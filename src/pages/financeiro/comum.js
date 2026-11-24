import { createElement as h } from 'react'

// Utilidades de data e valor usadas pelas telas do financeiro
export const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
export const somaDias = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
export const somaMeses = (d, n) => {
  const [a, m, dia] = d.split('-').map(Number)
  const ult = new Date(a, m - 1 + n + 1, 0).getDate()
  const x = new Date(a, m - 1 + n, Math.min(dia, ult), 12)
  return x.toISOString().slice(0, 10)
}
export const dataBR = (d) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '')
export const reais = (v) => (v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ','))
export const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
export const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const nomeMes = (am) => `${MESES_LONGOS[Number(am.slice(5, 7)) - 1]} de ${am.slice(0, 4)}`
export const somaMes = (am, n) => { const d = new Date(Number(am.slice(0, 4)), Number(am.slice(5, 7)) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
export const ultimoDia = (am) => `${am}-${String(new Date(Number(am.slice(0, 4)), Number(am.slice(5, 7)), 0).getDate()).padStart(2, '0')}`

// Navegador de mês: ‹ novembro de 2026 ›
export function NavegadorMes({ mes, onMudar, max }) {
  const botao = (n, rotulo, desab) => h('button', {
    onClick: () => onMudar(somaMes(mes, n)), disabled: desab, 'aria-label': rotulo,
    className: 'rounded-md px-2.5 py-1.5 text-lg leading-none hover:bg-papel-200 disabled:opacity-30 dark:hover:bg-noite-700',
  }, n < 0 ? '‹' : '›')
  return h('div', { className: 'inline-flex items-center gap-1 rounded-lg border border-papel-300 bg-white px-1 dark:border-noite-600 dark:bg-noite-800' },
    botao(-1, 'Mês anterior', false),
    h('span', { className: 'min-w-[10.5rem] text-center font-semibold' }, nomeMes(mes).replace(/^./, (c) => c.toUpperCase())),
    botao(1, 'Próximo mês', max ? mes >= max : false))
}
