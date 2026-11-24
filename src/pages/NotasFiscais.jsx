import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { chamarNfce } from '../lib/nfce.js'
import { imprimirDanfeNfe } from '../lib/danfe.js'
import { dinheiro, dataHora, lerNumero, arred } from '../lib/formato.js'
import { baixarArquivo } from '../lib/financeiro.js'
import { Botao, Cabecalho, Campo, Confirmacao, Etiqueta, Icone, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map((u) => ({ valor: u, texto: u }))
const NATUREZAS = ['Venda de mercadoria', 'Devolução de compra', 'Remessa para conserto', 'Remessa em bonificação, doação ou brinde', 'Outra saída']
const FINALIDADES = [{ valor: 1, texto: 'Normal' }, { valor: 4, texto: 'Devolução de mercadoria' }]
const PRESENCAS = [{ valor: 1, texto: 'Presencial' }, { valor: 2, texto: 'Pela internet' }, { valor: 3, texto: 'Por telefone' }, { valor: 9, texto: 'Outros' }, { valor: 0, texto: 'Não se aplica (devolução, ajuste)' }]
const SITUACAO_IE = [{ valor: 1, texto: 'Contribuinte do ICMS (tem IE)' }, { valor: 2, texto: 'Isento de inscrição' }, { valor: 9, texto: 'Não contribuinte (pessoa física e outros)' }]
const FRETES = [{ valor: 9, texto: 'Sem frete' }, { valor: 0, texto: 'Por conta do emitente' }, { valor: 1, texto: 'Por conta do destinatário' }, { valor: 2, texto: 'Por conta de terceiros' }]
const FORMAS = [{ valor: 'boleto', texto: 'Boleto' }, { valor: 'pix', texto: 'PIX' }, { valor: 'dinheiro', texto: 'Dinheiro' }, { valor: 'transferencia', texto: 'Transferência' },
  { valor: 'credito', texto: 'Cartão de crédito' }, { valor: 'debito', texto: 'Cartão de débito' }, { valor: 'credito_loja', texto: 'Crediário da loja' }, { valor: 'sem_pagamento', texto: 'Sem pagamento' }]
const SITUACOES = { rascunho: ['Rascunho', 'neutro'], pendente: ['Sem resposta da SEFAZ', 'alerta'], autorizada: ['Autorizada', 'positivo'], rejeitada: ['Rejeitada', 'critico'], cancelada: ['Cancelada', 'neutro'], inutilizada: ['Inutilizada', 'neutro'] }
const so = (v) => String(v ?? '').replace(/\D/g, '')
const horasDesde = (iso) => (Date.now() - new Date(iso).getTime()) / 3600000

const DEST_VAZIO = { documento: '', nome: '', ie: '', indIEDest: 9, email: '', endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', municipio_ibge: '', uf: '', fone: '' } }

// CFOP sugerido para o item conforme a operação e a tributação do produto
export function cfopSugerido(produto, finalidade) {
  const st = ['500', '60'].includes(String(produto.csosn || produto.cst_icms || ''))
  if (finalidade === 4) return st ? '5411' : '5202'
  return st ? '5405' : (produto.cfop && /^5\d{3}$/.test(produto.cfop) ? produto.cfop : '5102')
}

// Item da nota a partir do produto (fotografia fiscal; editável antes de emitir)
export function itemDoProduto(p, finalidade, extra = {}) {
  return {
    produto_id: p.id, codigo: p.codigo || '', ean: p.ean || null, descricao: p.descricao, ncm: p.ncm || '', cest: p.cest || null, unidade: p.unidade || 'UN',
    quantidade: 1, valor_unitario: Number(p.preco_venda || 0), desconto: 0, cfop: cfopSugerido(p, finalidade), origem: p.origem ?? 0,
    csosn: p.csosn || null, cst_icms: p.cst_icms || null, aliquota_icms: Number(p.aliquota_icms || 0), reducao_bc: Number(p.reducao_bc || 0), cbenef: p.cbenef || null,
    cst_pis: p.cst_pis || null, aliquota_pis: Number(p.aliquota_pis || 0), cst_cofins: p.cst_cofins || null, aliquota_cofins: Number(p.aliquota_cofins || 0), ...extra,
  }
}

export const totalDaNota = (f) => {
  const prod = (f.itens ?? []).reduce((s, i) => s + arred(Number(i.quantidade) * Number(i.valor_unitario)) - Number(i.desconto || 0), 0)
  return arred(prod + Number(f.frete?.valor || 0))
}

export default function NotasFiscais() {
  const avisar = useAviso()
  const [lista, setLista] = useState(null)
  const [empresa, setEmpresa] = useState(null)
  const [form, setForm] = useState(null)
  const [detalhe, setDetalhe] = useState(null)
  const [inutilizar, setInutilizar] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const carregar = async () => {
    const [{ data, error }, { data: e }] = await Promise.all([
      supabase.from('nfe_documentos').select('id, numero, serie, status, natureza, finalidade, destinatario, valor_total, criado_em, emitida_em, chave, motivo, codigo_status, venda_id').order('criado_em', { ascending: false }).limit(300),
      supabase.from('empresas').select('*').single(),
    ])
    if (error) avisar(mensagemErro(error), 'erro')
    setLista(data ?? []); setEmpresa(e)
  }
  useEffect(() => {
    carregar()
    // Rascunho criado na tela Vendas: abre direto
    let id = null
    try { id = localStorage.getItem('nfe:abrir'); localStorage.removeItem('nfe:abrir') } catch {}
    if (id) abrir({ id })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const abrir = async (n) => {
    const { data, error } = await supabase.from('nfe_documentos').select('*').eq('id', n.id).single()
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    if (['rascunho', 'rejeitada'].includes(data.status)) setForm(paraForm(data))
    else setDetalhe(data)
  }
  const paraForm = (d) => ({ ...d, destinatario: { ...DEST_VAZIO, ...d.destinatario, endereco: { ...DEST_VAZIO.endereco, ...(d.destinatario?.endereco ?? {}) } }, frete: { modalidade: 9, valor: 0, volumes: {}, ...(d.frete ?? {}) } })
  const nova = () => setForm({ natureza: NATUREZAS[0], finalidade: 1, presenca: 1, consumidor_final: false, destinatario: DEST_VAZIO, itens: [], frete: { modalidade: 9, valor: 0, volumes: {} },
    pagamentos: [], referencias: [], informacoes: '', mover_estoque: true })

  const autorizadas = (lista ?? []).filter((n) => n.status === 'autorizada')
  const doMes = autorizadas.filter((n) => (n.emitida_em ?? '').slice(0, 7) === new Date().toISOString().slice(0, 7))
  const pendencias = (lista ?? []).filter((n) => ['rascunho', 'rejeitada', 'pendente'].includes(n.status))

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Notas fiscais" descricao="NF-e modelo 55: venda a empresas e pessoas, devolução ao fornecedor e outras saídas">
        <Botao variante="secundario" onClick={() => setInutilizar({ inicio: '', fim: '', justificativa: 'Numeração não utilizada por falha no sistema emissor' })}>Inutilizar números</Botao>
        <Botao icone="mais" onClick={nova}>Nova NF-e</Botao>
      </Cabecalho>
      {empresa && !empresa.certificado_titular && <p className="mb-4 flex items-center gap-2 rounded-xl bg-ambar-50 px-4 py-3 text-sm text-ambar-700 dark:bg-ambar-600/15 dark:text-ambar-300"><Icone nome="alerta" className="h-4 w-4" />Configure e teste o certificado digital em Configurações para emitir. Os rascunhos já podem ser preparados.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Indicador titulo="Autorizadas no mês" icone="nota" tom="positivo" valor={doMes.length} detalhe={dinheiro(doMes.reduce((s, n) => s + Number(n.valor_total), 0))} />
        <Indicador titulo="Rascunhos e pendências" icone="relogio" tom={pendencias.length ? 'alerta' : 'neutro'} valor={pendencias.length} detalhe="Rascunho, rejeitada ou sem resposta" />
        <Indicador titulo="Série da NF-e" icone="configuracoes" valor={empresa?.nfe_serie ?? 1} detalhe={Number(empresa?.nfce_ambiente) === 1 ? 'Produção' : 'Homologação, sem valor fiscal'} />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        {lista === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : !lista.length ? (
          <Vazio icone="nota" titulo="Nenhuma NF-e ainda" texto="Use para vender a empresas, devolver mercadoria ao fornecedor ou registrar outras saídas. Para emitir a NF-e de uma venda do caixa, abra a venda na tela Vendas.">
            <Botao icone="mais" onClick={nova}>Nova NF-e</Botao>
          </Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr><th>Número</th><th>Data</th><th>Destinatário</th><th>Natureza</th><th className="text-right">Valor</th><th>Situação</th></tr></thead>
              <tbody>
                {lista.map((n) => {
                  const [txt, tom] = SITUACOES[n.status] ?? [n.status, 'neutro']
                  return (
                    <tr key={n.id} onClick={() => abrir(n)} className="cursor-pointer">
                      <td className="font-semibold">{n.numero ? `Nº ${n.numero}` : '—'}</td>
                      <td>{dataHora(n.emitida_em ?? n.criado_em)}</td>
                      <td>{n.destinatario?.nome || <span className="text-tinta-400">Sem destinatário</span>}<span className="block text-xs text-tinta-400">{n.destinatario?.documento}</span></td>
                      <td>{n.natureza}{n.venda_id && <span className="block text-xs text-tinta-400">Venda do caixa</span>}</td>
                      <td className="num text-right font-semibold">{dinheiro(n.valor_total)}</td>
                      <td><Etiqueta tom={tom}>{txt}</Etiqueta>{n.status === 'rejeitada' && <span className="mt-1 block max-w-xs text-xs text-rubro-600 dark:text-rubro-300">{n.codigo_status} {n.motivo}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && <FormNfe form={form} setForm={setForm} empresa={empresa} onFeito={(doc) => { setForm(null); carregar(); if (doc) setDetalhe(doc) }} />}
      {detalhe && <DetalheNfe nota={detalhe} onFechar={() => setDetalhe(null)} onMudou={async () => { await carregar(); abrir(detalhe) }} />}

      <TelaSuspensa aberta={!!inutilizar} titulo="Inutilizar números da NF-e" subtitulo={`Série ${empresa?.nfe_serie ?? 1}. Comunica à SEFAZ que estes números não serão usados.`} onFechar={() => setInutilizar(null)}
        rodape={<><Botao variante="secundario" onClick={() => setInutilizar(null)}>Voltar</Botao>
          <Botao variante="perigo" carregando={enviando} disabled={!inutilizar?.inicio || (inutilizar?.justificativa ?? '').trim().length < 15} onClick={async () => {
            setEnviando(true)
            const r = await chamarNfce({ acao: 'inutilizar', modelo: 55, inicio: Number(inutilizar.inicio), fim: Number(inutilizar.fim || inutilizar.inicio), justificativa: inutilizar.justificativa })
            setEnviando(false)
            if (r.erro) { avisar(r.erro, 'erro'); return }
            avisar(`Números inutilizados. Protocolo ${r.dados.protocolo}.`); setInutilizar(null); carregar()
          }}>Inutilizar</Botao></>}>
        {inutilizar && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Do número"><input className="campo num" inputMode="numeric" value={inutilizar.inicio} onChange={(e) => setInutilizar((x) => ({ ...x, inicio: so(e.target.value) }))} /></Campo>
              <Campo rotulo="Até o número" ajuda="Vazio: só um número"><input className="campo num" inputMode="numeric" value={inutilizar.fim} onChange={(e) => setInutilizar((x) => ({ ...x, fim: so(e.target.value) }))} /></Campo>
            </div>
            <Campo rotulo="Justificativa" ajuda={`${inutilizar.justificativa.trim().length} de no mínimo 15 caracteres`}><textarea className="campo" rows={2} maxLength={255} value={inutilizar.justificativa} onChange={(e) => setInutilizar((x) => ({ ...x, justificativa: e.target.value }))} /></Campo>
          </div>
        )}
      </TelaSuspensa>
    </div>
  )
}

// ------------------------------------------------------------------ Formulário (rascunho → emissão)
function FormNfe({ form, setForm, empresa, onFeito }) {
  const avisar = useAviso()
  const [enviando, setEnviando] = useState('')
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState([])
  const [pessoas, setPessoas] = useState({ clientes: [], fornecedores: [], notas: [] })
  const [excluir, setExcluir] = useState(false)
  const devolucao = Number(form.finalidade) === 4
  const daVenda = Boolean(form.venda_id)
  const dest = form.destinatario
  const md = (c) => (e) => setForm((f) => ({ ...f, destinatario: { ...f.destinatario, [c]: e?.target ? e.target.value : e } }))
  const me = (c) => (e) => setForm((f) => ({ ...f, destinatario: { ...f.destinatario, endereco: { ...f.destinatario.endereco, [c]: e?.target ? e.target.value : e } } }))
  const mf = (c) => (e) => setForm((f) => ({ ...f, [c]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }))
  const total = totalDaNota(form)

  useEffect(() => {
    Promise.all([
      supabase.from('clientes').select('id, nome, cpf_cnpj, email, telefone, endereco').eq('ativo', true).order('nome').limit(2000),
      supabase.from('fornecedores').select('id, cnpj, razao_social, nome_fantasia, inscricao_estadual, uf, telefone, municipio_ibge, endereco').order('razao_social'),
      supabase.from('notas_entrada').select('id, chave, numero, emissao, valor_total, fornecedor_id, fornecedor:fornecedores(razao_social)').order('criado_em', { ascending: false }).limit(200),
    ]).then(([c, f, n]) => setPessoas({ clientes: c.data ?? [], fornecedores: f.data ?? [], notas: n.data ?? [] }))
  }, [])

  useEffect(() => {
    const t = busca.trim()
    if (t.length < 2) { setAchados([]); return }
    const h = setTimeout(async () => {
      const { data } = await supabase.from('produtos').select('*').eq('ativo', true)
        .or(`descricao.ilike.%${t.replace(/[%,()]/g, '')}%,ean.eq.${so(t) || '0'},codigo.eq.${t.replace(/[%,()]/g, '')}`).limit(8)
      setAchados(data ?? [])
    }, 250)
    return () => clearTimeout(h)
  }, [busca])

  const usarCliente = (id) => {
    const c = pessoas.clientes.find((x) => x.id === id)
    if (!c) return
    const doc = so(c.cpf_cnpj)
    const e = c.endereco || {}
    setForm((f) => ({ ...f, cliente_id: c.id, fornecedor_id: null, destinatario: { ...DEST_VAZIO, documento: c.cpf_cnpj || '', nome: c.nome, email: c.email || '', ie: e.ie || '',
      indIEDest: e.ie ? 1 : doc.length === 14 ? 2 : 9,
      endereco: { ...DEST_VAZIO.endereco, ...e, uf: e.uf || empresa?.uf || '', fone: c.telefone || '' } },
      consumidor_final: !e.ie }))
  }
  const usarFornecedor = (id) => {
    const p = pessoas.fornecedores.find((x) => x.id === id)
    if (!p) return
    const e = p.endereco || {}
    setForm((f) => ({ ...f, fornecedor_id: p.id, cliente_id: null, consumidor_final: false, destinatario: { ...DEST_VAZIO, documento: p.cnpj, nome: p.razao_social, ie: p.inscricao_estadual || '',
      indIEDest: p.inscricao_estadual ? 1 : 2, endereco: { ...DEST_VAZIO.endereco, logradouro: e.logradouro || '', numero: e.numero || '', complemento: e.complemento || '', bairro: e.bairro || '',
        municipio: e.municipio || '', cep: e.cep || '', uf: p.uf || e.uf || '', municipio_ibge: p.municipio_ibge || '', fone: p.telefone || '' } } }))
  }
  const usarNotaEntrada = (id) => {
    const n = pessoas.notas.find((x) => x.id === id)
    if (!n) return
    setForm((f) => ({ ...f, referencias: [n.chave] }))
    if (n.fornecedor_id && !form.destinatario?.documento) usarFornecedor(n.fornecedor_id)
  }

  const buscarIbge = async () => {
    const uf = dest.endereco.uf, nome = dest.endereco.municipio
    if (!uf || !nome) { avisar('Informe o município e a UF.', 'erro'); return }
    try {
      const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`)
      const lista = await r.json()
      const norm = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
      const m = lista.find((x) => norm(x.nome) === norm(nome))
      if (!m) { avisar(`Município "${nome}" não encontrado em ${uf}. Confira a grafia.`, 'erro'); return }
      me('municipio_ibge')(String(m.id)); me('municipio')(m.nome)
    } catch { avisar('Não foi possível consultar o IBGE agora. Digite o código.', 'erro') }
  }

  const incluir = (p) => {
    setForm((f) => ({ ...f, itens: [...f.itens, itemDoProduto(p, Number(f.finalidade), devolucao ? { valor_unitario: Number(p.preco_custo || p.preco_venda || 0) } : {})] }))
    setBusca(''); setAchados([])
  }
  const mi = (k, c) => (e) => setForm((f) => ({ ...f, itens: f.itens.map((i, j) => (j === k ? { ...i, [c]: e?.target ? e.target.value : e } : i)) }))
  const tirar = (k) => setForm((f) => ({ ...f, itens: f.itens.filter((_, j) => j !== k) }))
  const mudarFinalidade = (v) => setForm((f) => ({ ...f, finalidade: v, presenca: v === 4 ? 0 : f.presenca === 0 ? 1 : f.presenca, natureza: v === 4 ? 'Devolução de compra' : f.natureza === 'Devolução de compra' ? NATUREZAS[0] : f.natureza,
    pagamentos: v === 4 ? [] : f.pagamentos, itens: f.itens.map((i) => ({ ...i, cfop: v === 4 ? (['5405', '5411'].includes(i.cfop) ? '5411' : '5202') : (i.cfop === '5411' ? '5405' : i.cfop === '5202' ? '5102' : i.cfop) })) }))
  const forma = form.pagamentos?.[0]?.forma ?? (devolucao ? 'sem_pagamento' : 'boleto')

  const dados = () => {
    const itens = form.itens.map((i) => ({ ...i, quantidade: lerNumero(String(i.quantidade)), valor_unitario: lerNumero(String(i.valor_unitario)), desconto: lerNumero(String(i.desconto || 0)) || 0, aliquota_icms: lerNumero(String(i.aliquota_icms || 0)) || 0 }))
    const frete = { ...form.frete, valor: lerNumero(String(form.frete.valor || 0)) || 0 }
    const tot = totalDaNota({ itens, frete })
    return {
      venda_id: form.venda_id ?? null, cliente_id: form.cliente_id ?? null, fornecedor_id: form.fornecedor_id ?? null,
      natureza: form.natureza.trim() || NATUREZAS[0], finalidade: Number(form.finalidade), presenca: Number(form.presenca), consumidor_final: Boolean(form.consumidor_final),
      destinatario: { ...dest, documento: dest.documento.trim(), indIEDest: Number(dest.indIEDest) }, itens, frete,
      pagamentos: forma === 'sem_pagamento' ? [] : [{ forma, valor: tot }], referencias: (form.referencias ?? []).map(so).filter((r) => r.length === 44),
      informacoes: form.informacoes?.trim() || null, mover_estoque: !form.venda_id && Boolean(form.mover_estoque), valor_total: tot,
    }
  }
  const validar = (d) => {
    if (!d.itens.length) return 'Inclua pelo menos um produto.'
    if (d.itens.some((i) => !(i.quantidade > 0) || !(i.valor_unitario >= 0))) return 'Confira quantidades e valores dos produtos.'
    if (d.itens.some((i) => so(i.ncm).length !== 8)) return 'Há produto sem NCM válido.'
    if (![11, 14].includes(so(d.destinatario.documento).length)) return 'Informe o CPF ou CNPJ do destinatário.'
    if (!d.destinatario.nome.trim()) return 'Informe o nome do destinatário.'
    const e = d.destinatario.endereco
    if (!e.logradouro || !e.bairro || !e.municipio || !e.uf || so(e.cep).length !== 8) return 'Complete o endereço do destinatário (com CEP).'
    if (so(e.municipio_ibge).length !== 7) return 'Informe o código IBGE do município (botão Buscar).'
    if (d.destinatario.indIEDest === 1 && !so(d.destinatario.ie)) return 'Destinatário contribuinte precisa da inscrição estadual.'
    if (d.finalidade === 4 && !d.referencias.length) return 'Na devolução, escolha a nota de compra que está sendo devolvida.'
    return null
  }
  const salvar = async (emitir) => {
    const d = dados()
    const erro = emitir ? validar(d) : null
    if (erro) { avisar(erro, 'erro'); return }
    setEnviando(emitir ? 'emitir' : 'salvar')
    const r = form.id
      ? await supabase.from('nfe_documentos').update({ ...d, status: form.status === 'rejeitada' ? 'rejeitada' : 'rascunho' }).eq('id', form.id).select('id').single()
      : await supabase.from('nfe_documentos').insert({ ...d, status: 'rascunho' }).select('id').single()
    if (r.error) { setEnviando(''); avisar(mensagemErro(r.error), 'erro'); return }
    if (!emitir) { setEnviando(''); avisar('Rascunho salvo.'); onFeito(null); return }
    const x = await chamarNfce({ acao: 'nfe_emitir', nfe_id: r.data.id })
    setEnviando('')
    if (x.erro) { avisar(x.erro, 'erro'); setForm((f) => ({ ...f, id: r.data.id })); return }
    avisar(`NF-e nº ${x.dados.numero} autorizada.`)
    if (x.dados.aviso) avisar(x.dados.aviso, 'erro')
    const { data: doc } = await supabase.from('nfe_documentos').select('*').eq('id', r.data.id).single()
    if (doc?.xml_autorizado) imprimirDanfeNfe(doc.xml_autorizado)
    onFeito(doc)
  }
  const apagar = async () => {
    const { error } = await supabase.from('nfe_documentos').delete().eq('id', form.id)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Rascunho excluído.'); setExcluir(false); onFeito(null)
  }

  const simples = ['simples', 'mei', 'simples_excesso'].includes(empresa?.regime_tributario)
  return (
    <TelaSuspensa aberta titulo={form.id ? (form.status === 'rejeitada' ? `Corrigir NF-e nº ${form.numero ?? ''}` : 'Rascunho de NF-e') : 'Nova NF-e'}
      subtitulo={form.status === 'rejeitada' ? `Rejeitada (${form.codigo_status}): ${form.motivo}` : daVenda ? 'NF-e de uma venda do caixa: produtos e pagamento vieram da venda' : 'Preencha, salve como rascunho e emita quando estiver tudo certo'}
      onFechar={() => setForm(null)} largura="max-w-6xl"
      rodape={<>
        {form.id && form.status === 'rascunho' && <Botao variante="secundario" className="mr-auto" onClick={() => setExcluir(true)}>Excluir rascunho</Botao>}
        <Botao variante="secundario" onClick={() => setForm(null)}>Cancelar</Botao>
        <Botao variante="secundario" onClick={() => salvar(false)} carregando={enviando === 'salvar'}>Salvar rascunho</Botao>
        <Botao icone="nota" onClick={() => salvar(true)} carregando={enviando === 'emitir'} disabled={!empresa?.certificado_titular}>Emitir NF-e de {dinheiro(total)}</Botao>
      </>}>
      <div className="space-y-6">
        <section>
          <h3 className="titulo-secao mb-3">Operação</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2"><Campo rotulo="Natureza da operação"><Lista valor={form.natureza} opcoes={[...new Set([...NATUREZAS, form.natureza])].map((n) => ({ valor: n, texto: n }))} onMudar={mf('natureza')} /></Campo></div>
            <Campo rotulo="Finalidade"><Lista valor={Number(form.finalidade)} opcoes={FINALIDADES} onMudar={mudarFinalidade} /></Campo>
            <Campo rotulo="Atendimento"><Lista valor={Number(form.presenca)} opcoes={PRESENCAS} onMudar={mf('presenca')} /></Campo>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={form.consumidor_final} onChange={mf('consumidor_final')} /> Destinatário é consumidor final (usa a mercadoria, não revende)</label>
            {!daVenda && <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={form.mover_estoque} onChange={mf('mover_estoque')} /> Baixar os produtos do estoque quando autorizar</label>}
          </div>
          {devolucao && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Nota de compra devolvida"><Lista valor={pessoas.notas.find((n) => n.chave === form.referencias?.[0])?.id ?? null} placeholder="Escolha a nota de entrada"
                opcoes={pessoas.notas.map((n) => ({ valor: n.id, texto: `Nº ${n.numero}, ${n.fornecedor?.razao_social ?? ''}, ${dinheiro(n.valor_total)}` }))} onMudar={usarNotaEntrada} /></Campo>
              <Campo rotulo="Ou a chave de acesso" ajuda="44 dígitos"><input className="campo num" value={form.referencias?.[0] ?? ''} onChange={(e) => setForm((f) => ({ ...f, referencias: [so(e.target.value).slice(0, 44)] }))} /></Campo>
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <h3 className="titulo-secao mr-auto">Destinatário</h3>
            <div className="w-64"><Lista valor={form.cliente_id ?? null} placeholder="Preencher com cliente" opcoes={pessoas.clientes.map((c) => ({ valor: c.id, texto: c.nome }))} onMudar={usarCliente} /></div>
            <div className="w-64"><Lista valor={form.fornecedor_id ?? null} placeholder="Preencher com fornecedor" opcoes={pessoas.fornecedores.map((p) => ({ valor: p.id, texto: p.nome_fantasia || p.razao_social }))} onMudar={usarFornecedor} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2"><Campo rotulo="CPF ou CNPJ"><input className="campo num" value={dest.documento} onChange={md('documento')} /></Campo></div>
            <div className="sm:col-span-4"><Campo rotulo="Nome ou razão social"><input className="campo" value={dest.nome} onChange={md('nome')} /></Campo></div>
            <div className="sm:col-span-3"><Campo rotulo="Situação perante o ICMS"><Lista valor={Number(dest.indIEDest)} opcoes={SITUACAO_IE} onMudar={md('indIEDest')} /></Campo></div>
            <Campo rotulo="Inscrição estadual"><input className="campo num" value={dest.ie ?? ''} onChange={md('ie')} disabled={Number(dest.indIEDest) !== 1} /></Campo>
            <div className="sm:col-span-2"><Campo rotulo="E-mail (recebe o XML)"><input className="campo" type="email" value={dest.email ?? ''} onChange={md('email')} /></Campo></div>
            <Campo rotulo="CEP"><input className="campo num" value={dest.endereco.cep} onChange={me('cep')} /></Campo>
            <div className="sm:col-span-3"><Campo rotulo="Logradouro"><input className="campo" value={dest.endereco.logradouro} onChange={me('logradouro')} /></Campo></div>
            <Campo rotulo="Número"><input className="campo" value={dest.endereco.numero} onChange={me('numero')} /></Campo>
            <Campo rotulo="Complemento"><input className="campo" value={dest.endereco.complemento ?? ''} onChange={me('complemento')} /></Campo>
            <div className="sm:col-span-2"><Campo rotulo="Bairro"><input className="campo" value={dest.endereco.bairro} onChange={me('bairro')} /></Campo></div>
            <div className="sm:col-span-2"><Campo rotulo="Município"><input className="campo" value={dest.endereco.municipio} onChange={me('municipio')} /></Campo></div>
            <Campo rotulo="UF"><Lista valor={dest.endereco.uf || null} opcoes={UFS} onMudar={me('uf')} /></Campo>
            <Campo rotulo="Código IBGE"><div className="flex gap-1.5"><input className="campo num min-w-0" value={dest.endereco.municipio_ibge} onChange={me('municipio_ibge')} /><Botao variante="secundario" className="px-3" onClick={buscarIbge} title="Buscar o código pelo nome do município">Buscar</Botao></div></Campo>
          </div>
          {dest.endereco.uf && empresa?.uf && dest.endereco.uf !== empresa.uf && <p className="mt-2 text-sm text-tinta-400">Operação para outro estado: os CFOP passam a 6xxx na emissão.{form.consumidor_final && Number(dest.indIEDest) === 9 ? (['normal', 'simples_excesso'].includes(empresa.regime_tributario) ? ' Consumidor final não contribuinte: o DIFAL é calculado na emissão; recolha a GNRE para o estado de destino antes da saída da mercadoria.' : ' No Simples Nacional e no MEI esta operação sai sem DIFAL.') : ''}</p>}
        </section>

        <section>
          <h3 className="titulo-secao mb-3">Produtos</h3>
          {!daVenda && (
            <div className="relative mb-3">
              <Icone nome="busca" className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tinta-400" />
              <input className="campo pl-10" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto por nome, código ou código de barras" />
              {achados.length > 0 && (
                <ul className="absolute z-20 mt-1.5 w-full rounded-xl bg-white p-1 shadow-elevado ring-1 ring-papel-200 dark:bg-noite-700 dark:ring-noite-600">
                  {achados.map((p) => (
                    <li key={p.id}><button type="button" onClick={() => incluir(p)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-caixa-50 dark:hover:bg-noite-600">
                      <span>{p.descricao}<span className="block text-xs text-tinta-400">{p.ean || p.codigo} · NCM {p.ncm || 'sem'} · estoque {Number(p.estoque_atual ?? 0)}</span></span>
                      <span className="num">{dinheiro(devolucao ? p.preco_custo : p.preco_venda)}</span></button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {!form.itens.length ? <p className="rounded-xl border border-dashed border-papel-300 p-4 text-center text-sm text-tinta-400 dark:border-noite-600">Nenhum produto. Busque acima para incluir.</p> : (
            <div className="overflow-x-auto rounded-xl ring-1 ring-papel-200 dark:ring-noite-700">
              <table className="tabela w-full text-sm">
                <thead><tr><th>Produto</th><th className="w-24">Qtd.</th><th className="w-28">Valor unit.</th><th className="w-24">Desconto</th><th className="w-20">CFOP</th><th className="w-20">{simples ? 'CSOSN' : 'CST'}</th><th className="w-20">ICMS %</th><th className="w-28 text-right">Total</th><th /></tr></thead>
                <tbody>
                  {form.itens.map((i, k) => (
                    <tr key={k}>
                      <td>{i.descricao}<span className="block text-xs text-tinta-400">NCM {i.ncm || 'sem NCM'}</span></td>
                      <td><input className="campo num px-2 py-1.5" value={i.quantidade} onChange={mi(k, 'quantidade')} disabled={daVenda} /></td>
                      <td><input className="campo num px-2 py-1.5" value={i.valor_unitario} onChange={mi(k, 'valor_unitario')} disabled={daVenda} /></td>
                      <td><input className="campo num px-2 py-1.5" value={i.desconto} onChange={mi(k, 'desconto')} disabled={daVenda} /></td>
                      <td><input className="campo num px-2 py-1.5" value={i.cfop} onChange={mi(k, 'cfop')} /></td>
                      <td><input className="campo num px-2 py-1.5" value={simples ? (i.csosn ?? '') : (i.cst_icms ?? '')} onChange={mi(k, simples ? 'csosn' : 'cst_icms')} /></td>
                      <td><input className="campo num px-2 py-1.5" value={i.aliquota_icms ?? 0} onChange={mi(k, 'aliquota_icms')} /></td>
                      <td className="num text-right font-semibold">{dinheiro(arred(lerNumero(String(i.quantidade)) * lerNumero(String(i.valor_unitario)) - (lerNumero(String(i.desconto || 0)) || 0)))}</td>
                      <td>{!daVenda && <button className="rounded-lg p-1.5 text-tinta-400 hover:bg-rubro-50 hover:text-rubro-600" onClick={() => tirar(k)} aria-label="Tirar produto"><Icone nome="lixo" className="h-4 w-4" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {devolucao && simples && <p className="mt-2 text-sm text-tinta-400">Na devolução pelo Simples, use CSOSN 900 e a alíquota de ICMS da nota de compra, se ela destacou imposto. Confira com o contador.</p>}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="titulo-secao mb-3">Frete e volumes</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Frete"><Lista valor={Number(form.frete.modalidade)} opcoes={FRETES} onMudar={(v) => setForm((f) => ({ ...f, frete: { ...f.frete, modalidade: v } }))} /></Campo>
              <Campo rotulo="Valor do frete na nota"><input className="campo num" value={form.frete.valor ?? 0} onChange={(e) => setForm((f) => ({ ...f, frete: { ...f.frete, valor: e.target.value } }))} /></Campo>
              <Campo rotulo="Volumes"><input className="campo num" value={form.frete.volumes?.quantidade ?? ''} onChange={(e) => setForm((f) => ({ ...f, frete: { ...f.frete, volumes: { ...f.frete.volumes, quantidade: so(e.target.value) } } }))} /></Campo>
              <Campo rotulo="Peso bruto (kg)"><input className="campo num" value={form.frete.volumes?.pesoBruto ?? ''} onChange={(e) => setForm((f) => ({ ...f, frete: { ...f.frete, volumes: { ...f.frete.volumes, pesoBruto: e.target.value.replace(',', '.') } } }))} /></Campo>
            </div>
          </div>
          <div>
            <h3 className="titulo-secao mb-3">Pagamento e informações</h3>
            <div className="space-y-3">
              <Campo rotulo="Forma de pagamento" ajuda={forma === 'sem_pagamento' ? 'Devolução e remessa vão sem pagamento' : `Valor: ${dinheiro(total)}`}>
                <Lista valor={forma} opcoes={FORMAS} onMudar={(v) => setForm((f) => ({ ...f, pagamentos: [{ forma: v, valor: total }] }))} /></Campo>
              <Campo rotulo="Informações complementares"><textarea className="campo" rows={3} maxLength={2000} value={form.informacoes ?? ''} onChange={mf('informacoes')} placeholder="Ex.: pedido do cliente, dados bancários, observações" /></Campo>
            </div>
          </div>
        </section>
      </div>
      <Confirmacao aberta={excluir} titulo="Excluir rascunho" mensagem="O rascunho será apagado. Nenhuma nota foi enviada à SEFAZ." textoConfirmar="Excluir" variante="perigo" onCancelar={() => setExcluir(false)} onConfirmar={apagar} />
    </TelaSuspensa>
  )
}

// ------------------------------------------------------------------ Detalhe da nota emitida
function DetalheNfe({ nota, onFechar, onMudou }) {
  const avisar = useAviso()
  const [janela, setJanela] = useState(null) // 'cancelar' | 'cce'
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [txt, tom] = SITUACOES[nota.status] ?? [nota.status, 'neutro']
  const horas = nota.emitida_em ? horasDesde(nota.emitida_em) : 0
  const d = nota.destinatario ?? {}

  const enviar = async () => {
    setEnviando(true)
    const r = await chamarNfce(janela === 'cancelar' ? { acao: 'nfe_cancelar', nfe_id: nota.id, justificativa: texto } : { acao: 'nfe_cce', nfe_id: nota.id, correcao: texto })
    setEnviando(false)
    if (r.erro) { avisar(r.erro, 'erro'); return }
    avisar(janela === 'cancelar' ? `NF-e nº ${nota.numero} cancelada.` : `Carta de correção nº ${r.dados.sequencia} registrada.`)
    if (r.dados.aviso) avisar(r.dados.aviso, 'erro')
    setJanela(null); setTexto(''); onMudou()
  }
  const consultar = async () => {
    setEnviando(true)
    const r = await chamarNfce({ acao: 'nfe_consultar', nfe_id: nota.id })
    setEnviando(false)
    if (r.erro) { avisar(r.erro, 'erro'); return }
    avisar(r.dados.status === 'autorizada' ? 'A SEFAZ confirmou a autorização.' : 'A nota não chegou à SEFAZ; corrija e emita de novo.')
    onMudou()
  }
  const xml = () => baixarArquivo(`${nota.chave}-nfe.xml`, nota.xml_autorizado, 'application/xml')

  return (
    <>
      <TelaSuspensa aberta={!janela} titulo={`NF-e nº ${nota.numero ?? ''}`} subtitulo={`${nota.natureza}, ${dataHora(nota.emitida_em ?? nota.criado_em)}`} onFechar={onFechar} largura="max-w-3xl"
        rodape={<>
          <Botao variante="secundario" onClick={onFechar}>Fechar</Botao>
          {nota.status === 'pendente' && <Botao onClick={consultar} carregando={enviando}>Consultar na SEFAZ</Botao>}
          {nota.status === 'autorizada' && <>
            <Botao variante="secundario" onClick={xml}>Baixar XML</Botao>
            <Botao variante="secundario" onClick={() => { setTexto(''); setJanela('cce') }}>Carta de correção</Botao>
            <Botao variante="perigo" onClick={() => { setTexto(''); setJanela('cancelar') }}>Cancelar NF-e</Botao>
          </>}
          {['autorizada', 'cancelada'].includes(nota.status) && nota.xml_autorizado && <Botao icone="impressora" onClick={() => imprimirDanfeNfe(nota.xml_autorizado, { cancelada: nota.status === 'cancelada', cces: nota.cces })}>Imprimir DANFE</Botao>}
        </>}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><Etiqueta tom={tom}>{txt}</Etiqueta>{nota.ambiente === 2 && <Etiqueta>Homologação</Etiqueta>}<span className="num ml-auto text-2xl font-semibold">{dinheiro(nota.valor_total)}</span></div>
          <div className="grid gap-3 text-[0.95rem] sm:grid-cols-2">
            <div><p className="text-xs text-tinta-400">Destinatário</p><p className="font-medium">{d.nome}</p><p className="text-sm text-tinta-400">{d.documento} · {d.endereco?.municipio}/{d.endereco?.uf}</p></div>
            <div><p className="text-xs text-tinta-400">Protocolo</p><p className="num">{nota.protocolo ?? '—'}</p></div>
          </div>
          {nota.chave && <p className="break-all rounded-xl bg-papel-100 px-3 py-2 font-mono text-sm dark:bg-noite-700">{nota.chave.replace(/(\d{4})/g, '$1 ')}</p>}
          <table className="tabela -mx-6 w-[calc(100%+3rem)] text-sm">
            <thead><tr><th>Produto</th><th className="text-right">Qtd.</th><th className="text-right">Unitário</th><th className="text-right">Total</th></tr></thead>
            <tbody>{(nota.itens ?? []).map((i, k) => <tr key={k}><td>{i.descricao}<span className="block text-xs text-tinta-400">CFOP {i.cfop}</span></td><td className="num text-right">{Number(i.quantidade)}</td><td className="num text-right">{dinheiro(i.valor_unitario)}</td><td className="num text-right">{dinheiro(Number(i.quantidade) * Number(i.valor_unitario) - Number(i.desconto || 0))}</td></tr>)}</tbody>
          </table>
          {nota.status === 'cancelada' && <p className="rounded-xl bg-papel-100 px-3 py-2 text-sm dark:bg-noite-700">Cancelada em {dataHora(nota.cancelada_em)}, protocolo {nota.protocolo_cancelamento}. {nota.justificativa_cancelamento}</p>}
          {nota.status === 'pendente' && <p className="rounded-xl bg-ambar-50 px-3 py-2 text-sm text-ambar-700 dark:bg-ambar-600/15 dark:text-ambar-300">Enviada sem resposta da SEFAZ. Consulte para saber se foi autorizada.</p>}
          {(nota.cces ?? []).length > 0 && (
            <div><p className="mb-1 font-semibold">Cartas de correção</p>
              <ul className="space-y-1 text-sm">{nota.cces.map((c) => <li key={c.sequencia} className="rounded-xl bg-papel-100 px-3 py-2 dark:bg-noite-700"><b>{c.sequencia}ª</b> {c.correcao} <span className="text-tinta-400">({dataHora(c.quando)}, protocolo {c.protocolo})</span></li>)}</ul></div>
          )}
        </div>
      </TelaSuspensa>
      <TelaSuspensa aberta={!!janela} titulo={janela === 'cancelar' ? `Cancelar NF-e nº ${nota.numero}` : `Carta de correção da NF-e nº ${nota.numero}`}
        subtitulo={janela === 'cancelar' ? 'O cancelamento vai para a SEFAZ e não pode ser desfeito.' : 'Corrige dados que não mudam valores, impostos, destinatário nem datas.'}
        onFechar={() => setJanela(null)}
        rodape={<><Botao variante="secundario" onClick={() => setJanela(null)}>Voltar</Botao>
          <Botao variante={janela === 'cancelar' ? 'perigo' : 'primario'} onClick={enviar} carregando={enviando} disabled={texto.trim().length < 15}>{janela === 'cancelar' ? 'Cancelar NF-e' : 'Registrar correção'}</Botao></>}>
        {janela === 'cancelar' && horas > 24 && <p className="mb-3 rounded-xl bg-rubro-50 px-3 py-2 text-sm text-rubro-600 dark:bg-rubro-600/15 dark:text-rubro-300">A nota foi autorizada há {Math.floor(horas)} horas. O prazo comum de cancelamento da NF-e é de 24 horas; a SEFAZ pode recusar.</p>}
        {janela === 'cce' && <p className="mb-3 text-sm text-tinta-400">Cada nova carta substitui as anteriores: escreva todas as correções juntas. Limite de 20 cartas por nota.</p>}
        <Campo rotulo={janela === 'cancelar' ? 'Motivo do cancelamento' : 'Correção'} ajuda={`${texto.trim().length} de no mínimo 15 caracteres`}>
          <textarea className="campo" rows={4} maxLength={janela === 'cancelar' ? 255 : 1000} value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
        </Campo>
      </TelaSuspensa>
    </>
  )
}

// Rascunho de NF-e a partir de uma venda do caixa (chamado pela tela Vendas)
export async function criarRascunhoDaVenda(venda) {
  const [{ data: itens }, { data: pags }, { data: cli }] = await Promise.all([
    supabase.from('venda_itens').select('*, produto:produtos(*)').eq('venda_id', venda.id).order('sequencia'),
    supabase.from('venda_pagamentos').select('forma, valor').eq('venda_id', venda.id),
    venda.cliente_id ? supabase.from('clientes').select('*').eq('id', venda.cliente_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const e = cli?.endereco || {}
  const doc = so(cli?.cpf_cnpj || venda.cpf_consumidor)
  const registro = {
    venda_id: venda.id, cliente_id: venda.cliente_id ?? null, natureza: 'Venda de mercadoria', finalidade: 1, presenca: 1, consumidor_final: !e.ie, mover_estoque: false,
    destinatario: { ...DEST_VAZIO, documento: doc, nome: cli?.nome ?? '', email: cli?.email ?? '', ie: e.ie ?? '', indIEDest: e.ie ? 1 : doc.length === 14 ? 2 : 9,
      endereco: { ...DEST_VAZIO.endereco, ...e, fone: cli?.telefone ?? '' } },
    itens: (itens ?? []).map((i) => itemDoProduto(i.produto ?? {}, 1, {
      quantidade: Number(i.quantidade) - Number(i.quantidade_devolvida || 0), valor_unitario: Number(i.preco_unitario), desconto: Number(i.desconto || 0), descricao: i.descricao,
      ncm: i.ncm || i.produto?.ncm, cfop: i.cfop || i.produto?.cfop || '5102', csosn: i.csosn ?? i.produto?.csosn, cst_icms: i.cst_icms ?? i.produto?.cst_icms,
      aliquota_icms: Number(i.aliquota_icms ?? i.produto?.aliquota_icms ?? 0) })).filter((i) => i.quantidade > 0),
    pagamentos: (pags ?? []).map((p) => ({ forma: p.forma, valor: Number(p.valor) })),
    frete: { modalidade: 9, valor: 0, volumes: {} }, valor_total: Number(venda.total),
    informacoes: `Referente à venda nº ${venda.numero} do caixa.`,
  }
  // Desconto geral da venda é dividido entre os itens pelo valor de cada um (o total bate com o caixa)
  const descontoGeral = Number(venda.desconto || 0)
  if (descontoGeral > 0 && registro.itens.length) {
    const bases = registro.itens.map((i) => arred(i.quantidade * i.valor_unitario - Number(i.desconto || 0)))
    const soma = bases.reduce((a, b) => a + b, 0)
    let resto = descontoGeral
    registro.itens.forEach((i, k) => {
      const parte = k === registro.itens.length - 1 ? arred(resto) : Math.floor((descontoGeral * bases[k] / soma) * 100) / 100
      resto = arred(resto - parte)
      i.desconto = arred(Number(i.desconto || 0) + parte)
    })
  }
  return supabase.from('nfe_documentos').insert({ ...registro, status: 'rascunho' }).select('id').single()
}

