import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase.js', () => ({ supabase: {} }))
import { totaisOS, atrasada, htmlOrdemServico } from './os.js'

const itens = [{ descricao: 'Troca de tela', quantidade: 1, preco_unitario: 120, servico: true }, { descricao: 'Tela <OLED>', quantidade: 1, preco_unitario: 150, servico: false }]
describe('ordem de serviço', () => {
  it('separa serviços e peças', () => {
    expect(totaisOS(itens)).toEqual({ servicos: 120, pecas: 150, total: 270 })
  })
  it('atraso pela previsão', () => {
    const hoje = new Date(2026, 10, 24)
    expect(atrasada({ previsao: '2026-11-23', status: 'aprovada' }, hoje)).toBe(true)
    expect(atrasada({ previsao: '2026-11-24', status: 'aprovada' }, hoje)).toBe(false)
    expect(atrasada({ previsao: '2026-11-20', status: 'pronta' }, hoje)).toBe(false)
  })
  it('impressão: duas vias, termo de entrada e garantia na entrega', () => {
    const os = { numero: 15, cliente_nome: 'Maria', equipamento: 'Celular', marca: 'Marca X', defeito: 'Tela quebrada', garantia_dias: 90, criado_em: '2026-11-20T13:00:00Z', entregue_em: '2026-11-24T13:00:00Z', solucao: 'Tela trocada' }
    const entrada = htmlOrdemServico({ empresa: { razao_social: 'Assistência' }, os, itens })
    expect(entrada.match(/class="via"/g)).toHaveLength(2)
    expect(entrada).toContain('Comprovante de entrada')
    expect(entrada).toContain('Valor orçado')
    expect(entrada).toContain('Tela &lt;OLED&gt;')
    expect(entrada).not.toContain('Garantia de')
    const entrega = htmlOrdemServico({ empresa: { razao_social: 'Assistência' }, os, itens, via: 'entrega' })
    expect(entrega).toContain('Garantia de 90 dias')
    expect(entrega).toContain('24/11/2026')
    expect(entrega).toContain('Tela trocada')
  })
})
