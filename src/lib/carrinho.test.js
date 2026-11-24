import { describe, it, expect } from 'vitest'
import { adicionar, alterarQuantidade, totais, lerCodigo, paraEnvio, trocarLote, precoSugerido, margemSobreVenda, markupDeMargem } from './carrinho.js'
import { lerNumero } from './formato.js'

const p = { id: 'p1', descricao: 'Produto', unidade: 'UN', preco_venda: '10.00' }

describe('carrinho', () => {
  it('soma quantidade ao bipar o mesmo produto', () => {
    let c = adicionar([], p)
    c = adicionar(c, p, 2)
    expect(c).toHaveLength(1)
    expect(c[0].quantidade).toBe(3)
  })
  it('remove item com quantidade zero', () => {
    const c = adicionar([], p)
    expect(alterarQuantidade(c, c[0].chave, 0)).toHaveLength(0)
  })
  it('calcula total, falta e troco', () => {
    const c = adicionar([], p, 3)
    const t = totais(c, 5, [{ forma: 'pix', valor: 10 }, { forma: 'dinheiro', valor: 20 }])
    expect(t).toMatchObject({ subtotal: 30, total: 25, pago: 30, falta: 0, troco: 5, trocoValido: true })
  })
  it('troco sem dinheiro é inválido', () => {
    const t = totais(adicionar([], p), 0, [{ forma: 'pix', valor: 15 }])
    expect(t.trocoValido).toBe(false)
  })
  it('evita erro de arredondamento', () => {
    const c = adicionar([], { ...p, preco_venda: '0.1' }, 3)
    expect(totais(c).total).toBe(0.3)
  })
  it('lê multiplicador no código', () => {
    expect(lerCodigo('3*7890001')).toEqual({ quantidade: 3, termo: '7890001' })
    expect(lerCodigo('dipirona')).toEqual({ quantidade: 1, termo: 'dipirona' })
  })
  it('envia só o necessário ao banco', () => {
    expect(paraEnvio(adicionar([], p))[0]).toEqual({ produto_id: 'p1', quantidade: 1, desconto: 0 })
  })
  it('separa itens por lote e envia o lote', () => {
    let c = adicionar([], p, 1, { id: 'L1', numero: 'A', validade: '2027-01-01' })
    c = adicionar(c, p, 1, { id: 'L2', numero: 'B', validade: '2027-06-01' })
    c = adicionar(c, p, 2, { id: 'L1', numero: 'A', validade: '2027-01-01' })
    expect(c).toHaveLength(2)
    expect(c[0].quantidade).toBe(3)
    expect(paraEnvio(c)[1]).toEqual({ produto_id: 'p1', quantidade: 1, desconto: 0, lote_id: 'L2' })
  })
  it('troca de lote junta com item igual', () => {
    let c = adicionar([], p, 1, { id: 'L1', numero: 'A' })
    c = adicionar(c, p, 2, { id: 'L2', numero: 'B' })
    c = trocarLote(c, c[0].chave, { id: 'L2', numero: 'B' })
    expect(c).toHaveLength(1)
    expect(c[0].quantidade).toBe(3)
  })
  it('calcula preço sugerido e margem', () => {
    expect(precoSugerido(10, 50)).toBe(15)
    expect(precoSugerido(0, 50)).toBe(null)
    expect(Math.round(margemSobreVenda(10, 15))).toBe(33)
    expect(Math.round(markupDeMargem(25) * 100) / 100).toBe(33.33)
  })
  it('lê números no formato brasileiro', () => {
    expect(lerNumero('1.234,56')).toBe(1234.56)
    expect(lerNumero('10.5')).toBe(10.5)
    expect(lerNumero('')).toBe(0)
  })
})
