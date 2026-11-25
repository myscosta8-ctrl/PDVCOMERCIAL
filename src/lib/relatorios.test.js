import { describe, it, expect } from 'vitest'
import { periodo, variacao, curvaABC, margem, mapaHoras } from './relatorios.js'

describe('relatórios', () => {
  const hoje = new Date(2026, 10, 24)
  it('períodos prontos', () => {
    expect(periodo('hoje', hoje)).toEqual({ inicio: '2026-11-24', fim: '2026-11-24' })
    expect(periodo('7d', hoje)).toEqual({ inicio: '2026-11-18', fim: '2026-11-24' })
    expect(periodo('mes', hoje)).toEqual({ inicio: '2026-11-01', fim: '2026-11-24' })
    expect(periodo('mes_passado', hoje)).toEqual({ inicio: '2026-10-01', fim: '2026-10-31' })
    expect(periodo('mes_passado', new Date(2026, 0, 15))).toEqual({ inicio: '2025-12-01', fim: '2025-12-31' })
    expect(periodo('ano', hoje)).toEqual({ inicio: '2026-01-01', fim: '2026-11-24' })
  })
  it('variação', () => {
    expect(variacao(120, 100)).toBeCloseTo(20)
    expect(variacao(50, 0)).toBeNull()
  })
  it('curva ABC', () => {
    const r = curvaABC([{ id: 1, total: 10 }, { id: 2, total: 700 }, { id: 3, total: 150 }, { id: 4, total: 100, custo: 60 }, { id: 5, total: 40 }])
    expect(r.map((p) => p.id)).toEqual([2, 3, 4, 5, 1])
    expect(r.map((p) => p.classe)).toEqual(['A', 'A', 'B', 'C', 'C'])
    expect(r[0].participacao).toBeCloseTo(70)
    expect(r[4].acumulado).toBeCloseTo(100)
    expect(r[2].margem).toBeCloseTo(40)
    expect(r[0].margem).toBeNull()
    expect(curvaABC([{ id: 1, total: 5 }])[0].classe).toBe('A')
  })
  it('margem e mapa de horários', () => {
    expect(margem(200, 150)).toBeCloseTo(25)
    expect(margem(0, 10)).toBeNull()
    const m = mapaHoras([{ dow: 1, hora: 9, total: 50 }, { dow: 1, hora: 9, total: 25 }, { dow: 5, hora: 21, total: 10 }])
    expect(m.m[1][9]).toBe(75)
    expect(m.max).toBe(75)
    expect(m.horas[0]).toBe(8)
    expect(m.horas.at(-1)).toBe(21)
  })
})
