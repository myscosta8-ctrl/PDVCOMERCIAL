import { describe, expect, it } from 'vitest'
import { montarInfNFe55, cfopPorDestino, aliquotaInterestadual, calcularDifal } from '../../supabase/functions/nfce/nfe55.ts'
import { montarCartaCorrecao, montarInutilizacao, CONDICAO_USO_CCE } from '../../supabase/functions/nfce/eventos.ts'
import { digitoChave } from '../../supabase/functions/nfce/xml.ts'

const valor = (xml, t) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1]
const dest = (extra = {}) => ({
  documento: '11.222.333/0001-81', nome: 'Clínica Bem-Estar Ltda', ie: '151112223', indIEDest: 1, email: 'compras@clinica.com.br',
  endereco: { logradouro: 'Av. Rio Branco', numero: '50', bairro: 'Centro', municipio: 'Breves', municipio_ibge: '1501808', uf: 'PA', cep: '68800-000' }, ...extra,
})
const nota = (extra = {}) => ({
  emitente: { cnpj: '12345678000195', ie: '151234567', razao_social: 'Farma Família Ltda', crt: 1, uf: 'PA', municipio_ibge: '1501808',
    endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', municipio: 'Breves', cep: '68800000' } },
  ambiente: 1, serie: 1, numero: 15, codigo_numerico: '87654321', emissao: new Date('2026-11-24T15:00:00Z'),
  natureza: 'Venda de mercadoria', finalidade: 1, presenca: 1, consumidorFinal: false, destinatario: dest(),
  itens: [{ codigo: '101', ean: '7896004700120', descricao: 'Dipirona 500 mg', ncm: '30049099', cfop: '5102', unidade: 'CX', quantidade: 10, valor_unitario: 6.9, desconto: 0, origem: 0, csosn: '102', frete: 5 }],
  frete: { modalidade: 0, volumes: { quantidade: 1, especie: 'Caixa', pesoBruto: 2.5 } },
  pagamentos: [{ forma: 'boleto', valor: 74 }], ...extra,
})

describe('NF-e modelo 55', () => {
  it('monta a venda dentro do estado para contribuinte', () => {
    const { chave, infNFe, vNF } = montarInfNFe55(nota())
    expect(chave.slice(20, 22)).toBe('55')
    expect(chave).toHaveLength(44)
    expect(Number(chave[43])).toBe(digitoChave(chave.slice(0, 43)))
    expect(infNFe).toContain('<mod>55</mod>')
    expect(infNFe).toContain('<idDest>1</idDest>')
    expect(infNFe).toContain('<tpImp>1</tpImp>')
    expect(infNFe).toContain('<indFinal>0</indFinal><indPres>1</indPres><procEmi>0</procEmi>')
    expect(infNFe).toContain('<CNPJ>11222333000181</CNPJ><xNome>Clínica Bem-Estar Ltda</xNome><enderDest>')
    expect(infNFe).toContain('<indIEDest>1</indIEDest><IE>151112223</IE><email>compras@clinica.com.br</email></dest>')
    expect(infNFe).toContain('<vFrete>5.00</vFrete>')
    expect(infNFe).toContain('<transp><modFrete>0</modFrete><vol><qVol>1</qVol><esp>Caixa</esp><pesoB>2.500</pesoB></vol></transp>')
    expect(infNFe).toContain('<tPag>15</tPag><vPag>74.00</vPag>')
    expect(vNF).toBe(74)
    expect(valor(infNFe.slice(infNFe.indexOf('<ICMSTot>')), 'vNF')).toBe('74.00')
    expect(infNFe).not.toContain('infNFeSupl')
  })
  it('para outro estado vira 6xxx', () => {
    const fora = dest({ endereco: { ...dest().endereco, uf: 'AM', municipio: 'Manaus', municipio_ibge: '1302603' } })
    const { infNFe } = montarInfNFe55(nota({ destinatario: fora }))
    expect(infNFe).toContain('<idDest>2</idDest>')
    expect(infNFe).toContain('<CFOP>6102</CFOP>')
  })
  it('DIFAL: regime normal informa ICMSUFDest; Simples Nacional não', () => {
    const fora = dest({ indIEDest: 9, ie: null, documento: '529.982.247-25', endereco: { ...dest().endereco, uf: 'AM', municipio: 'Manaus', municipio_ibge: '1302603' } })
    const normal = (extra = {}) => nota({ destinatario: fora, consumidorFinal: true,
      emitente: { ...nota().emitente, crt: 3 }, itens: [{ ...nota().itens[0], cst_icms: '00', aliquota_icms: 19 }], ...extra })
    const { infNFe, vICMSUFDest } = montarInfNFe55(normal())
    expect(infNFe).toContain('<CST>00</CST><modBC>3</modBC><vBC>74.00</vBC><pICMS>12.0000</pICMS><vICMS>8.88</vICMS>')
    expect(infNFe).toContain('<ICMSUFDest><vBCUFDest>74.00</vBCUFDest><pICMSUFDest>20.0000</pICMSUFDest><pICMSInter>12.00</pICMSInter><pICMSInterPart>100.0000</pICMSInterPart><vICMSUFDest>5.92</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet></ICMSUFDest><IBSCBS>')
    expect(infNFe).toContain('<vICMSDeson>0.00</vICMSDeson><vFCPUFDest>0.00</vFCPUFDest><vICMSUFDest>5.92</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet><vFCP>')
    expect(infNFe).toContain('DIFAL (EC 87/2015) devido a AM: ICMS R$ 5,92.')
    expect(vICMSUFDest).toBe(5.92)
    const dupla = montarInfNFe55(normal({ aliquotasUF: { AM: { fcp: 2, base_dupla: true } } }))
    expect(dupla.infNFe).toContain('<vBCUFDest>83.49</vBCUFDest><vBCFCPUFDest>83.49</vBCFCPUFDest><pFCPUFDest>2.0000</pFCPUFDest>')
    expect(dupla.vICMSUFDest).toBe(7.82)
    expect(dupla.vFCPUFDest).toBe(1.67)
    const simples = montarInfNFe55(nota({ destinatario: fora, consumidorFinal: true }))
    expect(simples.infNFe).not.toContain('ICMSUFDest')
  })
  it('alíquota interestadual e cálculo do DIFAL', () => {
    expect(aliquotaInterestadual('SP', 'PA', 0)).toBe(7)
    expect(aliquotaInterestadual('SP', 'RJ', 0)).toBe(12)
    expect(aliquotaInterestadual('SP', 'ES', 0)).toBe(7)
    expect(aliquotaInterestadual('PA', 'SP', 0)).toBe(12)
    expect(aliquotaInterestadual('PA', 'SP', 1)).toBe(4)
    expect(calcularDifal(1000, 7, { interna: 23, fcp: 0, base_dupla: false }).vICMSUFDest).toBe(160)
  })
  it('devolução referencia a nota de compra e vai sem pagamento', () => {
    const ref = '15261199888777000166550010000077771000077771'
    const { infNFe } = montarInfNFe55(nota({ finalidade: 4, presenca: 0, natureza: 'Devolução de compra', pagamentos: [], referencias: [ref],
      itens: [{ ...nota().itens[0], cfop: '5202', csosn: '900', aliquota_icms: 12, frete: 0 }] }))
    expect(infNFe).toContain(`<verProc>PDV Comercial 1.0</verProc><NFref><refNFe>${ref}</refNFe></NFref></ide>`)
    expect(infNFe).toContain('<finNFe>4</finNFe>')
    expect(infNFe).toContain('<tPag>90</tPag><vPag>0.00</vPag>')
    expect(infNFe).toContain('<ICMSSN900><orig>0</orig><CSOSN>900</CSOSN><modBC>3</modBC><vBC>69.00</vBC><pICMS>12.0000</pICMS><vICMS>8.28</vICMS></ICMSSN900>')
    expect(() => montarInfNFe55(nota({ finalidade: 4, referencias: [] }))).toThrow(/chave da nota/)
  })
  it('homologação troca o nome do destinatário e exige dados', () => {
    expect(montarInfNFe55(nota({ ambiente: 2 })).infNFe).toContain('<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome>')
    expect(() => montarInfNFe55(nota({ destinatario: dest({ endereco: { ...dest().endereco, municipio_ibge: '' } }) }))).toThrow(/IBGE/)
    expect(() => montarInfNFe55(nota({ pagamentos: [{ forma: 'pix', valor: 10 }] }))).toThrow(/não cobrem/)
  })
  it('CFOP por destino', () => {
    expect(cfopPorDestino('5102', true)).toBe('6102')
    expect(cfopPorDestino('6202', false)).toBe('5202')
  })
})

describe('carta de correção e inutilização da NF-e', () => {
  const chave55 = (() => { const b = '1526111234567800019555001000000015187654321'; return b + digitoChave(b) })()
  it('monta o evento 110110 com a condição de uso', () => {
    const { id, infEvento } = montarCartaCorrecao({ chave: chave55, cnpj: '12345678000195', uf: 'PA', ambiente: 2, correcao: 'Complemento do endereço: sala 2', quando: new Date('2026-11-24T15:00:00Z'), sequencia: 2 })
    expect(id).toBe(`ID110110${chave55}02`)
    expect(infEvento).toContain('<tpEvento>110110</tpEvento><nSeqEvento>2</nSeqEvento>')
    expect(infEvento).toContain(`<descEvento>Carta de Correcao</descEvento><xCorrecao>Complemento do endereço: sala 2</xCorrecao><xCondUso>${CONDICAO_USO_CCE}</xCondUso>`)
    expect(() => montarCartaCorrecao({ chave: chave55, cnpj: '1', uf: 'PA', ambiente: 2, correcao: 'curta', quando: new Date(), sequencia: 1 })).toThrow()
    expect(() => montarCartaCorrecao({ chave: chave55.replace('55001', '65001'), cnpj: '1', uf: 'PA', ambiente: 2, correcao: 'Correção longa o bastante', quando: new Date(), sequencia: 1 })).toThrow(/modelo 55/)
  })
  it('inutilização no modelo 55', () => {
    const { id, infInut } = montarInutilizacao({ cnpj: '12345678000195', uf: 'PA', ambiente: 2, serie: 1, inicio: 3, fim: 3, justificativa: 'Numeração pulada por falha do sistema', ano: 2026, modelo: 55 })
    expect(id).toBe('ID15261234567800019555001000000003000000003')
    expect(infInut).toContain('<mod>55</mod>')
  })
  it('IBS e CBS: regime normal destaca (2026), Simples não', () => {
    const normal = (item = {}, extra = {}) => nota({ emitente: { ...nota().emitente, crt: 3 }, itens: [{ ...nota().itens[0], cst_icms: '00', aliquota_icms: 19, ...item }], ...extra })
    const { infNFe, ibscbs } = montarInfNFe55(normal())
    // Base = 74,00 - ICMS 14,06 = 59,94; IBS UF 0,1% = 0,06; CBS 0,9% = 0,54
    expect(infNFe).toContain('<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>59.94</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>0.06</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.06</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>0.54</vCBS></gCBS></gIBSCBS></IBSCBS></imposto>')
    expect(infNFe).toContain('</ICMSTot><IBSCBSTot><vBCIBSCBS>59.94</vBCIBSCBS><gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>0.06</vIBSUF></gIBSUF>')
    expect(infNFe).toContain('<gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>0.54</vCBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot></total>')
    expect(ibscbs).toEqual({ vBC: 59.94, vIBSUF: 0.06, vIBSMun: 0, vCBS: 0.54 })
    // O total da nota não muda em 2026
    expect(valor(infNFe.slice(infNFe.indexOf('<ICMSTot>')), 'vNF')).toBe('74.00')
    const reduzida = montarInfNFe55(normal({ cst_ibscbs: '200', cclasstrib: '200014', reducao_ibscbs: 60 }))
    expect(reduzida.infNFe).toContain('<pIBSUF>0.1000</pIBSUF><gRed><pRedAliq>60.0000</pRedAliq><pAliqEfet>0.0400</pAliqEfet></gRed><vIBSUF>0.02</vIBSUF>')
    expect(reduzida.infNFe).toContain('<pCBS>0.9000</pCBS><gRed><pRedAliq>60.0000</pRedAliq><pAliqEfet>0.3600</pAliqEfet></gRed><vCBS>0.22</vCBS>')
    expect(montarInfNFe55(normal({ cst_ibscbs: '410', cclasstrib: '410001' })).infNFe).toContain('<IBSCBS><CST>410</CST><cClassTrib>410001</cClassTrib></IBSCBS>')
    expect(() => montarInfNFe55(normal({ cst_ibscbs: '200', cclasstrib: '000001' }))).toThrow(/não combinam/)
    expect(() => montarInfNFe55(normal({ cst_ibscbs: '200', cclasstrib: '200014' }))).toThrow(/redução/)
    expect(montarInfNFe55(nota()).infNFe).not.toContain('IBSCBS')
    expect(montarInfNFe55(normal({}, { emissao: new Date('2027-01-10T15:00:00Z') })).infNFe).not.toContain('IBSCBS')
    expect(montarInfNFe55(normal({}, { emissao: new Date('2027-01-10T15:00:00Z'), aliquotasIBSCBS: { 2027: { uf: 0.05, mun: 0.05, cbs: 8.8 } } })).infNFe).toContain('<pCBS>8.8000</pCBS>')
  })
  it('IBS e CBS com DIFAL: a base também desconta o DIFAL', () => {
    const fora = dest({ indIEDest: 9, ie: null, documento: '529.982.247-25', endereco: { ...dest().endereco, uf: 'AM', municipio: 'Manaus', municipio_ibge: '1302603' } })
    const { infNFe } = montarInfNFe55(nota({ destinatario: fora, consumidorFinal: true, emitente: { ...nota().emitente, crt: 3 }, itens: [{ ...nota().itens[0], cst_icms: '00', aliquota_icms: 19 }] }))
    // 74,00 - ICMS 8,88 - DIFAL 5,92 = 59,20
    expect(infNFe).toContain('</ICMSUFDest><IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>59.20</vBC>')
  })
})
