import { describe, expect, it } from 'vitest'
import { gzipSync, strToU8 } from 'fflate'
import { pedidoDistribuicao, pedidoPorChave, lerDistribuicao, interpretar, montarManifestacao } from '../../supabase/functions/nfce/dfe.ts'

const zip = (xml) => Buffer.from(gzipSync(strToU8(xml))).toString('base64')
const CHAVE = '15261199888777000166550010000077771000077771'
const resumo = `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${CHAVE}</chNFe><CNPJ>99888777000166</CNPJ><xNome>Distribuidora Norte Farma Ltda</xNome><IE>151999888</IE><dhEmi>2026-11-20T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>1520.40</vNF><digVal>abc=</digVal><dhRecbto>2026-11-20T10:00:05-03:00</dhRecbto><nProt>315260000099999</nProt><cSitNFe>1</cSitNFe></resNFe>`
const evento = `<resEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><cOrgao>15</cOrgao><CNPJ>99888777000166</CNPJ><chNFe>${CHAVE}</chNFe><dhEvento>2026-11-20T11:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><xEvento>Cancelamento</xEvento></resEvento>`
const proc = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${CHAVE}" versao="4.00"><ide><nNF>7777</nNF><dhEmi>2026-11-20T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>99888777000166</CNPJ><xNome>Distribuidora Norte Farma Ltda</xNome><IE>151999888</IE></emit><dest><CNPJ>12345678000195</CNPJ></dest><total><ICMSTot><vNF>1520.40</vNF></ICMSTot></total></infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>${CHAVE}</chNFe><nProt>315260000099999</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`

const resposta = (cStat, docs = '', ult = '000000000000012', max = '000000000000020') =>
  `<soap:Envelope><soap:Body><nfeDistDFeInteresseResponse><nfeDistDFeInteresseResult><retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><verAplic>1</verAplic><cStat>${cStat}</cStat><xMotivo>Documento localizado</xMotivo><dhResp>2026-11-24T10:00:00-03:00</dhResp><ultNSU>${ult}</ultNSU><maxNSU>${max}</maxNSU>${docs ? `<loteDistDFeInt>${docs}</loteDistDFeInt>` : ''}</retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>`

describe('Distribuição de documentos (notas contra o CNPJ)', () => {
  it('monta os pedidos por NSU e por chave', () => {
    expect(pedidoDistribuicao(1, '15', '12.345.678/0001-95', '42')).toBe(
      '<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>15</cUFAutor><CNPJ>12345678000195</CNPJ><distNSU><ultNSU>000000000000042</ultNSU></distNSU></distDFeInt>')
    expect(pedidoPorChave(2, '15', '12345678000195', CHAVE)).toContain(`<consChNFe><chNFe>${CHAVE}</chNFe></consChNFe>`)
    expect(() => pedidoPorChave(1, '15', '1', '123')).toThrow(/Chave/)
  })
  it('lê o lote, descompacta e interpreta resumo, nota completa e cancelamento', () => {
    const r = lerDistribuicao(resposta('138',
      `<docZip NSU="000000000000010" schema="resNFe_v1.01.xsd">${zip(resumo)}</docZip>` +
      `<docZip NSU="000000000000011" schema="procNFe_v4.00.xsd">${zip(proc)}</docZip>` +
      `<docZip NSU="000000000000012" schema="resEvento_v1.01.xsd">${zip(evento)}</docZip>`))
    expect(r.cStat).toBe('138')
    expect(r.ultNSU).toBe('000000000000012')
    expect(r.maxNSU).toBe('000000000000020')
    expect(r.docs).toHaveLength(3)
    const a = interpretar(r.docs[0]).nota
    expect(a).toMatchObject({ chave: CHAVE, cnpj_emitente: '99888777000166', nome_emitente: 'Distribuidora Norte Farma Ltda', valor: 1520.4, situacao: 1, resumo: true, xml: null })
    const b = interpretar(r.docs[1]).nota
    expect(b).toMatchObject({ chave: CHAVE, cnpj_emitente: '99888777000166', valor: 1520.4, resumo: false, protocolo: '315260000099999' })
    expect(b.xml).toContain('<nfeProc')
    expect(interpretar(r.docs[2]).evento).toEqual({ chave: CHAVE, tpEvento: '110111' })
  })
  it('sem documentos', () => {
    const r = lerDistribuicao(resposta('137', '', '000000000000020', '000000000000020'))
    expect(r.cStat).toBe('137')
    expect(r.docs).toEqual([])
  })
})

describe('Manifestação do destinatário', () => {
  const base = { chave: CHAVE, cnpj: '12.345.678/0001-95', ambiente: 1, quando: new Date('2026-11-24T15:00:00Z') }
  it('ciência da operação no Ambiente Nacional', () => {
    const { id, infEvento } = montarManifestacao({ ...base, tipo: 'ciencia' })
    expect(id).toBe(`ID210210${CHAVE}01`)
    expect(id).toHaveLength(54)
    expect(infEvento).toBe(`<infEvento Id="${id}"><cOrgao>91</cOrgao><tpAmb>1</tpAmb><CNPJ>12345678000195</CNPJ><chNFe>${CHAVE}</chNFe><dhEvento>2026-11-24T12:00:00-03:00</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento>`)
  })
  it('operação não realizada exige justificativa', () => {
    expect(() => montarManifestacao({ ...base, tipo: 'nao_realizada', justificativa: 'curta' })).toThrow(/15 letras/)
    const { infEvento } = montarManifestacao({ ...base, tipo: 'nao_realizada', justificativa: 'Mercadoria recusada na entrega por avaria' })
    expect(infEvento).toContain('<tpEvento>210240</tpEvento>')
    expect(infEvento).toContain('<descEvento>Operacao nao Realizada</descEvento><xJust>Mercadoria recusada na entrega por avaria</xJust>')
    expect(montarManifestacao({ ...base, tipo: 'confirmada' }).infEvento).toContain('<descEvento>Confirmacao da Operacao</descEvento>')
    expect(montarManifestacao({ ...base, tipo: 'desconhecida' }).infEvento).toContain('<tpEvento>210220</tpEvento>')
  })
})
