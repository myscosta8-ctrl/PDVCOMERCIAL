import { arred } from './formato.js'

// Lógica pura do carrinho (sem tela), testada em carrinho.test.js

export function adicionar(itens, produto, quantidade = 1) {
  const existente = itens.find((i) => i.produto_id === produto.id && !i.lote_id)
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
  itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, desconto: i.desconto || 0 }))

// Leitura "3*789..." = quantidade 3 do código lido
export function lerCodigo(texto) {
  const m = String(texto).trim().match(/^(\d+(?:[.,]\d+)?)\s*\*\s*(.+)$/)
  if (m) return { quantidade: Number(m[1].replace(',', '.')), termo: m[2].trim() }
  return { quantidade: 1, termo: String(texto).trim() }
}
