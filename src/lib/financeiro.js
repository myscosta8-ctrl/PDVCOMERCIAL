// Regras do controle de despesas que não dependem da tela (testadas em financeiro.test.js)

export const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const arred = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100

// Palavras que indicam a conta do plano padrão (códigos criados com a empresa).
// Se a empresa mudou os códigos, a sugestão simplesmente não acontece.
const PALAVRAS = [
  ['4.01', ['aluguel', 'condominio', 'locacao do imovel']],
  ['4.02', ['energia', 'conta de luz', 'agua', 'saneamento', 'esgoto', 'telefone', 'internet', 'celular', 'fibra', 'banda larga']],
  ['4.03', ['salario', 'folha', 'fgts', 'inss', 'ferias', 'decimo terceiro', '13o', 'rescisao', 'vale transporte', 'vale alimentacao', 'adiantamento funcionario']],
  ['4.04', ['pro-labore', 'pro labore', 'prolabore']],
  ['4.05', ['contabilidade', 'contador', 'honorarios contabeis', 'escritorio contabil']],
  ['4.06', ['sistema', 'assinatura', 'software', 'licenca', 'mensalidade do sistema', 'certificado digital', 'hospedagem', 'dominio']],
  ['4.07', ['limpeza', 'material de escritorio', 'embalagem', 'sacola', 'papel', 'bobina', 'copa', 'descartavel']],
  ['4.08', ['manutencao', 'conserto', 'reparo', 'pintura', 'ar condicionado', 'eletricista', 'encanador', 'dedetizacao']],
  ['4.09', ['propaganda', 'marketing', 'anuncio', 'panfleto', 'impulsionamento', 'carro de som', 'faixa', 'brinde']],
  ['4.10', ['tarifa', 'taxa de cartao', 'taxa do cartao', 'maquininha', 'aluguel da maquina', 'pacote de servicos', 'anuidade']],
  ['2.01', ['das', 'simples nacional', 'icms', 'imposto', 'difal', 'substituicao tributaria']],
  ['3.01', ['mercadoria', 'distribuidora', 'compra de', 'medicamento', 'duplicata', 'laboratorio', 'atacado', 'fornecedor de']],
  ['3.02', ['frete', 'transportadora', 'entrega da compra']],
  ['5.01', ['juros', 'multa', 'mora', 'iof']],
  ['6.01', ['retirada', 'distribuicao de lucro', 'saque do socio']],
  ['6.02', ['emprestimo', 'financiamento', 'consignado', 'parcela do banco', 'capital de giro']],
  ['6.03', ['equipamento', 'computador', 'impressora', 'balcao', 'prateleira', 'gondola', 'reforma', 'movel', 'freezer', 'geladeira']],
  ['1.02', ['servico', 'aplicacao', 'afericao', 'consulta']],
  ['1.03', ['rendimento', 'juros recebidos', 'cashback']],
  ['1.05', ['aporte', 'emprestimo recebido', 'capital do socio']],
]

// Sugere a conta do plano pela descrição. Retorna o id da conta ou null.
export function contaPorPalavra(descricao, planos, tipo) {
  const d = ` ${semAcento(descricao).replace(/[^a-z0-9 -]/g, ' ').replace(/\s+/g, ' ')} `
  if (d.trim().length < 3) return null
  let melhor = null, tamanho = 0
  for (const [codigo, palavras] of PALAVRAS) {
    for (const p of palavras) {
      if (p.length > tamanho && new RegExp(` ${p.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(s|es)? `).test(d)) {
        const plano = planos.find((x) => x.codigo === codigo && x.ativo !== false && (!tipo || x.tipo === (tipo === 'pagar' ? 'despesa' : 'receita')))
        if (plano) { melhor = plano.id; tamanho = p.length }
      }
    }
  }
  return melhor
}

