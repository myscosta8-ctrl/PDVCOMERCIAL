import { describe, expect, it } from 'vitest'
import forge from 'node-forge'
import { montarInfNFe, digitoChave } from '../../supabase/functions/nfce/xml.ts'
import { montarCancelamento, envelopeEvento, montarInutilizacao, envelopeInutilizacao, consultaProtocolo, parametrosQrV3Offline, montarQrCodeV3Offline, validarJustificativa } from '../../supabase/functions/nfce/eventos.ts'
import { assinar, assinarTexto } from '../../supabase/functions/nfce/assinatura.ts'

// Certificado de teste gerado na hora (nada real)
function certificadoTeste() {
  const chaves = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
  const c = forge.pki.createCertificate()
  c.publicKey = chaves.publicKey; c.serialNumber = '01'
  c.validity.notBefore = new Date(); c.validity.notAfter = new Date(Date.now() + 864e5)
  c.setSubject([{ name: 'commonName', value: 'LOJA TESTE:12345678000195' }]); c.setIssuer(c.subject.attributes); c.sign(chaves.privateKey)
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes()
  return { privada: chaves.privateKey, publica: chaves.publicKey, certBase64: forge.util.encode64(der), certPem: '', chavePem: '', titular: '', cnpj: '12345678000195', validoAte: c.validity.notAfter }
}
const cert = certificadoTeste()
const chave = (() => { const b = '1526111234567800019565001000000123912345678'; return b + digitoChave(b) })()

const nota = (extra = {}) => ({
  emitente: { cnpj: '12345678000195', ie: '151234567', razao_social: 'Loja Teste Ltda', crt: 1, uf: 'PA', municipio_ibge: '1501808',
    endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', municipio: 'Breves', cep: '68800000' } },
  ambiente: 2, serie: 1, numero: 123, codigo_numerico: '12345678', emissao: new Date('2026-11-24T15:00:00Z'),
  itens: [{ codigo: '1', ean: null, descricao: 'Produto', ncm: '96032100', cfop: '5102', unidade: 'UN', quantidade: 1, valor_unitario: 18.4, desconto: 0, origem: 0 }],
  pagamentos: [{ forma: 'dinheiro', valor: 18.4 }], troco: 0, ...extra,
})

describe('NFC-e em contingência off-line', () => {
  it('marca tpEmis 9 na chave e no XML, com início e motivo', () => {
    const { chave: ch, infNFe } = montarInfNFe(nota({ contingencia: { inicio: new Date('2026-11-24T14:58:00Z'), justificativa: 'Sem comunicação com a SEFAZ autorizadora' } }))
    expect(ch[34]).toBe('9')
    expect(infNFe).toContain('<tpEmis>9</tpEmis>')
    expect(infNFe).toContain('<dhCont>2026-11-24T11:58:00-03:00</dhCont><xJust>Sem comunicação com a SEFAZ autorizadora</xJust></ide>')
    expect(montarInfNFe(nota()).chave[34]).toBe('1')
  })
  it('QR Code versão 3 assinado, com e sem consumidor identificado', () => {
    const p = parametrosQrV3Offline(chave, 2, new Date('2026-11-24T15:00:00Z'), 18.4, '123.456.789-09')
    expect(p).toBe(`${chave}|3|2|24|18.40|2|12345678909`)
    expect(parametrosQrV3Offline(chave, 2, new Date('2026-11-24T15:00:00Z'), 18.4, null)).toBe(`${chave}|3|2|24|18.40||`)
    const ass = assinarTexto(p, cert)
    const md = forge.md.sha1.create(); md.update(p, 'utf8')
    expect(cert.publica.verify(md.digest().bytes(), forge.util.decode64(ass))).toBe(true)
    expect(montarQrCodeV3Offline(p, ass, 'https://qr.exemplo/nfce')).toBe(`https://qr.exemplo/nfce?p=${p}|${ass}`)
  })
  it('o dia vem do horário de Brasília', () => {
    expect(parametrosQrV3Offline(chave, 1, new Date('2026-11-25T01:30:00Z'), 1)).toContain('|1|24|1.00|')
  })
})

describe('cancelamento', () => {
  it('monta o evento 110111 assinado', () => {
    const { id, infEvento } = montarCancelamento({ chave, protocolo: '315260000012345', cnpj: '12.345.678/0001-95', uf: 'PA', ambiente: 2, justificativa: 'Cliente desistiu da compra no caixa', quando: new Date('2026-11-24T15:10:00Z') })
    expect(id).toBe(`ID110111${chave}01`)
    expect(id).toHaveLength(54)
    expect(infEvento).toContain('<cOrgao>15</cOrgao><tpAmb>2</tpAmb><CNPJ>12345678000195</CNPJ>')
    expect(infEvento).toContain('<dhEvento>2026-11-24T12:10:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento>')
    expect(infEvento).toContain('<detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>315260000012345</nProt><xJust>Cliente desistiu da compra no caixa</xJust></detEvento>')
    const { lote } = envelopeEvento(infEvento, assinar(infEvento, 'infEvento', id, cert), 42)
    expect(lote).toMatch(/^<envEvento xmlns="http:\/\/www.portalfiscal.inf.br\/nfe" versao="1.00"><idLote>42<\/idLote><evento xmlns=[^>]+><infEvento Id=/)
    expect(lote).toContain(`<Reference URI="#${id}">`)
  })
  it('exige justificativa de 15 letras', () => {
    expect(() => validarJustificativa('curta')).toThrow(/15 letras/)
    expect(() => montarCancelamento({ chave, protocolo: '1', cnpj: '1', uf: 'PA', ambiente: 2, justificativa: 'x', quando: new Date() })).toThrow()
  })
})

describe('inutilização', () => {
  it('monta o Id e os campos na ordem do leiaute', () => {
    const { id, infInut } = montarInutilizacao({ cnpj: '12345678000195', uf: 'PA', ambiente: 2, serie: 1, inicio: 5, fim: 7, justificativa: 'Falha no sistema pulou a numeração', ano: 2026 })
    expect(id).toBe('ID15261234567800019565001000000005000000007')
    expect(id).toHaveLength(43)
    expect(infInut).toContain('<tpAmb>2</tpAmb><xServ>INUTILIZAR</xServ><cUF>15</cUF><ano>26</ano><CNPJ>12345678000195</CNPJ><mod>65</mod><serie>1</serie><nNFIni>5</nNFIni><nNFFin>7</nNFFin>')
    expect(envelopeInutilizacao(infInut, '<Signature/>')).toMatch(/^<inutNFe xmlns="[^"]+" versao="4.00"><infInut/)
  })
  it('recusa faixa invertida ou grande demais', () => {
    expect(() => montarInutilizacao({ cnpj: '1', uf: 'PA', ambiente: 2, serie: 1, inicio: 9, fim: 3, justificativa: 'Falha no sistema pulou a numeração', ano: 2026 })).toThrow()
    expect(() => montarInutilizacao({ cnpj: '1', uf: 'PA', ambiente: 2, serie: 1, inicio: 1, fim: 20000, justificativa: 'Falha no sistema pulou a numeração', ano: 2026 })).toThrow()
  })
  it('consulta pela chave', () => {
    expect(consultaProtocolo(chave, 1)).toBe(`<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>1</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`)
  })
})
