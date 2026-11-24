import { arred } from './formato.js'

// Lógica pura do carrinho (sem tela), testada em carrinho.test.js

// lote (opcional): { id, numero, validade }
export function adicionar(itens, produto, quantidade = 1, lote = null) {
  const existente = itens.find((i) => i.produto_id === produto.id && (i.lote_id ?? null) === (lote?.id ?? null))
  if (existente) {
    return itens.map((i) => (i === existente ? { ...i, quantidade: i.quantidade + quantidade } : i))
  }
  return [
    ...itens,
    {
      chave: crypto.randomUUID(),
      produto_id: produto.id,
      descricao: produto.descricao,
      unidade: produto.unidade,
      preco_unitario: Number(produto.preco_venda),
      quantidade,
      desconto: 0,
      e_kit: Boolean(produto.e_kit),
      lote_id: lote?.id ?? null,
      lote_numero: lote?.numero ?? null,
      lote_validade: lote?.validade ?? null,
    },
  ]
}

export function alterarQuantidade(itens, chave, quantidade) {
  if (!(quantidade > 0)) return itens.filter((i) => i.chave !== chave)
  return itens.map((i) => (i.chave === chave ? { ...i, quantidade } : i))
}

export const remover = (itens, chave) => itens.filter((i) => i.chave !== chave)

export const totalItem = (i) => arred(i.quantidade * i.preco_unitario - (i.desconto || 0))

export function totais(itens, descontoGeral = 0, pagamentos = []) {
  const subtotal = arred(itens.reduce((s, i) => s + totalItem(i), 0))
  const total = arred(Math.max(0, subtotal - descontoGeral))
  const pago = arred(pagamentos.reduce((s, p) => s + Number(p.valor || 0), 0))
  const dinheiro = arred(pagamentos.filter((p) => p.forma === 'dinheiro').reduce((s, p) => s + Number(p.valor), 0))
  const falta = arred(Math.max(0, total - pago))
  const troco = arred(Math.max(0, pago - total))
  return { subtotal, total, pago, falta, troco, trocoValido: troco <= dinheiro }
}

// Formato esperado pela função finalizar_venda do banco
export const paraEnvio = (itens) =>
  itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco_unitario: i.preco_unitario, desconto: i.desconto || 0, ...(i.lote_id ? { lote_id: i.lote_id } : {}) }))

// Aplica os preços vigentes calculados pelo banco (mesma ordem dos itens). Retorna os mesmos itens se nada mudou.
export function aplicarPrecos(itens, precos) {
  let mudou = false
  const novos = itens.map((i, k) => {
    const p = precos?.[k]
    if (!p || p.produto_id !== i.produto_id) return i
    const preco = Number(p.preco), base = Number(p.preco_base)
    if (preco === i.preco_unitario && base === i.preco_base && p.nome === i.preco_nome) return i
    mudou = true
    return { ...i, preco_unitario: preco, preco_base: base, preco_origem: p.origem, preco_nome: p.nome }
  })
  return mudou ? novos : itens
}

// Troca o lote de um item (junta com outro item do mesmo lote, se houver)
export function trocarLote(itens, chave, lote) {
  const alvo = itens.find((i) => i.chave === chave)
  if (!alvo) return itens
  const igual = itens.find((i) => i !== alvo && i.produto_id === alvo.produto_id && i.lote_id === lote.id)
  if (igual) return itens.filter((i) => i !== alvo).map((i) => (i === igual ? { ...i, quantidade: i.quantidade + alvo.quantidade } : i))
  return itens.map((i) => (i === alvo ? { ...i, lote_id: lote.id, lote_numero: lote.numero, lote_validade: lote.validade } : i))
}

// Preço sugerido a partir do custo e do markup (%) e margem (%) resultante
export const precoSugerido = (custo, markup) => (Number(custo) > 0 && markup != null && markup !== '' ? Math.round(Number(custo) * (1 + Number(markup) / 100) * 100) / 100 : null)
export const margemSobreVenda = (custo, venda) => (Number(venda) > 0 && Number(custo) > 0 ? ((Number(venda) - Number(custo)) / Number(venda)) * 100 : null)
export const markupDeMargem = (margem) => (Number(margem) < 100 ? (Number(margem) / (100 - Number(margem))) * 100 : null)

// Leitura "3*789..." = quantidade 3 do código lido
export function lerCodigo(texto) {
  const m = String(texto).trim().match(/^(\d+(?:[.,]\d+)?)\s*\*\s*(.+)$/)
  if (m) return { quantidade: Number(m[1].replace(',', '.')), termo: m[2].trim() }
  return { quantidade: 1, termo: String(texto).trim() }
}
