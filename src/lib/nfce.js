import QRCode from 'qrcode'
import { NOMES_FORMAS as FORMAS } from './formas.js'
import { supabase } from './supabase.js'
import { dinheiro, dataHora } from './formato.js'
import { configImpressao, imprimirHtml, paginaBobina } from './impressao.js'

// Chama o servidor de NFC-e. Retorna { dados } ou { erro }.
export async function chamarNfce(corpo) {
  const { data, error } = await supabase.functions.invoke('nfce', { body: corpo })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).erro || msg } catch {}
    return { erro: msg }
  }
  if (data?.erro) return { erro: data.erro }
  return { dados: data }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const chaveFormatada = (c) => String(c || '').replace(/(\d{4})/g, '$1 ').trim()

const T_PAG_NOME = { '01': 'dinheiro', '03': 'credito', '04': 'debito', '05': 'crediario', '17': 'pix', '99': 'outro' }

// Valores do DANFE lidos do próprio XML enviado à SEFAZ (itens, totais e pagamentos ficam iguais aos da nota,
// inclusive quando a venda tem serviços, que não entram na NFC-e)
export function dadosDoXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return null
  const v = (no, nome) => no.getElementsByTagName(nome)[0]?.textContent ?? null
  const n = (no, nome) => Number(v(no, nome) ?? 0)
  const itens = [...doc.getElementsByTagName('det')].map((d, k) => ({
    sequencia: k + 1, descricao: v(d, 'xProd'), quantidade: n(d, 'qCom'), preco_unitario: n(d, 'vUnCom'), total: Math.round((n(d, 'vProd') - n(d, 'vDesc')) * 100) / 100,
  }))
  const tot = doc.getElementsByTagName('ICMSTot')[0]
  if (!tot) return null
  const pagamentos = [...doc.getElementsByTagName('detPag')].map((p) => ({ forma: T_PAG_NOME[v(p, 'tPag')] ?? 'outro', valor: n(p, 'vPag') }))
  const pag = doc.getElementsByTagName('pag')[0]
  return {
    itens, pagamentos, subtotal: n(tot, 'vProd'), desconto: n(tot, 'vDesc'), total: n(tot, 'vNF'),
    troco: pag ? n(pag, 'vTroco') : 0, informacoes: v(doc, 'infCpl'),
  }
}

// Imprime o DANFE NFC-e na bobina configurada (58 ou 80 mm)
export async function imprimirDanfe(vendaId) {
  const [{ data: vendaBanco }, { data: itensBanco }, { data: pagsBanco }, { data: doc }, { data: empresa }] = await Promise.all([
    supabase.from('vendas').select('*').eq('id', vendaId).single(),
    supabase.from('venda_itens').select('*').eq('venda_id', vendaId).order('sequencia'),
    supabase.from('venda_pagamentos').select('*').eq('venda_id', vendaId),
    supabase.from('nfce_documentos').select('*').eq('venda_id', vendaId).in('status', ['autorizada', 'contingencia']).order('criado_em', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('empresas').select('*').single(),
  ])
  if (!doc) return { erro: 'Esta venda não tem NFC-e autorizada.' }
  const doXml = doc.xml_enviado ? dadosDoXml(doc.xml_enviado) : null
  const itens = doXml?.itens ?? itensBanco
  const pags = doXml?.pagamentos ?? pagsBanco
  const venda = doXml ? { ...vendaBanco, subtotal: doXml.subtotal, desconto: doXml.desconto, total: doXml.total, troco: doXml.troco } : vendaBanco
  const contingencia = doc.status === 'contingencia'
  const qr = await QRCode.toDataURL(doc.qrcode_url, { margin: 0, width: 220 })
  const e = empresa.endereco || {}
  const homolog = doc.ambiente === 2
  const cfg = configImpressao(empresa)
  const corpo = `<div class="c b">${esc(empresa.nome_fantasia || empresa.razao_social)}</div>
<div class="c">${esc(empresa.razao_social)}<br>CNPJ ${esc(empresa.cnpj)} IE ${esc(empresa.inscricao_estadual)}<br>
${esc(e.logradouro)}, ${esc(e.numero)} - ${esc(e.bairro)} - ${esc(e.municipio)}/${esc(empresa.uf)}</div>
<hr><div class="c b">DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>
${homolog ? '<div class="c b">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL</div>' : ''}
${contingencia ? '<div class="c b">EMITIDA EM CONTINGÊNCIA<br>Pendente de autorização</div>' : ''}
<hr><table><tr><td>Descrição</td><td class="r">Qtd x Unit.</td><td class="r">Total</td></tr>
${itens.map((i) => `<tr><td colspan="3">${i.sequencia} ${esc(i.descricao)}</td></tr><tr><td></td><td class="r">${Number(i.quantidade)} x ${dinheiro(i.preco_unitario)}</td><td class="r">${dinheiro(i.total)}</td></tr>`).join('')}
</table><hr><table>
<tr><td>Qtd. total de itens</td><td class="r">${itens.length}</td></tr>
<tr><td>Valor total</td><td class="r">${dinheiro(venda.subtotal)}</td></tr>
${Number(venda.desconto) > 0 ? `<tr><td>Descontos</td><td class="r">-${dinheiro(venda.desconto)}</td></tr>` : ''}
<tr class="b"><td>Valor a pagar</td><td class="r">${dinheiro(venda.total)}</td></tr>
<tr><td>Forma de pagamento</td><td class="r">Valor pago</td></tr>
${pags.map((p) => `<tr><td>${FORMAS[p.forma] || p.forma}</td><td class="r">${dinheiro(p.valor)}</td></tr>`).join('')}
${Number(venda.troco) > 0 ? `<tr><td>Troco</td><td class="r">${dinheiro(venda.troco)}</td></tr>` : ''}
</table><hr>
${doXml?.informacoes ? `<div class="c">${esc(doXml.informacoes)}</div><hr>` : ''}<div class="c">Consulte pela chave de acesso em<br>${esc(empresa.nfce_url_consulta)}<br><span class="b">${chaveFormatada(doc.chave)}</span></div>
<hr><div class="c">${venda.cpf_consumidor ? `CONSUMIDOR CPF/CNPJ: ${esc(venda.cpf_consumidor)}` : 'CONSUMIDOR NÃO IDENTIFICADO'}</div>
<hr><div class="c b">NFC-e nº ${doc.numero} Série ${doc.serie} ${dataHora(doc.emitida_em)}</div>
${contingencia ? `<div class="c">Contingência desde ${dataHora(doc.dh_contingencia)}<br>${esc(doc.justificativa_contingencia)}</div>` : `<div class="c">Protocolo de autorização: ${esc(doc.protocolo)}<br>Data de autorização: ${dataHora(doc.emitida_em)}</div>`}
<img src="${qr}" alt="QR Code">
${cfg.mensagem ? `<hr><div class="c">${esc(cfg.mensagem)}</div>` : ''}`
  // Em contingência saem duas vias: a do consumidor e a que fica no estabelecimento até a autorização
  const vias = contingencia
    ? ['Via do consumidor', 'Via do estabelecimento'].map((v) => `<div class="via">${corpo.replace('<hr><div class="c b">DANFE NFC-e', `<div class="c">${v}</div><hr><div class="c b">DANFE NFC-e`)}</div>`).join('')
    : corpo
  return imprimirHtml(paginaBobina(`NFC-e ${doc.numero}`, vias, cfg.largura))
}
