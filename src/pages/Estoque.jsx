import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { dinheiro, dataHora, lerNumero } from '../lib/formato.js'
import { Botao, Cabecalho, Campo, Confirmacao, Etiqueta, Icone, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'
import { BuscaProduto } from '../components/BuscaProduto.jsx'

const qtd = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }))
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '')
const ESCOPOS = [
  { valor: 'todos', texto: 'Todos os produtos' },
  { valor: 'categoria', texto: 'Uma categoria' },
  { valor: 'livre', texto: 'Contagem livre (só o que for lido)' },
]
const nomeEscopo = (i, cats) => (i.escopo === 'categoria' ? `Categoria ${cats.find((c) => c.id === i.categoria_id)?.nome ?? ''}` : ESCOPOS.find((e) => e.valor === i.escopo)?.texto)

// Lê o arquivo do coletor: uma leitura por linha, "código;quantidade", "código,quantidade", "código quantidade" ou só o código
export function lerArquivoColetor(texto) {
  const linhas = []
  for (const bruta of String(texto).split(/\r?\n/)) {
    const l = bruta.trim()
    if (!l) continue
    const m = l.replace(/"/g, '').match(/^([^;,\t ]+)(?:[;,\t ]+(.+))?$/)
    const codigo = m?.[1]
    if (!codigo || !/^[0-9A-Za-z.-]{1,20}$/.test(codigo) || !/\d/.test(codigo)) continue
    const q = m[2] != null ? lerNumero(m[2].trim()) : 1
    if (Number.isNaN(q)) continue
    linhas.push({ codigo, quantidade: q })
  }
  return linhas
}

export default function Estoque() {
  const perfil = useSessao()
  const gestor = perfil.papel !== 'operador'
  const [aba, setAba] = useState('inventarios')
  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Inventário e transferências" descricao="Contagem de estoque com coletor e envio de mercadorias entre filiais" />
      {gestor && (
        <div className="mb-4 inline-flex abas" role="tablist">
          {[['inventarios', 'Inventários'], ['transferencias', 'Transferências entre filiais']].map(([id, nome]) => (
            <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
              className={`aba ${aba === id ? 'aba-ativa' : ''}`}>{nome}</button>
          ))}
        </div>
      )}
      {aba === 'inventarios' ? <Inventarios gestor={gestor} /> : <Transferencias />}
    </div>
  )
}

