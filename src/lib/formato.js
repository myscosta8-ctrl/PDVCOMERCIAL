const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const dinheiro = (v) => moeda.format(Number(v) || 0)

// Aceita "10,50", "10.50", "1.234,56"
export function lerNumero(texto) {
  if (typeof texto === 'number') return texto
  const s = String(texto ?? '').trim()
  if (!s) return 0
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(normal)
  return Number.isFinite(n) ? n : NaN
}

export const arred = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100

export function dataHora(iso) {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''
}
