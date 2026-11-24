import { supabase } from './supabase.js'
import { dinheiro, dataHora } from './formato.js'
import { nomeForma } from './formas.js'

// Configuração padrão da impressora de cupom (empresas.impressao)
export const IMPRESSAO_PADRAO = { largura: 80, automatica: true, comprovante: true, vias_crediario: 2, mensagem: '' }
export const configImpressao = (empresa) => ({ ...IMPRESSAO_PADRAO, ...(empresa?.impressao || {}) })

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '')

// Página para bobina térmica de 58 ou 80 mm
export function paginaBobina(titulo, corpo, largura = 80) {
  const estreita = Number(largura) === 58
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  @page { size: ${estreita ? 58 : 80}mm auto; margin: ${estreita ? 1.5 : 3}mm; }
  * { box-sizing: border-box }
  body { font-family: 'Courier New', monospace; font-size: ${estreita ? 9.5 : 11}px; width: ${estreita ? 48 : 72}mm; margin: 0 auto; color: #000; line-height: 1.25 }
  .c { text-align: center } .b { font-weight: bold } .g { font-size: 1.3em } hr { border: 0; border-top: 1px dashed #000; margin: 4px 0 }
  table { width: 100%; border-collapse: collapse } td { vertical-align: top; padding: 1px 0 } .r { text-align: right; white-space: nowrap }
  img { display: block; margin: 4px auto; width: ${estreita ? 32 : 40}mm; height: ${estreita ? 32 : 40}mm }
  .ass { margin-top: 28px; border-top: 1px solid #000; padding-top: 2px; text-align: center }
  .via { page-break-after: always } .via:last-child { page-break-after: auto }
</style></head><body>${corpo}</body></html>`
}

export function cabecalhoEmpresa(empresa) {
  const e = empresa?.endereco || {}
  const end = [e.logradouro && `${e.logradouro}${e.numero ? `, ${e.numero}` : ''}`, e.bairro, e.municipio && `${e.municipio}/${empresa.uf ?? ''}`].filter(Boolean).join(' - ')
  return `<div class="c b">${esc(empresa?.nome_fantasia || empresa?.razao_social)}</div>
<div class="c">${empresa?.nome_fantasia ? `${esc(empresa.razao_social)}<br>` : ''}${empresa?.cnpj ? `CNPJ ${esc(empresa.cnpj)}` : ''}${end ? `<br>${esc(end)}` : ''}${e.fone ? `<br>Tel. ${esc(e.fone)}` : ''}</div>`
}

const linhas = (pares) => `<table>${pares.filter(Boolean).map(([a, b, cls]) => `<tr${cls ? ` class="${cls}"` : ''}><td>${a}</td><td class="r">${b}</td></tr>`).join('')}</table>`

// Comprovante de venda (não fiscal). dados: { empresa, venda, itens, pagamentos, parcelas, cliente, operador, terminal, config }
export function htmlComprovanteVenda({ empresa, venda, itens, pagamentos, parcelas = [], cliente, operador, terminal, config }) {
  const cfg = { ...IMPRESSAO_PADRAO, ...(config || {}) }
  const crediario = parcelas.length > 0
  const vias = crediario ? Math.max(1, Math.min(3, Number(cfg.vias_crediario) || 1)) : 1
  const nomesVia = vias === 1 ? [''] : ['Via do estabelecimento', 'Via do cliente', 'Via extra']
  const corpo = (via) => `<div class="via">
${cabecalhoEmpresa(empresa)}
<hr><div class="c b">COMPROVANTE DE VENDA</div><div class="c">NÃO É DOCUMENTO FISCAL</div>
${via ? `<div class="c">${esc(via)}</div>` : ''}
<hr>${linhas([
    ['Venda nº', esc(venda.numero)],
    ['Data', dataHora(venda.criado_em)],
    operador && ['Operador', esc(operador)],
    terminal && ['Terminal', esc(terminal)],
  ])}
${cliente ? `<div>Cliente: ${esc(cliente.nome)}${cliente.cpf_cnpj ? ` - CPF/CNPJ ${esc(cliente.cpf_cnpj)}` : ''}</div>` : venda.cpf_consumidor ? `<div>CPF/CNPJ: ${esc(venda.cpf_consumidor)}</div>` : ''}
${venda.status === 'cancelada' ? '<hr><div class="c b">VENDA CANCELADA</div>' : ''}
<hr><table><tr><td>Item</td><td class="r">Qtd x Unit.</td><td class="r">Total</td></tr>
${itens.map((i) => `<tr><td colspan="3">${esc(i.sequencia)} ${esc(i.descricao)}</td></tr><tr><td></td><td class="r">${Number(i.quantidade).toLocaleString('pt-BR')} x ${dinheiro(i.preco_unitario)}</td><td class="r">${dinheiro(i.total)}</td></tr>`).join('')}
</table><hr>${linhas([
    ['Itens', itens.length],
    ['Subtotal', dinheiro(venda.subtotal)],
    Number(venda.desconto) > 0 && ['Desconto', `-${dinheiro(venda.desconto)}`],
    Number(venda.acrescimo) > 0 && ['Acréscimo', dinheiro(venda.acrescimo)],
    ['TOTAL', dinheiro(venda.total), 'b g'],
    ...pagamentos.map((p) => [esc(nomeForma(p.forma)), dinheiro(p.valor)]),
    Number(venda.troco) > 0 && ['Troco', dinheiro(venda.troco)],
  ])}
${crediario ? `<hr><div class="b">Parcelas do crediário</div>${linhas(parcelas.map((p) => [`${p.parcela}/${p.parcelas} vence ${dataBR(p.vencimento)}`, dinheiro(p.valor)]))}
<div style="margin-top:4px">Reconheço a dívida acima e me comprometo a pagá-la nos vencimentos indicados.</div>
<div class="ass">${esc(cliente?.nome || 'Assinatura do cliente')}</div>` : ''}
${cfg.mensagem ? `<hr><div class="c">${esc(cfg.mensagem)}</div>` : ''}
</div>`
  return paginaBobina(`Venda ${venda.numero}`, nomesVia.slice(0, vias).map(corpo).join(''), cfg.largura)
}

// Comprovante de pagamento de crediário/convênio no caixa
export function htmlComprovanteRecebimento({ empresa, cliente, valor, forma, parcelas = [], saldo, operador, quando = new Date().toISOString(), config }) {
  const cfg = { ...IMPRESSAO_PADRAO, ...(config || {}) }
  return paginaBobina('Comprovante de pagamento', `${cabecalhoEmpresa(empresa)}
<hr><div class="c b">COMPROVANTE DE PAGAMENTO</div><div class="c">NÃO É DOCUMENTO FISCAL</div>
<hr>${linhas([['Data', dataHora(quando)], operador && ['Operador', esc(operador)]])}
<div>Cliente: ${esc(cliente?.nome)}</div>
<hr>${linhas([
    ...parcelas.map((p) => [`Parcela venc. ${dataBR(p.vencimento)}`, dinheiro(p.valor)]),
    ['VALOR PAGO', dinheiro(valor), 'b g'],
    ['Forma', esc(nomeForma(forma))],
    saldo != null && ['Saldo devedor restante', dinheiro(saldo)],
  ])}
${cfg.mensagem ? `<hr><div class="c">${esc(cfg.mensagem)}</div>` : ''}`, cfg.largura)
}

// Sangria ou suprimento, com linha de assinatura
export function htmlMovimentoCaixa({ empresa, tipo, valor, motivo, terminal, operador, quando = new Date().toISOString(), config }) {
  const cfg = { ...IMPRESSAO_PADRAO, ...(config || {}) }
  return paginaBobina(tipo === 'sangria' ? 'Sangria' : 'Suprimento', `${cabecalhoEmpresa(empresa)}
<hr><div class="c b">${tipo === 'sangria' ? 'SANGRIA' : 'SUPRIMENTO'} DE CAIXA</div>
<hr>${linhas([['Data', dataHora(quando)], terminal && ['Terminal', esc(terminal)], operador && ['Operador', esc(operador)], ['VALOR', dinheiro(valor), 'b g']])}
${motivo ? `<div>Motivo: ${esc(motivo)}</div>` : ''}
<div class="ass">Operador</div><div class="ass">Responsável</div>`, cfg.largura)
}

// Fechamento de caixa: resumo do turno
export function htmlFechamento({ empresa, caixa, resumo, operador, config }) {
  const cfg = { ...IMPRESSAO_PADRAO, ...(config || {}) }
  const formas = Object.entries(resumo?.formas || {})
  const receb = Object.entries(resumo?.recebimentos || {})
  const informado = caixa.valor_informado
  const esperado = caixa.valor_esperado ?? resumo?.dinheiro_esperado
  const dif = informado != null && esperado != null ? Number(informado) - Number(esperado) : null
  return paginaBobina('Fechamento de caixa', `${cabecalhoEmpresa(empresa)}
<hr><div class="c b">FECHAMENTO DE CAIXA</div>
<hr>${linhas([
    ['Terminal', esc(caixa.numero_terminal)],
    operador && ['Operador', esc(operador)],
    ['Abertura', dataHora(caixa.aberto_em)],
    caixa.fechado_em && ['Fechamento', dataHora(caixa.fechado_em)],
    ['Vendas concluídas', resumo?.qtd_vendas ?? 0],
  ])}
<hr><div class="b">Vendas por forma</div>${linhas(formas.length ? formas.map(([f, v]) => [esc(nomeForma(f)), dinheiro(v)]) : [['Nenhuma venda', '']])}
${receb.length ? `<hr><div class="b">Recebimentos de contas</div>${linhas(receb.map(([f, v]) => [esc(nomeForma(f)), dinheiro(v)]))}` : ''}
<hr><div class="b">Dinheiro na gaveta</div>${linhas([
    ['Fundo de troco', dinheiro(resumo?.abertura)],
    ['Suprimentos', dinheiro(resumo?.suprimentos)],
    ['Sangrias', `-${dinheiro(resumo?.sangrias)}`],
    Number(resumo?.devolucoes_dinheiro) > 0 && ['Devoluções em dinheiro', `-${dinheiro(resumo.devolucoes_dinheiro)}`],
    ['Esperado', dinheiro(esperado), 'b'],
    informado != null && ['Contado', dinheiro(informado), 'b'],
    dif != null && [dif === 0 ? 'Diferença' : dif > 0 ? 'Sobra' : 'Falta', dinheiro(Math.abs(dif)), 'b'],
  ])}
<div class="ass">Operador</div><div class="ass">Responsável</div>`, cfg.largura)
}

export function htmlTeste(empresa, config) {
  const cfg = { ...IMPRESSAO_PADRAO, ...(config || {}) }
  const regua = '1234567890'.repeat(Number(cfg.largura) === 58 ? 4 : 5).slice(0, Number(cfg.largura) === 58 ? 32 : 48)
  return paginaBobina('Teste de impressão', `${cabecalhoEmpresa(empresa)}
<hr><div class="c b">TESTE DE IMPRESSÃO</div><div class="c">Bobina de ${cfg.largura} mm</div>
<hr><div style="white-space:nowrap;overflow:hidden">${regua}</div>
<div>Acentuação: ÁÉÍÓÚ ÃÕ Ç àéíóú ãõ ç</div>
${linhas([['Valor de exemplo', dinheiro(1234.56), 'b g']])}
<hr><div class="c">Se o texto acima saiu inteiro e sem cortes nas laterais, a largura está correta.</div>`, cfg.largura)
}

// ---------------------------------------------------------------------
// Envio para a impressora
// ---------------------------------------------------------------------
const toque = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

// Imprime o HTML sem abrir janela (quadro oculto). Em celulares e tablets,
// onde o quadro oculto imprime a página inteira, abre uma janela própria.
export function imprimirHtml(html) {
  if (toque()) {
    const j = window.open('', '_blank', 'width=420,height=700')
    if (!j) return { erro: 'O navegador bloqueou a janela de impressão. Permita janelas para este site.' }
    j.document.write(html.replace('</body>', '<script>window.onload = () => { window.print(); setTimeout(() => window.close(), 500) }</script></body>'))
    j.document.close()
    return {}
  }
  const f = document.createElement('iframe')
  f.setAttribute('aria-hidden', 'true')
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(f)
  const d = f.contentDocument
  d.open(); d.write(html); d.close()
  const imagens = [...d.images].map((i) => (i.complete ? null : new Promise((ok) => { i.onload = ok; i.onerror = ok }))).filter(Boolean)
  Promise.all(imagens).then(() => {
    const w = f.contentWindow
    w.addEventListener('afterprint', () => setTimeout(() => f.remove(), 100))
    setTimeout(() => f.isConnected && f.remove(), 120000)
    w.focus(); w.print()
  })
  return {}
}

// ---------------------------------------------------------------------
// Busca os dados e imprime
// ---------------------------------------------------------------------
async function nomeUsuario(id) {
  if (!id) return null
  const { data } = await supabase.from('usuarios').select('nome').eq('id', id).maybeSingle()
  return data?.nome ?? null
}

export async function imprimirComprovanteVenda(vendaId) {
  const [{ data: venda }, { data: itens }, { data: pagamentos }, { data: parcelas }, { data: empresa }] = await Promise.all([
    supabase.from('vendas').select('*').eq('id', vendaId).single(),
    supabase.from('venda_itens').select('*').eq('venda_id', vendaId).order('sequencia'),
    supabase.from('venda_pagamentos').select('*').eq('venda_id', vendaId),
    supabase.from('contas_receber').select('parcela, parcelas, valor, vencimento, origem').eq('venda_id', vendaId).eq('origem', 'crediario').order('parcela'),
    supabase.from('empresas').select('*').single(),
  ])
  if (!venda) return { erro: 'Venda não encontrada.' }
  const [cliente, operador, caixa] = await Promise.all([
    venda.cliente_id ? supabase.from('clientes').select('nome, cpf_cnpj').eq('id', venda.cliente_id).maybeSingle().then((r) => r.data) : null,
    nomeUsuario(venda.operador_id),
    supabase.from('caixas').select('numero_terminal').eq('id', venda.caixa_id).maybeSingle().then((r) => r.data),
  ])
  return imprimirHtml(htmlComprovanteVenda({
    empresa, venda, itens: itens || [], pagamentos: pagamentos || [], parcelas: parcelas || [], cliente, operador,
    terminal: caixa?.numero_terminal, config: configImpressao(empresa),
  }))
}

export async function imprimirFechamento(caixaId) {
  const [{ data: caixa }, { data: resumo }, { data: empresa }] = await Promise.all([
    supabase.from('caixas').select('*').eq('id', caixaId).single(),
    supabase.rpc('resumo_caixa', { p_caixa: caixaId }),
    supabase.from('empresas').select('*').single(),
  ])
  if (!caixa) return { erro: 'Caixa não encontrado.' }
  const operador = await nomeUsuario(caixa.operador_id)
  return imprimirHtml(htmlFechamento({ empresa, caixa, resumo, operador, config: configImpressao(empresa) }))
}

// Monta o HTML com os dados da empresa. Com { automatica: true }, só imprime
// se a impressão automática estiver ligada em Configurações.
export async function imprimirComEmpresa(montar, { automatica = false } = {}) {
  const { data: empresa } = await supabase.from('empresas').select('*').single()
  const config = configImpressao(empresa)
  if (automatica && !config.automatica) return {}
  return imprimirHtml(montar(empresa, config))
}
