import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { useCaixaAberto } from '../lib/caixa.js'
import { dinheiro, lerNumero, arred } from '../lib/formato.js'
import { imprimirComEmpresa, htmlPreConta, htmlPedidoCozinha } from '../lib/impressao.js'
import { emitirEImprimir } from '../lib/posvenda.js'
import { Botao, Cabecalho, Campo, Confirmacao, Etiqueta, Icone, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'
import { Pagamento, useConfigCaixa } from './PDV.jsx'

const SITUACAO_ITEM = { pendente: ['Na cozinha', 'alerta'], pronto: ['Pronto', 'positivo'], entregue: ['Entregue', 'neutro'], cancelado: ['Cancelado', 'critico'] }
const minutos = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
const tempo = (iso) => { const m = minutos(iso); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` }
const totalComanda = (itens) => arred(itens.filter((i) => i.status !== 'cancelado').reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0))
const nomeComanda = (c, mesas) => { const m = mesas.find((x) => x.id === c.mesa_id); return m ? `Mesa ${m.numero}` : (c.identificacao || `Comanda ${c.numero}`) }

export default function Comandas() {
  const perfil = useSessao()
  const avisar = useAviso()
  const gestor = perfil.papel !== 'operador'
  const [mesas, setMesas] = useState(null)
  const [comandas, setComandas] = useState([])
  const [itens, setItens] = useState([])
  const [abrir, setAbrir] = useState(null)        // { mesa } ou { avulsa: true }
  const [aberta, setAberta] = useState(null)      // id da comanda em detalhe
  const [cadastro, setCadastro] = useState(false)

  const carregar = async () => {
    const [m, c] = await Promise.all([
      supabase.from('mesas').select('*').eq('ativo', true).order('numero'),
      supabase.from('comandas').select('*').eq('status', 'aberta').order('aberta_em'),
    ])
    if (m.error || c.error) { avisar(mensagemErro(m.error || c.error), 'erro'); return }
    const ids = c.data.map((x) => x.id)
    const it = ids.length ? await supabase.from('comanda_itens').select('*').in('comanda_id', ids).order('lancado_em') : { data: [] }
    setMesas(m.data); setComandas(c.data); setItens(it.data ?? [])
  }
  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 15000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const porComanda = useMemo(() => {
    const g = {}
    for (const i of itens) (g[i.comanda_id] ??= []).push(i)
    return g
  }, [itens])
  const daMesa = (m) => comandas.find((c) => c.mesa_id === m.id)
  const avulsas = comandas.filter((c) => !c.mesa_id)
  const totalAberto = comandas.reduce((s, c) => s + totalComanda(porComanda[c.id] ?? []), 0)
  const ocupadas = (mesas ?? []).filter(daMesa).length

  const abrirComanda = async (dados) => {
    const { data, error } = await supabase.rpc('abrir_comanda', { p_mesa: dados.mesa?.id ?? null, p_identificacao: dados.identificacao || null, p_pessoas: Number(dados.pessoas) || 1 })
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    setAbrir(null); await carregar(); setAberta(data)
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Mesas e comandas" descricao="Abra a mesa, lance os pedidos e feche a conta no caixa">
        {gestor && <Botao variante="secundario" icone="configuracoes" onClick={() => setCadastro(true)}>Cadastrar mesas</Botao>}
        <Botao icone="mais" onClick={() => setAbrir({ avulsa: true, identificacao: '', pessoas: 1 })}>Comanda sem mesa</Botao>
      </Cabecalho>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-white px-3 py-1 font-medium shadow-cartao dark:bg-noite-800">{ocupadas} de {mesas?.length ?? 0} mesas ocupadas</span>
        <span className="rounded-full bg-white px-3 py-1 font-medium shadow-cartao dark:bg-noite-800">{comandas.length} comanda(s) aberta(s)</span>
        <span className="num rounded-full bg-white px-3 py-1 font-medium shadow-cartao dark:bg-noite-800">{dinheiro(totalAberto)} em aberto</span>
      </div>

      {mesas === null ? <p className="text-sm text-tinta-400">Carregando…</p> : (<>
        {!mesas.length ? (
          <div className="cartao"><Vazio icone="caixa" titulo="Nenhuma mesa cadastrada" texto={gestor ? 'Cadastre as mesas do salão para controlar a ocupação. Comandas sem mesa (balcão, entrega) funcionam mesmo sem cadastro.' : 'Peça ao gerente para cadastrar as mesas. Comandas sem mesa já podem ser usadas.'}>
            {gestor && <Botao icone="mais" onClick={() => setCadastro(true)}>Cadastrar mesas</Botao>}
          </Vazio></div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {mesas.map((m) => {
              const c = daMesa(m)
              const it = c ? porComanda[c.id] ?? [] : []
              const prontos = it.filter((i) => i.status === 'pronto').length
              return (
                <button key={m.id} onClick={() => (c ? setAberta(c.id) : setAbrir({ mesa: m, pessoas: m.lugares || 1, identificacao: '' }))}
                  className={`relative flex min-h-[7.5rem] flex-col rounded-2xl p-4 text-left transition hover:-translate-y-0.5 ${c
                    ? 'bg-gradient-to-br from-caixa-600 to-caixa-700 text-white shadow-[0_10px_24px_-12px_rgba(20,145,125,.9)]'
                    : 'border-2 border-dashed border-papel-300 bg-white/60 text-tinta-500 hover:border-caixa-400 dark:border-noite-600 dark:bg-noite-800/50 dark:text-tinta-300'}`}>
                  <span className="text-xs font-semibold opacity-80">{m.nome || 'Mesa'}</span>
                  <span className="num text-[2rem] font-bold leading-none">{m.numero}</span>
                  {c ? (<>
                    <span className="num mt-auto text-[1.05rem] font-semibold">{dinheiro(totalComanda(it))}</span>
                    <span className="text-xs opacity-85">{c.pessoas} pessoa(s), há {tempo(c.aberta_em)}</span>
                    {prontos > 0 && <span className="absolute right-3 top-3 rounded-full bg-ambar-500 px-2 py-0.5 text-[0.7rem] font-bold text-white">{prontos} pronto(s)</span>}
                  </>) : <span className="mt-auto text-sm font-medium">Livre{m.lugares ? `, ${m.lugares} lugares` : ''}</span>}
                </button>
              )
            })}
          </div>
        )}

        {avulsas.length > 0 && (
          <section className="mt-6">
            <h2 className="titulo-secao mb-2">Comandas sem mesa</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {avulsas.map((c) => {
                const it = porComanda[c.id] ?? []
                return (
                  <button key={c.id} onClick={() => setAberta(c.id)} className="cartao flex items-center justify-between gap-3 p-4 text-left transition hover:-translate-y-0.5">
                    <span className="min-w-0"><span className="block truncate font-semibold">{c.identificacao}</span><span className="text-xs text-tinta-400">Comanda nº {c.numero}, há {tempo(c.aberta_em)}</span></span>
                    <span className="num shrink-0 font-semibold">{dinheiro(totalComanda(it))}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </>)}

      {abrir && (
        <TelaSuspensa aberta titulo={abrir.mesa ? `Abrir mesa ${abrir.mesa.numero}` : 'Comanda sem mesa'} subtitulo={abrir.mesa ? 'A conta fica aberta até o fechamento no caixa' : 'Para balcão, entrega ou cartão de comanda'} onFechar={() => setAbrir(null)}
          rodape={<><Botao variante="secundario" onClick={() => setAbrir(null)}>Cancelar</Botao><Botao onClick={() => abrirComanda(abrir)}>Abrir comanda</Botao></>}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Pessoas"><input className="campo num" inputMode="numeric" value={abrir.pessoas} onChange={(e) => setAbrir((x) => ({ ...x, pessoas: e.target.value.replace(/\D/g, '') }))} autoFocus={!!abrir.mesa} /></Campo>
            <div className="sm:col-span-2"><Campo rotulo={abrir.mesa ? 'Identificação (opcional)' : 'Identificação'} ajuda="Nome do cliente ou número do cartão de comanda">
              <input className="campo" value={abrir.identificacao} onChange={(e) => setAbrir((x) => ({ ...x, identificacao: e.target.value }))} autoFocus={!abrir.mesa} /></Campo></div>
          </div>
        </TelaSuspensa>
      )}
      {aberta && <DetalheComanda id={aberta} mesas={mesas ?? []} comandas={comandas} onFechar={() => setAberta(null)} onMudou={carregar} />}
      {cadastro && <CadastroMesas mesas={mesas ?? []} onFechar={() => { setCadastro(false); carregar() }} />}
    </div>
  )
}

function DetalheComanda({ id, mesas, comandas, onFechar, onMudou }) {
  const perfil = useSessao()
  const avisar = useAviso()
  const { caixa } = useCaixaAberto()
  const cfg = useConfigCaixa()
  const gestor = perfil.papel !== 'operador'
  const [c, setC] = useState(null)
  const [itens, setItens] = useState([])
  const [novos, setNovos] = useState([])          // itens a enviar
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState([])
  const [enviando, setEnviando] = useState(false)
  const [cancelarItem, setCancelarItem] = useState(null)
  const [acao, setAcao] = useState(null)          // transferir | juntar | cancelar
  const [alvo, setAlvo] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [pagar, setPagar] = useState(null)
  const busca = useRef(null)

  const carregar = async () => {
    const [{ data: cm }, { data: it }] = await Promise.all([
      supabase.from('comandas').select('*').eq('id', id).single(),
      supabase.from('comanda_itens').select('*').eq('comanda_id', id).order('lancado_em'),
    ])
    setC(cm); setItens(it ?? [])
  }
  useEffect(() => { carregar() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const buscar = async (e) => {
    e?.preventDefault()
    const t = termo.trim().replace(/[%,()]/g, '')
    if (!t) return
    let q = supabase.from('produtos').select('id, descricao, codigo, ean, preco_venda, cozinha, unidade').eq('ativo', true).eq('e_grade', false).order('descricao').limit(12)
    q = /^\d{3,14}$/.test(t) ? q.or(`ean.eq.${t},codigo.eq.${t}`) : q.or(`descricao.ilike.%${t}%,codigo.eq.${t}`)
    const { data } = await q
    if (data?.length === 1 && /^\d+$/.test(t)) { incluir(data[0]); return }
    setAchados(data ?? [])
  }
  const incluir = (p) => {
    setNovos((n) => [...n, { chave: crypto.randomUUID(), produto_id: p.id, descricao: p.descricao, preco: Number(p.preco_venda), cozinha: p.cozinha, quantidade: '1', observacao: '' }])
    setAchados([]); setTermo(''); busca.current?.focus()
  }
  const enviar = async () => {
    const lista = novos.map((n) => ({ produto_id: n.produto_id, quantidade: lerNumero(n.quantidade), observacao: n.observacao }))
    if (lista.some((n) => !(n.quantidade > 0))) { avisar('Confira as quantidades.', 'erro'); return }
    setEnviando(true)
    const { error } = await supabase.rpc('lancar_itens_comanda', { p_comanda: id, p_itens: lista })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    const cozinha = novos.filter((n) => n.cozinha).map((n) => ({ ...n, quantidade: lerNumero(n.quantidade) }))
    if (cozinha.length) {
      const x = await imprimirComEmpresa((empresa, config) => htmlPedidoCozinha({ comanda: { ...c, mesa: mesaNum }, itens: cozinha, garcom: perfil.nome, config }), { automatica: true })
      if (x?.erro) avisar(x.erro, 'erro')
    }
    avisar(`${lista.length} item(ns) lançado(s)${cozinha.length ? '; pedido enviado à cozinha' : ''}.`)
    setNovos([]); carregar(); onMudou()
  }
  const executar = async (rpc, args, ok) => {
    const { error } = await supabase.rpc(rpc, args)
    if (error) { avisar(mensagemErro(error), 'erro'); return false }
    if (ok) avisar(ok)
    return true
  }
  const abrirPagamento = async () => {
    if (!caixa) { avisar('Abra o caixa para fechar a conta.', 'erro'); return }
    if (novos.length) { avisar('Envie ou remova os itens ainda não lançados.', 'erro'); return }
    const g = {}
    for (const i of itens.filter((x) => x.status !== 'cancelado')) {
      const k = g[i.produto_id] ??= { chave: i.produto_id, produto_id: i.produto_id, descricao: i.descricao, quantidade: 0, preco_unitario: Number(i.preco_unitario), desconto: 0 }
      k.quantidade += Number(i.quantidade)
    }
    const lista = Object.values(g)
    if (!lista.length) { avisar('A comanda não tem itens.', 'erro'); return }
    // Preço vigente no fechamento (o mesmo que o banco usa na venda)
    const { data } = await supabase.rpc('precos_itens', { p_itens: lista.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade })) })
    setPagar(lista.map((i, k) => ({ ...i, preco_unitario: data?.[k]?.preco != null ? Number(data[k].preco) : i.preco_unitario })))
  }
  const concluida = async (r) => {
    setPagar(null)
    avisar(`Conta fechada: venda nº ${r.numero}.`)
    onMudou(); onFechar()
    await emitirEImprimir(r.venda_id, avisar)
  }

  if (!c) return null
  const mesa = mesas.find((m) => m.id === c.mesa_id)
  const mesaNum = mesa?.numero ?? null
  const validos = itens.filter((i) => i.status !== 'cancelado')
  const total = totalComanda(itens)
  const outras = comandas.filter((x) => x.id !== c.id)
  const livres = mesas.filter((m) => !comandas.some((x) => x.mesa_id === m.id))

  return (<>
    <TelaSuspensa aberta titulo={`${mesa ? `Mesa ${mesa.numero}` : c.identificacao}, comanda nº ${c.numero}`}
      subtitulo={`${c.pessoas} pessoa(s), aberta há ${tempo(c.aberta_em)}${mesa && c.identificacao ? `; ${c.identificacao}` : ''}`} largura="max-w-5xl" onFechar={onFechar}
      rodape={<>
        <Botao variante="secundario" onClick={() => { setAcao('cancelar'); setMotivo('') }}>Cancelar comanda</Botao>
        <Botao variante="secundario" onClick={() => { setAcao('transferir'); setAlvo(null) }}>Trocar de mesa</Botao>
        <Botao variante="secundario" onClick={() => { setAcao('juntar'); setAlvo(null) }} disabled={!outras.length}>Juntar comandas</Botao>
        <Botao variante="secundario" icone="impressora" onClick={async () => { const x = await imprimirComEmpresa((empresa, config) => htmlPreConta({ empresa, comanda: { ...c, mesa: mesaNum }, itens, config })); if (x?.erro) avisar(x.erro, 'erro') }} disabled={!validos.length}>Conferência de conta</Botao>
        <Botao variante="sucesso" icone="dinheiro" onClick={abrirPagamento} disabled={!validos.length}>Fechar conta {dinheiro(total)}</Botao>
      </>}>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <section>
          <h3 className="titulo-secao mb-2">Consumo</h3>
          {!itens.length ? <p className="rounded-xl border border-dashed border-papel-300 px-4 py-8 text-center text-sm text-tinta-400 dark:border-noite-600">Nenhum item lançado ainda.</p> : (
            <ul className="divide-y divide-papel-200 rounded-xl border border-papel-200 dark:divide-noite-700 dark:border-noite-700">
              {itens.map((i) => {
                const [txt, tom] = i.cozinha || i.status === 'cancelado' ? SITUACAO_ITEM[i.status] : ['Bebida / balcão', 'neutro']
                return (
                  <li key={i.id} className={`flex items-start gap-3 px-3.5 py-2.5 ${i.status === 'cancelado' ? 'opacity-55' : ''}`}>
                    <span className="num w-10 shrink-0 font-semibold">{Number(i.quantidade).toLocaleString('pt-BR')}×</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block ${i.status === 'cancelado' ? 'line-through' : ''}`}>{i.descricao}</span>
                      {i.observacao && <span className="block text-xs text-ambar-600 dark:text-ambar-300">{i.observacao}</span>}
                      {i.status === 'cancelado' && i.motivo && <span className="block text-xs text-tinta-400">Cancelado: {i.motivo}</span>}
                    </span>
                    <Etiqueta tom={tom}>{txt}</Etiqueta>
                    <span className="num w-24 shrink-0 text-right">{dinheiro(Number(i.quantidade) * Number(i.preco_unitario))}</span>
                    {i.status !== 'cancelado' && <button className="rounded p-1 text-tinta-400 hover:text-rubro-600" onClick={() => { setCancelarItem(i); setMotivo('') }} aria-label={`Cancelar ${i.descricao}`}><Icone nome="fechar" className="h-4 w-4" /></button>}
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mt-3 flex items-baseline justify-between rounded-xl bg-papel-100 px-4 py-3 dark:bg-noite-700">
            <span className="text-sm text-tinta-500 dark:text-tinta-300">Total{c.pessoas > 1 ? `; ${dinheiro(total / c.pessoas)} por pessoa` : ''}</span>
            <span className="num text-2xl font-semibold">{dinheiro(total)}</span>
          </div>
        </section>

        <section>
          <h3 className="titulo-secao mb-2">Lançar pedido</h3>
          <form onSubmit={buscar} className="flex gap-2">
            <input ref={busca} className="campo" value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Nome ou código do produto" autoFocus aria-label="Buscar produto" />
            <Botao type="submit" variante="secundario" icone="busca">Buscar</Botao>
          </form>
          {achados.length > 0 && (
            <ul className="mt-2 max-h-56 divide-y divide-papel-200 overflow-auto rounded-xl border border-papel-200 dark:divide-noite-700 dark:border-noite-700">
              {achados.map((p) => (
                <li key={p.id}><button type="button" onClick={() => incluir(p)} className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left hover:bg-caixa-50 dark:hover:bg-noite-700">
                  <span>{p.descricao}{p.cozinha && <span className="ml-2 text-xs text-ambar-600">cozinha</span>}</span><span className="num shrink-0 font-semibold">{dinheiro(p.preco_venda)}</span>
                </button></li>
              ))}
            </ul>
          )}
          {novos.length > 0 && (
            <div className="mt-3 space-y-2">
              {novos.map((n) => (
                <div key={n.chave} className="rounded-xl border border-caixa-200 bg-caixa-50/60 p-2.5 dark:border-caixa-800 dark:bg-caixa-900/20">
                  <div className="flex items-center gap-2">
                    <input className="campo num w-16 py-1.5" inputMode="decimal" value={n.quantidade} aria-label="Quantidade" onChange={(e) => setNovos((x) => x.map((y) => (y.chave === n.chave ? { ...y, quantidade: e.target.value } : y)))} />
                    <span className="min-w-0 flex-1 truncate font-medium">{n.descricao}</span>
                    <button className="rounded p-1 text-tinta-400 hover:text-rubro-600" onClick={() => setNovos((x) => x.filter((y) => y.chave !== n.chave))} aria-label="Remover"><Icone nome="fechar" className="h-4 w-4" /></button>
                  </div>
                  <input className="campo mt-2 py-1.5 text-sm" value={n.observacao} placeholder="Observação (ex.: sem cebola, bem passado)" maxLength={140}
                    onChange={(e) => setNovos((x) => x.map((y) => (y.chave === n.chave ? { ...y, observacao: e.target.value } : y)))} />
                </div>
              ))}
              <Botao className="w-full" icone="ok" onClick={enviar} carregando={enviando}>Enviar pedido ({novos.length} item{novos.length > 1 ? 's' : ''})</Botao>
            </div>
          )}
          {!novos.length && !achados.length && <p className="mt-3 text-sm text-tinta-400">Busque o produto, ajuste a quantidade e a observação, e envie. Os itens de cozinha aparecem na tela Cozinha e saem impressos se a impressão automática estiver ligada.</p>}
        </section>
      </div>
    </TelaSuspensa>

    {cancelarItem && (
      <TelaSuspensa aberta titulo="Cancelar item" subtitulo={`${Number(cancelarItem.quantidade).toLocaleString('pt-BR')} × ${cancelarItem.descricao}`} onFechar={() => setCancelarItem(null)}
        rodape={<><Botao variante="secundario" onClick={() => setCancelarItem(null)}>Voltar</Botao>
          <Botao variante="perigo" onClick={async () => { if (await executar('cancelar_item_comanda', { p_item: cancelarItem.id, p_motivo: motivo }, 'Item cancelado.')) { setCancelarItem(null); carregar(); onMudou() } }}>Cancelar item</Botao></>}>
        {!gestor && cancelarItem.cozinha && <p className="mb-3 rounded-xl bg-ambar-50 px-3 py-2 text-sm text-ambar-700 dark:bg-ambar-600/15 dark:text-ambar-300">Item já enviado à cozinha: só o gerente cancela depois de 2 minutos.</p>}
        <Campo rotulo="Motivo"><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus /></Campo>
      </TelaSuspensa>
    )}

    {acao === 'transferir' && (
      <TelaSuspensa aberta titulo="Trocar de mesa" subtitulo={`Comanda nº ${c.numero}`} onFechar={() => setAcao(null)}
        rodape={<><Botao variante="secundario" onClick={() => setAcao(null)}>Cancelar</Botao>
          <Botao onClick={async () => { if (await executar('transferir_comanda', { p_comanda: c.id, p_mesa: alvo === 'sem' ? null : alvo }, 'Comanda transferida.')) { setAcao(null); carregar(); onMudou() } }} disabled={!alvo}>Transferir</Botao></>}>
        <Campo rotulo="Mesa de destino"><Lista valor={alvo} opcoes={[...livres.map((m) => ({ valor: m.id, texto: `Mesa ${m.numero}${m.nome ? ` (${m.nome})` : ''}` })), ...(c.identificacao ? [{ valor: 'sem', texto: 'Sem mesa (balcão)' }] : [])]} onMudar={setAlvo} placeholder="Escolha uma mesa livre" /></Campo>
      </TelaSuspensa>
    )}
    {acao === 'juntar' && (
      <TelaSuspensa aberta titulo="Juntar comandas" subtitulo={`Os itens desta comanda (nº ${c.numero}) passam para a escolhida`} onFechar={() => setAcao(null)}
        rodape={<><Botao variante="secundario" onClick={() => setAcao(null)}>Cancelar</Botao>
          <Botao onClick={async () => { if (await executar('juntar_comandas', { p_origem: c.id, p_destino: alvo }, 'Comandas juntadas.')) { setAcao(null); onMudou(); onFechar() } }} disabled={!alvo}>Juntar</Botao></>}>
        <Campo rotulo="Juntar na comanda"><Lista valor={alvo} opcoes={outras.map((x) => ({ valor: x.id, texto: `${nomeComanda(x, mesas)} (nº ${x.numero})` }))} onMudar={setAlvo} placeholder="Escolha a comanda" /></Campo>
      </TelaSuspensa>
    )}
    <Confirmacao aberta={acao === 'cancelar'} titulo="Cancelar comanda" variante="perigo" textoConfirmar="Cancelar comanda"
      mensagem={<>
        {validos.length ? 'A comanda tem itens lançados. O cancelamento fica registrado no histórico e exige gerente.' : 'A comanda será encerrada sem venda.'}
        <span className="mt-3 block"><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" aria-label="Motivo" /></span>
      </>}
      onCancelar={() => setAcao(null)}
      onConfirmar={async () => { if (await executar('cancelar_comanda', { p_comanda: c.id, p_motivo: motivo }, 'Comanda cancelada.')) { setAcao(null); onMudou(); onFechar() } }} />

    {pagar && <Pagamento caixa={caixa} itens={pagar} cliente={null} tabela={null} cfg={cfg} fechar={{ comanda: c.id }} onFechar={() => setPagar(null)} onConcluir={concluida} />}
  </>)
}

