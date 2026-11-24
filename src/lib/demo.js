// Cliente falso, com dados fictícios, usado apenas para conferir as telas (VITE_DEMO=1).
// Nunca é incluído quando o sistema roda com o banco real.
const agora = new Date()
const h = (horas, min = 0) => { const d = new Date(agora); d.setHours(horas, min, 0, 0); return d.toISOString() }
const EMP = {
  id: 'e1', razao_social: 'Farma Família Ltda', nome_fantasia: 'Farma Família', segmento: 'farmacia', cnpj: '12345678000195',
  inscricao_estadual: '151234567', uf: 'PA', municipio_ibge: '1501808', regime_tributario: 'simples', nfce_ambiente: 2, nfce_serie: 1,
  nfce_csc_id: '000001', markup_padrao: 35, certificado_titular: 'FARMA FAMILIA LTDA:12345678000195', certificado_validade: '2027-08-10T00:00:00Z',
  nfce_url_qrcode: 'https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam', nfce_url_consulta: 'www.sefa.pa.gov.br/nfce/consulta',
  pix_chave: '12345678000195', pix_nome: 'Farma Familia', pix_cidade: 'Breves', balanca: { ativo: true, digitos_codigo: 5, tipo: 'preco' },
  impressao: { largura: 80, automatica: true, comprovante: true, vias_crediario: 2, mensagem: 'Obrigado pela preferência!' }, alertas: { dias_pagar: 5, dias_validade: 60, dias_certificado: 30 },
  contador: { nome: 'Escritório Contábil Exemplo', cpf: '12345678909', crc: 'PA-012345/O' }, sped_perfil: 'A', cod_receita_icms: null,
  endereco: { logradouro: 'Rua Presidente Getúlio Vargas', numero: '120', bairro: 'Centro', municipio: 'Breves', cep: '68800000', fone: '91999990000' },
}
const P = (id, descricao, ean, preco_venda, preco_custo, estoque_atual, estoque_minimo, extra = {}) => ({
  id, descricao, ean, codigo: String(100 + Number(id.slice(1))), preco_venda, preco_custo, estoque_atual, estoque_minimo, unidade: 'UN',
  ncm: '30049099', cfop: '5102', csosn: '102', origem: 0, ativo: true, controlado: false, controla_lote: true, produto_pai_id: null, atributos: {}, regra_fiscal_id: extra.ncm === undefined ? 'rf2' : extra.ncm ? 'rf1' : null, ...extra,
})
const PRODUTOS = [
  P('p1', 'Dipirona Monoidratada 500 mg, 10 comprimidos', '7896004700120', 6.9, 2.35, 84, 20),
  P('p2', 'Paracetamol 750 mg, 20 comprimidos', '7896714200156', 12.5, 4.8, 12, 15),
  P('p3', 'Soro fisiológico 0,9%, 500 ml', '7898148290178', 8.9, 3.9, 46, 10, { unidade: 'FR' }),
  P('p4', 'Álcool etílico 70%, 1 litro', '7896020160014', 14.9, 7.2, 0, 8, { unidade: 'FR', ncm: '22071090' }),
  P('p5', 'Clonazepam 2 mg, 30 comprimidos', '7896004711232', 18.4, 6.1, 9, 5, { controlado: true, lista_controle: 'B1', registro_ms: '1004300450021' }),
  P('p6', 'Protetor solar FPS 50, 120 ml', '7891010245321', 59.9, 31.0, 7, 6, { ncm: '33049910' }),
  P('p7', 'Fralda infantil tamanho G, 30 unidades', '7896007541124', 54.9, 38.5, 22, 10, { ncm: null, controla_lote: false, unidade: 'PCT' }),
  P('p8', 'Vitamina C 1 g efervescente, 10 comprimidos', '7896112402158', 16.9, 6.4, 31, 10),
  P('p9', 'Meia esportiva cano médio', '7890000009999', 19.9, 7.5, 0, 0, { e_grade: true, controla_lote: false, ncm: '61159500' }),
  ...[['P', 'Branca', 6], ['M', 'Branca', 11], ['G', 'Branca', 0], ['P', 'Preta', 3], ['M', 'Preta', 8], ['G', 'Preta', 5]].map(([t, c, e], i) =>
    P(`pv${i}`, `Meia esportiva cano médio ${c} ${t}`, `78900000100${i}`, 19.9, 7.5, e, 2, { produto_pai_id: 'p9', atributos: { tamanho: t, cor: c }, controla_lote: false, ncm: '61159500' })),
]
const VENDAS = [
  { id: 'v8', numero: 1049, subtotal: 42.5, desconto: 0, total: 42.5, troco: 7.5, status: 'concluida', criado_em: h(17, 5), operador: { nome: 'Ana Ribeiro' }, pagamentos: [{ forma: 'dinheiro', valor: 50 }], notas: [{ numero: 313, status: 'contingencia' }] },
  { id: 'v7', numero: 1048, subtotal: 89.7, desconto: 0, total: 89.7, troco: 10.3, status: 'concluida', criado_em: h(16, 42), operador: { nome: 'Ana Ribeiro' }, pagamentos: [{ forma: 'dinheiro', valor: 100 }], notas: [{ numero: 312, status: 'autorizada' }] },
  { id: 'v6', numero: 1047, subtotal: 25.8, desconto: 0, total: 25.8, troco: 0, status: 'concluida', criado_em: h(16, 5), operador: { nome: 'Ana Ribeiro' }, pagamentos: [{ forma: 'pix', valor: 25.8 }], notas: [{ numero: 311, status: 'rejeitada' }] },
  { id: 'v5', numero: 1046, subtotal: 114.8, desconto: 4.8, total: 110, troco: 0, status: 'concluida', criado_em: h(15, 31), operador: { nome: 'Carlos Lima' }, pagamentos: [{ forma: 'credito', valor: 110 }], notas: [{ numero: 310, status: 'autorizada' }] },
  { id: 'v4', numero: 1045, subtotal: 18.4, desconto: 0, total: 18.4, troco: 0, status: 'cancelada', criado_em: h(14, 12), operador: { nome: 'Ana Ribeiro' }, motivo_cancelamento: 'Cliente desistiu da compra no caixa', pagamentos: [{ forma: 'debito', valor: 18.4 }], notas: [{ numero: 307, status: 'cancelada' }] },
  { id: 'v3', numero: 1044, subtotal: 66.8, desconto: 0, total: 66.8, troco: 0, status: 'concluida', criado_em: h(11, 48), operador: { nome: 'Carlos Lima' }, pagamentos: [{ forma: 'pix', valor: 40 }, { forma: 'debito', valor: 26.8 }], notas: [{ numero: 309, status: 'autorizada' }] },
  { id: 'v2', numero: 1043, subtotal: 13.8, desconto: 0, total: 13.8, troco: 6.2, status: 'concluida', criado_em: h(9, 20), operador: { nome: 'Ana Ribeiro' }, pagamentos: [{ forma: 'dinheiro', valor: 20 }], notas: [{ numero: 308, status: 'autorizada' }] },
]
const CAIXA = { id: 'c1', numero_terminal: 1, aberto_em: h(7, 58), valor_abertura: 150, status: 'aberto' }

