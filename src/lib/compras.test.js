import { describe, it, expect } from 'vitest'
import { totaisLista, textoLista, htmlLista } from './compras.js'

const lista = { numero: 4, nome: 'Compras de 25/11', observacoes: 'Entregar até sexta', criado_em: '2026-11-25T15:00:00Z' }
const itens = [
  { descricao: 'Dipirona 500 mg', unidade: 'CX', quantidade: 12, custo_estimado: 2.35, comprado: true },
  { descricao: 'Sacolas plásticas', unidade: 'PCT', quantidade: 3, custo_estimado: null, comprado: false, observacao: 'tamanho médio' },
]
describe('listas de compras', () => {
  it('soma só os itens com custo e conta comprados', () => {
    expect(totaisLista(itens)).toEqual({ total: 28.2, semCusto: 1, comprados: 1, itens: 2 })
  })
  it('monta o texto da mensagem', () => {
    const t = textoLista({ empresa: { nome_fantasia: 'Farma Família' }, lista, itens, fornecedor: { nome_fantasia: 'Norte Farma' } })
    expect(t).toBe('*Lista de compras nº 4: Compras de 25/11*\nFarma Família\nFornecedor: Norte Farma\n\n- 12 CX  Dipirona 500 mg\n- 3 PCT  Sacolas plásticas (tamanho médio)\n\n2 itens\nObs.: Entregar até sexta')
  })
  it('imprime com quadrinhos e total estimado', () => {
    const h = htmlLista({ empresa: { razao_social: 'Loja' }, lista, itens })
    expect(h).toContain('LISTA DE COMPRAS')
    expect(h).toContain('&#9745;')
    expect(h).toContain('&#9744;')
    expect(h).toMatch(/Total estimado \(1 sem custo\)<\/td><td class="r">R\$\s28,20/)
    expect(h).toContain('tamanho médio')
  })
})