// ---------------------------------------------------------------- Inventários
function Inventarios({ gestor }) {
  const avisar = useAviso()
  const [lista, setLista] = useState(null)
  const [cats, setCats] = useState([])
  const [novo, setNovo] = useState(null)
  const [aberto, setAberto] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const carregar = async () => {
    const [i, c] = await Promise.all([
      supabase.from('inventarios').select('*, itens:inventario_itens(count)').order('numero', { ascending: false }).limit(100),
      supabase.from('categorias').select('id, nome').eq('ativo', true).order('nome'),
    ])
    if (i.error) avisar(mensagemErro(i.error), 'erro')
    setLista(i.data ?? []); setCats(c.data ?? [])
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const criar = async () => {
    if (!novo.descricao.trim()) { avisar('Informe a descrição.', 'erro'); return }
    if (novo.escopo === 'categoria' && !novo.categoria_id) { avisar('Escolha a categoria.', 'erro'); return }
    setEnviando(true)
    const { data, error } = await supabase.rpc('abrir_inventario', { p_descricao: novo.descricao, p_escopo: novo.escopo, p_categoria: novo.categoria_id })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    setNovo(null); await carregar()
    setAberto(data)
  }

  if (aberto) return <Contagem id={aberto} gestor={gestor} cats={cats} onVoltar={() => { setAberto(null); carregar() }} />

  const abertos = (lista ?? []).filter((i) => i.status === 'aberto')
  const ultimo = (lista ?? []).find((i) => i.status === 'finalizado')
  const visiveis = gestor ? lista ?? [] : abertos

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Inventários abertos" icone="estoque" tom={abertos.length ? 'alerta' : 'neutro'} valor={abertos.length} detalhe={abertos[0]?.descricao ?? 'Nenhuma contagem em andamento'} />
        <Indicador titulo="Último finalizado" icone="relogio" valor={ultimo ? `Nº ${ultimo.numero}` : '—'} detalhe={ultimo ? dataHora(ultimo.finalizado_em) : 'Ainda não houve inventário'} />
        <Indicador titulo="Faltas no último" icone="alerta" tom={Number(ultimo?.resumo?.falta_valor) ? 'critico' : 'neutro'} valor={dinheiro(ultimo?.resumo?.falta_valor ?? 0)} detalhe={`${qtd(ultimo?.resumo?.falta_qtd ?? 0)} unidade(s), pelo custo`} />
        <Indicador titulo="Sobras no último" icone="mais" tom={Number(ultimo?.resumo?.sobra_valor) ? 'positivo' : 'neutro'} valor={dinheiro(ultimo?.resumo?.sobra_valor ?? 0)} detalhe={`${qtd(ultimo?.resumo?.sobra_qtd ?? 0)} unidade(s), pelo custo`} />
      </div>
      <div className="mt-4 cartao overflow-hidden">
        <div className="flex items-center justify-between border-b border-papel-200 px-4 py-3 dark:border-noite-700">
          <div><p className="font-semibold">Inventários</p><p className="text-sm text-tinta-400">Leitor de código de barras, coletor de dados ou celular. Vendas durante a contagem continuam valendo.</p></div>
          {gestor && <Botao icone="mais" onClick={() => setNovo({ descricao: `Inventário de ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`, escopo: 'todos', categoria_id: null })}>Novo inventário</Botao>}
        </div>
        {lista === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : visiveis.length === 0 ? (
          <Vazio icone="estoque" titulo={gestor ? 'Nenhum inventário' : 'Nenhuma contagem aberta'} texto={gestor ? 'Abra um inventário geral, de uma categoria ou uma contagem livre para conferir só alguns produtos.' : 'Quando o gerente abrir um inventário, ele aparece aqui para você contar.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr><th>Nº</th><th>Descrição</th><th>Abrangência</th><th>Aberto em</th><th className="text-right">Itens</th><th className="text-right">Diferença</th><th>Situação</th></tr></thead>
              <tbody>
                {visiveis.map((i) => (
                  <tr key={i.id} onClick={() => setAberto(i.id)} className="cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40">
                    <td className="num font-semibold">{i.numero}</td>
                    <td className="font-medium">{i.descricao}</td>
                    <td>{nomeEscopo(i, cats)}</td>
                    <td>{dataHora(i.criado_em)}</td>
                    <td className="num text-right">{i.itens?.[0]?.count ?? 0}</td>
                    <td className="num text-right">{i.resumo ? dinheiro(Number(i.resumo.sobra_valor) - Number(i.resumo.falta_valor)) : '—'}</td>
                    <td>{i.status === 'aberto' ? <Etiqueta tom="alerta">Em contagem</Etiqueta> : i.status === 'finalizado' ? <Etiqueta tom="positivo">Finalizado</Etiqueta> : <Etiqueta>Cancelado</Etiqueta>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TelaSuspensa aberta={!!novo} titulo="Novo inventário" subtitulo="Os produtos entram na lista; o estoque de cada um é fotografado na primeira leitura" onFechar={() => setNovo(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setNovo(null)}>Cancelar</Botao>
          <Botao onClick={criar} carregando={enviando}>Abrir inventário</Botao>
        </>}>
        {novo && (
          <div className="space-y-3">
            <Campo rotulo="Descrição"><input className="campo" value={novo.descricao} onChange={(e) => setNovo((n) => ({ ...n, descricao: e.target.value }))} autoFocus /></Campo>
            <Campo rotulo="Abrangência" ajuda={novo.escopo === 'livre' ? 'Ideal para contagem rotativa: só os produtos lidos são ajustados.' : 'Ao finalizar, você escolhe se os produtos não contados ficam como estão ou são zerados.'}>
              <Lista valor={novo.escopo} opcoes={ESCOPOS} onMudar={(v) => setNovo((n) => ({ ...n, escopo: v }))} />
            </Campo>
            {novo.escopo === 'categoria' && <Campo rotulo="Categoria"><Lista valor={novo.categoria_id} opcoes={cats.map((c) => ({ valor: c.id, texto: c.nome }))} onMudar={(v) => setNovo((n) => ({ ...n, categoria_id: v }))} /></Campo>}
          </div>
        )}
      </TelaSuspensa>
    </>
  )
}

const FILTROS = [
  { valor: 'todos', texto: 'Todos os itens' }, { valor: 'pendentes', texto: 'Não contados' },
  { valor: 'diferenca', texto: 'Com diferença' }, { valor: 'contados', texto: 'Contados' },
]
const MODOS = [{ valor: 'somar', texto: 'Somar a cada leitura' }, { valor: 'definir', texto: 'Informar o total contado' }]

function Contagem({ id, gestor, cats, onVoltar }) {
  const avisar = useAviso()
  const [inv, setInv] = useState(null)
  const [itens, setItens] = useState([])
  const [leituras, setLeituras] = useState([])
  const [codigo, setCodigo] = useState('')
  const [quantidade, setQuantidade] = useState('1')
  const [modo, setModo] = useState('somar')
  const [ultima, setUltima] = useState(null)
  const [filtro, setFiltro] = useState('todos')
  const [busca, setBusca] = useState('')
  const [finalizar, setFinalizar] = useState(null)
  const [cancelar, setCancelar] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const campo = useRef(null)
  const arquivo = useRef(null)

  const carregarLeituras = async () => {
    const { data } = await supabase.from('inventario_leituras').select('*, produto:produtos(descricao, unidade)').eq('inventario_id', id).order('criado_em', { ascending: false }).limit(15)
    setLeituras(data ?? [])
  }
  const carregar = async () => {
    const [i, it] = await Promise.all([
      supabase.from('inventarios').select('*').eq('id', id).single(),
      supabase.from('inventario_itens').select('*, produto:produtos(descricao, ean, codigo, unidade, estoque_atual, preco_custo)').eq('inventario_id', id).limit(20000),
    ])
    if (i.error) { avisar(mensagemErro(i.error), 'erro'); return }
    setInv(i.data)
    setItens((it.data ?? []).sort((a, b) => String(a.produto?.descricao).localeCompare(String(b.produto?.descricao), 'pt-BR')))
    carregarLeituras()
  }
  useEffect(() => { carregar() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const aberto = inv?.status === 'aberto'
  const sistema = (i) => Number(i.estoque_sistema ?? i.produto?.estoque_atual ?? 0)
  const dif = (i) => (i.contado == null ? null : Number(i.ajuste ?? Number(i.contado) - sistema(i)))
  const contados = itens.filter((i) => i.contado != null)
  const comDif = contados.filter((i) => dif(i) !== 0)
  const valorDif = comDif.reduce((s, i) => s + dif(i) * Number(i.custo_unitario ?? i.produto?.preco_custo ?? 0), 0)

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return itens.filter((i) => {
      if (filtro === 'pendentes' && i.contado != null) return false
      if (filtro === 'contados' && i.contado == null) return false
      if (filtro === 'diferenca' && !(i.contado != null && dif(i) !== 0)) return false
      return !t || [i.produto?.descricao, i.produto?.ean, i.produto?.codigo].some((x) => String(x ?? '').toLowerCase().includes(t))
    })
  }, [itens, filtro, busca]) // eslint-disable-line react-hooks/exhaustive-deps

  const registrar = async (e, produtoId) => {
    e?.preventDefault()
    const c = codigo.trim()
    if (!c && !produtoId) return
    const q = lerNumero(quantidade || '1')
    if (Number.isNaN(q) || (modo === 'definir' && q < 0)) { avisar('Quantidade inválida.', 'erro'); return }
    const { data, error } = await supabase.rpc('contar_inventario', { p_inventario: id, p_codigo: c || null, p_quantidade: q, p_modo: modo, p_produto: produtoId ?? null })
    setCodigo(''); campo.current?.focus()
    if (error) { setUltima({ erro: mensagemErro(error) }); return }
    setUltima(data)
    if (modo === 'definir') setQuantidade('1')
    if (itens.some((i) => i.produto_id === data.produto_id)) {
      setItens((l) => l.map((i) => (i.produto_id === data.produto_id ? { ...i, contado: data.contado, estoque_sistema: i.estoque_sistema ?? data.sistema } : i)))
      carregarLeituras()
    } else carregar()
  }

  const desfazer = async (l) => {
    const { error } = await supabase.rpc('desfazer_leitura', { p_leitura: l.id })
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Leitura desfeita.'); setUltima(null); carregar()
  }

  const importar = async (ev) => {
    const f = ev.target.files?.[0]; ev.target.value = ''
    if (!f) return
    const linhas = lerArquivoColetor(await f.text())
    if (!linhas.length) { avisar('Nenhuma leitura reconhecida no arquivo. Use uma linha por leitura: código;quantidade.', 'erro'); return }
    setEnviando(true)
    let lidos = 0; const rejeitados = []
    for (let k = 0; k < linhas.length; k += 500) {
      const { data, error } = await supabase.rpc('importar_contagem', { p_inventario: id, p_linhas: linhas.slice(k, k + 500), p_modo: 'somar' })
      if (error) { setEnviando(false); avisar(mensagemErro(error), 'erro'); return }
      lidos += data.lidos; rejeitados.push(...data.rejeitados)
    }
    setEnviando(false)
    avisar(`${lidos} leitura(s) importada(s)${rejeitados.length ? `, ${rejeitados.length} não reconhecida(s): ${rejeitados.slice(0, 5).map((r) => r.codigo).join(', ')}` : ''}.`, rejeitados.length ? 'erro' : 'sucesso')
    carregar()
  }

  const exportar = () => {
    const cab = ['Produto', 'Código de barras', 'Código', 'Sistema', 'Contado', 'Diferença', 'Custo unitário', 'Valor da diferença']
    const n = (v) => (v == null ? '' : String(v).replace('.', ','))
    const linhas = itens.map((i) => {
      const d = dif(i), custo = Number(i.custo_unitario ?? i.produto?.preco_custo ?? 0)
      return [i.produto?.descricao, i.produto?.ean, i.produto?.codigo, n(sistema(i)), n(i.contado), n(d), n(custo), d == null ? '' : n((d * custo).toFixed(2))]
    })
    const csv = [cab, ...linhas].map((l) => l.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `inventario-${inv.numero}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const confirmarFinalizar = async () => {
    setEnviando(true)
    const { data, error } = await supabase.rpc('finalizar_inventario', { p_inventario: id, p_zerar_nao_contados: finalizar.zerar })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`Inventário finalizado: ${data.itens_ajustados} produto(s) ajustado(s).`)
    setFinalizar(null); carregar()
  }
  const confirmarCancelar = async () => {
    const { error } = await supabase.rpc('cancelar_inventario', { p_inventario: id })
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Inventário cancelado; nenhum estoque foi alterado.'); onVoltar()
  }

  if (!inv) return <p className="text-sm text-tinta-400">Carregando…</p>
  const pendentes = itens.length - contados.length
  const ultimaPorProduto = new Set()

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Botao variante="secundario" onClick={onVoltar}>Voltar</Botao>
        <div className="mr-auto">
          <p className="text-lg font-semibold">Inventário nº {inv.numero}: {inv.descricao}</p>
          <p className="text-sm text-tinta-400">{nomeEscopo(inv, cats)}, aberto em {dataHora(inv.criado_em)}{inv.finalizado_em ? `, ${inv.status === 'cancelado' ? 'cancelado' : 'finalizado'} em ${dataHora(inv.finalizado_em)}` : ''}</p>
        </div>
        <Botao variante="secundario" icone="nota" onClick={exportar}>Exportar planilha</Botao>
        {aberto && gestor && <Botao variante="secundario" onClick={() => setCancelar(true)}>Cancelar inventário</Botao>}
        {aberto && gestor && <Botao icone="ok" onClick={() => setFinalizar({ zerar: false })}>Finalizar e ajustar estoque</Botao>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Contados" icone="ok" tom={pendentes === 0 && itens.length ? 'positivo' : 'neutro'} valor={`${contados.length} de ${itens.length}`} detalhe={inv.escopo === 'livre' ? 'Contagem livre' : `${pendentes} produto(s) ainda sem leitura`} />
        <Indicador titulo="Com diferença" icone="alerta" tom={comDif.length ? 'alerta' : 'neutro'} valor={comDif.length} detalhe="Entre os já contados" />
        <Indicador titulo="Diferença em valor" icone="dinheiro" tom={valorDif < 0 ? 'critico' : valorDif > 0 ? 'positivo' : 'neutro'} valor={dinheiro(valorDif)} detalhe="Sobras menos faltas, pelo custo" />
        <Indicador titulo="Situação" icone="estoque" tom={aberto ? 'alerta' : 'neutro'} valor={aberto ? 'Em contagem' : inv.status === 'finalizado' ? 'Finalizado' : 'Cancelado'} detalhe={aberto ? 'O estoque só muda ao finalizar' : 'Somente consulta'} />
      </div>

      {aberto && (
        <div className="mt-4 grid gap-4 lg:grid-cols-5">
          <form onSubmit={registrar} className="cartao p-4 lg:col-span-3">
            <p className="mb-3 font-semibold">Coletor</p>
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-3"><Campo rotulo="Código de barras ou código interno">
                <input ref={campo} className="campo num text-lg" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoFocus inputMode="numeric" aria-label="Código do produto" placeholder="Passe o leitor aqui" />
              </Campo></div>
              <Campo rotulo="Quantidade"><input className="campo num text-lg" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} /></Campo>
              <div className="sm:col-span-2"><Campo rotulo="Modo"><Lista valor={modo} opcoes={MODOS} onMudar={setModo} /></Campo></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Botao type="submit" icone="ok">Registrar (Enter)</Botao>
              <Botao type="button" variante="secundario" icone="busca" onClick={() => setBuscando(true)}>Produto sem código</Botao>
              <input ref={arquivo} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden" onChange={importar} />
              <Botao type="button" variante="secundario" icone="nota" carregando={enviando} onClick={() => arquivo.current?.click()}>Importar arquivo do coletor</Botao>
            </div>
            {ultima && (ultima.erro
              ? <div className="mt-3 flex items-center gap-2 rounded-lg bg-rubro-50 px-3 py-2.5 text-sm font-medium text-rubro-600 dark:bg-rubro-600/20 dark:text-rubro-300"><Icone nome="alerta" className="h-4 w-4" />{ultima.erro}</div>
              : <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-caixa-50 px-3 py-2.5 dark:bg-caixa-700/20">
                  <span className="font-medium">{ultima.descricao}</span>
                  <span className="num text-sm">contado <strong className="text-base">{qtd(ultima.contado)}</strong> {ultima.unidade}{gestor && <span className="text-tinta-400"> · sistema {qtd(ultima.sistema)}</span>}</span>
                </div>)}
          </form>
          <div className="cartao overflow-hidden lg:col-span-2">
            <p className="border-b border-papel-200 px-4 py-3 font-semibold dark:border-noite-700">Últimas leituras</p>
            {leituras.length === 0 ? <p className="p-4 text-sm text-tinta-400">Nenhuma leitura ainda.</p> : (
              <ul className="max-h-64 divide-y divide-papel-200 overflow-auto dark:divide-noite-700">
                {leituras.map((l) => {
                  const pode = !ultimaPorProduto.has(l.produto_id); ultimaPorProduto.add(l.produto_id)
                  return (
                    <li key={l.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{l.produto?.descricao}</span>
                      <span className="num whitespace-nowrap">{l.modo === 'somar' ? `+${qtd(l.quantidade)}` : `= ${qtd(l.quantidade)}`}</span>
                      {pode ? <button className="text-sm font-medium text-rubro-600 hover:underline" onClick={() => desfazer(l)}>Desfazer</button> : <span className="w-[3.7rem]" />}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 cartao overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-papel-200 p-3 dark:border-noite-700">
          <div className="w-48"><Lista valor={filtro} opcoes={FILTROS} onMudar={setFiltro} /></div>
          <div className="relative min-w-[14rem] flex-1">
            <Icone nome="busca" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tinta-400" />
            <input className="campo pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar por descrição ou código" />
          </div>
        </div>
        {visiveis.length === 0 ? <Vazio icone="estoque" titulo="Nenhum item neste filtro" texto={inv.escopo === 'livre' ? 'Na contagem livre os produtos entram na lista conforme são lidos.' : ''} /> : (
          <div className="max-h-[36rem] overflow-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead className="sticky top-0 bg-papel dark:bg-noite-800"><tr><th>Produto</th>{gestor && <th className="text-right">Sistema</th>}<th className="text-right">Contado</th>{gestor && <><th className="text-right">Diferença</th><th className="text-right">Valor</th></>}</tr></thead>
              <tbody>
                {visiveis.slice(0, 500).map((i) => {
                  const d = dif(i)
                  const cor = d == null || d === 0 ? '' : d < 0 ? 'text-rubro-600 dark:text-rubro-300' : 'text-caixa-600 dark:text-caixa-300'
                  return (
                    <tr key={i.id}>
                      <td>{i.produto?.descricao}<span className="block text-xs text-tinta-400">{i.produto?.ean || i.produto?.codigo || 'sem código'}</span></td>
                      {gestor && <td className="num text-right">{qtd(sistema(i))}</td>}
                      <td className="num text-right font-semibold">{i.contado == null ? <span className="font-normal text-tinta-400">—</span> : qtd(i.contado)}</td>
                      {gestor && <>
                        <td className={`num text-right font-semibold ${cor}`}>{d == null ? '—' : d > 0 ? `+${qtd(d)}` : qtd(d)}</td>
                        <td className={`num text-right ${cor}`}>{d ? dinheiro(d * Number(i.custo_unitario ?? i.produto?.preco_custo ?? 0)) : '—'}</td>
                      </>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {visiveis.length > 500 && <p className="p-3 text-sm text-tinta-400">Mostrando 500 de {visiveis.length}. Use o filtro ou exporte a planilha.</p>}
          </div>
        )}
      </div>

      {buscando && <BuscaProduto titulo="Contar produto" semKits onFechar={() => setBuscando(false)} onEscolher={(p) => { setBuscando(false); registrar(null, p.id) }} />}
      <TelaSuspensa aberta={!!finalizar} titulo="Finalizar inventário" subtitulo="As diferenças viram ajustes de estoque. Esta ação não pode ser desfeita." onFechar={() => setFinalizar(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setFinalizar(null)}>Cancelar</Botao>
          <Botao onClick={confirmarFinalizar} carregando={enviando}>Finalizar e ajustar</Botao>
        </>}>
        {finalizar && (
          <div className="space-y-3 text-[0.95rem]">
            <p className="flex justify-between"><span>Produtos contados</span><strong className="num">{contados.length}</strong></p>
            <p className="flex justify-between"><span>Com diferença</span><strong className="num">{comDif.length}</strong></p>
            <p className="flex justify-between"><span>Diferença em valor (custo)</span><strong className={`num ${valorDif < 0 ? 'text-rubro-600 dark:text-rubro-300' : ''}`}>{dinheiro(valorDif)}</strong></p>
            {inv.escopo !== 'livre' && pendentes > 0 && (
              <div className="rounded-lg border border-ambar-600/40 bg-ambar-50 p-3 dark:bg-ambar-600/10">
                <p className="font-medium">{pendentes} produto(s) não foram contados.</p>
                <label className="mt-2 flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4 accent-caixa-600" checked={finalizar.zerar} onChange={(e) => setFinalizar({ zerar: e.target.checked })} />
                  <span>Zerar o estoque dos não contados<span className="block text-sm text-tinta-400">Deixe desmarcado para mantê-los como estão.</span></span></label>
              </div>
            )}
          </div>
        )}
      </TelaSuspensa>
      <Confirmacao aberta={cancelar} titulo="Cancelar inventário" mensagem="As leituras são descartadas e nenhum estoque é alterado." textoConfirmar="Cancelar inventário" variante="perigo" onCancelar={() => setCancelar(false)} onConfirmar={confirmarCancelar} />
    </>
  )
}

// ---------------------------------------------------------------- Transferências
function Transferencias() {
  const perfil = useSessao()
  const avisar = useAviso()
  const minha = perfil.empresa.id
  const [lista, setLista] = useState(null)
  const [filiais, setFiliais] = useState([])
  const [nova, setNova] = useState(null)
  const [buscando, setBuscando] = useState(false)
  const [detalhe, setDetalhe] = useState(null)
  const [cancelar, setCancelar] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const carregar = async () => {
    const [t, f] = await Promise.all([
      supabase.from('transferencias').select('*, itens:transferencia_itens(count)').order('enviado_em', { ascending: false }).limit(200),
      supabase.rpc('filiais'),
    ])
    if (t.error) avisar(mensagemErro(t.error), 'erro')
    setLista(t.data ?? []); setFiliais(f.data ?? [])
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const incluir = async (p) => {
    setBuscando(false)
    if (nova.itens.some((i) => i.produto_id === p.id)) return
    const { data } = await supabase.from('lotes').select('id, numero, validade, quantidade').eq('produto_id', p.id).gt('quantidade', 0).order('validade')
    setNova((n) => ({ ...n, itens: [...n.itens, { produto_id: p.id, descricao: p.descricao, unidade: p.unidade, estoque: p.estoque_atual, quantidade: '1', lote_id: null, lotes: data ?? [] }] }))
  }
  const mudarItem = (k, campo, v) => setNova((n) => ({ ...n, itens: n.itens.map((i, j) => (j === k ? { ...i, [campo]: v } : i)) }))

  const enviar = async () => {
    if (!nova.destino) { avisar('Escolha a filial de destino.', 'erro'); return }
    if (!nova.itens.length) { avisar('Inclua os produtos.', 'erro'); return }
    const itens = []
    for (const i of nova.itens) {
      const q = lerNumero(i.quantidade)
      if (!(q > 0)) { avisar(`Quantidade inválida em ${i.descricao}.`, 'erro'); return }
      itens.push({ produto_id: i.produto_id, quantidade: q, lote_id: i.lote_id })
    }
    setEnviando(true)
    const { data, error } = await supabase.rpc('enviar_transferencia', { p_destino: nova.destino, p_itens: itens, p_obs: nova.observacao })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`Transferência nº ${data.numero} enviada. O estoque já saiu desta loja.`); setNova(null); carregar()
  }

  const abrir = async (t) => {
    const { data } = await supabase.from('transferencia_itens').select('*').eq('transferencia_id', t.id)
    setDetalhe({ ...t, linhas: (data ?? []).map((l) => ({ ...l, recebido: String(Number(l.quantidade_recebida ?? l.quantidade)).replace('.', ',') })) })
  }
  const receber = async () => {
    const itens = []
    for (const l of detalhe.linhas) {
      const q = lerNumero(l.recebido)
      if (Number.isNaN(q) || q < 0) { avisar(`Quantidade inválida em ${l.descricao}.`, 'erro'); return }
      itens.push({ item_id: l.id, quantidade_recebida: q })
    }
    setEnviando(true)
    const { data, error } = await supabase.rpc('receber_transferencia', { p_transferencia: detalhe.id, p_itens: itens })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`Recebimento confirmado${data.produtos_novos ? `, ${data.produtos_novos} produto(s) cadastrado(s)` : ''}${data.divergencias ? `, ${data.divergencias} item(ns) com diferença registrados` : ''}.`)
    setDetalhe(null); carregar()
  }
  const confirmarCancelar = async () => {
    const { error } = await supabase.rpc('cancelar_transferencia', { p_transferencia: cancelar.id })
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Transferência cancelada; o estoque voltou para esta loja.'); setCancelar(null); setDetalhe(null); carregar()
  }

  const aReceber = (lista ?? []).filter((t) => t.empresa_destino_id === minha && t.status === 'enviada')
  const emTransito = (lista ?? []).filter((t) => t.empresa_origem_id === minha && t.status === 'enviada')
  const mes = new Date().toISOString().slice(0, 7)
  const enviadasMes = (lista ?? []).filter((t) => t.empresa_origem_id === minha && t.status !== 'cancelada' && t.enviado_em.slice(0, 7) === mes)
  const situacao = (t) => (t.status === 'cancelada' ? <Etiqueta>Cancelada</Etiqueta>
    : t.status === 'recebida' ? (t.divergencias ? <Etiqueta tom="alerta">Recebida com diferença</Etiqueta> : <Etiqueta tom="positivo">Recebida</Etiqueta>)
    : t.empresa_destino_id === minha ? <Etiqueta tom="critico">Aguardando sua conferência</Etiqueta> : <Etiqueta tom="alerta">Em trânsito</Etiqueta>)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Aguardando recebimento" icone="estoque" tom={aReceber.length ? 'critico' : 'neutro'} valor={aReceber.length} detalhe="Enviadas para esta loja" />
        <Indicador titulo="Em trânsito" icone="relogio" tom={emTransito.length ? 'alerta' : 'neutro'} valor={emTransito.length} detalhe="Enviadas, ainda não conferidas" />
        <Indicador titulo="Enviado no mês" icone="dinheiro" valor={dinheiro(enviadasMes.reduce((s, t) => s + Number(t.valor_total), 0))} detalhe={`${enviadasMes.length} transferência(s), pelo custo`} />
        <Indicador titulo="Filiais do grupo" icone="usuario" valor={filiais.length} detalhe={filiais.slice(0, 2).map((f) => f.nome).join(', ') || 'Nenhuma vinculada'} />
      </div>
      <div className="mt-4 cartao overflow-hidden">
        <div className="flex items-center justify-between border-b border-papel-200 px-4 py-3 dark:border-noite-700">
          <div><p className="font-semibold">Transferências</p><p className="text-sm text-tinta-400">O estoque sai no envio e entra quando a filial confere o recebimento.</p></div>
          {filiais.length > 0 && <Botao icone="mais" onClick={() => setNova({ destino: filiais.length === 1 ? filiais[0].id : null, observacao: '', itens: [] })}>Nova transferência</Botao>}
        </div>
        {lista === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : lista.length === 0 ? (
          filiais.length === 0
            ? <Vazio icone="usuario" titulo="Nenhuma filial vinculada" texto="Para transferir mercadorias, as lojas precisam estar no mesmo grupo de empresas. Solicite ao suporte do sistema o vínculo entre as filiais." />
            : <Vazio icone="estoque" titulo="Nenhuma transferência" texto="Envie mercadorias para outra loja do grupo. A filial confere e confirma o recebimento." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr><th>Nº</th><th>De</th><th>Para</th><th>Enviada em</th><th className="text-right">Itens</th><th className="text-right">Valor</th><th>Situação</th></tr></thead>
              <tbody>
                {lista.map((t) => (
                  <tr key={t.id} onClick={() => abrir(t)} className="cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40">
                    <td className="num font-semibold">{t.numero}</td>
                    <td className={t.empresa_origem_id === minha ? 'font-medium' : ''}>{t.origem_nome}</td>
                    <td className={t.empresa_destino_id === minha ? 'font-medium' : ''}>{t.destino_nome}</td>
                    <td>{dataHora(t.enviado_em)}</td>
                    <td className="num text-right">{t.itens?.[0]?.count ?? '—'}</td>
                    <td className="num text-right">{dinheiro(t.valor_total)}</td>
                    <td>{situacao(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TelaSuspensa aberta={!!nova} titulo="Nova transferência" subtitulo="O estoque sai desta loja ao enviar" onFechar={() => setNova(null)} largura="max-w-3xl"
        rodape={<>
          <Botao variante="secundario" onClick={() => setNova(null)}>Cancelar</Botao>
          <Botao onClick={enviar} carregando={enviando}>Enviar transferência</Botao>
        </>}>
        {nova && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Filial de destino"><Lista valor={nova.destino} opcoes={filiais.map((f) => ({ valor: f.id, texto: f.nome }))} onMudar={(v) => setNova((n) => ({ ...n, destino: v }))} /></Campo>
              <Campo rotulo="Observação"><input className="campo" value={nova.observacao} onChange={(e) => setNova((n) => ({ ...n, observacao: e.target.value }))} placeholder="Ex.: reposição semanal" /></Campo>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">Produtos</p>
                <Botao variante="secundario" icone="mais" className="py-1" onClick={() => setBuscando(true)}>Incluir produto</Botao>
              </div>
              {nova.itens.length === 0 ? <p className="text-sm text-tinta-400">Nenhum produto incluído.</p> : (
                <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
                  <thead><tr><th>Produto</th><th className="text-right">Em estoque</th><th>Lote</th><th className="text-right">Quantidade</th><th /></tr></thead>
                  <tbody>
                    {nova.itens.map((i, k) => (
                      <tr key={i.produto_id}>
                        <td>{i.descricao}</td>
                        <td className="num text-right">{qtd(i.estoque)} {i.unidade}</td>
                        <td className="w-52">{i.lotes.length ? <Lista valor={i.lote_id} opcoes={[{ valor: null, texto: 'Sem lote' }, ...i.lotes.map((l) => ({ valor: l.id, texto: `${l.numero}, val. ${dataBR(l.validade)} (${qtd(l.quantidade)})` }))]} onMudar={(v) => mudarItem(k, 'lote_id', v)} /> : <span className="text-tinta-400">—</span>}</td>
                        <td className="text-right"><input className="campo num ml-auto w-24 py-1 text-right" inputMode="decimal" value={i.quantidade} onChange={(e) => mudarItem(k, 'quantidade', e.target.value)} aria-label="Quantidade" /></td>
                        <td className="text-right"><button className="rounded p-1 text-tinta-400 hover:text-rubro-600" aria-label={`Remover ${i.descricao}`} onClick={() => setNova((n) => ({ ...n, itens: n.itens.filter((_, j) => j !== k) }))}><Icone nome="fechar" className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p className="text-sm text-tinta-400">Entre CNPJs diferentes, o transporte exige NF-e de transferência (CFOP 5.152). A emissão entra com o módulo de NF-e.</p>
          </div>
        )}
      </TelaSuspensa>

      <TelaSuspensa aberta={!!detalhe} titulo={detalhe ? `Transferência nº ${detalhe.numero}` : ''} subtitulo={detalhe ? `${detalhe.origem_nome} para ${detalhe.destino_nome}, enviada em ${dataHora(detalhe.enviado_em)}` : ''} onFechar={() => setDetalhe(null)} largura="max-w-3xl"
        rodape={detalhe && <>
          {detalhe.status === 'enviada' && detalhe.empresa_origem_id === minha && <Botao variante="secundario" className="mr-auto" onClick={() => setCancelar(detalhe)}>Cancelar transferência</Botao>}
          {detalhe.status === 'enviada' && detalhe.empresa_destino_id === minha
            ? <><Botao variante="secundario" onClick={() => setDetalhe(null)}>Cancelar</Botao><Botao icone="ok" onClick={receber} carregando={enviando}>Confirmar recebimento</Botao></>
            : <Botao variante="secundario" onClick={() => setDetalhe(null)}>Fechar</Botao>}
        </>}>
        {detalhe && (
          <div className="space-y-3">
            {detalhe.status === 'enviada' && detalhe.empresa_destino_id === minha && (
              <p className="rounded-lg bg-ambar-50 px-3 py-2 text-sm dark:bg-ambar-600/10">Confira a mercadoria e corrija a quantidade do que chegou diferente. Produtos sem cadastro nesta loja são cadastrados com os dados da origem (vínculo pelo código de barras).</p>
            )}
            <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
              <thead><tr><th>Produto</th><th>Lote</th><th className="text-right">Enviado</th><th className="text-right">Recebido</th></tr></thead>
              <tbody>
                {detalhe.linhas.map((l, k) => {
                  const div = detalhe.status === 'recebida' && Number(l.quantidade_recebida) !== Number(l.quantidade)
                  return (
                    <tr key={l.id}>
                      <td>{l.descricao}<span className="block text-xs text-tinta-400">{l.ean || 'sem código de barras'}</span></td>
                      <td>{l.lote_numero ? <>{l.lote_numero}<span className="block text-xs text-tinta-400">val. {dataBR(l.validade)}</span></> : '—'}</td>
                      <td className="num text-right">{qtd(l.quantidade)} {l.unidade}</td>
                      <td className="text-right">
                        {detalhe.status === 'enviada' && detalhe.empresa_destino_id === minha
                          ? <input className="campo num ml-auto w-24 py-1 text-right" inputMode="decimal" value={l.recebido} onChange={(e) => setDetalhe((d) => ({ ...d, linhas: d.linhas.map((x, j) => (j === k ? { ...x, recebido: e.target.value } : x)) }))} aria-label={`Recebido de ${l.descricao}`} />
                          : <span className={`num ${div ? 'font-semibold text-ambar-600 dark:text-ambar-300' : ''}`}>{qtd(l.quantidade_recebida)}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {detalhe.observacao && <p className="text-sm text-tinta-400">Observação: {detalhe.observacao}</p>}
            <p className="flex justify-between text-sm"><span className="text-tinta-400">Valor pelo custo</span><strong className="num">{dinheiro(detalhe.valor_total)}</strong></p>
          </div>
        )}
      </TelaSuspensa>

      {buscando && <BuscaProduto titulo="Incluir produto" semKits onFechar={() => setBuscando(false)} onEscolher={incluir} />}
      <Confirmacao aberta={!!cancelar} titulo="Cancelar transferência" mensagem="A mercadoria volta para o estoque desta loja. Só é possível antes de a filial confirmar o recebimento." textoConfirmar="Cancelar transferência" variante="perigo" onCancelar={() => setCancelar(null)} onConfirmar={confirmarCancelar} />
    </>
  )
}
