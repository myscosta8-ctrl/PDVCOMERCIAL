import { describe, it, expect } from 'vitest'
import { gruposAlertas, totalAlertas } from './alertas.js'

const resposta = {
  dias: { pagar: 3, validade: 60, certificado: 30 },
  pagar_vencidas: { qtd: 1, valor: 100, lista: [{ id: 'a', descricao: 'Aluguel', vencimento: '2026-11-20', valor: 100 }] },
  pagar_vencendo: { qtd: 0, valor: 0, lista: [] },
  receber_atrasadas: { qtd: 2, valor: 50, lista: [] },
  lotes_vencidos: { qtd: 0, lista: [] },
  lotes_vencendo: { qtd: 1, lista: [{ id: 'l', descricao: 'Dipirona', numero: 'X1', vencimento: '2026-12-10', quantidade: 4, unidade: 'UN' }] },
  certificado: { dias: 5 },
}

describe('alertas de vencimento', () => {
  it('ordena críticos primeiro e ignora grupos vazios', () => {
    const g = gruposAlertas(resposta, 'administrador')
    expect(g.map((x) => x.id)).toEqual(['pagar_vencidas', 'certificado', 'receber_atrasadas', 'lotes_vencendo'])
    expect(g[1].nivel).toBe('critico')
    expect(g[0].itens[0]).toMatchObject({ texto: 'Aluguel', data: '20/11/2026', valor: 100 })
    expect(g[3].itens[0].texto).toBe('Dipirona (lote X1)')
    expect(totalAlertas(g)).toEqual({ qtd: 5, critico: true })
  })
  it('operador vai para clientes ao ver atrasos', () => {
    const g = gruposAlertas({ receber_atrasadas: { qtd: 1, lista: [] } }, 'operador')
    expect(g[0].tela).toBe('clientes')
  })
  it('certificado vencido', () => {
    expect(gruposAlertas({ certificado: { dias: -2 } })[0].titulo).toMatch(/vencido há 2/)
  })
})
