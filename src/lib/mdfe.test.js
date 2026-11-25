import { describe, expect, it } from 'vitest'
import { gunzipSync } from 'fflate'
import { montarInfMDFe, montarMDFe, compactar, montarEncerramento, montarCancelamentoMDFe, cpfValido } from '../../supabase/functions/nfce/mdfe.ts'
import { digitoChave } from '../../supabase/functions/nfce/xml.ts'

const NFE1 = '15261112345678000195550010000000151876543211'
const NFE2 = '15261112345678000195550010000000161876543212'
const dados = (extra = {}) => ({
  emitente: { cnpj: '12345678000195', ie: '151234567', razao_social: 'Loja Exemplo Ltda', uf: 'PA', municipio_ibge: '1501808',
    endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', municipio: 'Breves', cep: '68800000', fone: '91999990000' } },
  ambiente: 2, serie: 1, numero: 7, codigo_numerico: '12345678', emissao: new Date('2026-11-24T15:00:00Z'),
  ufInicio: 'PA', ufFim: 'AM', percurso: [],
  carregamento: [{ codigo: '1501808', nome: 'Breves' }],
  descargas: [{ codigo: '1302603', nome: 'Manaus', chaves: [NFE1, NFE2] }],
  veiculo: { placa: 'abc-1d23', renavam: '123456789', tara: 3500, capKG: 6000, tpRod: '01', tpCar: '02', uf: 'PA' },
  condutores: [{ nome: 'João da Silva', cpf: '529.982.247-25' }],
  produto: { tpCarga: '05', xProd: 'Medicamentos', ncm: '30049099' },
  valorCarga: 1520.4, unidade: '01', pesoCarga: 320.5, ...extra,
})

describe('MDF-e (modelo 58)', () => {
  it('monta o manifesto rodoviário de carga própria', () => {
    const { chave, infMDFe, qrCode, placa, qNFe } = montarInfMDFe(dados())
    expect(chave).toHaveLength(44)
    expect(chave.slice(20, 22)).toBe('58')
    expect(Number(chave[43])).toBe(digitoChave(chave.slice(0, 43)))
    expect(placa).toBe('ABC1D23')
    expect(qNFe).toBe(2)
    expect(infMDFe).toContain(`<infMDFe Id="MDFe${chave}" versao="3.00"><ide><cUF>15</cUF><tpAmb>2</tpAmb><tpEmit>2</tpEmit><mod>58</mod><serie>1</serie><nMDF>7</nMDF><cMDF>12345678</cMDF>`)
    expect(infMDFe).toContain('<modal>1</modal><dhEmi>2026-11-24T12:00:00-03:00</dhEmi><tpEmis>1</tpEmis><procEmi>0</procEmi><verProc>PDV Comercial 1.0</verProc><UFIni>PA</UFIni><UFFim>AM</UFFim><infMunCarrega><cMunCarrega>1501808</cMunCarrega><xMunCarrega>Breves</xMunCarrega></infMunCarrega></ide>')
    expect(infMDFe).toContain('<emit><CNPJ>12345678000195</CNPJ><IE>151234567</IE><xNome>Loja Exemplo Ltda</xNome><enderEmit>')
    expect(infMDFe).toContain('<infModal versaoModal="3.00"><rodo><veicTracao><placa>ABC1D23</placa><RENAVAM>123456789</RENAVAM><tara>3500</tara><capKG>6000</capKG><condutor><xNome>João da Silva</xNome><CPF>52998224725</CPF></condutor><tpRod>01</tpRod><tpCar>02</tpCar><UF>PA</UF></veicTracao></rodo></infModal>')
    expect(infMDFe).toContain(`<infDoc><infMunDescarga><cMunDescarga>1302603</cMunDescarga><xMunDescarga>Manaus</xMunDescarga><infNFe><chNFe>${NFE1}</chNFe></infNFe><infNFe><chNFe>${NFE2}</chNFe></infNFe></infMunDescarga></infDoc>`)
    expect(infMDFe).toContain('<prodPred><tpCarga>05</tpCarga><xProd>Medicamentos</xProd><NCM>30049099</NCM></prodPred><tot><qNFe>2</qNFe><vCarga>1520.40</vCarga><cUnid>01</cUnid><qCarga>320.5000</qCarga></tot></infMDFe>')
    expect(qrCode).toBe(`https://dfe-portal.svrs.rs.gov.br/mdfe/qrCode?chMDFe=${chave}&tpAmb=2`)
    const xml = montarMDFe(infMDFe, '<Signature/>', qrCode)
    expect(xml).toContain('</infMDFe><infMDFeSupl><qrCodMDFe><![CDATA[')
    expect(new TextDecoder().decode(gunzipSync(Uint8Array.from(atob(compactar(xml)), (c) => c.charCodeAt(0))))).toBe(xml)
  })
  it('percurso e validações', () => {
    expect(montarInfMDFe(dados({ ufFim: 'SP', percurso: ['TO', 'GO'], descargas: [{ codigo: '3550308', nome: 'São Paulo', chaves: [NFE1] }] })).infMDFe)
      .toContain('</infMunCarrega><infPercurso><UFPer>TO</UFPer></infPercurso><infPercurso><UFPer>GO</UFPer></infPercurso></ide>')
    expect(() => montarInfMDFe(dados({ percurso: ['PA'] }))).toThrow(/percurso/)
    expect(() => montarInfMDFe(dados({ descargas: [{ codigo: '1302603', nome: 'Manaus', chaves: [] }] }))).toThrow(/NF-e/)
    expect(() => montarInfMDFe(dados({ descargas: [{ codigo: '1302603', nome: 'Manaus', chaves: [NFE1, NFE1] }] }))).toThrow(/duas vezes/)
    expect(() => montarInfMDFe(dados({ veiculo: { ...dados().veiculo, placa: 'XX12' } }))).toThrow(/Placa/)
    expect(() => montarInfMDFe(dados({ condutores: [{ nome: 'Fulano', cpf: '111.111.111-11' }] }))).toThrow(/condutores/)
    expect(() => montarInfMDFe(dados({ pesoCarga: 0 }))).toThrow(/peso/)
    expect(cpfValido('52998224725')).toBe(true)
    expect(cpfValido('52998224724')).toBe(false)
  })
  it('encerramento e cancelamento', () => {
    const chave = montarInfMDFe(dados()).chave
    const base = { chave, cnpj: '12345678000195', ambiente: 2, quando: new Date('2026-11-25T18:00:00Z'), protocolo: '915260000012345' }
    const enc = montarEncerramento({ ...base, uf: 'AM', municipio: '1302603' })
    expect(enc.id).toBe(`ID110112${chave}01`)
    expect(enc.infEvento).toBe(`<infEvento Id="ID110112${chave}01"><cOrgao>15</cOrgao><tpAmb>2</tpAmb><CNPJ>12345678000195</CNPJ><chMDFe>${chave}</chMDFe><dhEvento>2026-11-25T15:00:00-03:00</dhEvento><tpEvento>110112</tpEvento><nSeqEvento>1</nSeqEvento><detEvento versaoEvento="3.00"><evEncMDFe><descEvento>Encerramento</descEvento><nProt>915260000012345</nProt><dtEnc>2026-11-25</dtEnc><cUF>13</cUF><cMun>1302603</cMun></evEncMDFe></detEvento></infEvento>`)
    expect(montarCancelamentoMDFe({ ...base, justificativa: 'Viagem desistida pelo cliente final' }).infEvento)
      .toContain('<tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><detEvento versaoEvento="3.00"><evCancMDFe><descEvento>Cancelamento</descEvento><nProt>915260000012345</nProt><xJust>Viagem desistida pelo cliente final</xJust></evCancMDFe>')
    expect(() => montarCancelamentoMDFe({ ...base, justificativa: 'curto' })).toThrow(/15 letras/)
    expect(() => montarEncerramento({ ...base, uf: 'AM', municipio: '13' })).toThrow(/município/)
  })
})
