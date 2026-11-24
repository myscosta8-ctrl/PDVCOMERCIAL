// Cliente falso, com dados fictícios, usado apenas para conferir as telas (VITE_DEMO=1).
// Nunca é incluído quando o sistema roda com o banco real.
const agora = new Date()
const h = (horas, min = 0) => { const d = new Date(agora); d.setHours(horas, min, 0, 0); return d.toISOString() }
const EMP = {
  id: 'e1', razao_social: 'Farma Família Ltda', nome_fantasia: 'Farma Família', segmento: 'farmacia', cnpj: '12345678000195',
  inscricao_estadual: '151234567', uf: 'PA', municipio_ibge: '1501808', regime_tributario: 'simples', nfce_ambiente: 2, nfce_serie: 1,
  nfce_csc_id: '000001', certificado_titular: 'FARMA FAMILIA LTDA:12345678000195', certificado_validade: '2027-08-10T00:00:00Z',
  nfce_url_qrcode: 'https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam', nfce_url_consulta: 'www.sefa.pa.gov.br/nfce/consulta',
  endereco: { logradouro: 'Rua Presidente Getúlio Vargas', numero: '120', bairro: 'Centro', municipio: 'Breves', cep: '68800000', fone: '91999990000' },
}
const P = (id, descricao, ean, preco_venda, preco_custo, estoque_atual, estoque_minimo, extra = {}) => ({
  id, descricao, ean, codigo: String(100 + Number(id.slice(1))), preco_venda, preco_custo, estoque_atual, estoque_minimo, unidade: 'UN',
  ncm: '30049099', cfop: '5102', csosn: '102', origem: 0, ativo: true, controlado: false, controla_lote: true, ...extra,
})
const PRODUTOS = [
  P('p1', 'Dipirona Monoidratada 500 mg, 10 comprimidos', '7896004700120', 6.9, 2.35, 84, 20),
  P('p2', 'Paracetamol 750 mg, 20 comprimidos', '7896714200156', 12.5, 4.8, 12, 15),
  P('p3', 'Soro fisiológico 0,9%, 500 ml', '7898148290178', 8.9, 3.9, 46, 10, { unidade: 'FR' }),
  P('p4', 'Álcool etílico 70%, 1 litro', '7896020160014', 14.9, 7.2, 0, 8, { unidade: 'FR', ncm: '22071090' }),
  P('p5', 'Clonazepam 2 mg, 30 comprimidos', '7896004711232', 18.4, 6.1, 9, 5, { controlado: true }),
  P('p6', 'Protetor solar FPS 50, 120 ml', '7891010245321', 59.9, 31.0, 7, 6, { ncm: '33049910' }),
  P('p7', 'Fralda infantil tamanho G, 30 unidades', '7896007541124', 54.9, 38.5, 22, 10, { ncm: null, controla_lote: false, unidade: 'PCT' }),
  P('p8', 'Vitamina C 1 g efervescente, 10 comprimidos', '7896112402158', 16.9, 6.4, 31, 10),
]
const VENDAS = [
  { id: 'v7', numero: 1048, subtotal: 89.7, desconto: 0, total: 89.7, troco: 10.3, status: 'concluida', criado_em: h(16, 42), operador: { nome: 'Ana Ribeiro' }, pagamentos: [{ forma: 'dinheiro', valor: 100 }], notas: [{ numero: 312, status: 'autorizada' }] },
  { id: 'v6', numero: 1047, subtotal: 25.8, desconto: 0, total: 25.8, troco: 0, status: 'concluida', criado_em: h(16, 5), operador: { nome: 'Ana Ribeiro' }, pagamentos: [{ forma: 'pix', valor: 25.8 }], notas: [{ numero: 311, status: 'rejeitada' }] },
  { id: 'v5', numero: 1046, subtotal: 114.8, desconto: 4.8, total: 110, troco: 0, status: 'concluida', criado_em: h(15, 31), operador: { nome: 'Carlos Lima' }, pagamentos: [{ forma: 'credito', valor: 110 }], notas: [{ numero: 310, status: 'autorizada' }] },
  { id: 'v4', numero: 1045, subtotal: 18.4, desconto: 0, total: 18.4, troco: 0, status: 'cancelada', criado_em: h(14, 12), operador: { nome: 'Ana Ribeiro' }, motivo_cancelamento: 'Cliente desistiu da compra no caixa', pagamentos: [{ forma: 'debito', valor: 18.4 }], notas: [] },
  { id: 'v3', numero: 1044, subtotal: 66.8, desconto: 0, total: 66.8, troco: 0, status: 'concluida', criado_em: h(11, 48), operador: { nome: 'Carlos Lima' }, pagamentos: [{ forma: 'pix', valor: 40 }, { forma: 'debito', valor: 26.8 }], notas: [{ numero: 309, status: 'autorizada' }] },
  { id: 'v2', numero: 1043, subtotal: 13.8, desconto: 0, total: 13.8, troco: 6.2, status: 'concluida', criado_em: h(9, 20), operador: { nome: 'Ana Ribeiro' }, pagamentos: [{ forma: 'dinheiro', valor: 20 }], notas: [{ numero: 308, status: 'autorizada' }] },
]
const CAIXA = { id: 'c1', numero_terminal: 1, aberto_em: h(7, 58), valor_abertura: 150, status: 'aberto' }
const TABELAS = {
  usuarios: [{ id: 'u1', nome: 'Carlos Lima', papel: 'administrador', empresa: EMP }],
  empresas: [EMP],
  produtos: PRODUTOS,
  categorias: [{ id: 'k1', nome: 'Medicamentos' }, { id: 'k2', nome: 'Higiene e beleza' }, { id: 'k3', nome: 'Infantil' }],
  caixas: [
    CAIXA,
    { id: 'c0', numero_terminal: 1, aberto_em: '2026-11-23T11:02:00Z', fechado_em: '2026-11-23T22:10:00Z', valor_esperado: 812.4, valor_informado: 812.4, status: 'fechado' },
    { id: 'c9', numero_terminal: 2, aberto_em: '2026-11-23T12:00:00Z', fechado_em: '2026-11-23T21:40:00Z', valor_esperado: 403.1, valor_informado: 398.1, status: 'fechado' },
    { id: 'c8', numero_terminal: 1, aberto_em: '2026-11-22T11:00:00Z', fechado_em: '2026-11-22T22:05:00Z', valor_esperado: 655.0, valor_informado: 657.0, status: 'fechado' },
  ],
  caixa_movimentos: [
    { id: 'm2', tipo: 'sangria', valor: 200, motivo: 'Depósito bancário', criado_em: h(13, 10) },
    { id: 'm1', tipo: 'suprimento', valor: 50, motivo: 'Reforço de troco', criado_em: h(10, 2) },
  ],
  vendas: VENDAS,
  venda_itens: [
    { sequencia: 1, descricao: 'Protetor solar FPS 50, 120 ml', quantidade: 1, preco_unitario: 59.9, desconto: 0, total: 59.9 },
    { sequencia: 2, descricao: 'Dipirona Monoidratada 500 mg, 10 comprimidos', quantidade: 2, preco_unitario: 6.9, desconto: 0, total: 13.8 },
    { sequencia: 3, descricao: 'Vitamina C 1 g efervescente, 10 comprimidos', quantidade: 1, preco_unitario: 16.9, desconto: 0.9, total: 16.0 },
  ],
  nfce_documentos: [{ numero: 312, serie: 1, status: 'autorizada', ambiente: 2, chave: '15261112345678000195650010000003121123456788' }],
}
const RPC = {
  painel_dia: {
    total: 300.3, qtd: 5, itens: 17, descontos: 5.7, ontem_total: 268.4, ontem_qtd: 6, canceladas: 1,
    por_hora: [0, 0, 0, 0, 0, 0, 0, 0, 0, 13.8, 0, 66.8, 0, 0, 0, 110, 115.5, 0, 0, 0, 0, 0, 0, 0],
    formas: { pix: 65.8, credito: 110, dinheiro: 97.7, debito: 26.8 },
    mais_vendidos: [
      { descricao: 'Protetor solar FPS 50, 120 ml', quantidade: 2, total: 119.8 },
      { descricao: 'Vitamina C 1 g efervescente, 10 comprimidos', quantidade: 3, total: 50.7 },
      { descricao: 'Dipirona Monoidratada 500 mg, 10 comprimidos', quantidade: 6, total: 41.4 },
      { descricao: 'Soro fisiológico 0,9%, 500 ml', quantidade: 3, total: 26.7 },
    ],
    estoque_baixo: PRODUTOS.filter((p) => p.estoque_atual <= p.estoque_minimo),
    qtd_estoque_baixo: 2, sem_ncm: 1, produtos_ativos: 8,
    nfce: { autorizadas: 4, pendentes: 1, sem_nota: 1 }, caixas_abertos: 1,
    ultimas: VENDAS.filter((v) => v.status === 'concluida').slice(0, 5),
  },
  resumo_caixa: { abertura: 150, formas: { dinheiro: 97.7, pix: 65.8, credito: 110, debito: 26.8 }, suprimentos: 50, sangrias: 200, qtd_vendas: 5, dinheiro_esperado: 97.7 },
  credenciais_configuradas: { certificado: true, senha: true, csc: true },
}

