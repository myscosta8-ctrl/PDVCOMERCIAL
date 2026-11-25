// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase.js', () => ({ supabase: {} }))
import { dadosDoXml } from './nfce.js'
import { montarInfNFe, pagamentosProporcionais } from '../../supabase/functions/nfce/xml.ts'

describe('DANFE NFC-e a partir do XML', () => {
  it('usa itens, totais e pagamentos da nota', () => {
    const pags = pagamentosProporcionais([{ forma: 'pix', valor: 200 }, { forma: 'dinheiro', valor: 100 }], 30, 270, 150)
    const { infNFe } = montarInfNFe({
      emitente: { cnpj: '12345678000195', ie: '151234567', razao_social: 'Loja', crt: 1, uf: 'PA', municipio_ibge: '1501808',
        endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', municipio: 'Breves', cep: '68800000' } },
      ambiente: 2, serie: 1, numero: 1, codigo_numerico: '12345678', emissao: new Date('2026-11-24T15:00:00Z'),
      itens: [{ codigo: '1', descricao: 'Tela de reposição', ncm: '85177099', cfop: '5102', unidade: 'UN', quantidade: 1, valor_unitario: 150, desconto: 0, origem: 0 }],
      pagamentos: pags.pagamentos, troco: pags.troco, informacoes: 'Serviços prestados nesta venda (R$ 120,00) não estão incluídos neste documento.',
    })
    const d = dadosDoXml(`<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>`)
    expect(d.itens).toHaveLength(1)
    expect(d.total).toBe(150)
    expect(d.pagamentos.map((p) => p.forma)).toEqual(['pix', 'dinheiro'])
    expect(Math.round((d.pagamentos.reduce((s, p) => s + p.valor, 0) - d.troco) * 100) / 100).toBe(150)
    expect(d.informacoes).toContain('R$ 120,00')
  })
})
