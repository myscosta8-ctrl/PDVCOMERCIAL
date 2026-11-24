// Interpreta a lista de preços de medicamentos da CMED (planilha publicada pela ANVISA).
// Procura a linha de cabeçalho, as colunas de código de barras (EAN 1, 2, 3) e as colunas de PMC por alíquota de ICMS.

export const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

export function lerValor(v) {
  if (v == null) return null
  if (typeof v === 'number') return v
  const s = String(v).trim()
  if (!s || s === '-') return null
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

export function interpretarCmed(linhas) {
  const idx = linhas.findIndex((l) => {
    const n = l.map(normalizar)
    return n.some((c) => /^EAN ?1$/.test(c) || c === 'EAN') && n.some((c) => c.startsWith('PMC'))
  })
  if (idx < 0) throw new Error('Não encontrei as colunas de código de barras (EAN) e de PMC. Use a planilha de preços máximos ao consumidor da CMED.')
  const cab = linhas[idx].map(normalizar)
  const achar = (...testes) => cab.findIndex((c) => testes.some((t) => (t instanceof RegExp ? t.test(c) : c === t)))
  const col = {
    produto: achar('PRODUTO'),
    apresentacao: achar('APRESENTACAO'),
    laboratorio: achar('LABORATORIO'),
    registro: achar('REGISTRO'),
    tipo: achar(/^TIPO DE PRODUTO/),
    tarja: achar('TARJA'),
    restricao: achar(/^RESTRICAO HOSPITALAR/),
  }
  const eans = cab.map((c, i) => (/^EAN( ?\d)?$/.test(c) ? i : -1)).filter((i) => i >= 0)
  const pmcs = cab.map((c, i) => ({ nome: linhas[idx][i].trim(), chave: c, i })).filter((c) => c.chave.startsWith('PMC') && !c.chave.includes('PMVG'))
  const dados = linhas.slice(idx + 1)

  return {
    colunas: pmcs.map((c) => c.nome),
    registros(colunaPmc) {
      const pmc = pmcs.find((c) => c.nome === colunaPmc)
      if (!pmc) throw new Error('Escolha a coluna de PMC.')
      const pfChave = pmc.chave.replace(/^PMC/, 'PF')
      const pf = cab.findIndex((c) => c === pfChave)
      const vistos = new Set()
      const saida = []
      for (const l of dados) {
        const preco = lerValor(l[pmc.i])
        for (const e of eans) {
          const ean = String(l[e] ?? '').replace(/\D/g, '')
          if (!/^\d{8,14}$/.test(ean) || /^0+$/.test(ean) || vistos.has(ean)) continue
          vistos.add(ean)
          saida.push({
            ean,
            produto: col.produto >= 0 ? String(l[col.produto] ?? '').trim() : '',
            apresentacao: col.apresentacao >= 0 ? String(l[col.apresentacao] ?? '').trim() : '',
            laboratorio: col.laboratorio >= 0 ? String(l[col.laboratorio] ?? '').trim() : '',
            registro: col.registro >= 0 ? String(l[col.registro] ?? '').replace(/\D/g, '') : '',
            tipo: col.tipo >= 0 ? String(l[col.tipo] ?? '').trim() : '',
            tarja: col.tarja >= 0 ? String(l[col.tarja] ?? '').trim() : '',
            restricao_hospitalar: col.restricao >= 0 && normalizar(l[col.restricao]) === 'SIM',
            pmc: preco,
            pf: pf >= 0 ? lerValor(l[pf]) : null,
          })
        }
      }
      return saida
    },
  }
}
