import { describe, expect, it } from 'vitest'
import { montarInfNFe } from '../../supabase/functions/nfce/xml.ts'

const base = (crt, item) => ({
  emitente: { cnpj: '12345678000195', ie: '151234567', razao_social: 'Loja Teste Ltda', crt, uf: 'PA', municipio_ibge: '1501808',
    endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', municipio: 'Breves', cep: '68800000' } },
  ambiente: 2, serie: 1, numero: 10, codigo_numerico: '12345678', emissao: new Date('2026-11-24T15:00:00Z'),
  itens: [{ codigo: '1', ean: null, descricao: 'Produto', ncm: '96032100', cfop: '5102', unidade: 'UN', quantidade: 2, valor_unitario: 50, desconto: 10, origem: 0, ...item }],
  pagamentos: [{ forma: 'dinheiro', valor: 90 }], troco: 0,
})
const valor = (xml, t) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1]

describe('NFC-e: tributação pela regra', () => {
  it('regime normal com CST 00 destaca ICMS, PIS e COFINS', () => {
    const { infNFe } = montarInfNFe(base(3, { cst_icms: '00', aliquota_icms: 19, cst_pis: '01', aliquota_pis: 1.65, cst_cofins: '01', aliquota_cofins: 7.6 }))
    expect(infNFe).toContain('<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>90.00</vBC><pICMS>19.0000</pICMS><vICMS>17.10</vICMS></ICMS00>')
    expect(infNFe).toContain('<PISAliq><CST>01</CST><vBC>90.00</vBC><pPIS>1.6500</pPIS><vPIS>1.49</vPIS></PISAliq>')
    const tot = infNFe.slice(infNFe.indexOf('<ICMSTot>'))
    expect(valor(tot, 'vBC')).toBe('90.00')
    expect(valor(tot, 'vICMS')).toBe('17.10')
    expect(valor(tot, 'vCOFINS')).toBe('6.84')
  })
  it('CST 20 aplica a redução da base', () => {
    const { infNFe } = montarInfNFe(base(3, { cst_icms: '20', aliquota_icms: 18, reducao_bc: 33.33 }))
    expect(infNFe).toContain('<pRedBC>33.3300</pRedBC><vBC>60.00</vBC><pICMS>18.0000</pICMS><vICMS>10.80</vICMS>')
  })
  it('Simples com PIS monofásico usa o grupo NT e não destaca ICMS', () => {
    const { infNFe } = montarInfNFe(base(1, { csosn: '500', cst_pis: '04', cst_cofins: '04' }))
    expect(infNFe).toContain('<ICMSSN500><orig>0</orig><CSOSN>500</CSOSN></ICMSSN500>')
    expect(infNFe).toContain('<PISNT><CST>04</CST></PISNT>')
    expect(valor(infNFe.slice(infNFe.indexOf('<ICMSTot>')), 'vICMS')).toBe('0.00')
  })
})