const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00`) - new Date(`${a}T12:00`)) / 864e5)
const pessoaDe = (l) => l.fornecedor_id || l.cliente_id || null

// Conferência: aponta o que provavelmente está errado nos lançamentos
export function conferirLancamentos(lancs, hoje, codigoGenerico = '4.11') {
  const ativos = lancs.filter((l) => l.status !== 'cancelado')
  const problemas = []

  // 1) Possíveis duplicados: mesmo tipo e valor, vencimento até 3 dias de diferença e mesmo fornecedor ou descrição
  const vistos = new Set()
  const porValor = new Map()
  for (const l of ativos) {
    const k = `${l.tipo}|${Number(l.valor).toFixed(2)}`
    if (!porValor.has(k)) porValor.set(k, [])
    porValor.get(k).push(l)
  }
  for (const grupo of porValor.values()) {
    if (grupo.length < 2) continue
    for (let i = 0; i < grupo.length; i++) {
      const a = grupo[i]
      if (vistos.has(a.id)) continue
      const iguais = [a]
      for (let j = i + 1; j < grupo.length; j++) {
        const b = grupo[j]
        if (vistos.has(b.id)) continue
        if (a.grupo_id && a.grupo_id === b.grupo_id) continue                   // parcelas do mesmo lançamento
        if (a.despesa_fixa_id && a.despesa_fixa_id === b.despesa_fixa_id) continue  // meses diferentes da mesma fixa
        const perto = Math.abs(diasEntre(a.vencimento, b.vencimento)) <= 3
        const mesmaPessoa = pessoaDe(a) && pessoaDe(a) === pessoaDe(b)
        const mesmaDescricao = semAcento(a.descricao).trim() === semAcento(b.descricao).trim()
        if (perto && (mesmaPessoa || mesmaDescricao)) iguais.push(b)
      }
      if (iguais.length > 1) {
        iguais.forEach((x) => vistos.add(x.id))
        problemas.push({ tipo: 'duplicado', nivel: 'critico', titulo: `Possível lançamento repetido: ${a.descricao}`, valor: Number(a.valor), lancamentos: iguais,
          texto: `${iguais.length} lançamentos de mesmo valor com vencimentos próximos. Se for a mesma conta, cancele o que sobra.` })
      }
    }
  }

  // 2) Em aberto há mais de 60 dias: talvez pago sem registrar a baixa
  const antigos = ativos.filter((l) => l.status === 'aberto' && diasEntre(l.vencimento, hoje) > 60)
  if (antigos.length) problemas.push({ tipo: 'antigo', nivel: 'alerta', titulo: `${antigos.length} conta(s) em aberto vencidas há mais de 60 dias`, lancamentos: antigos,
    valor: arred(antigos.reduce((s, l) => s + Number(l.valor) - Number(l.valor_pago), 0)), texto: 'Se já foram pagas, registre o pagamento; se não existem mais, cancele.' })

  // 3) Pagamento parcial parado há mais de 30 dias
  const parciais = ativos.filter((l) => l.status === 'aberto' && Number(l.valor_pago) > 0 && diasEntre(l.vencimento, hoje) > 30)
  if (parciais.length) problemas.push({ tipo: 'parcial', nivel: 'alerta', titulo: `${parciais.length} conta(s) pagas só em parte há mais de 30 dias`, lancamentos: parciais,
    valor: arred(parciais.reduce((s, l) => s + Number(l.valor) - Number(l.valor_pago), 0)), texto: 'Confira se o restante foi desconto ou se ainda falta pagar.' })

  // 4) Valor estimado de despesa fixa variável ainda não conferido, vencendo em até 7 dias
  const estimados = ativos.filter((l) => l.status === 'aberto' && Number(l.valor_pago) === 0 && String(l.observacao ?? '').startsWith('Valor estimado') && diasEntre(hoje, l.vencimento) <= 7)
  if (estimados.length) problemas.push({ tipo: 'estimado', nivel: 'alerta', titulo: `${estimados.length} despesa(s) fixa(s) com valor estimado`, lancamentos: estimados,
    valor: arred(estimados.reduce((s, l) => s + Number(l.valor), 0)), texto: 'Abra cada uma, confira o valor da fatura e salve para tirar o aviso.' })

  // 5) Muitas despesas em "Outras despesas": o relatório perde detalhe
  const desde = new Date(`${hoje}T12:00`); desde.setDate(desde.getDate() - 90)
  const inicio = desde.toISOString().slice(0, 10)
  const genericas = ativos.filter((l) => l.plano?.codigo === codigoGenerico && l.competencia >= inicio)
  if (genericas.length >= 5) problemas.push({ tipo: 'generico', nivel: 'alerta', titulo: `${genericas.length} lançamentos em "${genericas[0].plano?.nome ?? 'Outras despesas'}" nos últimos 90 dias`, lancamentos: genericas,
    valor: arred(genericas.reduce((s, l) => s + Number(l.valor), 0)), texto: 'Use Reclassificar para mover para a conta certa e enxergar melhor onde o dinheiro vai.' })

  return problemas
}

// Ao editar um lançamento de valor estimado, tira o aviso da observação
export const semAvisoEstimado = (obs) => String(obs ?? '').replace(/^Valor estimado: confira a fatura e ajuste\.\s*/, '').trim()

// Agrupa as linhas do relatorio_contas: { contas: [{id, codigo, nome, tipo, grupo, meses: {'2026-01': v}, total}], meses }
export function montarRelatorio(linhas, meses) {
  const mapa = new Map()
  for (const r of linhas) {
    if (!mapa.has(r.plano_conta_id)) mapa.set(r.plano_conta_id, { id: r.plano_conta_id, codigo: r.codigo, nome: r.nome, tipo: r.tipo, grupo: r.grupo, meses: {}, total: 0 })
    const c = mapa.get(r.plano_conta_id)
    if (!meses.includes(r.mes)) continue
    c.meses[r.mes] = arred((c.meses[r.mes] ?? 0) + Number(r.valor))
    c.total = arred(c.total + Number(r.valor))
  }
  return [...mapa.values()].filter((c) => c.total !== 0).sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
}

// Comparação de um mês com o anterior, conta a conta, das maiores variações para as menores
export function compararMeses(contas, atual, anterior) {
  return contas.map((c) => {
    const a = c.meses[atual] ?? 0, b = c.meses[anterior] ?? 0
    return { ...c, atual: a, anterior: b, diferenca: arred(a - b), pct: b ? arred(((a - b) / b) * 100) : null }
  }).filter((c) => c.atual || c.anterior).sort((x, y) => Math.abs(y.diferenca) - Math.abs(x.diferenca))
}

// Lista de meses 'AAAA-MM' terminando em fim (inclusive)
export function mesesAte(fim, qtd) {
  const [a, m] = fim.split('-').map(Number)
  return Array.from({ length: qtd }, (_, i) => {
    const d = new Date(a, m - 1 - (qtd - 1 - i), 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}

// CSV com ponto e vírgula (abre direto no Excel em português)
export function paraCsv(cabecalho, linhas) {
  const cel = (v) => {
    if (v == null) return ''
    if (typeof v === 'number') return String(v).replace('.', ',')
    const s = String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + [cabecalho, ...linhas].map((l) => l.map(cel).join(';')).join('\r\n')
}

export function baixarArquivo(nome, conteudo, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }))
  const a = document.createElement('a')
  a.href = url; a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
