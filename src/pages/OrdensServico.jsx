import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useCaixaAberto } from '../lib/caixa.js'
import { dinheiro, dataHora, lerNumero } from '../lib/formato.js'
import { imprimirComEmpresa } from '../lib/impressao.js'
import { emitirEImprimir } from '../lib/posvenda.js'
import { SITUACOES_OS, totaisOS, atrasada, htmlOrdemServico } from '../lib/os.js'
import { Botao, Cabecalho, Campo, Confirmacao, Etiqueta, Icone, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'
import { SeletorCliente } from '../components/Clientes.jsx'
import { Pagamento, useConfigCaixa } from './PDV.jsx'

const FILTROS = [
  { valor: 'andamento', texto: 'Em andamento' }, { valor: 'aguardando_aprovacao', texto: 'Aguardando aprovação' }, { valor: 'pronta', texto: 'Prontas para retirar' },
  { valor: 'atrasadas', texto: 'Atrasadas' }, { valor: 'entregue', texto: 'Entregues' }, { valor: 'cancelada', texto: 'Canceladas' }, { valor: 'todas', texto: 'Todas' },
]
const GARANTIAS = [0, 30, 90, 180, 365].map((d) => ({ valor: d, texto: d ? `${d} dias` : 'Sem garantia' }))
const EM_ANDAMENTO = ['aberta', 'aguardando_aprovacao', 'aprovada', 'pronta']
const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—')
const NOVA = { cliente_nome: '', cliente_telefone: '', equipamento: '', marca: '', modelo: '', numero_serie: '', acessorios: '', defeito: '', diagnostico: '', solucao: '', observacoes: '', previsao: '', garantia_dias: 90, tecnico_id: null, status: 'aberta' }

export default function OrdensServico() {
  const avisar = useAviso()
  const [lista, setLista] = useState(null)
  const [itensPorOs, setItensPorOs] = useState({})
  const [filtro, setFiltro] = useState('andamento')
  const [busca, setBusca] = useState('')
  const [aberta, setAberta] = useState(null)
  const [tecnicos, setTecnicos] = useState([])

  const carregar = async () => {
    const [{ data, error }, { data: it }, { data: us }] = await Promise.all([
      supabase.from('ordens_servico').select('*').order('criado_em', { ascending: false }).limit(500),
      supabase.from('os_itens').select('os_id, quantidade, preco_unitario'),
      supabase.from('usuarios').select('id, nome').eq('ativo', true).order('nome'),
    ])
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    const g = {}
    for (const i of it ?? []) (g[i.os_id] ??= []).push(i)
    setLista(data); setItensPorOs(g); setTecnicos(us ?? [])
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return (lista ?? []).filter((o) => {
      if (t && !`${o.numero} ${o.cliente_nome} ${o.cliente_telefone ?? ''} ${o.equipamento ?? ''} ${o.marca ?? ''} ${o.modelo ?? ''} ${o.numero_serie ?? ''}`.toLowerCase().includes(t)) return false
      if (filtro === 'andamento') return EM_ANDAMENTO.includes(o.status)
      if (filtro === 'atrasadas') return atrasada(o)
      if (filtro === 'todas') return true
      return o.status === filtro
    })
  }, [lista, filtro, busca])
  const conta = (f) => (lista ?? []).filter(f).length
  const nomeTecnico = (id) => tecnicos.find((t) => t.id === id)?.nome

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Ordens de serviço" descricao="Entrada do equipamento, orçamento, execução e entrega com recebimento no caixa">
        <Botao icone="mais" onClick={() => setAberta({ ...NOVA })}>Nova OS</Botao>
      </Cabecalho>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Em andamento" icone="relogio" valor={conta((o) => ['aberta', 'aprovada'].includes(o.status))} detalhe="Em análise ou em execução" />
        <Indicador titulo="Aguardando aprovação" icone="usuario" tom={conta((o) => o.status === 'aguardando_aprovacao') ? 'alerta' : 'neutro'} valor={conta((o) => o.status === 'aguardando_aprovacao')} detalhe="Orçamento enviado ao cliente" />
        <Indicador titulo="Prontas para retirar" icone="ok" tom="positivo" valor={conta((o) => o.status === 'pronta')} detalhe={dinheiro((lista ?? []).filter((o) => o.status === 'pronta').reduce((s, o) => s + totaisOS(itensPorOs[o.id] ?? []).total, 0)) + ' a receber'} />
        <Indicador titulo="Atrasadas" icone="alerta" tom={conta((o) => atrasada(o)) ? 'critico' : 'neutro'} valor={conta((o) => atrasada(o))} detalhe="Passaram da previsão" />
      </div>
      <div className="mt-4 cartao overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-papel-200 p-4 dark:border-noite-700">
          <div className="min-w-[16rem] flex-1"><Campo rotulo="Buscar"><input className="campo" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Número, cliente, telefone, equipamento ou nº de série" /></Campo></div>
          <div className="w-60"><Campo rotulo="Mostrar"><Lista valor={filtro} opcoes={FILTROS} onMudar={setFiltro} /></Campo></div>
        </div>
        {lista === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : !filtradas.length ? (
          <Vazio icone="nota" titulo={lista.length ? 'Nenhuma OS neste filtro' : 'Nenhuma ordem de serviço ainda'} texto="Registre a entrada do equipamento com o defeito relatado. O orçamento e as peças entram depois.">
            {!lista.length && <Botao icone="mais" onClick={() => setAberta({ ...NOVA })}>Nova OS</Botao>}
          </Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr><th>Nº</th><th>Entrada</th><th>Cliente</th><th>Equipamento</th><th>Técnico</th><th>Previsão</th><th className="text-right">Valor</th><th>Situação</th></tr></thead>
              <tbody>
                {filtradas.map((o) => {
                  const s = SITUACOES_OS[o.status]
                  const atr = atrasada(o)
                  return (
                    <tr key={o.id} onClick={() => setAberta(o)} className="cursor-pointer">
                      <td className="num font-semibold">{o.numero}</td>
                      <td>{dataHora(o.criado_em)}</td>
                      <td>{o.cliente_nome}<span className="block text-xs text-tinta-400">{o.cliente_telefone}</span></td>
                      <td>{[o.equipamento, o.marca, o.modelo].filter(Boolean).join(' ') || '—'}<span className="block max-w-xs truncate text-xs text-tinta-400">{o.defeito}</span></td>
                      <td>{nomeTecnico(o.tecnico_id) ?? '—'}</td>
                      <td className={atr ? 'font-semibold text-rubro-600 dark:text-rubro-300' : ''}>{dataBR(o.previsao)}{atr && <span className="block text-xs">atrasada</span>}</td>
                      <td className="num text-right font-semibold">{dinheiro(totaisOS(itensPorOs[o.id] ?? []).total)}</td>
                      <td><Etiqueta tom={s.tom}>{s.texto}</Etiqueta></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {aberta && <FormOS inicial={aberta} tecnicos={tecnicos} onFechar={() => setAberta(null)} onMudou={carregar} />}
    </div>
  )
}

function FormOS({ inicial, tecnicos, onFechar, onMudou }) {
  const avisar = useAviso()
  const { caixa } = useCaixaAberto()
  const cfg = useConfigCaixa()
  const [os, setOs] = useState(inicial)
  const [itens, setItens] = useState(null)
  const [cliente, setCliente] = useState(false)
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState([])
  const [salvando, setSalvando] = useState('')
  const [cancelar, setCancelar] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [pagar, setPagar] = useState(null)
  const fechada = ['entregue', 'cancelada'].includes(os.status)

  useEffect(() => {
    if (!os.id) { setItens([]); return }
    supabase.from('os_itens').select('*, produto:produtos(servico)').eq('os_id', os.id).order('criado_em')
      .then(({ data }) => setItens((data ?? []).map((i) => ({ ...i, chave: i.id, servico: !!i.produto?.servico, quantidade: String(i.quantidade).replace('.', ','), preco_unitario: String(i.preco_unitario).replace('.', ',') }))))
  }, [os.id])

  const m = (c) => (e) => setOs((x) => ({ ...x, [c]: e?.target ? e.target.value : e }))
  const numItens = (itens ?? []).map((i) => ({ ...i, quantidade: lerNumero(i.quantidade), preco_unitario: lerNumero(i.preco_unitario) }))
  const t = totaisOS(numItens.filter((i) => i.quantidade > 0 && i.preco_unitario >= 0))

  const buscar = async (e) => {
    e?.preventDefault()
    const q0 = termo.trim().replace(/[%,()]/g, '')
    if (!q0) return
    let q = supabase.from('produtos').select('id, descricao, codigo, ean, preco_venda, servico, estoque_atual, unidade').eq('ativo', true).eq('e_grade', false).order('servico', { ascending: false }).order('descricao').limit(12)
    q = /^\d{3,14}$/.test(q0) ? q.or(`ean.eq.${q0},codigo.eq.${q0}`) : q.or(`descricao.ilike.%${q0}%,codigo.eq.${q0}`)
    const { data } = await q
    setAchados(data ?? [])
  }
  const incluir = (p) => {
    setItens((l) => [...l, { chave: crypto.randomUUID(), produto_id: p.id, descricao: p.descricao, servico: p.servico, quantidade: '1', preco_unitario: String(p.preco_venda).replace('.', ',') }])
    setAchados([]); setTermo('')
  }

  // Grava a OS e os itens; devolve a OS gravada (ou null se deu erro)
  const salvar = async (mudanca = {}) => {
    if (!os.cliente_nome?.trim()) { avisar('Informe o cliente.', 'erro'); return null }
    if (numItens.some((i) => !(i.quantidade > 0) || Number.isNaN(i.preco_unitario) || i.preco_unitario < 0)) { avisar('Confira quantidade e preço dos itens.', 'erro'); return null }
    const { id, numero, criado_em, criado_por, atualizado_em, empresa_id, aprovada_em, pronta_em, entregue_em, venda_id, ...dados } = { ...os, ...mudanca }
    for (const c of ['previsao', 'tecnico_id']) if (!dados[c]) dados[c] = null
    const r = id ? await supabase.from('ordens_servico').update(dados).eq('id', id).select('*').single() : await supabase.from('ordens_servico').insert(dados).select('*').single()
    if (r.error) { avisar(mensagemErro(r.error), 'erro'); return null }
    if (!fechada && dados.status !== 'cancelada') {
      const del = await supabase.from('os_itens').delete().eq('os_id', r.data.id)
      if (del.error) { avisar(mensagemErro(del.error), 'erro'); return null }
      if (numItens.length) {
        const ins = await supabase.from('os_itens').insert(numItens.map((i) => ({ os_id: r.data.id, produto_id: i.produto_id, descricao: i.descricao, quantidade: i.quantidade, preco_unitario: i.preco_unitario })))
        if (ins.error) { avisar(mensagemErro(ins.error), 'erro'); return null }
      }
    }
    setOs(r.data); onMudou()
    return r.data
  }
  const acao = async (status, texto) => {
    setSalvando(status ?? 'salvar')
    const r = await salvar(status ? { status } : {})
    setSalvando('')
    if (r) avisar(texto ?? `OS nº ${r.numero} salva.`)
  }
  const imprimir = async (gravada = os, via = gravada.status === 'entregue' ? 'entrega' : 'entrada') => {
    const tecnico = tecnicos.find((x) => x.id === gravada.tecnico_id)?.nome
    const x = await imprimirComEmpresa((empresa) => htmlOrdemServico({ empresa, os: gravada, itens: numItens, tecnico, via }))
    if (x?.erro) avisar(x.erro, 'erro')
  }
  const entregar = async () => {
    if (!caixa) { avisar('Abra o caixa para receber e entregar a OS.', 'erro'); return }
    if (!numItens.length) { avisar('Inclua os serviços e peças antes de entregar.', 'erro'); return }
    setSalvando('entregar')
    const r = await salvar()
    setSalvando('')
    if (!r) return
    setPagar(numItens.map((i) => ({ chave: i.chave, produto_id: i.produto_id, descricao: i.descricao, quantidade: i.quantidade, preco_unitario: i.preco_unitario, desconto: 0 })))
  }
  const concluida = async (v) => {
    setPagar(null)
    const { data } = await supabase.from('ordens_servico').select('*').eq('id', os.id).single()
    if (data) setOs(data)
    avisar(`OS nº ${os.numero} entregue. Venda nº ${v.numero}.`)
    onMudou()
    if (data) await imprimir(data, 'entrega')
    if (numItens.some((i) => !i.servico)) await emitirEImprimir(v.venda_id, avisar)
  }

  const s = SITUACOES_OS[os.status]
  const temServico = numItens.some((i) => i.servico)
  return (<>
    <TelaSuspensa aberta titulo={os.id ? `OS nº ${os.numero}` : 'Nova ordem de serviço'} subtitulo={os.id ? `${s.texto}; entrada em ${dataHora(os.criado_em)}` : 'Registre o que o cliente deixou e o defeito relatado'}
      largura="max-w-5xl" onFechar={onFechar}
      rodape={<>
        {os.id && !fechada && <Botao variante="secundario" onClick={() => { setCancelar(true); setMotivo('') }}>Cancelar OS</Botao>}
        {os.id && <Botao variante="secundario" icone="impressora" onClick={() => imprimir()}>Imprimir</Botao>}
        {!fechada && <Botao variante="secundario" onClick={() => acao(null)} carregando={salvando === 'salvar'}>{os.id ? 'Salvar' : 'Abrir OS'}</Botao>}
        {os.status === 'aberta' && os.id && <Botao variante="secundario" onClick={() => acao('aguardando_aprovacao', 'Orçamento registrado: aguardando aprovação do cliente.')} carregando={salvando === 'aguardando_aprovacao'}>Enviar orçamento</Botao>}
        {['aberta', 'aguardando_aprovacao'].includes(os.status) && os.id && <Botao onClick={() => acao('aprovada', 'Orçamento aprovado. OS em execução.')} carregando={salvando === 'aprovada'}>Cliente aprovou</Botao>}
        {os.status === 'aprovada' && <Botao onClick={() => acao('pronta', 'OS pronta. Avise o cliente para retirar.')} carregando={salvando === 'pronta'}>Marcar como pronta</Botao>}
        {['aprovada', 'pronta'].includes(os.status) && <Botao variante="sucesso" icone="dinheiro" onClick={entregar} carregando={salvando === 'entregar'}>Entregar e receber {dinheiro(t.total)}</Botao>}
      </>}>
      {fechada && <p className={`mb-4 rounded-xl px-4 py-3 text-sm ${os.status === 'entregue' ? 'bg-caixa-50 text-caixa-700 dark:bg-caixa-900/30 dark:text-caixa-300' : 'bg-rubro-50 text-rubro-700 dark:bg-rubro-600/15 dark:text-rubro-300'}`}>
        {os.status === 'entregue' ? `Entregue em ${dataHora(os.entregue_em)}. A OS não pode mais ser alterada.` : `Cancelada: ${os.motivo_cancelamento}`}</p>}
      <fieldset disabled={fechada} className="space-y-5">
        <section className="grid gap-3 sm:grid-cols-4">
          <h3 className="titulo-secao sm:col-span-4">Cliente</h3>
          <div className="sm:col-span-2"><Campo rotulo="Nome" ajuda={!fechada ? <button type="button" className="font-semibold text-caixa-600 hover:underline dark:text-caixa-300" onClick={() => setCliente(true)}>Buscar cliente cadastrado</button> : undefined}>
            <input className="campo" value={os.cliente_nome} onChange={m('cliente_nome')} autoFocus={!os.id} /></Campo></div>
          <Campo rotulo="Telefone"><input className="campo num" inputMode="tel" value={os.cliente_telefone ?? ''} onChange={m('cliente_telefone')} /></Campo>
          <Campo rotulo="Técnico"><Lista valor={os.tecnico_id} opcoes={[{ valor: null, texto: 'A definir' }, ...tecnicos.map((u) => ({ valor: u.id, texto: u.nome }))]} onMudar={m('tecnico_id')} /></Campo>
        </section>
        <section className="grid gap-3 border-t border-papel-200 pt-4 sm:grid-cols-4 dark:border-noite-700">
          <h3 className="titulo-secao sm:col-span-4">Equipamento</h3>
          <div className="sm:col-span-2"><Campo rotulo="Equipamento ou serviço pedido"><input className="campo" value={os.equipamento ?? ''} onChange={m('equipamento')} placeholder="Ex.: celular, notebook, motor, ar-condicionado" /></Campo></div>
          <Campo rotulo="Marca"><input className="campo" value={os.marca ?? ''} onChange={m('marca')} /></Campo>
          <Campo rotulo="Modelo"><input className="campo" value={os.modelo ?? ''} onChange={m('modelo')} /></Campo>
          <Campo rotulo="Número de série / IMEI / placa"><input className="campo" value={os.numero_serie ?? ''} onChange={m('numero_serie')} /></Campo>
          <div className="sm:col-span-3"><Campo rotulo="Acessórios entregues"><input className="campo" value={os.acessorios ?? ''} onChange={m('acessorios')} placeholder="Ex.: carregador e capa" /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="Defeito relatado pelo cliente"><textarea className="campo" rows={2} value={os.defeito ?? ''} onChange={m('defeito')} /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="Diagnóstico"><textarea className="campo" rows={2} value={os.diagnostico ?? ''} onChange={m('diagnostico')} /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="Serviço realizado"><textarea className="campo" rows={2} value={os.solucao ?? ''} onChange={m('solucao')} /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="Observações"><textarea className="campo" rows={2} value={os.observacoes ?? ''} onChange={m('observacoes')} /></Campo></div>
          <Campo rotulo="Previsão de entrega"><input type="date" className="campo" value={os.previsao ?? ''} onChange={m('previsao')} /></Campo>
          <Campo rotulo="Garantia"><Lista valor={Number(os.garantia_dias)} opcoes={GARANTIAS} onMudar={m('garantia_dias')} /></Campo>
        </section>
        <section className="border-t border-papel-200 pt-4 dark:border-noite-700">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
            <h3 className="titulo-secao">Serviços e peças</h3>
            {!fechada && (
              <form onSubmit={buscar} className="flex w-full max-w-md gap-2">
                <input className="campo" value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar serviço ou peça" aria-label="Buscar serviço ou peça" />
                <Botao type="submit" variante="secundario" icone="busca">Buscar</Botao>
              </form>
            )}
          </div>
          {achados.length > 0 && (
            <ul className="mb-3 max-h-48 divide-y divide-papel-200 overflow-auto rounded-xl border border-papel-200 dark:divide-noite-700 dark:border-noite-700">
              {achados.map((p) => (
                <li key={p.id}><button type="button" onClick={() => incluir(p)} className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left hover:bg-caixa-50 dark:hover:bg-noite-700">
                  <span>{p.descricao} <Etiqueta tom={p.servico ? 'positivo' : 'neutro'}>{p.servico ? 'Serviço' : `Peça; ${Number(p.estoque_atual)} ${p.unidade} em estoque`}</Etiqueta></span>
                  <span className="num shrink-0 font-semibold">{dinheiro(p.preco_venda)}</span>
                </button></li>
              ))}
            </ul>
          )}
          {itens === null ? <p className="text-sm text-tinta-400">Carregando…</p> : !itens.length ? (
            <p className="rounded-xl border border-dashed border-papel-300 px-4 py-6 text-center text-sm text-tinta-400 dark:border-noite-600">Nenhum item. Cadastre a mão de obra em Produtos marcando "É um serviço".</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-papel-200 dark:border-noite-700">
              <table className="tabela w-full text-[0.95rem]">
                <thead><tr><th>Descrição</th><th>Tipo</th><th className="w-24 text-right">Qtd.</th><th className="w-32 text-right">Preço</th><th className="text-right">Total</th><th className="w-10" /></tr></thead>
                <tbody>
                  {itens.map((i, k) => (
                    <tr key={i.chave}>
                      <td>{i.descricao}</td>
                      <td><Etiqueta tom={i.servico ? 'positivo' : 'neutro'}>{i.servico ? 'Serviço' : 'Peça'}</Etiqueta></td>
                      <td><input className="campo num py-1.5 text-right" inputMode="decimal" value={i.quantidade} aria-label="Quantidade" onChange={(e) => setItens((l) => l.map((x, j) => (j === k ? { ...x, quantidade: e.target.value } : x)))} /></td>
                      <td><input className="campo num py-1.5 text-right" inputMode="decimal" value={i.preco_unitario} aria-label="Preço" onChange={(e) => setItens((l) => l.map((x, j) => (j === k ? { ...x, preco_unitario: e.target.value } : x)))} /></td>
                      <td className="num text-right font-semibold">{dinheiro(numItens[k].quantidade * numItens[k].preco_unitario || 0)}</td>
                      <td>{!fechada && <button type="button" className="rounded p-1 text-tinta-400 hover:text-rubro-600" onClick={() => setItens((l) => l.filter((_, j) => j !== k))} aria-label={`Remover ${i.descricao}`}><Icone nome="fechar" className="h-4 w-4" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-baseline justify-end gap-x-6 gap-y-1 text-sm">
            <span className="text-tinta-400">Serviços <span className="num font-semibold text-tinta dark:text-papel">{dinheiro(t.servicos)}</span></span>
            <span className="text-tinta-400">Peças <span className="num font-semibold text-tinta dark:text-papel">{dinheiro(t.pecas)}</span></span>
            <span className="num text-xl font-semibold">{dinheiro(t.total)}</span>
          </div>
          {temServico && !fechada && <p className="mt-2 text-right text-xs text-tinta-400">Os serviços não saem na NFC-e; a nota de serviço (NFS-e) é emitida na prefeitura.</p>}
        </section>
      </fieldset>
    </TelaSuspensa>

    <SeletorCliente aberta={cliente} onFechar={() => setCliente(false)}
      onEscolher={(c) => { setOs((x) => ({ ...x, cliente_id: c.id, cliente_nome: c.nome, cliente_telefone: c.telefone ?? x.cliente_telefone })); setCliente(false) }} />
    <Confirmacao aberta={cancelar} titulo={`Cancelar OS nº ${os.numero}`} variante="perigo" textoConfirmar="Cancelar OS"
      mensagem={<>A OS fica registrada como cancelada e não pode mais ser alterada.<span className="mt-3 block"><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" aria-label="Motivo" /></span></>}
      onCancelar={() => setCancelar(false)}
      onConfirmar={async () => { const r = await salvar({ status: 'cancelada', motivo_cancelamento: motivo }); if (r) { setCancelar(false); avisar('OS cancelada.') } }} />
    {pagar && <Pagamento caixa={caixa} itens={pagar} cliente={null} tabela={null} cfg={cfg} fechar={{ rpc: 'fechar_os', args: { p_os: os.id } }} onFechar={() => setPagar(null)} onConcluir={concluida} />}
  </>)
}
