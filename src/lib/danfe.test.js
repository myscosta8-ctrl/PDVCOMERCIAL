// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { lerNfe55, htmlDanfe } from './danfe.js'
import { montarInfNFe55 } from '../../supabase/functions/nfce/nfe55.ts'

const nota = (crt) => montarInfNFe55({
  emitente: { cnpj: '12345678000195', ie: '151234567', razao_social: 'Loja Exemplo Ltda', crt, uf: 'PA', municipio_ibge: '1501808',
    endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', municipio: 'Breves', cep: '68800000' } },
  ambiente: 1, serie: 1, numero: 15, codigo_numerico: '87654321', emissao: new Date('2026-11-24T15:00:00Z'),
  natureza: 'Venda de mercadoria', finalidade: 1, presenca: 1, consumidorFinal: false,
  destinatario: { documento: '11222333000181', nome: 'Cliente Ltda', ie: '151112223', indIEDest: 1,
    endereco: { logradouro: 'Av. B', numero: '50', bairro: 'Centro', municipio: 'Breves', municipio_ibge: '1501808', uf: 'PA', cep: '68800000' } },
  itens: [{ codigo: '101', descricao: 'Produto', ncm: '30049099', cfop: '5102', unidade: 'UN', quantidade: 10, valor_unitario: 10, desconto: 0, origem: 0, csosn: '102', cst_icms: '00', aliquota_icms: 19 }],
  frete: { modalidade: 9 }, pagamentos: [{ forma: 'dinheiro', valor: 100 }],
})
const xml = (crt) => `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe>${nota(crt).infNFe}</NFe></nfeProc>`

describe('DANFE da NF-e', () => {
  it('mostra IBS e CBS quando a nota tem o grupo', () => {
    const d = lerNfe55(xml(3))
    // 100,00 - ICMS 19,00 = 81,00; IBS 0,08; CBS 0,73
    expect(d.ibscbs).toEqual({ vBC: 81, vIBS: 0.08, vCBS: 0.73 })
    const html = htmlDanfe(d)
    expect(html).toContain('Valor da CBS')
    expect(html).toContain('0,73')
  })
  it('sem o grupo (Simples Nacional), não mostra a linha', () => {
    const d = lerNfe55(xml(1))
    expect(d.ibscbs).toBeNull()
    expect(htmlDanfe(d)).not.toContain('Valor da CBS')
  })
})
