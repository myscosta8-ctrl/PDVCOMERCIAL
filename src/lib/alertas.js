// Organiza a resposta de alertas_vencimento() em grupos para a tela
const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '')

export function gruposAlertas(a, papel = 'operador') {
  if (!a) return []
  const gestor = papel === 'administrador' || papel === 'gerente'
  const dias = a.dias || {}
  const g = []
  const add = (chave, nivel, titulo, tela, acao, item) => {
    const x = a[chave]
    if (!x || !(Number(x.qtd) > 0)) return
    g.push({ id: chave, nivel, titulo: titulo(Number(x.qtd)), qtd: Number(x.qtd), valor: x.valor != null ? Number(x.valor) : null, tela, acao, itens: (x.lista || []).map(item) })
  }
  const conta = (l) => ({ id: l.id, texto: l.descricao, data: dataBR(l.vencimento), valor: Number(l.valor) })
  const lote = (l) => ({ id: l.id, texto: `${l.descricao} (lote ${l.numero})`, data: dataBR(l.vencimento), quantidade: `${Number(l.quantidade).toLocaleString('pt-BR')} ${l.unidade ?? ''}`.trim() })

  add('pagar_vencidas', 'critico', (n) => `${n} conta(s) a pagar vencida(s)`, 'financeiro', 'Ver contas a pagar', conta)
  add('lotes_vencidos', 'critico', (n) => `${n} lote(s) vencido(s) com saldo em estoque`, 'produtos', 'Ver produtos', lote)
  if (a.certificado) {
    const d = Number(a.certificado.dias)
    g.push({
      id: 'certificado', nivel: d <= 7 ? 'critico' : 'alerta', tela: 'configuracoes', acao: 'Ver certificado', qtd: 1, valor: null, itens: [],
      titulo: d < 0 ? `Certificado digital vencido há ${-d} dia(s): a NFC-e não será autorizada` : d === 0 ? 'Certificado digital vence hoje' : `Certificado digital vence em ${d} dia(s)`,
    })
  }
  add('receber_atrasadas', 'alerta', (n) => `${n} conta(s) a receber em atraso`, gestor ? 'financeiro' : 'clientes', gestor ? 'Ver contas a receber' : 'Ver clientes', conta)
  add('pagar_vencendo', 'alerta', (n) => `${n} conta(s) a pagar ${dias.pagar === 0 ? 'vencem hoje' : `vencem em até ${dias.pagar ?? 5} dia(s)`}`, 'financeiro', 'Ver contas a pagar', conta)
  add('lotes_vencendo', 'alerta', (n) => `${n} lote(s) vencem em até ${dias.validade ?? 60} dia(s)`, 'produtos', 'Ver produtos', lote)
  return g
}

export const totalAlertas = (grupos) => ({
  qtd: grupos.reduce((s, x) => s + x.qtd, 0),
  critico: grupos.some((x) => x.nivel === 'critico'),
})