function consulta(tabela) {
  let linhas = [...(TABELAS[tabela] ?? [])]
  let unico = false
  const q = {
    select: () => q, order: () => q, limit: () => q, gte: () => q, lt: () => q,
    or: (expr) => {
      const conds = expr.split(',').map((c) => c.split('.'))
      linhas = linhas.filter((l) => conds.some(([campo, op, ...v]) => {
        const val = v.join('.')
        if (op === 'eq') return String(l[campo] ?? '') === val
        if (op === 'ilike') return String(l[campo] ?? '').toLowerCase().includes(val.replace(/%/g, '').toLowerCase())
        return false
      }))
      return q
    },
    eq: (campo, valor) => { linhas = linhas.filter((l) => !(campo in l) || l[campo] === valor); return q },
    insert: () => q, update: () => q,
    single: () => { unico = true; return q },
    maybeSingle: () => { unico = true; return q },
    then: (ok) => ok({ data: unico ? linhas[0] ?? null : linhas, error: null }),
  }
  return q
}

export const clienteDemo = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => {},
    signInWithPassword: async () => ({ error: null }),
  },
  from: consulta,
  rpc: async (nome) => ({ data: RPC[nome] ?? null, error: null }),
  functions: { invoke: async () => ({ data: { titular: EMP.certificado_titular, validade: EMP.certificado_validade, sefaz: { codigo: '107', mensagem: 'Serviço em Operação' } }, error: null }) },
}

export const criarCliente = () => clienteDemo
