// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { cfopEntrada, cstEscrituracao, gerarSped, versaoLeiaute } from './sped.js'

const empresa = {
  razao_social: 'Loja Teste Ltda', nome_fantasia: 'Loja Teste', cnpj: '12345678000195', uf: 'PA', inscricao_estadual: '151234567', municipio_ibge: '1501808',
  regime_tributario: 'normal', sped_perfil: 'A', cod_receita_icms: '1113',
  endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '68800000' },
  contador: { nome: 'Contador', cpf: '12345678909', crc: 'PA-012345/O', municipio_ibge: '1501402' },
}
const dados = {
  empresa,
  notas: [{
    chave: '15261199888777000166550010000077771000077771', numero: 7777, serie: 1, emissao: '2026-10-05T10:00:00-03:00', entrada: '2026-10-06T13:00:00Z',
    valor_produtos: 100, valor_total: 105, duplicatas: [{ vencimento: '2026-11-05', valor: 105 }],
    fiscal: { vBC: 100, vICMS: 12, vFrete: 5, modFrete: '0' },
    fornecedor: { cnpj: '99888777000166', razao_social: 'Fornecedor | Ltda', inscricao_estadual: '159999999', municipio_ibge: '1501402', endereco: { logradouro: 'Rua B' } },
    itens: [{ n_item: 1, cod_item: 'P1', unidade: 'UN', quantidade: 10, custo_unitario: 10, fiscal: { cfop: '6102', orig: '0', cst: '00', vProd: 100, vBC: 100, pICMS: 12, vICMS: 12 } }],
  }],
  produtos: [{ cod_item: 'P1', descricao: 'Produto 1', ean: '7890000000011', unidade: 'UN', ncm: '96032100', aliquota_icms: 19 }],
  inventario: [{ cod_item: 'P1', unidade: 'UN', quantidade: 4, custo: 10 }],
}
const nfceXml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe><ide><dhEmi>2026-10-10T20:30:00-03:00</dhEmi></ide>
<det nItem="1"><prod><CFOP>5102</CFOP><vProd>100.00</vProd><vDesc>10.00</vDesc></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>90.00</vBC><pICMS>19.0000</pICMS><vICMS>17.10</vICMS></ICMS00></ICMS></imposto></det>
<total><ICMSTot><vBC>90.00</vBC><vICMS>17.10</vICMS><vProd>100.00</vProd><vDesc>10.00</vDesc><vNF>90.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`
const nfce = [
  { numero: 10, serie: 1, chave: '15261012345678000195650010000000101123456780', status: 'autorizada', emitida_em: '2026-10-10T23:30:00Z', xml_autorizado: nfceXml },
  { numero: 11, serie: 1, chave: '15261012345678000195650010000000111123456781', status: 'cancelada', emitida_em: '2026-10-11T12:00:00Z' },
]
const op = { inutilizadas: [{ serie: 1, inicio: 12, fim: 13 }], inicio: '2026-10-01', fim: '2026-10-31', finalidade: '0', saldoCredorAnterior: 0, vencimentoIcms: '2026-11-10', inventario: { data: '2026-10-31', motivo: '01', conta: '1.1.4.01' } }

const QTD_CAMPOS = { '0000': 15, '0005': 10, '0100': 14, '0150': 13, '0190': 3, '0200': 13, C100: 29, C170: 38, C190: 12, E110: 15, E116: 10, H005: 4, H010: 11, 1010: 14 }

describe('SPED Fiscal', () => {
  const { texto, resumo } = gerarSped(dados, nfce, op)
  const linhas = texto.trimEnd().split('\r\n')
  const campos = linhas.map((l) => l.slice(1, -1).split('|'))

  it('cada registro tem o número de campos do leiaute', () => {
    for (const c of campos) if (QTD_CAMPOS[c[0]]) expect([c[0], c.length]).toEqual([c[0], QTD_CAMPOS[c[0]]])
  })
  it('fecha os totais do bloco 9 e dos blocos', () => {
    expect(campos.at(-1)).toEqual(['9999', String(linhas.length)])
    const cont = {}
    for (const c of campos) cont[c[0]] = (cont[c[0]] ?? 0) + 1
    for (const c of campos.filter((x) => x[0] === '9900')) expect(Number(c[2])).toBe(cont[c[1]])
    const qtdBloco = (b) => campos.filter((c) => c[0][0] === b).length
    expect(campos.find((c) => c[0] === 'C990')[1]).toBe(String(qtdBloco('C')))
    expect(campos.find((c) => c[0] === '0990')[1]).toBe(String(qtdBloco('0')))
    expect(campos.find((c) => c[0] === 'H990')[1]).toBe(String(qtdBloco('H')))
  })
  it('escritura entrada com crédito, NFC-e com débito e apura o ICMS', () => {
    expect(campos.find((c) => c[0] === '0000')[1]).toBe('020')
    const c170 = campos.find((c) => c[0] === 'C170')
    expect([c170[9], c170[10], c170[14]]).toEqual(['000', '2102', '12,00'])
    const c190Entrada = campos.find((c) => c[0] === 'C190')
    expect(c190Entrada[4]).toBe('105,00') // frete entra no valor da operação
    expect(campos.filter((c) => c[0] === 'C100' && c[5] === '02')).toHaveLength(1)
    expect(campos.filter((c) => c[0] === 'C100' && c[5] === '05').map((c) => c[7])).toEqual(['12', '13'])
    expect(resumo).toMatchObject({ debito: 17.1, credito: 12, recolher: 5.1 })
    expect(campos.find((c) => c[0] === 'E116')[2]).toBe('5,10')
    expect(campos.find((c) => c[0] === 'H005')[2]).toBe('40,00')
    expect(texto).not.toContain('Fornecedor | Ltda')
  })
  it('converte CFOP e CST de entrada', () => {
    expect(cfopEntrada('5405')).toBe('1403')
    expect(cfopEntrada('6102')).toBe('2102')
    expect(cfopEntrada('5910')).toBe('1910')
    expect(cstEscrituracao('0', null, '500')).toBe('060')
    expect(cstEscrituracao('2', '20', null)).toBe('220')
    expect(versaoLeiaute('2027-01-31')).toBe('021')
  })
})
