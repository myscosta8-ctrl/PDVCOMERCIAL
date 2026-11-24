import { describe, it, expect } from 'vitest'
import { contaPorPalavra, conferirLancamentos, montarRelatorio, compararMeses, mesesAte, paraCsv, semAvisoEstimado } from './financeiro.js'

const planos = [
  { id: 'p401', codigo: '4.01', tipo: 'despesa' }, { id: 'p402', codigo: '4.02', tipo: 'despesa' }, { id: 'p403', codigo: '4.03', tipo: 'despesa' },
  { id: 'p410', codigo: '4.10', tipo: 'despesa' }, { id: 'p301', codigo: '3.01', tipo: 'despesa' }, { id: 'p201', codigo: '2.01', tipo: 'despesa' },
  { id: 'p102', codigo: '1.02', tipo: 'receita' }, { id: 'p411', codigo: '4.11', tipo: 'despesa' },
]

describe('sugestão de conta pela descrição', () => {
  it('reconhece palavras com e sem acento', () => {
    expect(contaPorPalavra('Conta de energia novembro', planos, 'pagar')).toBe('p402')
    expect(contaPorPalavra('ÁGUA E ESGOTO', planos, 'pagar')).toBe('p402')
    expect(contaPorPalavra('Salário Brenda', planos, 'pagar')).toBe('p403')
    expect(contaPorPalavra('DAS outubro', planos, 'pagar')).toBe('p201')
  })
  it('a expressão mais longa vence', () => {
    expect(contaPorPalavra('Aluguel da máquina de cartão', planos, 'pagar')).toBe('p410')
    expect(contaPorPalavra('Aluguel da loja', planos, 'pagar')).toBe('p401')
  })
  it('respeita o tipo e não inventa', () => {
    expect(contaPorPalavra('Serviço de aplicação', planos, 'pagar')).toBeNull()
    expect(contaPorPalavra('Serviço de aplicação', planos, 'receber')).toBe('p102')
    expect(contaPorPalavra('xyz', planos, 'pagar')).toBeNull()
    expect(contaPorPalavra('Dasgupta consultoria', planos, 'pagar')).toBeNull()
  })
})

describe('conferência', () => {
  const base = { tipo: 'pagar', status: 'aberto', valor_pago: 0, competencia: '2026-11-01' }
  it('acha repetido, mas não parcelas nem meses da mesma fixa', () => {
    const p = conferirLancamentos([
      { ...base, id: 'a', descricao: 'Energia', valor: 300, vencimento: '2026-11-10' },
      { ...base, id: 'b', descricao: 'energia ', valor: 300, vencimento: '2026-11-12' },
      { ...base, id: 'c', descricao: 'Parcela', valor: 100, vencimento: '2026-11-10', grupo_id: 'g' },
      { ...base, id: 'd', descricao: 'Parcela', valor: 100, vencimento: '2026-11-11', grupo_id: 'g' },
      { ...base, id: 'e', descricao: 'Outra', valor: 300, vencimento: '2026-11-11' },
    ], '2026-11-24')
    const dup = p.filter((x) => x.tipo === 'duplicado')
    expect(dup).toHaveLength(1)
    expect(dup[0].lancamentos.map((l) => l.id)).toEqual(['a', 'b'])
  })
  it('aponta contas antigas, parciais, estimadas e genéricas', () => {
    const gen = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `g${i}`, descricao: `Coisa ${i}`, valor: 10 + i, vencimento: '2026-11-30', plano: { codigo: '4.11', nome: 'Outras despesas' } }))
    const p = conferirLancamentos([
      { ...base, id: 'x', descricao: 'Velha', valor: 50, vencimento: '2026-08-01' },
      { ...base, id: 'y', descricao: 'Parcial', valor: 80, valor_pago: 30, vencimento: '2026-10-01' },
      { ...base, id: 'z', descricao: 'Luz', valor: 400, vencimento: '2026-11-28', observacao: 'Valor estimado: confira a fatura e ajuste.' },
      ...gen,
    ], '2026-11-24')
    expect(p.map((x) => x.tipo).sort()).toEqual(['antigo', 'estimado', 'generico', 'parcial'])
    expect(p.find((x) => x.tipo === 'antigo').valor).toBe(50)
  })
  it('remove o aviso de valor estimado', () => {
    expect(semAvisoEstimado('Valor estimado: confira a fatura e ajuste. Medidor 2')).toBe('Medidor 2')
  })
})

describe('relatórios', () => {
  const linhas = [
    { plano_conta_id: 'p402', codigo: '4.02', nome: 'Energia', tipo: 'despesa', grupo: 'despesas_operacionais', mes: '2026-10', valor: 300 },
    { plano_conta_id: 'p402', codigo: '4.02', nome: 'Energia', tipo: 'despesa', grupo: 'despesas_operacionais', mes: '2026-11', valor: 390 },
    { plano_conta_id: 'p401', codigo: '4.01', nome: 'Aluguel', tipo: 'despesa', grupo: 'despesas_operacionais', mes: '2026-11', valor: 1500 },
    { plano_conta_id: 'p410', codigo: '4.10', nome: 'Tarifas', tipo: 'despesa', grupo: 'despesas_operacionais', mes: '2026-10', valor: 50 },
  ]
  it('monta por conta e mês e compara', () => {
    const meses = mesesAte('2026-11', 2)
    expect(meses).toEqual(['2026-10', '2026-11'])
    const r = montarRelatorio(linhas, meses)
    expect(r.map((c) => c.codigo)).toEqual(['4.01', '4.02', '4.10'])
    expect(r[1].total).toBe(690)
    const c = compararMeses(r, '2026-11', '2026-10')
    expect(c[0]).toMatchObject({ codigo: '4.01', diferenca: 1500, pct: null })
    expect(c.find((x) => x.codigo === '4.02').pct).toBe(30)
    expect(c.find((x) => x.codigo === '4.10').diferenca).toBe(-50)
  })
  it('meses atravessam o ano', () => {
    expect(mesesAte('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
  it('CSV em formato brasileiro', () => {
    expect(paraCsv(['A', 'B'], [['x;y', 1.5]])).toBe('﻿A;B\r\n"x;y";1,5')
  })
})