function CadastroMesas({ mesas, onFechar }) {
  const avisar = useAviso()
  const [de, setDe] = useState(String((mesas.at(-1)?.numero ?? 0) + 1))
  const [ate, setAte] = useState(String((mesas.at(-1)?.numero ?? 0) + 10))
  const [lugares, setLugares] = useState('4')
  const [nome, setNome] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [lista, setLista] = useState(mesas)

  const criar = async () => {
    const a = parseInt(de, 10), b = parseInt(ate, 10)
    if (!(a > 0 && b >= a && b - a < 200)) { avisar('Informe a faixa de números (até 200 mesas por vez).', 'erro'); return }
    const existentes = new Set(lista.map((m) => m.numero))
    const novas = []
    for (let n = a; n <= b; n++) if (!existentes.has(n)) novas.push({ numero: n, lugares: parseInt(lugares, 10) || null, nome: nome.trim() || null, ativo: true })
    if (!novas.length) { avisar('Essas mesas já existem.', 'erro'); return }
    setSalvando(true)
    const { data, error } = await supabase.from('mesas').upsert(novas, { onConflict: 'empresa_id,numero' }).select('*')
    setSalvando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`${data.length} mesa(s) cadastrada(s).`)
    setLista((l) => [...l, ...data].sort((x, y) => x.numero - y.numero))
  }
  const desativar = async (m) => {
    const { error } = await supabase.from('mesas').update({ ativo: false }).eq('id', m.id)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    setLista((l) => l.filter((x) => x.id !== m.id))
  }

  return (
    <TelaSuspensa aberta titulo="Cadastrar mesas" subtitulo="Crie várias de uma vez pela faixa de números" largura="max-w-2xl" onFechar={onFechar}
      rodape={<><Botao variante="secundario" onClick={onFechar}>Concluir</Botao><Botao onClick={criar} carregando={salvando}>Criar mesas</Botao></>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Campo rotulo="Da mesa"><input className="campo num" inputMode="numeric" value={de} onChange={(e) => setDe(e.target.value.replace(/\D/g, ''))} /></Campo>
        <Campo rotulo="Até a mesa"><input className="campo num" inputMode="numeric" value={ate} onChange={(e) => setAte(e.target.value.replace(/\D/g, ''))} /></Campo>
        <Campo rotulo="Lugares"><input className="campo num" inputMode="numeric" value={lugares} onChange={(e) => setLugares(e.target.value.replace(/\D/g, ''))} /></Campo>
        <Campo rotulo="Ambiente (opcional)"><input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Varanda" /></Campo>
      </div>
      <h3 className="titulo-secao mb-2 mt-5">Mesas ativas ({lista.length})</h3>
      {!lista.length ? <p className="text-sm text-tinta-400">Nenhuma mesa ainda.</p> : (
        <div className="flex flex-wrap gap-2">
          {lista.map((m) => (
            <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full bg-papel-100 py-1 pl-3 pr-1 text-sm dark:bg-noite-700">
              <span className="num font-semibold">{m.numero}</span>{m.nome && <span className="text-tinta-400">{m.nome}</span>}
              <button className="rounded-full p-1 text-tinta-400 hover:text-rubro-600" onClick={() => desativar(m)} aria-label={`Desativar mesa ${m.numero}`}><Icone nome="fechar" className="h-3.5 w-3.5" /></button>
            </span>
          ))}
        </div>
      )}
    </TelaSuspensa>
  )
}
