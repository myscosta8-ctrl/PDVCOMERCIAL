// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { lerXmlNfe } from './nfe.js'

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe15261111222333000144550010000012341000012345" versao="4.00">
<ide><cUF>15</cUF><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>11222333000144</CNPJ><xNome>DISTRIBUIDORA TESTE LTDA</xNome><xFant>DIST TESTE</xFant><enderEmit><UF>PA</UF><fone>9132220000</fone></enderEmit><IE>151111111</IE></emit>
<dest><CNPJ>12345678000195</CNPJ></dest>
<det nItem="1"><prod><cProd>AMX500</cProd><cEAN>7890000000011</cEAN><xProd>AMOXICILINA 500MG CX 12</xProd><NCM>30042099</NCM><CFOP>5102</CFOP><uCom>CX</uCom><qCom>2.0000</qCom><vUnCom>100.00</vUnCom><vProd>200.00</vProd><vDesc>10.00</vDesc><vFrete>4.00</vFrete>
<rastro><nLote>L123</nLote><qLote>2</qLote><dFab>2026-01-10</dFab><dVal>2028-01-10</dVal></rastro><med><cProdANVISA>1234567890123</cProdANVISA><vPMC>150.00</vPMC></med></prod>
<imposto><ICMS><ICMS10><vICMSST>6.00</vICMSST></ICMS10></ICMS><IPI><IPITrib><vIPI>0</vIPI></IPITrib></IPI></imposto></det>
<det nItem="2"><prod><cProd>GAZ</cProd><cEAN>SEM GTIN</cEAN><xProd>GAZE</xProd><NCM>30059090</NCM><CFOP>5102</CFOP><uCom>PCT</uCom><qCom>10</qCom><vUnCom>1.5</vUnCom><vProd>15.00</vProd></prod><imposto></imposto></det>
<total><ICMSTot><vProd>215.00</vProd><vNF>215.00</vNF></ICMSTot></total>
<cobr><dup><nDup>001</nDup><dVenc>2026-12-20</dVenc><vDup>215.00</vDup></dup></cobr>
</infNFe></NFe><protNFe><infProt><chNFe>15261111222333000144550010000012341000012345</chNFe></infProt></protNFe></nfeProc>`

describe('leitura do XML da NF-e', () => {
  const n = lerXmlNfe(XML)
  it('lê cabeçalho, fornecedor e duplicatas', () => {
    expect(n.chave).toBe('15261111222333000144550010000012341000012345')
    expect(n.autorizada).toBe(true)
    expect(n.numero).toBe(1234)
    expect(n.fornecedor).toMatchObject({ cnpj: '11222333000144', razao_social: 'DISTRIBUIDORA TESTE LTDA', uf: 'PA' })
    expect(n.destinatario_cnpj).toBe('12345678000195')
    expect(n.duplicatas).toEqual([{ numero: '001', vencimento: '2026-12-20', valor: 215 }])
  })
  it('calcula custo com desconto, frete e ST e lê lote', () => {
    const [a, b] = n.itens
    expect(a.custo_unitario).toBe(100) // (200 - 10 + 4 + 6) / 2
    expect(a.rastros[0]).toEqual({ lote: 'L123', quantidade: 2, fabricacao: '2026-01-10', validade: '2028-01-10' })
    expect(a.registro_ms).toBe('1234567890123')
    expect(b.ean).toBe(null)
    expect(b.custo_unitario).toBe(1.5)
  })
  it('recusa arquivo que não é NF-e', () => {
    expect(() => lerXmlNfe('<a/>')).toThrow('não é uma NF-e')
  })
  it('guarda os dados fiscais do item para o SPED', () => {
    const n = lerXmlNfe(XML)
    expect(n.itens[0].fiscal).toMatchObject({ cfop: '5102', vICMSST: 6 })
    expect(n.fiscal).toHaveProperty('vICMS')
  })
})
