import { describe, it, expect } from 'vitest'
import { textoPorRegras, pedidoIA, real } from '../../supabase/functions/resumo/resumo.ts'

const base = {
  mes: '2026-11', dia: 24, dias_mes: 30,
  vendas: { total: 12000, qtd: 400, descontos: 300, canceladas: 2, dias_com_venda: 22 },
  anterior: { total: 10000, qtd: 380 }, margem: 3000, faturamento_com_custo: 10000,
  mais_vendidos: [{ descricao: 'Dipirona 500 mg', quantidade: 120, total: 1200 }, { descricao: 'Fralda G', quantidade: 30, total: 900 }],
  formas: { pix: 6000, dinheiro: 4000, credito: 2000 },
  crediario_atrasado: 450.5, estoque_baixo: 3, lotes_vencendo: 2, lotes_vencidos: 1,
  financeiro: { pagos_mes: 5000, compras_mes: 4000, a_vencer_mes: 1200, a_receber_total: 800, teto_gastos: 4500 },
}

describe('resumo do mês por regras', () => {
  it('formata reais no padrão brasileiro', () => {
    expect(real(1234567.8)).toBe('R$ 1.234.567,80')
  })
  it('compara com o mês anterior, projeta e aponta riscos', () => {
    const t = textoPorRegras(base).join('\n')
    expect(t).toContain('R$ 12.000,00 em 400 vendas')
    expect(t).toContain('ticket médio de R$ 30,00')
    expect(t).toContain('20% acima do mesmo período')
    expect(t).toContain('perto de R$ 15.000,00')
    expect(t).toContain('margem bruta')
    expect(t).toContain('30%')
    expect(t).toContain('PIX (50% do recebido)')
    expect(t).toContain('Dipirona 500 mg (R$ 1.200,00)')
    expect(t).toContain('R$ 450,50 de crediário em atraso')
    expect(t).toContain('passaram do teto')
  })
  it('mês sem vendas', () => {
    expect(textoPorRegras({ ...base, vendas: { ...base.vendas, qtd: 0, total: 0 } })).toHaveLength(1)
  })
  it('pedido para a IA leva os indicadores e proíbe inventar', () => {
    const p = pedidoIA(base)
    expect(p.mensagem).toContain('"total":12000')
    expect(p.system).toContain('Não invente')
  })
})
