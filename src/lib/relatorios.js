// Cálculos dos relatórios gerenciais (sem acesso ao banco)

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Períodos prontos, a partir de uma data de referência (hoje)
export function periodo(tipo, hoje = new Date()) {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  const menos = (n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - n)
  switch (tipo) {
    case 'hoje': return { inicio: iso(d), fim: iso(d) }
    case 'ontem': return { inicio: iso(menos(1)), fim: iso(menos(1)) }
    case '7d': return { inicio: iso(menos(6)), fim: iso(d) }
    case '30d': return { inicio: iso(menos(29)), fim: iso(d) }
    case 'mes': return { inicio: iso(new Date(d.getFullYear(), d.getMonth(), 1)), fim: iso(d) }
    case 'mes_passado': return { inicio: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), fim: iso(new Date(d.getFullYear(), d.getMonth(), 0)) }
    case 'ano': return { inicio: iso(new Date(d.getFullYear(), 0, 1)), fim: iso(d) }
    default: return null
  }
}

// Variação percentual (null quando não há base de comparação)
export function variacao(atual, anterior) {
  const a = Number(atual) || 0, b = Number(anterior) || 0
  if (!b) return null
  return ((a - b) / b) * 100
}

// Curva ABC pelo faturamento: A até 80% acumulado, B até 95%, C o restante
export function curvaABC(produtos) {
  const total = produtos.reduce((s, p) => s + Number(p.total || 0), 0)
  let acumulado = 0
  return [...produtos].sort((a, b) => Number(b.total) - Number(a.total)).map((p) => {
    const antes = acumulado
    acumulado += Number(p.total || 0)
    const participacao = total ? (Number(p.total) / total) * 100 : 0
    // A classe considera onde o produto começa na curva, para o maior produto ficar sempre na A
    const classe = !total ? 'C' : (antes / total) < 0.8 ? 'A' : (antes / total) < 0.95 ? 'B' : 'C'
    const margem = p.custo != null && Number(p.total) > 0 ? ((Number(p.total) - Number(p.custo)) / Number(p.total)) * 100 : null
    return { ...p, participacao, acumulado: total ? (acumulado / total) * 100 : 0, classe, margem }
  })
}

export function margem(total, custo) {
  const t = Number(total) || 0
  return t > 0 && custo != null ? ((t - Number(custo)) / t) * 100 : null
}

// Mapa de horários: matriz [dia da semana][hora] com o faturamento e o maior valor
export function mapaHoras(linhas) {
  const m = Array.from({ length: 7 }, () => Array(24).fill(0))
  let max = 0
  for (const l of linhas) {
    m[l.dow][l.hora] += Number(l.total) || 0
    max = Math.max(max, m[l.dow][l.hora])
  }
  const horas = []
  for (let h = 0; h < 24; h++) if (m.some((d) => d[h] > 0)) horas.push(h)
  const faixa = horas.length ? [Math.min(...horas, 8), Math.max(...horas, 20)] : [8, 20]
  return { m, max, horas: Array.from({ length: faixa[1] - faixa[0] + 1 }, (_, i) => faixa[0] + i) }
}
