import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { useCaixaAberto } from '../lib/caixa.js'
import { dinheiro, lerNumero } from '../lib/formato.js'
import { Botao, Cabecalho, Campo, Etiqueta, Icone, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'
import { SituacaoCliente, carregarSituacao } from '../components/Clientes.jsx'
import { ReceberConta } from '../components/ReceberConta.jsx'

const ABAS = [
  { id: 'clientes', nome: 'Clientes' },
  { id: 'receber', nome: 'Contas a receber' },
  { id: 'convenios', nome: 'Convênios' },
]
const CLIENTE_VAZIO = { tabela_preco_id: null, nome: '', cpf_cnpj: '', telefone: '', email: '', nascimento: '', limite_credito: '', convenio_id: null, matricula: '', observacoes: '', bloqueado: false, ativo: true, endereco: { logradouro: '', numero: '', bairro: '', municipio: '', cep: '' } }
const CONVENIO_VAZIO = { nome: '', cnpj: '', desconto_percentual: '', dia_fechamento: '25', dias_vencimento: '10', ativo: true }
const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const dataBR = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '')

export default function Clientes() {
  const perfil = useSessao()
  const avisar = useAviso()
  const { caixa } = useCaixaAberto()
  const gestor = perfil.papel !== 'operador'
  const [aba, setAba] = useState('clientes')
  const [clientes, setClientes] = useState(null)
  const [contas, setContas] = useState([])
  const [convenios, setConvenios] = useState([])
  const [tabelas, setTabelas] = useState([])
  const [busca, setBusca] = useState('')
  const [soAtraso, setSoAtraso] = useState(false)
  const [edicao, setEdicao] = useState(null)
  const [convEdicao, setConvEdicao] = useState(null)
  const [detalhe, setDetalhe] = useState(null)
  const [receber, setReceber] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const carregar = async () => {
    const [c, r, v] = await Promise.all([
      supabase.from('clientes').select('*, convenio:convenios(nome)').order('nome').limit(2000),
      supabase.from('contas_receber').select('*, cliente:clientes(nome, telefone)').eq('status', 'aberta').order('vencimento').limit(2000),
      supabase.from('convenios').select('*').order('nome'),
    ])
    supabase.from('tabelas_preco').select('id, nome').eq('ativo', true).order('nome').then(({ data }) => setTabelas(data ?? []))
    if (c.error) avisar(mensagemErro(c.error), 'erro')
    setClientes(c.data ?? []); setContas(r.data ?? []); setConvenios(v.data ?? [])
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const hoje = hojeISO()
  const porCliente = useMemo(() => {
    const m = {}
    for (const ct of contas) {
      const s = (m[ct.cliente_id] ??= { devedor: 0, atraso: 0 })
      const aberto = Number(ct.valor) - Number(ct.valor_pago)
      s.devedor += aberto
      if (ct.vencimento < hoje) s.atraso += aberto
    }
    return m
  }, [contas, hoje])

  const totais = useMemo(() => {
    const aberto = contas.reduce((s, c) => s + Number(c.valor) - Number(c.valor_pago), 0)
    const vencido = contas.filter((c) => c.vencimento < hoje).reduce((s, c) => s + Number(c.valor) - Number(c.valor_pago), 0)
    const em7 = contas.filter((c) => c.vencimento >= hoje && c.vencimento <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).reduce((s, c) => s + Number(c.valor) - Number(c.valor_pago), 0)
    return { aberto, vencido, em7, inadimplentes: Object.values(porCliente).filter((x) => x.atraso > 0).length }
  }, [contas, porCliente, hoje])

  const visiveis = (clientes ?? []).filter((c) => {
    const t = busca.trim().toLowerCase()
    if (soAtraso && !(porCliente[c.id]?.atraso > 0)) return false
    return !t || c.nome.toLowerCase().includes(t) || (c.cpf_cnpj ?? '').includes(t.replace(/\D/g, '') || '#') || (c.telefone ?? '').includes(t)
  })

  const abrirDetalhe = async (c) => {
    const [sit, ct] = await Promise.all([
      carregarSituacao(c.id),
      supabase.from('contas_receber').select('*').eq('cliente_id', c.id).order('vencimento', { ascending: false }).limit(60),
    ])
    setDetalhe({ ...c, situacao: sit, contas: ct.data ?? [] })
  }

  const salvarCliente = async () => {
    const c = { ...edicao }
    if (!c.nome.trim()) { avisar('Informe o nome do cliente.', 'erro'); return }
    c.limite_credito = lerNumero(c.limite_credito)
    if (Number.isNaN(c.limite_credito) || c.limite_credito < 0) { avisar('Limite de crédito inválido.', 'erro'); return }
    c.cpf_cnpj = c.cpf_cnpj?.replace(/\D/g, '') || null
    if (c.cpf_cnpj && ![11, 14].includes(c.cpf_cnpj.length)) { avisar('CPF deve ter 11 números e CNPJ 14.', 'erro'); return }
    if (!gestor) { delete c.limite_credito; delete c.bloqueado; delete c.tabela_preco_id }
    c.nascimento = c.nascimento || null
    for (const k of ['convenio', 'empresa_id', 'criado_em']) delete c[k]
    setEnviando(true)
    const r = c.id ? await supabase.from('clientes').update(c).eq('id', c.id) : await supabase.from('clientes').insert(c)
    setEnviando(false)
    if (r.error) { avisar(r.error.code === '23505' ? 'Já existe cliente com este CPF/CNPJ.' : mensagemErro(r.error), 'erro'); return }
    avisar('Cliente salvo.'); setEdicao(null); carregar()
  }

  const salvarConvenio = async () => {
    const v = { ...convEdicao }
    if (!v.nome.trim()) { avisar('Informe o nome do convênio.', 'erro'); return }
    v.desconto_percentual = lerNumero(v.desconto_percentual) || 0
    v.dia_fechamento = Number(v.dia_fechamento); v.dias_vencimento = Number(v.dias_vencimento)
    if (!(v.dia_fechamento >= 1 && v.dia_fechamento <= 28)) { avisar('Dia de fechamento entre 1 e 28.', 'erro'); return }
    v.cnpj = v.cnpj?.replace(/\D/g, '') || null
    delete v.empresa_id; delete v.criado_em
    setEnviando(true)
    const r = v.id ? await supabase.from('convenios').update(v).eq('id', v.id) : await supabase.from('convenios').insert(v)
    setEnviando(false)
    if (r.error) { avisar(r.error.code === '23505' ? 'Já existe convênio com este nome.' : mensagemErro(r.error), 'erro'); return }
    avisar('Convênio salvo.'); setConvEdicao(null); carregar()
  }

  const m = (c) => (e) => setEdicao((x) => ({ ...x, [c]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const me = (c) => (e) => setEdicao((x) => ({ ...x, endereco: { ...x.endereco, [c]: e.target.value } }))
  const mv = (c) => (e) => setConvEdicao((x) => ({ ...x, [c]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Clientes" descricao="Cadastro, crediário, convênios e contas a receber">
        {aba === 'convenios'
          ? gestor && <Botao icone="mais" onClick={() => setConvEdicao({ ...CONVENIO_VAZIO })}>Novo convênio</Botao>
          : <Botao icone="mais" onClick={() => setEdicao({ ...CLIENTE_VAZIO })}>Novo cliente</Botao>}
      </Cabecalho>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="A receber" icone="dinheiro" valor={dinheiro(totais.aberto)} detalhe={`${contas.length} parcela(s) em aberto`} />
        <Indicador titulo="Vencido" icone="alerta" valor={dinheiro(totais.vencido)} tom={totais.vencido ? 'critico' : 'neutro'} detalhe={`${totais.inadimplentes} cliente(s) em atraso`} />
        <Indicador titulo="Vence em 7 dias" icone="relogio" valor={dinheiro(totais.em7)} tom={totais.em7 ? 'alerta' : 'neutro'} detalhe="Parcelas de crediário e convênio" />
        <Indicador titulo="Clientes ativos" icone="usuario" valor={(clientes ?? []).filter((c) => c.ativo).length} detalhe={`${convenios.filter((v) => v.ativo).length} convênio(s) ativo(s)`} />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-papel-200 p-3 dark:border-noite-700">
          <div className="flex gap-1 rounded-lg bg-papel-200 p-1 dark:bg-noite-700" role="tablist">
            {ABAS.map((a) => (
              <button key={a.id} role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${aba === a.id ? 'bg-white shadow-sm dark:bg-noite-800' : 'text-tinta-600 dark:text-tinta-300'}`}>{a.nome}</button>
            ))}
          </div>
          {aba === 'clientes' && <>
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-papel-300 px-3 dark:border-noite-600">
              <Icone nome="busca" className="h-4 w-4 text-tinta-400" />
              <input className="w-full bg-transparent py-2 outline-none placeholder:text-tinta-300" placeholder="Buscar por nome, CPF/CNPJ ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar clientes" />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={soAtraso} onChange={(e) => setSoAtraso(e.target.checked)} />Somente em atraso</label>
          </>}
        </div>

        {clientes === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : aba === 'clientes' ? (
          visiveis.length === 0 ? <Vazio icone="usuario" titulo={clientes.length ? 'Nenhum cliente neste filtro' : 'Nenhum cliente cadastrado'} texto="Cadastre clientes para vender no crediário, no convênio e gerar vale-troca." /> : (
            <div className="overflow-x-auto">
              <table className="tabela w-full text-[0.95rem]">
                <thead className="bg-papel/70 dark:bg-noite/40"><tr><th>Cliente</th><th>Contato</th><th>Convênio</th><th className="text-right">Limite</th><th className="text-right">Saldo devedor</th><th>Situação</th></tr></thead>
                <tbody>
                  {visiveis.map((c) => {
                    const s = porCliente[c.id] ?? { devedor: 0, atraso: 0 }
                    return (
                      <tr key={c.id} onClick={() => abrirDetalhe(c)} className={`cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40 ${c.ativo ? '' : 'opacity-60'}`}>
                        <td><span className="font-medium">{c.nome}</span><span className="block text-xs text-tinta-400">{c.cpf_cnpj ? `CPF/CNPJ ${c.cpf_cnpj}` : 'Sem documento'}</span></td>
                        <td className="text-tinta-600 dark:text-tinta-300">{c.telefone || '—'}</td>
                        <td>{c.convenio?.nome ?? '—'}</td>
                        <td className="num text-right">{Number(c.limite_credito) > 0 ? dinheiro(c.limite_credito) : '—'}</td>
                        <td className="num text-right font-semibold">{dinheiro(s.devedor)}</td>
                        <td>
                          {c.bloqueado ? <Etiqueta tom="critico">Bloqueado</Etiqueta>
                            : s.atraso > 0 ? <Etiqueta tom="critico">{dinheiro(s.atraso)} em atraso</Etiqueta>
                            : s.devedor > 0 ? <Etiqueta tom="alerta">Com parcelas a vencer</Etiqueta>
                            : <Etiqueta tom="positivo">Em dia</Etiqueta>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : aba === 'receber' ? (
          contas.length === 0 ? <Vazio icone="dinheiro" titulo="Nenhuma conta em aberto" texto="Vendas no crediário e no convênio geram parcelas que aparecem aqui." /> : (
            <div className="overflow-x-auto">
              <table className="tabela w-full text-[0.95rem]">
                <thead className="bg-papel/70 dark:bg-noite/40"><tr><th>Vencimento</th><th>Cliente</th><th>Origem</th><th>Parcela</th><th className="text-right">Valor</th><th className="text-right">Em aberto</th><th /></tr></thead>
                <tbody>
                  {contas.map((ct) => {
                    const vencida = ct.vencimento < hoje
                    return (
                      <tr key={ct.id}>
                        <td className={vencida ? 'font-semibold text-rubro-600 dark:text-rubro-300' : ''}>{dataBR(ct.vencimento)}{vencida && <span className="block text-xs font-normal">vencida</span>}</td>
                        <td>{ct.cliente?.nome}<span className="block text-xs text-tinta-400">{ct.cliente?.telefone}</span></td>
                        <td>{ct.origem === 'crediario' ? 'Crediário' : 'Convênio'}</td>
                        <td className="num">{ct.parcela}/{ct.parcelas}</td>
                        <td className="num text-right">{dinheiro(ct.valor)}</td>
                        <td className="num text-right font-semibold">{dinheiro(Number(ct.valor) - Number(ct.valor_pago))}</td>
                        <td className="text-right"><Botao variante="discreto" className="px-2 py-1" disabled={!caixa} title={caixa ? '' : 'Abra o caixa para receber'} onClick={() => setReceber({ id: ct.cliente_id, nome: ct.cliente?.nome })}>Receber</Botao></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          convenios.length === 0 ? <Vazio icone="nota" titulo="Nenhum convênio cadastrado" texto="Convênios com empresas ou órgãos permitem vender para funcionários e cobrar no fechamento do mês." /> : (
            <div className="overflow-x-auto">
              <table className="tabela w-full text-[0.95rem]">
                <thead className="bg-papel/70 dark:bg-noite/40"><tr><th>Convênio</th><th className="text-right">Desconto</th><th className="text-right">Fechamento</th><th className="text-right">Vencimento</th><th className="text-right">Clientes</th><th>Situação</th></tr></thead>
                <tbody>
                  {convenios.map((v) => (
                    <tr key={v.id} onClick={() => gestor && setConvEdicao({ ...v, desconto_percentual: String(v.desconto_percentual).replace('.', ','), dia_fechamento: String(v.dia_fechamento), dias_vencimento: String(v.dias_vencimento) })} className={gestor ? 'cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40' : ''}>
                      <td className="font-medium">{v.nome}<span className="block text-xs text-tinta-400">{v.cnpj ? `CNPJ ${v.cnpj}` : ''}</span></td>
                      <td className="num text-right">{String(v.desconto_percentual).replace('.', ',')}%</td>
                      <td className="num text-right">todo dia {v.dia_fechamento}</td>
                      <td className="num text-right">{v.dias_vencimento} dias após</td>
                      <td className="num text-right">{(clientes ?? []).filter((c) => c.convenio_id === v.id).length}</td>
                      <td>{v.ativo ? <Etiqueta tom="positivo">Ativo</Etiqueta> : <Etiqueta>Inativo</Etiqueta>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      <TelaSuspensa
        aberta={!!detalhe}
        titulo={detalhe?.nome}
        subtitulo={detalhe ? [detalhe.cpf_cnpj && `CPF/CNPJ ${detalhe.cpf_cnpj}`, detalhe.telefone].filter(Boolean).join(', ') : ''}
        onFechar={() => setDetalhe(null)}
        largura="max-w-3xl"
        rodape={<>
          <Botao variante="secundario" onClick={() => setDetalhe(null)}>Fechar</Botao>
          <Botao variante="secundario" onClick={() => { setEdicao({ ...CLIENTE_VAZIO, ...detalhe, limite_credito: String(Number(detalhe.limite_credito)).replace('.', ','), nascimento: detalhe.nascimento ?? '', endereco: { ...CLIENTE_VAZIO.endereco, ...(detalhe.endereco || {}) } }); setDetalhe(null) }}>Editar cadastro</Botao>
          <Botao icone="dinheiro" disabled={!caixa || !(Number(detalhe?.situacao?.saldo_devedor) > 0)} onClick={() => { setReceber(detalhe); setDetalhe(null) }}>Receber pagamento</Botao>
        </>}
      >
        {detalhe && (
          <div className="space-y-4">
            <SituacaoCliente cliente={detalhe} />
            {!caixa && Number(detalhe.situacao?.saldo_devedor) > 0 && <p className="text-sm text-ambar-600">Abra o caixa para receber pagamentos.</p>}
            <div>
              <p className="mb-2 font-semibold">Parcelas</p>
              {detalhe.contas.length === 0 ? <p className="text-sm text-tinta-400">Nenhuma parcela registrada.</p> : (
                <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
                  <thead><tr><th>Vencimento</th><th>Origem</th><th>Parcela</th><th className="text-right">Valor</th><th className="text-right">Pago</th><th>Situação</th></tr></thead>
                  <tbody>
                    {detalhe.contas.map((ct) => (
                      <tr key={ct.id}>
                        <td>{dataBR(ct.vencimento)}</td>
                        <td>{ct.origem === 'crediario' ? 'Crediário' : 'Convênio'}</td>
                        <td className="num">{ct.parcela}/{ct.parcelas}</td>
                        <td className="num text-right">{dinheiro(ct.valor)}</td>
                        <td className="num text-right">{dinheiro(ct.valor_pago)}</td>
                        <td>{ct.status === 'paga' ? <Etiqueta tom="positivo">Paga</Etiqueta> : ct.status === 'cancelada' ? <Etiqueta>Cancelada</Etiqueta> : ct.vencimento < hoje ? <Etiqueta tom="critico">Vencida</Etiqueta> : <Etiqueta tom="alerta">A vencer</Etiqueta>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {detalhe.observacoes && <p className="rounded-lg bg-papel px-3 py-2 text-sm dark:bg-noite-700">{detalhe.observacoes}</p>}
          </div>
        )}
      </TelaSuspensa>

      <TelaSuspensa
        aberta={!!edicao}
        titulo={edicao?.id ? 'Editar cliente' : 'Novo cliente'}
        subtitulo={gestor ? 'Dados cadastrais, crédito e convênio' : 'O limite de crédito é definido pelo gerente'}
        onFechar={() => setEdicao(null)}
        largura="max-w-3xl"
        rodape={<>
          <Botao variante="secundario" onClick={() => setEdicao(null)}>Cancelar</Botao>
          <Botao onClick={salvarCliente} carregando={enviando}>Salvar cliente</Botao>
        </>}
      >
        {edicao && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2"><Campo rotulo="Nome completo"><input className="campo" value={edicao.nome} onChange={m('nome')} autoFocus /></Campo></div>
              <Campo rotulo="CPF ou CNPJ"><input className="campo num" inputMode="numeric" value={edicao.cpf_cnpj ?? ''} onChange={m('cpf_cnpj')} /></Campo>
              <Campo rotulo="Data de nascimento"><input type="date" className="campo" value={edicao.nascimento ?? ''} onChange={m('nascimento')} /></Campo>
              <Campo rotulo="Telefone"><input className="campo num" inputMode="tel" value={edicao.telefone ?? ''} onChange={m('telefone')} /></Campo>
              <div className="sm:col-span-3"><Campo rotulo="E-mail"><input type="email" className="campo" value={edicao.email ?? ''} onChange={m('email')} /></Campo></div>
              <div className="sm:col-span-2"><Campo rotulo="Logradouro"><input className="campo" value={edicao.endereco.logradouro} onChange={me('logradouro')} /></Campo></div>
              <Campo rotulo="Número"><input className="campo" value={edicao.endereco.numero} onChange={me('numero')} /></Campo>
              <Campo rotulo="Bairro"><input className="campo" value={edicao.endereco.bairro} onChange={me('bairro')} /></Campo>
              <div className="sm:col-span-2"><Campo rotulo="Município"><input className="campo" value={edicao.endereco.municipio} onChange={me('municipio')} /></Campo></div>
              <Campo rotulo="CEP"><input className="campo num" inputMode="numeric" value={edicao.endereco.cep} onChange={me('cep')} /></Campo>
            </div>
            <fieldset className="rounded-xl border border-papel-200 p-4 dark:border-noite-700">
              <legend className="px-1 text-sm font-semibold">Crédito e convênio</legend>
              <div className="grid items-end gap-3 sm:grid-cols-4">
                <Campo rotulo="Limite do crediário (R$)" ajuda="Zero impede venda no crediário"><input className="campo num" inputMode="decimal" value={edicao.limite_credito} onChange={m('limite_credito')} disabled={!gestor} /></Campo>
                <div className="sm:col-span-2"><Campo rotulo="Convênio"><Lista valor={edicao.convenio_id} opcoes={[{ valor: null, texto: 'Sem convênio' }, ...convenios.filter((v) => v.ativo).map((v) => ({ valor: v.id, texto: v.nome }))]} onMudar={(v) => setEdicao((x) => ({ ...x, convenio_id: v }))} /></Campo></div>
                <Campo rotulo="Matrícula no convênio"><input className="campo" value={edicao.matricula ?? ''} onChange={m('matricula')} /></Campo>
                <div className="sm:col-span-2"><Campo rotulo="Tabela de preço" ajuda="Aplicada automaticamente quando o cliente é identificado no caixa"><Lista valor={edicao.tabela_preco_id ?? null} opcoes={[{ valor: null, texto: 'Varejo (preço normal)' }, ...tabelas.map((t) => ({ valor: t.id, texto: t.nome }))]} onMudar={(v) => gestor && setEdicao((x) => ({ ...x, tabela_preco_id: v }))} /></Campo></div>
              </div>
              {gestor && <label className="mt-3 flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={edicao.bloqueado} onChange={m('bloqueado')} /> Bloquear vendas a prazo para este cliente</label>}
            </fieldset>
            <Campo rotulo="Observações"><textarea className="campo" rows={2} value={edicao.observacoes ?? ''} onChange={m('observacoes')} /></Campo>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={edicao.ativo} onChange={m('ativo')} /> Cliente ativo</label>
          </div>
        )}
      </TelaSuspensa>

      <TelaSuspensa
        aberta={!!convEdicao}
        titulo={convEdicao?.id ? 'Editar convênio' : 'Novo convênio'}
        subtitulo="As compras do mês são cobradas após o fechamento"
        onFechar={() => setConvEdicao(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setConvEdicao(null)}>Cancelar</Botao>
          <Botao onClick={salvarConvenio} carregando={enviando}>Salvar convênio</Botao>
        </>}
      >
        {convEdicao && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Campo rotulo="Nome da empresa ou órgão"><input className="campo" value={convEdicao.nome} onChange={mv('nome')} autoFocus /></Campo></div>
            <Campo rotulo="CNPJ"><input className="campo num" inputMode="numeric" value={convEdicao.cnpj ?? ''} onChange={mv('cnpj')} /></Campo>
            <Campo rotulo="Desconto para conveniados (%)"><input className="campo num" inputMode="decimal" value={convEdicao.desconto_percentual} onChange={mv('desconto_percentual')} /></Campo>
            <Campo rotulo="Dia do fechamento" ajuda="Entre 1 e 28"><input className="campo num" inputMode="numeric" value={convEdicao.dia_fechamento} onChange={mv('dia_fechamento')} /></Campo>
            <Campo rotulo="Prazo de pagamento (dias após o fechamento)"><input className="campo num" inputMode="numeric" value={convEdicao.dias_vencimento} onChange={mv('dias_vencimento')} /></Campo>
            <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={convEdicao.ativo} onChange={mv('ativo')} /> Convênio ativo</label>
          </div>
        )}
      </TelaSuspensa>

      {receber && caixa && <ReceberConta caixa={caixa} cliente={receber} onFechar={() => setReceber(null)} onConcluir={() => { setReceber(null); carregar() }} />}
    </div>
  )
}
