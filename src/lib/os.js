// Ordem de serviço: situações, totais e impressão em folha A4 (via do cliente e do estabelecimento)
import { esc } from './impressao.js'
import { dinheiro, dataHora } from './formato.js'

export const SITUACOES_OS = {
  aberta: { texto: 'Em análise', tom: 'neutro' },
  aguardando_aprovacao: { texto: 'Aguardando aprovação', tom: 'alerta' },
  aprovada: { texto: 'Em execução', tom: 'positivo' },
  pronta: { texto: 'Pronta para retirar', tom: 'positivo' },
  entregue: { texto: 'Entregue', tom: 'neutro' },
  cancelada: { texto: 'Cancelada', tom: 'critico' },
}

export const totalOS = (itens) => Math.round(itens.reduce((s, i) => s + Number(i.quantidade || 0) * Number(i.preco_unitario || 0), 0) * 100) / 100

export function totaisOS(itens) {
  const servicos = totalOS(itens.filter((i) => i.servico))
  const pecas = totalOS(itens.filter((i) => !i.servico))
  return { servicos, pecas, total: Math.round((servicos + pecas) * 100) / 100 }
}

// Atrasada: passou da previsão e ainda não ficou pronta
export function atrasada(os, hoje = new Date()) {
  if (!os.previsao || ['pronta', 'entregue', 'cancelada'].includes(os.status)) return false
  const h = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
  return os.previsao < h
}

const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '')

export function htmlOrdemServico({ empresa, os, itens, tecnico, via = 'entrada' }) {
  const e = empresa?.endereco || {}
  const t = totaisOS(itens)
  const linha = (rotulo, valor) => (valor ? `<tr><th>${esc(rotulo)}</th><td>${esc(valor)}</td></tr>` : '')
  const entrega = via === 'entrega'
  const garantia = entrega && os.garantia_dias > 0
    ? `<p class="obs">Garantia de ${os.garantia_dias} dias para os serviços e peças desta ordem, a contar de ${dataBR(os.entregue_em || new Date().toISOString())}. A garantia não cobre mau uso, quedas, líquidos ou intervenção de terceiros.</p>` : ''
  const termo = entrega
    ? 'Declaro que recebi o bem descrito acima, com os serviços realizados, em perfeito estado de funcionamento.'
    : 'Declaro que deixei o bem descrito acima para análise e serviço. Bens não retirados em até 90 dias após o aviso de conclusão poderão ser descartados ou vendidos para cobrir os custos, conforme a legislação.'
  const corpo = `
<header><div><h1>${esc(empresa?.nome_fantasia || empresa?.razao_social)}</h1>
<p>${esc(empresa?.razao_social)}${empresa?.cnpj ? ` - CNPJ ${esc(empresa.cnpj)}` : ''}<br>${esc([e.logradouro && `${e.logradouro}, ${e.numero || 's/n'}`, e.bairro, e.municipio && `${e.municipio}/${empresa?.uf ?? ''}`].filter(Boolean).join(' - '))}${e.fone ? ` - Tel. ${esc(e.fone)}` : ''}</p></div>
<div class="num"><strong>ORDEM DE SERVIÇO</strong><span>Nº ${esc(os.numero)}</span><small>${entrega ? 'Comprovante de entrega' : 'Comprovante de entrada'}</small></div></header>
<table class="dados">
${linha('Cliente', os.cliente_nome)}${linha('Telefone', os.cliente_telefone)}
${linha('Entrada', dataHora(os.criado_em))}${linha('Previsão', dataBR(os.previsao))}${linha('Técnico', tecnico)}
${linha('Equipamento / serviço', [os.equipamento, os.marca, os.modelo].filter(Boolean).join(' - '))}${linha('Número de série', os.numero_serie)}
${linha('Acessórios entregues', os.acessorios)}${linha('Defeito relatado', os.defeito)}${linha('Diagnóstico', os.diagnostico)}${linha('Serviço realizado', entrega ? os.solucao : '')}
</table>
${itens.length ? `<table class="itens"><thead><tr><th>Descrição</th><th>Tipo</th><th class="r">Qtd.</th><th class="r">Unitário</th><th class="r">Total</th></tr></thead><tbody>
${itens.map((i) => `<tr><td>${esc(i.descricao)}</td><td>${i.servico ? 'Serviço' : 'Peça'}</td><td class="r">${esc(Number(i.quantidade).toLocaleString('pt-BR'))}</td><td class="r">${dinheiro(i.preco_unitario)}</td><td class="r">${dinheiro(Number(i.quantidade) * Number(i.preco_unitario))}</td></tr>`).join('')}
</tbody><tfoot>
${t.servicos && t.pecas ? `<tr><td colspan="4">Serviços</td><td class="r">${dinheiro(t.servicos)}</td></tr><tr><td colspan="4">Peças</td><td class="r">${dinheiro(t.pecas)}</td></tr>` : ''}
<tr class="total"><td colspan="4">${entrega ? 'Total' : 'Valor orçado'}</td><td class="r">${dinheiro(t.total)}</td></tr></tfoot></table>` : '<p class="obs">Orçamento a definir após a análise.</p>'}
${os.observacoes ? `<p class="obs"><strong>Observações:</strong> ${esc(os.observacoes)}</p>` : ''}
${garantia}
<p class="termo">${esc(termo)}</p>
<div class="ass"><div>Cliente: ${esc(os.cliente_nome)}</div><div>${esc(empresa?.nome_fantasia || empresa?.razao_social)}</div></div>`
  const vias = ['Via do cliente', 'Via do estabelecimento'].map((v) => `<section class="via"><p class="v">${v}</p>${corpo}</section>`).join('')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>OS ${esc(os.numero)}</title><style>
@page { size: A4; margin: 12mm }
* { box-sizing: border-box } body { font: 10.5pt/1.35 Arial, Helvetica, sans-serif; color: #000; margin: 0 }
.via { page-break-after: always } .via:last-child { page-break-after: auto }
.v { text-align: right; font-size: 8.5pt; margin: 0 0 4px; color: #444 }
header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #000; padding-bottom: 8px }
h1 { font-size: 15pt; margin: 0 } header p { margin: 2px 0 0; font-size: 9pt }
.num { text-align: right; display: flex; flex-direction: column } .num span { font-size: 18pt; font-weight: bold } .num small { font-size: 9pt }
table { width: 100%; border-collapse: collapse; margin-top: 10px }
.dados th { text-align: left; width: 32%; font-weight: 600; padding: 3px 6px; background: #f2f2f2; border: 1px solid #ccc; vertical-align: top }
.dados td { padding: 3px 6px; border: 1px solid #ccc; white-space: pre-wrap }
.itens th, .itens td { border-bottom: 1px solid #ccc; padding: 4px 6px; text-align: left } .itens thead th { border-bottom: 1.5px solid #000 }
.r { text-align: right !important } .total td { font-weight: bold; font-size: 12pt; border-top: 1.5px solid #000 }
.obs { margin: 10px 0 0; font-size: 9.5pt } .termo { margin: 14px 0 0; font-size: 9pt }
.ass { display: flex; gap: 40px; margin-top: 46px } .ass div { flex: 1; border-top: 1px solid #000; padding-top: 3px; text-align: center; font-size: 9pt }
</style></head><body>${vias}</body></html>`
}