const dIso = (n) => { const d = new Date(agora); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const PLANO = [
  ['1.01', 'Vendas de mercadorias (lançamento manual)', 'receita', 'receita_bruta'], ['1.02', 'Prestação de serviços', 'receita', 'receita_bruta'],
  ['1.03', 'Rendimentos e juros recebidos', 'receita', 'receitas_financeiras'], ['1.04', 'Outras receitas', 'receita', 'outras_receitas'],
  ['1.05', 'Aporte dos sócios e empréstimos recebidos', 'receita', 'nao_operacional'], ['2.01', 'Impostos sobre vendas (Simples Nacional/DAS)', 'despesa', 'deducoes'],
  ['3.01', 'Compras de mercadorias para revenda', 'despesa', 'estoque'], ['3.02', 'Frete sobre compras', 'despesa', 'estoque'],
  ['4.01', 'Aluguel e condomínio', 'despesa', 'despesas_operacionais'], ['4.02', 'Energia, água, telefone e internet', 'despesa', 'despesas_operacionais'],
  ['4.03', 'Salários e encargos', 'despesa', 'despesas_operacionais'], ['4.04', 'Pró-labore', 'despesa', 'despesas_operacionais'],
  ['4.05', 'Contabilidade', 'despesa', 'despesas_operacionais'], ['4.06', 'Sistemas e assinaturas', 'despesa', 'despesas_operacionais'],
  ['4.07', 'Material de uso, limpeza e embalagens', 'despesa', 'despesas_operacionais'], ['4.08', 'Manutenção e conservação', 'despesa', 'despesas_operacionais'],
  ['4.09', 'Marketing e publicidade', 'despesa', 'despesas_operacionais'], ['4.10', 'Taxas de cartão e tarifas bancárias', 'despesa', 'despesas_operacionais'],
  ['4.11', 'Outras despesas operacionais', 'despesa', 'despesas_operacionais'], ['5.01', 'Juros e multas pagos', 'despesa', 'despesas_financeiras'],
  ['6.01', 'Retirada dos sócios', 'despesa', 'nao_operacional'], ['6.02', 'Pagamento de empréstimos (principal)', 'despesa', 'nao_operacional'],
  ['6.03', 'Equipamentos e investimentos', 'despesa', 'nao_operacional'],
].map(([codigo, nome, tipo, grupo_dre], i) => ({ id: `pc${i}`, codigo, nome, tipo, grupo_dre, ativo: true }))
const pc = (codigo) => { const p = PLANO.find((x) => x.codigo === codigo); return { plano_conta_id: p.id, plano: { codigo: p.codigo, nome: p.nome } } }
const NF = { fornecedor_id: 'f1', fornecedor: { razao_social: 'Distribuidora Norte Farma Ltda', nome_fantasia: 'Norte Farma' } }
const L = (id, tipo, descricao, valor, venc, extra = {}) => ({
  id, tipo, descricao, valor, valor_pago: 0, vencimento: dIso(venc), competencia: dIso(Math.min(venc, 0)), parcela: 1, parcelas: 1, status: 'aberto',
  documento: null, linha_digitavel: null, observacao: null, centro_custo_id: 'cc1', centro: { nome: 'Loja' }, fornecedor: null, cliente: null, baixas: [], ...extra,
})
const F = (id, descricao, codigo, valor, dia, extra = {}) => ({ id, descricao, ...pc(codigo), valor, dia_vencimento: dia, valor_variavel: false, inicio: '2026-01-01', fim: null, ativo: true,
  observacao: null, centro_custo_id: 'cc1', centro: { nome: 'Loja' }, fornecedor_id: null, fornecedor: null, ...extra })
const FIXAS = [
  F('df1', 'Aluguel da loja', '4.01', 2200, 24), F('df2', 'Energia elétrica', '4.02', 480, 21, { valor_variavel: true }),
  F('df3', 'Internet e telefone', '4.02', 189.9, 12), F('df4', 'Contabilidade', '4.05', 650, 6), F('df5', 'Salários', '4.03', 4380, 7),
  F('df6', 'Água e esgoto', '4.02', 95, 27, { valor_variavel: true }), F('df7', 'Sistema de gestão', '4.06', 149.9, 14),
  F('df8', 'Seguro do ponto comercial', '4.11', 120, 15, { fim: '2026-06-01' }),
]
const LANCAMENTOS = [
  L('la1', 'pagar', 'Energia elétrica', 486.32, -3, { ...pc('4.02'), documento: 'Fatura 10/2026', despesa_fixa_id: 'df2' }),
  L('la12', 'pagar', 'Energia elétrica', 486.32, -1, { ...pc('4.02'), criado_em: dIso(-2) }),
  L('la13', 'pagar', 'Água e esgoto', 95, 3, { ...pc('4.02'), despesa_fixa_id: 'df6', observacao: 'Valor estimado: confira a fatura e ajuste.' }),
  L('la2', 'pagar', 'Aluguel da loja', 2200, 0, { ...pc('4.01'), despesa_fixa_id: 'df1', valor_pago: 1000, baixas: [{ id: 'b1', data: dIso(-2), valor: 1000, juros: 0, desconto: 0, forma: 'pix', conta_bancaria_id: 'cb2' }] }),
  L('la3', 'pagar', 'NF-e 88412 duplicata 001', 921.3, 4, { ...pc('3.01'), ...NF, documento: '88412/001', parcela: 1, parcelas: 2 }),
  L('la4', 'pagar', 'Simples Nacional (DAS)', 1312.4, 6, { ...pc('2.01'), linha_digitavel: '85890000013124003282612410202611000000000004' }),
  L('la5', 'pagar', 'Contabilidade', 650, 12, { ...pc('4.05'), despesa_fixa_id: 'df4' }),
  L('la6', 'pagar', 'Salários', 4380, 13, { ...pc('4.03'), despesa_fixa_id: 'df5' }),
  L('la7', 'pagar', 'Internet e telefone', 189.9, 18, { ...pc('4.02'), despesa_fixa_id: 'df3' }),
  L('la8', 'pagar', 'NF-e 88412 duplicata 002', 921.3, 34, { ...pc('3.01'), ...NF, documento: '88412/002', parcela: 2, parcelas: 2 }),
  L('la9', 'pagar', 'Sistema de gestão', 149.9, -10, { ...pc('4.06'), despesa_fixa_id: 'df7', status: 'pago', valor_pago: 149.9, baixas: [{ id: 'b2', data: dIso(-10), valor: 149.9, juros: 0, desconto: 0, forma: 'cartao', conta_bancaria_id: 'cb2' }] }),
  L('la10', 'receber', 'Aluguel da sala comercial', 900, 2, { ...pc('1.04'), cliente: { nome: 'Clínica Bem-Estar' } }),
  L('la11', 'receber', 'Aferição de pressão e glicemia', 340, 9, { ...pc('1.02') }),
]
const fluxoDemo = ({ p_inicio, p_fim }) => {
  const dias = []
  const hoje = dIso(0)
  for (let d = new Date(`${p_inicio}T12:00:00`); d <= new Date(`${p_fim}T12:00:00`); d.setDate(d.getDate() + 1)) {
    const dia = d.toISOString().slice(0, 10)
    const k = d.getDate()
    const passado = dia <= hoje
    const lancs = LANCAMENTOS.filter((l) => l.status === 'aberto' && l.vencimento === dia)
    dias.push({
      dia,
      vendas: passado && d.getDay() !== 0 ? 600 + ((k * 137) % 520) : 0,
      recebimentos: passado && k % 5 === 0 ? 120 : 0,
      outras_entradas: 0,
      saidas: passado ? (k % 7 === 3 ? 1450 : k % 3 === 0 ? 210 : 0) : 0,
      previsto_entradas: lancs.filter((l) => l.tipo === 'receber').reduce((s, l) => s + l.valor - l.valor_pago, 0) + (dia > hoje && d.getDay() !== 0 ? 0 : 0),
      previsto_saidas: lancs.filter((l) => l.tipo === 'pagar').reduce((s, l) => s + l.valor - l.valor_pago, 0),
    })
  }
  return { dias, vencidos_pagar: 486.32, vencidos_receber: 60 }
}
const dreDemo = () => ({
  meses: Array.from({ length: 12 }, (_, i) => {
    const rb = 21000 + ((i * 1733) % 6400), dev = 180 + i * 12, ded = Math.round(rb * 0.061), cmv = Math.round(rb * 0.58)
    const dop = 8600 + ((i * 311) % 900), dfi = 40 + (i % 3) * 25, outras = 900 + (i % 2) * 340
    const rl = rb - dev - ded
    return { mes: i + 1, receita_bruta: rb, devolucoes: dev, deducoes: ded, receita_liquida: rl, cmv, lucro_bruto: rl - cmv, despesas_operacionais: dop,
      resultado_operacional: rl - cmv - dop, despesas_financeiras: dfi, outras_receitas: outras, resultado: rl - cmv - dop - dfi + outras }
  }),
  detalhe: Array.from({ length: 12 }, (_, i) => [
    ['4.01', 'Aluguel e condomínio', 2200], ['4.02', 'Energia, água, telefone e internet', 680 + ((i * 53) % 140)], ['4.03', 'Salários e encargos', 4380],
    ['4.05', 'Contabilidade', 650], ['4.06', 'Sistemas e assinaturas', 149.9], ['4.10', 'Taxas de cartão e tarifas bancárias', 540 + ((i * 311) % 900) - 149.9],
  ].map(([codigo, nome, valor]) => ({ mes: i + 1, grupo: 'despesas_operacionais', codigo, nome, valor }))).flat(),
})
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
    { id: 'vi1', quantidade_devolvida: 0, sequencia: 1, descricao: 'Protetor solar FPS 50, 120 ml', quantidade: 1, preco_unitario: 59.9, desconto: 0, total: 59.9 },
    { id: 'vi2', quantidade_devolvida: 0, sequencia: 2, descricao: 'Dipirona Monoidratada 500 mg, 10 comprimidos', quantidade: 2, preco_unitario: 6.9, desconto: 0, total: 13.8 },
    { id: 'vi3', quantidade_devolvida: 1, sequencia: 3, descricao: 'Vitamina C 1 g efervescente, 10 comprimidos', quantidade: 1, preco_unitario: 16.9, desconto: 0.9, total: 16.0 },
  ],
  convenios: [
    { id: 'cv1', nome: 'Prefeitura Municipal', cnpj: '05123456000101', desconto_percentual: 5, dia_fechamento: 25, dias_vencimento: 10, ativo: true },
    { id: 'cv2', nome: 'Sindicato dos Comerciários', cnpj: null, desconto_percentual: 0, dia_fechamento: 20, dias_vencimento: 15, ativo: true },
  ],
  clientes: [
    { id: 'cl1', nome: 'Joana Martins', cpf_cnpj: '12345678909', telefone: '(91) 99876-1122', limite_credito: 500, bloqueado: false, ativo: true, convenio_id: null, convenio: null, endereco: {} },
    { id: 'cl2', nome: 'Raimundo Pereira', cpf_cnpj: '98765432100', telefone: '(91) 98111-2233', limite_credito: 300, bloqueado: false, ativo: true, convenio_id: null, convenio: null, endereco: {} },
    { id: 'cl3', nome: 'Luciana Farias', cpf_cnpj: '45678912300', telefone: '(91) 99222-3344', limite_credito: 0, bloqueado: false, ativo: true, convenio_id: 'cv1', convenio: { nome: 'Prefeitura Municipal' }, endereco: {} },
    { id: 'cl4', nome: 'Pedro Santos', cpf_cnpj: null, telefone: '(91) 98333-4455', limite_credito: 200, bloqueado: true, ativo: true, convenio_id: null, convenio: null, endereco: {} },
  ],
  contas_receber: [
    { id: 'cr1', cliente_id: 'cl2', origem: 'crediario', parcela: 1, parcelas: 3, valor: 60, valor_pago: 0, vencimento: '2026-11-10', status: 'aberta', cliente: { nome: 'Raimundo Pereira', telefone: '(91) 98111-2233' } },
    { id: 'cr2', cliente_id: 'cl2', origem: 'crediario', parcela: 2, parcelas: 3, valor: 60, valor_pago: 0, vencimento: '2026-12-10', status: 'aberta', cliente: { nome: 'Raimundo Pereira', telefone: '(91) 98111-2233' } },
    { id: 'cr3', cliente_id: 'cl1', origem: 'crediario', parcela: 1, parcelas: 2, valor: 85.5, valor_pago: 20, vencimento: '2026-11-28', status: 'aberta', cliente: { nome: 'Joana Martins', telefone: '(91) 99876-1122' } },
    { id: 'cr4', cliente_id: 'cl3', origem: 'convenio', parcela: 1, parcelas: 1, valor: 142.3, valor_pago: 0, vencimento: '2026-12-05', status: 'aberta', cliente: { nome: 'Luciana Farias', telefone: '(91) 99222-3344' } },
  ],
  pre_vendas: [
    { id: 'pv1', numero: 18, tipo: 'orcamento', cliente_nome: 'Joana Martins', itens: [{ produto_id: 'p6', descricao: 'Protetor solar FPS 50, 120 ml', quantidade: 2, preco_unitario: 59.9, desconto: 0 }, { produto_id: 'p8', descricao: 'Vitamina C 1 g efervescente, 10 comprimidos', quantidade: 1, preco_unitario: 16.9, desconto: 0 }], total: 136.7, validade: '2026-11-30', status: 'aberto', criado_em: h(10, 15), criador: { nome: 'Ana Ribeiro' } },
    { id: 'pv2', numero: 7, tipo: 'pedido', cliente_nome: 'Clínica Bem-Estar', itens: [{ produto_id: 'p3', descricao: 'Soro fisiológico 0,9%, 500 ml', quantidade: 20, preco_unitario: 8.9, desconto: 0 }], total: 178, validade: '2026-11-26', status: 'aberto', criado_em: h(8, 40), criador: { nome: 'Carlos Lima' } },
    { id: 'pv3', numero: 17, tipo: 'orcamento', cliente_nome: 'Raimundo Pereira', itens: [{ produto_id: 'p1', descricao: 'Dipirona Monoidratada 500 mg, 10 comprimidos', quantidade: 3, preco_unitario: 6.9, desconto: 0 }], total: 20.7, validade: '2026-11-20', status: 'aberto', criado_em: '2026-11-13T14:00:00Z', criador: { nome: 'Ana Ribeiro' } },
  ],
  promocoes: [
    { id: 'pr1', nome: 'Semana da beleza', tipo: 'percentual', inicio: '2026-11-20', fim: '2026-11-30', percentual: 15, categoria_id: 'k2', ativo: true, itens: [] },
    { id: 'pr2', nome: 'Protetor em oferta', tipo: 'preco', inicio: '2026-11-24', fim: '2026-11-27', percentual: null, categoria_id: null, ativo: true, itens: [{ id: 'x' }] },
    { id: 'pr3', nome: 'Atacado de soro', tipo: 'quantidade', inicio: '2026-11-01', fim: '2026-12-31', percentual: null, categoria_id: null, ativo: true, itens: [{ id: 'y' }] },
    { id: 'pr4', nome: 'Natal', tipo: 'percentual', inicio: '2026-12-15', fim: '2026-12-24', percentual: 10, categoria_id: null, ativo: true, itens: [{ id: 'z' }, { id: 'w' }] },
    { id: 'pr5', nome: 'Dia das crianças', tipo: 'preco', inicio: '2026-10-05', fim: '2026-10-12', percentual: null, categoria_id: null, ativo: true, itens: [{ id: 'v' }] },
  ],
  promocao_itens: [{ produto_id: 'p6', preco: 49.9, quantidade_minima: 1, produto: { descricao: 'Protetor solar FPS 50, 120 ml', preco_venda: 59.9, unidade: 'UN' } }],
  tabelas_preco: [
    { id: 'tp1', nome: 'Atacado', ajuste_percentual: -12, ativo: true, itens: [{ id: 'a' }], clientes: [{ count: 3 }] },
    { id: 'tp2', nome: 'Clínicas parceiras', ajuste_percentual: -8, ativo: true, itens: [], clientes: [{ count: 2 }] },
  ],
  fornecedores: [{ id: 'f1', cnpj: '11222333000144', razao_social: 'Distribuidora Norte Farma Ltda', nome_fantasia: 'Norte Farma' }],
  produto_fornecedor: [{ codigo_fornecedor: 'DIP500', fator: 1, produto: { id: 'p1', descricao: 'Dipirona Monoidratada 500 mg, 10 comprimidos', unidade: 'UN', preco_venda: 6.9, preco_custo: 2.35, markup: null, e_kit: false, ean: '7896004700120' } }],
  notas_entrada: [
    { id: 'n2', numero: 88412, serie: 1, emissao: '2026-11-21T09:00:00-03:00', criado_em: h(9, 5), valor_total: 1842.6, fornecedor_id: 'f1', duplicatas: [{ numero: '001', vencimento: '2026-12-21', valor: 921.3 }, { numero: '002', vencimento: '2027-01-20', valor: 921.3 }], chave: '15261111222333000144550010000884121000012345', fornecedor: { razao_social: 'Distribuidora Norte Farma Ltda', nome_fantasia: 'Norte Farma', cnpj: '11222333000144' }, itens: [{ count: 14 }] },
    { id: 'n1', numero: 5531, serie: 2, emissao: '2026-11-12T15:00:00-03:00', criado_em: '2026-11-12T19:40:00Z', valor_total: 612.0, fornecedor_id: 'f2', duplicatas: [], chave: '15261199888777000166550020000055311000054321', fornecedor: { razao_social: 'Higiene e Cia Comércio Ltda', nome_fantasia: null, cnpj: '99888777000166' }, itens: [{ count: 6 }] },
  ],
  lotes: [
    { id: 'l1', numero: 'DP2611A', validade: '2026-12-10', quantidade: 34, produto_id: 'p1' },
    { id: 'l2', numero: 'DP2702C', validade: '2027-08-30', quantidade: 50, produto_id: 'p1' },
  ],
  plano_contas: PLANO,
  centros_custo: [{ id: 'cc1', nome: 'Loja', ativo: true }, { id: 'cc2', nome: 'Delivery', ativo: true }],
  contas_bancarias: [
    { id: 'cb1', nome: 'Caixa da loja', tipo: 'caixa', saldo_inicial: 0, data_saldo: '2026-01-01', ativo: true },
    { id: 'cb2', nome: 'Banpará, conta 12345-6', tipo: 'banco', saldo_inicial: 8200, data_saldo: '2026-01-01', ativo: true },
  ],
  lancamentos: LANCAMENTOS,
  despesas_fixas: FIXAS,
  inventarios: [
    { id: 'iv2', numero: 4, descricao: 'Inventário de novembro de 2026', escopo: 'todos', categoria_id: null, status: 'aberto', criado_em: h(8, 5), finalizado_em: null, resumo: null, itens: [{ count: 8 }] },
    { id: 'iv1', numero: 3, descricao: 'Higiene e beleza', escopo: 'categoria', categoria_id: 'k2', status: 'finalizado', criado_em: '2026-10-28T11:00:00Z', finalizado_em: '2026-10-28T19:30:00Z', resumo: { itens_ajustados: 4, sobra_qtd: 3, falta_qtd: 7, sobra_valor: 41.2, falta_valor: 187.9 }, itens: [{ count: 46 }] },
  ],
  inventario_itens: PRODUTOS.filter((p) => !p.e_grade && !p.produto_pai_id).map((p, k) => ({
    id: `ii${k}`, inventario_id: 'iv2', produto_id: p.id, produto: p,
    estoque_sistema: k < 5 ? p.estoque_atual : null, contado: [84, 10, null, 1, 9, 7, null, 31][k] ?? null, ajuste: null, custo_unitario: null,
  })).map((i) => (i.contado == null ? { ...i, estoque_sistema: null } : i)),
  inventario_leituras: [
    { id: 'lt3', produto_id: 'p6', modo: 'somar', quantidade: 1, criado_em: h(9, 42), produto: { descricao: 'Protetor solar FPS 50, 120 ml' } },
    { id: 'lt2', produto_id: 'p5', modo: 'definir', quantidade: 9, criado_em: h(9, 40), produto: { descricao: 'Clonazepam 2 mg, 30 comprimidos' } },
    { id: 'lt1', produto_id: 'p4', modo: 'somar', quantidade: 1, criado_em: h(9, 38), produto: { descricao: 'Álcool etílico 70%, 1 litro' } },
    { id: 'lt0', produto_id: 'p2', modo: 'somar', quantidade: 10, criado_em: h(9, 31), produto: { descricao: 'Paracetamol 750 mg, 20 comprimidos' } },
  ],
  transferencias: [
    { id: 'tr3', numero: 12, empresa_origem_id: 'e2', empresa_destino_id: 'e1', origem_nome: 'Farma Família Centro', destino_nome: 'Farma Família', status: 'enviada', enviado_em: h(10, 12), valor_total: 412.6, divergencias: 0, observacao: 'Reposição de vitaminas', itens: [{ count: 4 }] },
    { id: 'tr2', numero: 31, empresa_origem_id: 'e1', empresa_destino_id: 'e2', origem_nome: 'Farma Família', destino_nome: 'Farma Família Centro', status: 'enviada', enviado_em: h(8, 50), valor_total: 156.4, divergencias: 0, itens: [{ count: 2 }] },
    { id: 'tr1', numero: 30, empresa_origem_id: 'e1', empresa_destino_id: 'e2', origem_nome: 'Farma Família', destino_nome: 'Farma Família Centro', status: 'recebida', enviado_em: '2026-11-19T13:00:00Z', valor_total: 980, divergencias: 1, itens: [{ count: 7 }] },
  ],
  transferencia_itens: [
    { id: 'ti1', descricao: 'Vitamina C 1 g efervescente, 10 comprimidos', ean: '7896112402158', unidade: 'UN', quantidade: 24, quantidade_recebida: null, lote_numero: 'VC2611', validade: '2027-06-30' },
    { id: 'ti2', descricao: 'Dipirona Monoidratada 500 mg, 10 comprimidos', ean: '7896004700120', unidade: 'UN', quantidade: 40, quantidade_recebida: null, lote_numero: 'DP2702C', validade: '2027-08-30' },
    { id: 'ti3', descricao: 'Soro fisiológico 0,9%, 500 ml', ean: '7896181900012', unidade: 'UN', quantidade: 12, quantidade_recebida: null, lote_numero: null, validade: null },
  ],
  regras_fiscais: [
    { id: 'rf1', nome: 'Padrão', ativo: true, prioridade: 100, ncm_prefixo: null, origem: null, cfop: '5102', csosn: '102', cst_icms: null, aliquota_icms: 0, reducao_bc: 0, cst_pis: '49', aliquota_pis: 0, cst_cofins: '49', aliquota_cofins: 0, cbenef: null, cst_ibscbs: null, cclasstrib: null, observacao: null },
    { id: 'rf2', nome: 'Medicamentos com substituição tributária', ativo: true, prioridade: 100, ncm_prefixo: '3004', origem: null, cfop: '5405', csosn: '500', cst_icms: null, aliquota_icms: 0, reducao_bc: 0, cst_pis: '04', aliquota_pis: 0, cst_cofins: '04', aliquota_cofins: 0, cbenef: null, cst_ibscbs: null, cclasstrib: null, observacao: 'Conferido com o contador' },
    { id: 'rf3', nome: 'Higiene pessoal monofásico', ativo: true, prioridade: 100, ncm_prefixo: '3305', origem: null, cfop: '5405', csosn: '500', cst_icms: null, aliquota_icms: 0, reducao_bc: 0, cst_pis: '04', aliquota_pis: 0, cst_cofins: '04', aliquota_cofins: 0, cbenef: null, cst_ibscbs: null, cclasstrib: null, observacao: null },
  ],
  receitas: [
    { id: 'rc1', tipo: 'notificacao_b', numero: 'PA2611042', data_emissao: '2026-11-20', prescritor_nome: 'Dra. Helena Souza', prescritor_conselho: 'CRM', prescritor_numero: '8812', prescritor_uf: 'PA', paciente_nome: 'Joana Martins', paciente_idade: 54, paciente_sexo: 'F', comprador_nome: 'Joana Martins', comprador_documento: '4512387', comprador_orgao: 'SSP/PA', criado_em: h(10, 22), venda: { numero: 1044, status: 'concluida' }, itens: [{ quantidade: 1, produto: { descricao: 'Clonazepam 2 mg, 30 comprimidos' }, lote: { numero: 'CLZ2604', validade: '2027-04-30' } }] },
    { id: 'rc2', tipo: 'antimicrobiano', numero: null, data_emissao: '2026-11-22', prescritor_nome: 'Dr. Paulo Lima', prescritor_conselho: 'CRM', prescritor_numero: '10231', prescritor_uf: 'PA', paciente_nome: 'Pedro Santos', paciente_idade: 8, paciente_sexo: 'M', comprador_nome: 'Raimundo Pereira', comprador_documento: '98765432100', criado_em: '2026-11-22T15:40:00Z', venda: { numero: 1031, status: 'concluida' }, itens: [{ quantidade: 1, produto: { descricao: 'Amoxicilina 250 mg/5 ml, suspensão 150 ml' }, lote: { numero: 'AMX2609', validade: '2027-09-30' } }] },
    { id: 'rc3', tipo: 'controle_especial', numero: null, data_emissao: '2026-11-18', prescritor_nome: 'Dra. Helena Souza', prescritor_conselho: 'CRM', prescritor_numero: '8812', prescritor_uf: 'PA', paciente_nome: 'Luciana Farias', comprador_nome: 'Luciana Farias', comprador_documento: '45678912300', criado_em: '2026-11-18T13:05:00Z', venda: { numero: 1012, status: 'concluida' }, itens: [{ quantidade: 2, produto: { descricao: 'Sertralina 50 mg, 30 comprimidos' }, lote: null }] },
  ],
  nfce_documentos: [
    { id: 'nd1', venda_id: 'v7', numero: 312, serie: 1, status: 'autorizada', ambiente: 2, emitida_em: h(16, 42), chave: '15261112345678000195650010000003121123456788' },
    { id: 'nd2', venda_id: 'v8', numero: 313, serie: 1, status: 'contingencia', ambiente: 2, dh_contingencia: h(17, 5), criado_em: h(17, 5), motivo: 'Emitida em contingência; será transmitida quando a SEFAZ responder.', venda: { numero: 1049, total: 42.5 } },
    { id: 'nd3', venda_id: 'v4', numero: 307, serie: 1, status: 'cancelada', ambiente: 2, cancelada_em: h(14, 20), protocolo_cancelamento: '315260000098765', justificativa_cancelamento: 'Cliente desistiu da compra no caixa', venda: { numero: 1045, total: 18.4 } },
    { id: 'nd4', venda_id: 'v6', numero: 311, serie: 1, status: 'rejeitada', ambiente: 2, codigo_status: '778', motivo: 'Rejeição: Informado NCM inexistente' },
  ],
  nfce_inutilizacoes: [{ id: 'i1', serie: 1, inicio: 290, fim: 291, criado_em: '2026-11-10T14:00:00Z', protocolo: '315260000054321', justificativa: 'Numeração pulada por falha do sistema emissor' }],
}
// Valores por conta e mês com variação estável (mesma semente, mesmo número)
function relatorioDemo({ p_inicio, p_fim }) {
  const base = { '2.01': 1290, '3.01': 9800, '3.02': 310, '4.01': 2200, '4.02': 690, '4.03': 4380, '4.05': 650, '4.06': 149.9, '4.07': 210, '4.08': 160, '4.09': 120, '4.10': 380, '4.11': 95, '5.01': 22, '6.01': 3000, '1.02': 340, '1.04': 900 }
  const out = []
  for (let d = new Date(`${p_inicio}T12:00`); d.toISOString().slice(0, 10) <= p_fim; d.setMonth(d.getMonth() + 1)) {
    const mes = d.toISOString().slice(0, 7)
    if (mes > agora.toISOString().slice(0, 7)) break
    const k = d.getMonth() + 1
    for (const [codigo, v] of Object.entries(base)) {
      const p = PLANO.find((x) => x.codigo === codigo)
      const varia = ['4.01', '4.03', '4.05', '4.06'].includes(codigo) ? 1 : 0.78 + (((k * 37 + codigo.charCodeAt(2) * 11) % 50) / 100)
      if (codigo === '4.09' && k % 3) continue
      out.push({ mes, plano_conta_id: p.id, codigo, nome: p.nome, tipo: p.tipo, grupo: p.grupo_dre, valor: Math.round(v * varia * 100) / 100, qtd: 1 })
    }
  }
  return out
}

