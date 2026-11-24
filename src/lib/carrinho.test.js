import { describe, it, expect } from 'vitest'
import { adicionar, alterarQuantidade, totais, lerCodigo, paraEnvio } from './carrinho.js'
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
  it('lê números no formato brasileiro', () => {
    expect(lerNumero('1.234,56')).toBe(1234.56)
    expect(lerNumero('10.5')).toBe(10.5)
    expect(lerNumero('')).toBe(0)
  })
})
