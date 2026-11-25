// Listas de compras: situações, totais, texto para mensagem e impressão em folha A4
import { esc } from './impressao.js'
import { dinheiro, dataHora } from './formato.js'

export const SITUACOES_LISTA = {
  aberta: { texto: 'Em montagem', tom: 'neutro' },
  enviada: { texto: 'Enviada ao fornecedor', tom: 'alerta' },
  concluida: { texto: 'Concluída', tom: 'positivo' },
  cancelada: { texto: 'Cancelada', tom: 'critico' },
}

export const MOTIVOS_SUGESTAO = {
  zerado: { texto: 'Sem estoque', tom: 'critico' },
  minimo: { texto: 'Abaixo do mínimo', tom: 'alerta' },
  consumo: { texto: 'Pelo consumo', tom: 'neutro' },
}

export const qtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

// Total estimado só com os itens que têm custo; conta quantos ficaram sem custo
export function totaisLista(itens = []) {
  let total = 0, semCusto = 0, comprados = 0
  for (const i of itens) {
    if (i.custo_estimado == null || i.custo_estimado === '') semCusto++
    else total += Number(i.quantidade) * Number(i.custo_estimado)
    if (i.comprado) comprados++
  }
  return { total: Math.round(total * 100) / 100, semCusto, comprados, itens: itens.length }
}

const nomeFornecedor = (f) => f?.nome_fantasia || f?.razao_social || ''

// Texto simples para enviar por mensagem (WhatsApp, e-mail)
export function textoLista({ empresa, lista, itens, fornecedor }) {
  const cab = [`*Lista de compras nº ${lista.numero}: ${lista.nome}*`, empresa ? (empresa.nome_fantasia || empresa.razao_social) : '', fornecedor ? `Fornecedor: ${nomeFornecedor(fornecedor)}` : '']
  const linhas = itens.map((i) => `- ${qtd(i.quantidade)} ${i.unidade || 'UN'}  ${i.descricao}${i.observacao ? ` (${i.observacao})` : ''}`)
  const fim = [`${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`, lista.observacoes ? `Obs.: ${lista.observacoes}` : ''].filter(Boolean)
  return [cab.filter(Boolean).join('\n'), linhas.join('\n'), fim.join('\n')].join('\n\n')
}

export function htmlLista({ empresa, lista, itens, fornecedor, comCusto = true }) {
  const t = totaisLista(itens)
  const linhas = itens.map((i) => `<tr><td class="c">${i.comprado ? '&#9745;' : '&#9744;'}</td><td>${esc(i.descricao)}${i.observacao ? `<small>${esc(i.observacao)}</small>` : ''}</td>
<td class="r">${esc(qtd(i.quantidade))}</td><td>${esc(i.unidade || 'UN')}</td>${comCusto ? `<td class="r">${i.custo_estimado != null ? dinheiro(i.custo_estimado) : ''}</td><td class="r">${i.custo_estimado != null ? dinheiro(Number(i.quantidade) * Number(i.custo_estimado)) : ''}</td>` : ''}</tr>`).join('')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Lista de compras ${esc(lista.numero)}</title><style>
@page { size: A4; margin: 12mm }
* { box-sizing: border-box } body { font: 10.5pt/1.35 Arial, Helvetica, sans-serif; color: #000; margin: 0 }
header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #000; padding-bottom: 8px }
h1 { font-size: 15pt; margin: 0 } header p { margin: 2px 0 0; font-size: 9pt }
.num { text-align: right; display: flex; flex-direction: column } .num span { font-size: 18pt; font-weight: bold } .num small { font-size: 9pt }
table { width: 100%; border-collapse: collapse; margin-top: 12px }
th, td { border-bottom: 1px solid #ccc; padding: 5px 6px; text-align: left; vertical-align: top } thead th { border-bottom: 1.5px solid #000 }
td small { display: block; color: #444; font-size: 8.5pt }
.c { width: 22px; font-size: 13pt; line-height: 1 } .r { text-align: right !important }
.total td { font-weight: bold; font-size: 12pt; border-top: 1.5px solid #000; border-bottom: 0 }
.obs { margin: 10px 0 0; font-size: 9.5pt }
</style></head><body>
<header><div><h1>${esc(empresa?.nome_fantasia || empresa?.razao_social)}</h1>
<p>${esc(lista.nome)}${fornecedor ? `<br>Fornecedor: ${esc(nomeFornecedor(fornecedor))}${fornecedor.telefone ? ` - Tel. ${esc(fornecedor.telefone)}` : ''}` : ''}</p></div>
<div class="num"><strong>LISTA DE COMPRAS</strong><span>Nº ${esc(lista.numero)}</span><small>${esc(dataHora(lista.criado_em))}</small></div></header>
<table><thead><tr><th class="c"></th><th>Item</th><th class="r">Qtd.</th><th>Un.</th>${comCusto ? '<th class="r">Custo est.</th><th class="r">Total</th>' : ''}</tr></thead>
<tbody>${linhas}</tbody>
${comCusto ? `<tfoot><tr class="total"><td colspan="5">Total estimado${t.semCusto ? ` (${t.semCusto} sem custo)` : ''}</td><td class="r">${dinheiro(t.total)}</td></tr></tfoot>` : ''}</table>
<p class="obs">${t.itens} ${t.itens === 1 ? 'item' : 'itens'}${t.comprados ? `, ${t.comprados} já comprado(s)` : ''}.</p>
${lista.observacoes ? `<p class="obs"><strong>Observações:</strong> ${esc(lista.observacoes)}</p>` : ''}
</body></html>`
}