const RPC = {
  gerar_despesas_fixas: 0,
  numeros_nfce_sem_nota: { ambiente: 2, serie: 1, ultimo: 313, faixas: [
    { inicio: 305, fim: 306, qtd: 2, situacao: 'sem_nota' },
    { inicio: 311, fim: 311, qtd: 1, situacao: 'rejeitada', venda_numero: 1047, pode_reenviar: true },
  ] },
  historico_financeiro: [
    { id: 9, acao: 'pagou', quando: h(10, 12), usuario: 'Carlos Lima', descricao: 'Aluguel da loja', tipo: 'pagar', valor: 1000, detalhes: { data: dIso(-2), forma: 'pix', juros: 0, desconto: 0 } },
    { id: 8, acao: 'editou', quando: h(9, 40), usuario: 'Brenda Souza', descricao: 'Energia elétrica', tipo: 'pagar', valor: 486.32, detalhes: { antes: { valor: 480 }, depois: { valor: 486.32 } } },
    { id: 7, acao: 'criou', quando: h(9, 31), usuario: 'Brenda Souza', descricao: 'Energia elétrica', tipo: 'pagar', valor: 486.32, detalhes: {} },
    { id: 6, acao: 'reclassificou', quando: h(8, 55), usuario: 'Carlos Lima', descricao: 'Sistema de gestão', tipo: 'pagar', valor: 149.9, detalhes: { antes: { plano_conta_id: 'pc18' }, depois: { plano_conta_id: 'pc13' } } },
    { id: 5, acao: 'gerou_fixa', quando: h(8, 2), usuario: 'Carlos Lima', descricao: 'Salários', tipo: 'pagar', valor: 4380, detalhes: {} },
    { id: 4, acao: 'cancelou', quando: h(8, 1), usuario: 'Carlos Lima', descricao: 'Frete avulso', tipo: 'pagar', valor: 45, detalhes: {} },
  ],
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
  resumo_caixa: { abertura: 150, formas: { dinheiro: 97.7, pix: 65.8, credito: 110, debito: 26.8 }, recebimentos: { dinheiro: 60, pix: 40 }, devolucoes_dinheiro: 0, suprimentos: 50, sangrias: 200, qtd_vendas: 5, dinheiro_esperado: 157.7 },
  situacao_cliente: { limite: 500, saldo_devedor: 65.5, disponivel: 434.5, em_atraso: 0, dias_atraso: 0, vale: 30, bloqueado: false, convenio: null },
  credenciais_configuradas: { certificado: true, senha: true, csc: true },
  lotes_alerta: { vencidos: 1, vencendo: 3, lista: [] },
  alertas_vencimento: {
    dias: { pagar: 5, validade: 60, certificado: 30 },
    pagar_vencidas: { qtd: 1, valor: 486.3, lista: [{ id: 'av1', descricao: 'Energia elétrica', vencimento: '2026-11-20', valor: 486.3 }] },
    pagar_vencendo: { qtd: 2, valor: 3870, lista: [{ id: 'av2', descricao: 'Distribuidora Norte duplicata 1/3', vencimento: '2026-11-26', valor: 2370 }, { id: 'av3', descricao: 'Aluguel da loja', vencimento: '2026-11-28', valor: 1500 }] },
    receber_atrasadas: { qtd: 2, valor: 214.5, lista: [{ id: 'av4', descricao: 'Maria das Graças (crediario 2/3)', vencimento: '2026-11-15', valor: 120 }, { id: 'av5', descricao: 'José Ribamar (crediario 1/2)', vencimento: '2026-11-18', valor: 94.5 }] },
    lotes_vencidos: { qtd: 1, lista: [{ id: 'av6', descricao: 'Dipirona 500 mg 10 comprimidos', numero: 'DP2231', vencimento: '2026-11-10', quantidade: 6, unidade: 'CX' }] },
    lotes_vencendo: { qtd: 3, lista: [{ id: 'av7', descricao: 'Amoxicilina 500 mg 21 cápsulas', numero: 'AM0912', vencimento: '2026-12-15', quantidade: 4, unidade: 'CX' }, { id: 'av8', descricao: 'Soro fisiológico 500 ml', numero: 'SF1188', vencimento: '2027-01-08', quantidade: 12, unidade: 'UN' }, { id: 'av9', descricao: 'Protetor solar FPS 50', numero: 'PS7720', vencimento: '2027-01-20', quantidade: 3, unidade: 'UN' }] },
  },
  aplicar_regras_fiscais: { alterados: 3, sem_regra: 0, amostra: [
    { descricao: 'Dipirona Monoidratada 500 mg, 10 comprimidos', ncm: '30049099', regra: 'Medicamentos com substituição tributária', antes: { cfop: '5102', csosn: '102' }, depois: { cfop: '5405', csosn: '500' } },
    { descricao: 'Paracetamol 750 mg, 20 comprimidos', ncm: '30049099', regra: 'Medicamentos com substituição tributária', antes: { cfop: '5102', csosn: '102' }, depois: { cfop: '5405', csosn: '500' } },
    { descricao: 'Protetor solar FPS 50, 120 ml', ncm: '33049910', regra: 'Padrão', antes: { cfop: '5405', csosn: '500' }, depois: { cfop: '5102', csosn: '102' } },
  ] },
  conferir_cmed: { tabela: 24816, atualizada_em: '2026-11-03T14:20:00Z', coluna: 'PMC 19 %', ligados: 412, abaixo: 380, sem_ean_medicamento: 7, acima: [
    { id: 'p2', descricao: 'Paracetamol 750 mg, 20 comprimidos', ean: '7896714200156', preco_venda: 12.5, pmc: 11.38 },
    { id: 'p5', descricao: 'Clonazepam 2 mg, 30 comprimidos', ean: '7896004711232', preco_venda: 18.4, pmc: 17.95 },
  ] },
  dados_sped: {
    empresa: EMP,
    notas: [{ chave: '15261111222333000144550010000884121000012345', numero: 88412, serie: 1, emissao: '2026-10-21T09:00:00-03:00', entrada: '2026-10-21T14:00:00Z',
      valor_produtos: 1842.6, valor_total: 1842.6, duplicatas: [{ vencimento: '2026-11-20', valor: 921.3 }, { vencimento: '2026-12-20', valor: 921.3 }], fiscal: { modFrete: '0' },
      fornecedor: { cnpj: '11222333000144', razao_social: 'Distribuidora Norte Farma Ltda', inscricao_estadual: '151111111', municipio_ibge: '1501402', endereco: { logradouro: 'Av. Almirante Barroso', numero: '1000', bairro: 'Marco' } },
      itens: [{ n_item: 1, cod_item: '101', unidade: 'UN', quantidade: 240, custo_unitario: 2.35, fiscal: { cfop: '5405', orig: '0', cst: '60', vProd: 564 } },
              { n_item: 2, cod_item: '108', unidade: 'UN', quantidade: 200, custo_unitario: 6.393, fiscal: { cfop: '5405', orig: '0', cst: '60', vProd: 1278.6 } }] }],
    produtos: [{ cod_item: '101', descricao: 'Dipirona Monoidratada 500 mg, 10 comprimidos', ean: '7896004700120', unidade: 'UN', ncm: '30049099', aliquota_icms: 0 },
               { cod_item: '108', descricao: 'Vitamina C 1 g efervescente, 10 comprimidos', ean: '7896112402158', unidade: 'UN', ncm: '30049099', aliquota_icms: 0 }],
    inventario: [],
  },
  livro_controlados: [{
    produto_id: 'p5', descricao: 'Clonazepam 2 mg, 30 comprimidos', lista: 'B1', registro_ms: '1004300450021', unidade: 'UN', inicial: 4,
    movimentos: [
      { data: '2026-11-05T13:00:00Z', tipo: 'entrada', quantidade: 10, lote: 'CLZ2604', validade: '2027-04-30', documento: 'NF-e 88301, Distribuidora Norte Farma Ltda', saldo: 14 },
      { data: '2026-11-12T16:20:00Z', tipo: 'saida_venda', quantidade: -2, lote: 'CLZ2604', validade: '2027-04-30', documento: 'Venda 1003 — receita PA2610988, CRM 8812/PA, comprador Ana Costa', saldo: 12 },
      { data: '2026-11-19T11:02:00Z', tipo: 'perda', quantidade: -1, lote: 'CLZ2604', validade: '2027-04-30', documento: 'Embalagem danificada', saldo: 11 },
      { data: h(10, 22), tipo: 'saida_venda', quantidade: -1, lote: 'CLZ2604', validade: '2027-04-30', documento: 'Venda 1044 — receita PA2611042, CRM 8812/PA, comprador Joana Martins', saldo: 10 },
    ],
  }],
  balanco_controlados: [
    { descricao: 'Clonazepam 2 mg, 30 comprimidos', lista: 'B1', registro_ms: '1004300450021', inicial: 6, entradas: 20, saidas: 15, perdas: 1, ajustes: 0, final: 10 },
    { descricao: 'Sertralina 50 mg, 30 comprimidos', lista: 'C1', registro_ms: '1057301230014', inicial: 12, entradas: 30, saidas: 26, perdas: 0, ajustes: -1, final: 15 },
    { descricao: 'Amoxicilina 250 mg/5 ml, suspensão 150 ml', lista: 'AM', registro_ms: '1004301100042', inicial: 8, entradas: 24, saidas: 19, perdas: 0, ajustes: 0, final: 13 },
  ],
  filiais: [{ id: 'e2', nome: 'Farma Família Centro', cnpj: '12345678000276' }],
  painel_financeiro: {
    hoje: new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 10), dias_mes: 30,
    vendas_mes: 18240.5, dias_com_venda: 21, venda_hoje: 768, vendas_3_meses: [{ m: '2026-08-01', t: 21900 }, { m: '2026-09-01', t: 22840 }, { m: '2026-10-01', t: 23710 }],
    pagos_mes: 6120.4, a_vencer_mes: 2152.3, compras_mes: 7480, retiradas_mes: 1500, a_pagar_total: 12520.82, a_receber_total: 1587.8,
    teto_gastos: 9000, meta_retirada_pct: 30,
    saldos: [
      { id: 'cb2', nome: 'Banpará, conta 12345-6', tipo: 'banco', ativo: true, saldo: 14380.55 },
      { id: 'cb1', nome: 'Caixa da loja', tipo: 'caixa', ativo: true, saldo: 157.7 },
    ],
    despesas: [
      ['4.01', 'Aluguel e condomínio', [2200, 2200, 2200, 2200, 2200, 2200]], ['4.02', 'Energia, água, telefone e internet', [702, 655, 731, 688, 640, 676.22]],
      ['4.03', 'Salários e encargos', [4380, 4380, 4380, 4380, 4380, 4380]], ['4.05', 'Contabilidade', [650, 650, 650, 650, 650, 650]],
      ['4.10', 'Taxas de cartão e tarifas bancárias', [512, 498, 560, 531, 545, 640.1]], ['2.01', 'Impostos sobre vendas (Simples Nacional/DAS)', [1201, 1275, 1340, 1298, 1312.4, 0]],
    ].map(([codigo, nome, v]) => ({ codigo, nome, meses: v.map((x, i) => ({ k: i - 5, v: x })) })),
  },
}

