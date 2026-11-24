import QRCode from 'qrcode'
import { supabase } from './supabase.js'
import { dinheiro, dataHora } from './formato.js'

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

const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Cartão de débito', credito: 'Cartão de crédito', crediario: 'Crediário', outro: 'Outros' }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const chaveFormatada = (c) => String(c || '').replace(/(\d{4})/g, '$1 ').trim()

// Imprime o DANFE NFC-e (bobina 80 mm) em uma janela própria
export async function imprimirDanfe(vendaId) {
  const [{ data: venda }, { data: itens }, { data: pags }, { data: doc }, { data: empresa }] = await Promise.all([
    supabase.from('vendas').select('*').eq('id', vendaId).single(),
    supabase.from('venda_itens').select('*').eq('venda_id', vendaId).order('sequencia'),
    supabase.from('venda_pagamentos').select('*').eq('venda_id', vendaId),
    supabase.from('nfce_documentos').select('*').eq('venda_id', vendaId).eq('status', 'autorizada').maybeSingle(),
    supabase.from('empresas').select('*').single(),
  ])
  if (!doc) return { erro: 'Esta venda não tem NFC-e autorizada.' }
  const qr = await QRCode.toDataURL(doc.qrcode_url, { margin: 0, width: 220 })
  const e = empresa.endereco || {}
  const homolog = doc.ambiente === 2
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>NFC-e ${doc.numero}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { font-family: 'Courier New', monospace; font-size: 11px; width: 74mm; margin: 0 auto; color: #000; }
  .c { text-align: center } .b { font-weight: bold } hr { border: 0; border-top: 1px dashed #000; margin: 4px 0 }
  table { width: 100%; border-collapse: collapse } td { vertical-align: top; padding: 1px 0 } .r { text-align: right }
  img { display: block; margin: 4px auto; width: 40mm; height: 40mm }
</style></head><body>
<div class="c b">${esc(empresa.nome_fantasia || empresa.razao_social)}</div>
<div class="c">${esc(empresa.razao_social)}<br>CNPJ ${esc(empresa.cnpj)} IE ${esc(empresa.inscricao_estadual)}<br>
${esc(e.logradouro)}, ${esc(e.numero)} - ${esc(e.bairro)} - ${esc(e.municipio)}/${esc(empresa.uf)}</div>
<hr><div class="c b">DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>
${homolog ? '<div class="c b">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL</div>' : ''}
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
<div class="c">Consulte pela chave de acesso em<br>${esc(empresa.nfce_url_consulta)}<br><span class="b">${chaveFormatada(doc.chave)}</span></div>
<hr><div class="c">${venda.cpf_consumidor ? `CONSUMIDOR CPF/CNPJ: ${esc(venda.cpf_consumidor)}` : 'CONSUMIDOR NÃO IDENTIFICADO'}</div>
<hr><div class="c b">NFC-e nº ${doc.numero} Série ${doc.serie} ${dataHora(doc.emitida_em)}</div>
<div class="c">Protocolo de autorização: ${esc(doc.protocolo)}<br>Data de autorização: ${dataHora(doc.emitida_em)}</div>
<img src="${qr}" alt="QR Code">
<script>window.onload = () => { window.print(); setTimeout(() => window.close(), 500) }</script>
</body></html>`
  const janela = window.open('', '_blank', 'width=420,height=700')
  if (!janela) return { erro: 'O navegador bloqueou a janela de impressão. Permita janelas para este site.' }
  janela.document.write(html)
  janela.document.close()
  return {}
}