function consulta(tabela) {
  let linhas = [...(TABELAS[tabela] ?? [])]
  let unico = false
  const q = {
    select: () => q, not: () => q, range: () => q, lte: () => q, order: () => q, limit: () => q, gte: () => q, lt: () => q, in: (campo, vals) => { linhas = linhas.filter((l) => !(campo in l) || vals.includes(l[campo])); return q }, ilike: () => q,
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
    eq: (campo, valor) => { linhas = linhas.filter((l) => !(campo in l) || l[campo] === valor); return q }, gt: () => q,
    insert: () => q, update: () => q,
    single: () => { unico = true; return q },
    maybeSingle: () => { unico = true; return q },
    then: (ok) => ok({ data: unico ? linhas[0] ?? null : linhas, count: linhas.length, error: null }),
  }
  return q
}

export const clienteDemo = {
  auth: {
    getSession: async () => ({ data: { session: (() => { try { return localStorage.getItem('demo:saiu') ? null : { user: { id: 'u1' } } } catch { return { user: { id: 'u1' } } } })() } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => {},
    signInWithPassword: async () => ({ error: null }),
  },
  from: consulta,
  rpc: async (nome, args) => {
    if (nome === 'precos_itens') {
      return { data: args.p_itens.map((i) => {
        const p = PRODUTOS.find((x) => x.id === i.produto_id) ?? { preco_venda: 0 }
        const promo = i.produto_id === 'p6' ? { preco: 49.9, origem: 'promocao', nome: 'Protetor em oferta' } : null
        return { produto_id: i.produto_id, preco: promo?.preco ?? p.preco_venda, preco_base: p.preco_venda, origem: promo?.origem ?? 'base', nome: promo?.nome ?? null }
      }), error: null }
    }
    if (nome === 'fluxo_caixa') return { data: fluxoDemo(args), error: null }
    if (nome === 'dre') return { data: dreDemo(args), error: null }
    if (nome === 'relatorio_contas') return { data: relatorioDemo(args), error: null }
    return { data: RPC[nome] ?? null, error: null }
  },
  functions: { invoke: async (_n, { body } = {}) => body?.acao === 'transmitir' ? { data: { autorizadas: 0, rejeitadas: 0, sem_comunicacao: true, mensagens: [] }, error: null } : ({ data: { titular: EMP.certificado_titular, validade: EMP.certificado_validade, sefaz: { codigo: '107', mensagem: 'Serviço em Operação' } }, error: null }) },
}

export const criarCliente = () => clienteDemo
