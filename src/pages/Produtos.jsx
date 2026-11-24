import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { dinheiro, lerNumero } from '../lib/formato.js'
import { Botao, Cabecalho, Campo, Etiqueta, Icone, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'
import { BuscaProduto } from '../components/BuscaProduto.jsx'
import { JanelaEtiquetas } from '../components/Etiquetas.jsx'
import { GerenciarGrade } from '../components/Grade.jsx'
import { precoSugerido, markupDeMargem } from '../lib/carrinho.js'

export const LISTAS_CONTROLE = [
  { valor: 'A1', texto: 'A1: entorpecentes (notificação A)' }, { valor: 'A2', texto: 'A2: entorpecentes de uso permitido (notificação A)' },
  { valor: 'A3', texto: 'A3: psicotrópicos (notificação A)' }, { valor: 'B1', texto: 'B1: psicotrópicos (notificação B)' },
  { valor: 'B2', texto: 'B2: psicotrópicos anorexígenos (notificação B2)' }, { valor: 'C1', texto: 'C1: outras de controle especial (receita de controle especial)' },
  { valor: 'C2', texto: 'C2: retinoides (notificação especial)' }, { valor: 'C3', texto: 'C3: imunossupressores (notificação especial)' },
  { valor: 'C4', texto: 'C4: antirretrovirais (receita de controle especial)' }, { valor: 'C5', texto: 'C5: anabolizantes (receita de controle especial)' },
  { valor: 'AM', texto: 'Antimicrobiano (receita em 2 vias, validade de 10 dias)' },
]

const VAZIO = {
  descricao: '', codigo: '', ean: '', unidade: 'UN', preco_venda: '', preco_custo: '', estoque_minimo: '',
  categoria_id: null, ncm: '', cest: '', cfop: '5102', origem: 0, csosn: '102', cst_icms: '', controla_lote: false,
  registro_ms: '', controlado: false, lista_controle: null, codigo_balanca: '', ativo: true, markup: '', e_kit: false, componentes: [],
}
const UNIDADES = ['UN', 'CX', 'FR', 'CP', 'KG', 'G', 'L', 'ML', 'M', 'PCT', 'PAR'].map((u) => ({ valor: u, texto: u }))
const ORIGENS = [
  { valor: 0, texto: '0 – Nacional' },
  { valor: 1, texto: '1 – Estrangeira, importação direta' },
  { valor: 2, texto: '2 – Estrangeira, mercado interno' },
]
const TIPOS_ESTOQUE = [
  { valor: 'entrada', texto: 'Entrada' },
  { valor: 'ajuste', texto: 'Ajuste (+ ou −)' },
  { valor: 'perda', texto: 'Perda, avaria ou vencimento' },
]
const FILTROS = [
  { id: 'todos', nome: 'Todos' },
  { id: 'baixo', nome: 'Estoque baixo' },
  { id: 'sem_ncm', nome: 'Sem NCM' },
  { id: 'inativos', nome: 'Inativos' },
]
const ncmValido = (p) => /^\d{8}$/.test(p.ncm ?? '')
const estoqueBaixo = (p) => p.ativo && !p.e_kit && !p.e_grade && Number(p.estoque_atual) <= Number(p.estoque_minimo)

export default function Produtos() {
  const perfil = useSessao()
  const avisar = useAviso()
  const pode = perfil.papel !== 'operador'
  const farmacia = perfil.empresa.segmento === 'farmacia'
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [lista, setLista] = useState(null)
  const [categorias, setCategorias] = useState([])
  const [edicao, setEdicao] = useState(null)
  const [estoque, setEstoque] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [selecionados, setSelecionados] = useState({})
  const [etiquetas, setEtiquetas] = useState(null)
  const [lotes, setLotes] = useState(null)
  const [buscaComp, setBuscaComp] = useState(false)
  const [grade, setGrade] = useState(null)
  const [markupPadrao, setMarkupPadrao] = useState(30)

  const carregar = async () => {
    const { data, error } = await supabase.from('produtos').select('*').order('descricao').limit(2000)
    if (error) avisar(mensagemErro(error), 'erro')
    else setLista(data)
  }
  useEffect(() => {
    carregar()
    supabase.from('categorias').select('id, nome').eq('ativo', true).order('nome').then(({ data }) => setCategorias(data ?? []))
    supabase.from('empresas').select('markup_padrao').single().then(({ data }) => data && setMarkupPadrao(Number(data.markup_padrao)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const resumo = useMemo(() => {
    const ativos = (lista ?? []).filter((p) => p.ativo)
    return {
      ativos: ativos.length,
      baixo: ativos.filter(estoqueBaixo).length,
      semNcm: ativos.filter((p) => !ncmValido(p)).length,
      valorCusto: ativos.reduce((s, p) => s + Math.max(0, Number(p.estoque_atual)) * Number(p.preco_custo), 0),
      valorVenda: ativos.reduce((s, p) => s + Math.max(0, Number(p.estoque_atual)) * Number(p.preco_venda), 0),
    }
  }, [lista])

  const estoqueGrade = useMemo(() => {
    const m = {}
    for (const p of lista ?? []) if (p.produto_pai_id) m[p.produto_pai_id] = (m[p.produto_pai_id] ?? 0) + Number(p.estoque_atual)
    return m
  }, [lista])

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (lista ?? []).filter((p) => {
      if (p.produto_pai_id && !termo && filtro !== 'baixo') return false
      if (filtro === 'inativos' ? p.ativo : !p.ativo) return false
      if (filtro === 'baixo' && !estoqueBaixo(p)) return false
      if (filtro === 'sem_ncm' && ncmValido(p)) return false
      if (!termo) return true
      return p.descricao.toLowerCase().includes(termo) || p.ean === termo || p.codigo === termo
    })
  }, [lista, busca, filtro])

  const salvar = async () => {
    const p = { ...edicao }
    if (!p.descricao.trim()) { avisar('Informe a descrição.', 'erro'); return }
    for (const c of ['preco_venda', 'preco_custo', 'estoque_minimo']) {
      p[c] = lerNumero(p[c])
      if (Number.isNaN(p[c]) || p[c] < 0) { avisar('Valores numéricos inválidos.', 'erro'); return }
    }
    for (const c of ['codigo', 'ean', 'ncm', 'cest', 'cst_icms', 'registro_ms', 'codigo_balanca']) p[c] = p[c]?.trim() || null
    if (!p.controlado) p.lista_controle = null
    if (p.controlado && farmacia && !p.lista_controle) { avisar('Informe a lista do controlado (Portaria 344 ou antimicrobiano).', 'erro'); return }
    if (p.controlado && !p.controla_lote) p.controla_lote = true
    if (p.ncm && !/^\d{8}$/.test(p.ncm)) { avisar('O NCM deve ter 8 números.', 'erro'); return }
    p.markup = p.markup === '' || p.markup == null ? null : lerNumero(p.markup)
    if (p.markup != null && (Number.isNaN(p.markup) || p.markup < 0)) { avisar('Markup inválido.', 'erro'); return }
    const componentes = p.componentes ?? []
    if (p.e_kit && !componentes.length) { avisar('Inclua os produtos que compõem o kit.', 'erro'); return }
    if (p.e_kit) p.controla_lote = false
    delete p.estoque_atual; delete p.empresa_id; delete p.criado_em; delete p.atualizado_em; delete p.componentes; delete p.e_grade; delete p.produto_pai_id; delete p.atributos
    setEnviando(true)
    const r = p.id ? await supabase.from('produtos').update(p).eq('id', p.id).select('id').single() : await supabase.from('produtos').insert(p).select('id').single()
    if (r.error) {
      setEnviando(false)
      avisar(r.error.code === '23505' ? 'Já existe produto com este código ou código de barras.' : mensagemErro(r.error), 'erro')
      return
    }
    if (p.e_kit || p.id) {
      await supabase.from('kit_itens').delete().eq('kit_id', r.data.id)
      if (p.e_kit) {
        const { error } = await supabase.from('kit_itens').insert(componentes.map((c) => ({ kit_id: r.data.id, produto_id: c.produto_id, quantidade: lerNumero(c.quantidade) || 1 })))
        if (error) { setEnviando(false); avisar(mensagemErro(error), 'erro'); return }
      }
    }
    setEnviando(false)
    avisar('Produto salvo.')
    setEdicao(null)
    carregar()
  }

  const lancar = async () => {
    const q = lerNumero(estoque.quantidade)
    if (Number.isNaN(q) || q === 0 || (estoque.tipo !== 'ajuste' && q < 0)) { avisar('Quantidade inválida.', 'erro'); return }
    setEnviando(true)
    const { error } = await supabase.rpc('lancar_estoque', {
      p_produto: estoque.produto.id, p_tipo: estoque.tipo, p_quantidade: q,
      p_custo: estoque.custo ? lerNumero(estoque.custo) : null, p_obs: estoque.obs || null,
      p_lote_numero: estoque.lote?.trim() || null, p_validade: estoque.validade || null,
    })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Estoque atualizado.')
    setEstoque(null)
    carregar()
  }

  const m = (c) => (e) => setEdicao((x) => ({ ...x, [c]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const margem = (p) => (Number(p.preco_venda) > 0 && Number(p.preco_custo) > 0 ? ((Number(p.preco_venda) - Number(p.preco_custo)) / Number(p.preco_venda)) * 100 : null)
  const margemEdicao = edicao ? margem({ preco_venda: lerNumero(edicao.preco_venda), preco_custo: lerNumero(edicao.preco_custo) }) : null
  const markupEdicao = edicao ? (edicao.markup === '' || edicao.markup == null ? markupPadrao : lerNumero(edicao.markup)) : null
  const sugeridoEdicao = edicao ? precoSugerido(lerNumero(edicao.preco_custo), markupEdicao) : null
  const qtdSel = Object.values(selecionados).filter(Boolean).length

  const editar = async (p) => {
    let componentes = []
    if (p.e_kit) {
      const { data } = await supabase.from('kit_itens').select('produto_id, quantidade, produto:produtos!kit_itens_produto_id_fkey(descricao, unidade, preco_venda)').eq('kit_id', p.id)
      componentes = (data ?? []).map((c) => ({ produto_id: c.produto_id, descricao: c.produto?.descricao, unidade: c.produto?.unidade, preco_venda: c.produto?.preco_venda, quantidade: String(Number(c.quantidade)) }))
    }
    setEdicao({ ...VAZIO, ...p, componentes, markup: p.markup == null ? '' : String(p.markup).replace('.', ','), preco_venda: String(p.preco_venda).replace('.', ','), preco_custo: String(Number(p.preco_custo)).replace('.', ','), estoque_minimo: String(Number(p.estoque_minimo)) })
  }

  const verLotes = async (p) => {
    const { data } = await supabase.from('lotes').select('*').eq('produto_id', p.id).order('validade', { nullsFirst: false })
    setLotes({ produto: p, lista: data ?? [] })
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Produtos" descricao="Cadastro, preços, estoque e dados fiscais">
        {qtdSel > 0 && <Botao variante="secundario" icone="impressora" onClick={() => setEtiquetas((lista ?? []).filter((p) => selecionados[p.id]))}>Etiquetas ({qtdSel})</Botao>}
        {pode && <Botao icone="mais" onClick={() => setEdicao({ ...VAZIO })}>Novo produto</Botao>}
      </Cabecalho>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Produtos ativos" icone="produtos" valor={resumo.ativos} detalhe={`${categorias.length} categorias`} />
        <Indicador titulo="Estoque baixo" icone="estoque" valor={resumo.baixo} tom={resumo.baixo ? 'alerta' : 'neutro'} detalhe="No mínimo ou abaixo dele" />
        <Indicador titulo="Sem NCM válido" icone="nota" valor={resumo.semNcm} tom={resumo.semNcm ? 'critico' : 'neutro'} detalhe="Impedem a emissão da NFC-e" />
        <Indicador titulo="Estoque a preço de custo" icone="dinheiro" valor={dinheiro(resumo.valorCusto)} detalhe={`${dinheiro(resumo.valorVenda)} a preço de venda`} />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-papel-200 p-3 dark:border-noite-700">
          <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-papel-300 px-3 dark:border-noite-600">
            <Icone nome="busca" className="h-4 w-4 text-tinta-400" />
            <input className="w-full bg-transparent py-2 outline-none placeholder:text-tinta-300" placeholder="Buscar por descrição, código ou código de barras" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar produtos" />
          </div>
          <div className="flex abas" role="tablist">
            {FILTROS.map((f) => (
              <button key={f.id} role="tab" aria-selected={filtro === f.id} onClick={() => setFiltro(f.id)}
                className={`aba ${filtro === f.id ? 'aba-ativa' : ''}`}>
                {f.nome}
              </button>
            ))}
          </div>
        </div>

        {lista === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : visiveis.length === 0 ? (
          <Vazio icone="produtos" titulo={lista.length ? 'Nenhum produto neste filtro' : 'Nenhum produto cadastrado'} texto={lista.length ? 'Ajuste a busca ou escolha outro filtro.' : 'Cadastre os produtos com código de barras, preço e NCM para vender e emitir NFC-e.'}>
            {!lista.length && pode && <Botao icone="mais" onClick={() => setEdicao({ ...VAZIO })}>Cadastrar o primeiro produto</Botao>}
          </Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead>
                <tr><th className="w-10"><input type="checkbox" className="h-4 w-4 accent-caixa-600" aria-label="Selecionar todos" checked={visiveis.length > 0 && visiveis.every((p) => selecionados[p.id])} onChange={(e) => setSelecionados((x) => ({ ...x, ...Object.fromEntries(visiveis.map((p) => [p.id, e.target.checked])) }))} /></th><th>Produto</th><th>Código de barras</th><th className="text-right">Custo</th><th className="text-right">Venda</th><th className="text-right">Margem</th><th className="text-right">Estoque</th><th>Situação</th><th /></tr>
              </thead>
              <tbody>
                {visiveis.map((p) => {
                  const mg = margem(p)
                  return (
                    <tr key={p.id} className={p.ativo ? '' : 'opacity-60'}>
                      <td><input type="checkbox" className="h-4 w-4 accent-caixa-600" aria-label={`Selecionar ${p.descricao}`} checked={!!selecionados[p.id]} onChange={(e) => setSelecionados((x) => ({ ...x, [p.id]: e.target.checked }))} /></td>
                      <td className="max-w-[320px]">
                        <span className="block truncate font-medium">{p.descricao}</span>
                        <span className="text-xs text-tinta-400">{p.codigo ? `Código ${p.codigo}` : 'Sem código interno'}{p.ncm ? `, NCM ${p.ncm}` : ''}</span>
                      </td>
                      <td className="num text-tinta-600 dark:text-tinta-300">{p.ean || '—'}</td>
                      <td className="num text-right text-tinta-600 dark:text-tinta-300">{dinheiro(p.preco_custo)}</td>
                      <td className="num text-right font-semibold">{dinheiro(p.preco_venda)}</td>
                      <td className={`num text-right ${mg === null ? 'text-tinta-300' : mg < 15 ? 'text-ambar-600 dark:text-ambar-300' : 'text-caixa-600 dark:text-caixa-300'}`}>{mg === null ? '—' : `${mg.toFixed(1).replace('.', ',')}%`}</td>
                      <td className={`num text-right font-semibold ${p.e_kit || p.e_grade ? '' : Number(p.estoque_atual) <= 0 ? 'text-rubro-600' : estoqueBaixo(p) ? 'text-ambar-600' : ''}`}>{p.e_grade ? <>{estoqueGrade[p.id] ?? 0} <span className="font-sans text-xs font-normal text-tinta-400">na grade</span></> : p.e_kit ? <span className="font-sans text-sm font-normal text-tinta-400">pelos componentes</span> : <>{Number(p.estoque_atual)} <span className="font-sans text-xs font-normal text-tinta-400">{p.unidade}</span></>}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {!p.ativo && <Etiqueta>Inativo</Etiqueta>}
                          {p.ativo && !ncmValido(p) && <Etiqueta tom="critico">Sem NCM</Etiqueta>}
                          {estoqueBaixo(p) && <Etiqueta tom="alerta">Repor</Etiqueta>}
                          {p.controlado && <Etiqueta tom="critico">Controlado</Etiqueta>}
                          {p.e_kit && <Etiqueta>Kit</Etiqueta>}
                          {p.e_grade && <Etiqueta>Grade</Etiqueta>}
                          {p.produto_pai_id && <Etiqueta>Variação</Etiqueta>}
                          {p.controla_lote && <Etiqueta>Lote</Etiqueta>}
                          {p.ativo && ncmValido(p) && !estoqueBaixo(p) && !p.controlado && !p.e_kit && !p.e_grade && !p.produto_pai_id && !p.controla_lote && <Etiqueta tom="positivo">Regular</Etiqueta>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {p.controla_lote && <Botao variante="discreto" className="px-2 py-1" onClick={() => verLotes(p)}>Lotes</Botao>}
                        {pode && p.e_grade && <Botao variante="discreto" className="px-2 py-1" onClick={() => setGrade(p)}>Grade</Botao>}
                        {pode && <>
                          {!p.e_kit && !p.e_grade && <Botao variante="discreto" className="px-2 py-1" onClick={() => setEstoque({ produto: p, tipo: 'entrada', quantidade: '', custo: '', obs: '', lote: '', validade: '' })}>Estoque</Botao>}
                          <Botao variante="discreto" className="px-2 py-1" onClick={() => editar(p)}>Editar</Botao>
                        </>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="border-t border-papel-200 px-4 py-2 text-sm text-tinta-400 dark:border-noite-700">{visiveis.length} de {lista.length} produtos</p>
          </div>
        )}
      </div>

      <TelaSuspensa
        aberta={!!edicao}
        titulo={edicao?.id ? 'Editar produto' : 'Novo produto'}
        subtitulo={edicao?.id ? edicao.descricao : 'Preencha os dados de venda e os dados fiscais exigidos pela NFC-e'}
        onFechar={() => setEdicao(null)}
        largura="max-w-3xl"
        rodape={<>
          <Botao variante="secundario" onClick={() => setEdicao(null)}>Cancelar</Botao>
          <Botao onClick={salvar} carregando={enviando}>Salvar produto</Botao>
        </>}
      >
        {edicao && (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-4"><Campo rotulo="Descrição"><input className="campo" value={edicao.descricao} onChange={m('descricao')} autoFocus /></Campo></div>
              <Campo rotulo="Código interno"><input className="campo" value={edicao.codigo ?? ''} onChange={m('codigo')} /></Campo>
              <div className="sm:col-span-2"><Campo rotulo="Código de barras (GTIN/EAN)"><input className="campo num" inputMode="numeric" value={edicao.ean ?? ''} onChange={m('ean')} /></Campo></div>
              <Campo rotulo="Unidade"><Lista valor={edicao.unidade} opcoes={UNIDADES} onMudar={(v) => setEdicao((x) => ({ ...x, unidade: v }))} /></Campo>
              <Campo rotulo="Estoque mínimo"><input className="campo num" inputMode="decimal" value={edicao.estoque_minimo} onChange={m('estoque_minimo')} disabled={edicao.e_kit} /></Campo>
              <div className="sm:col-span-2"><Campo rotulo="Categoria"><Lista valor={edicao.categoria_id} opcoes={[{ valor: null, texto: 'Sem categoria' }, ...categorias.map((c) => ({ valor: c.id, texto: c.nome }))]} onMudar={(v) => setEdicao((x) => ({ ...x, categoria_id: v }))} /></Campo></div>
            </div>

            <fieldset className="rounded-xl border border-papel-200 p-4 dark:border-noite-700">
              <legend className="px-1 text-sm font-semibold">Formação de preço</legend>
              <div className="grid items-start gap-3 sm:grid-cols-4">
                <Campo rotulo="Preço de custo (R$)"><input className="campo num" inputMode="decimal" value={edicao.preco_custo} onChange={m('preco_custo')} /></Campo>
                <Campo rotulo="Markup (%)" ajuda={edicao.markup === '' ? `Vazio usa o padrão da empresa (${String(markupPadrao).replace('.', ',')}%)` : undefined}><input className="campo num" inputMode="decimal" value={edicao.markup} onChange={m('markup')} placeholder={String(markupPadrao).replace('.', ',')} /></Campo>
                <Campo rotulo="Preço sugerido" ajuda={sugeridoEdicao ? <button type="button" className="font-semibold text-caixa-600 hover:underline dark:text-caixa-300" onClick={() => setEdicao((x) => ({ ...x, preco_venda: String(sugeridoEdicao).replace('.', ',') }))}>Usar este preço</button> : 'Informe o custo'}>
                  <div className="campo num bg-papel dark:bg-noite-800">{sugeridoEdicao ? dinheiro(sugeridoEdicao) : '—'}</div>
                </Campo>
                <Campo rotulo="Preço de venda (R$)" ajuda={margemEdicao === null ? undefined : `Margem de ${margemEdicao.toFixed(1).replace('.', ',')}% sobre a venda`}><input className="campo num" inputMode="decimal" value={edicao.preco_venda} onChange={m('preco_venda')} /></Campo>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <span className="text-tinta-400">Margem desejada:</span>
                {[20, 25, 30, 35, 40, 50].map((mg) => (
                  <button key={mg} type="button" className="rounded-md border border-papel-300 px-2 py-0.5 hover:border-caixa-500 dark:border-noite-600"
                    onClick={() => setEdicao((x) => ({ ...x, markup: String(Math.round(markupDeMargem(mg) * 100) / 100).replace('.', ',') }))}>{mg}%</button>
                ))}
              </div>
            </fieldset>

            {edicao.id && !edicao.e_kit && !edicao.produto_pai_id && (edicao.e_grade || Number(edicao.estoque_atual) === 0) && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-papel-200 p-4 dark:border-noite-700">
                <span className="text-sm">{edicao.e_grade ? 'Este produto é o modelo de uma grade de tamanho e cor.' : 'Vende em tamanhos ou cores diferentes? Transforme em grade: cada combinação vira um item com estoque e código próprios.'}</span>
                <Botao variante="secundario" onClick={() => { const p = edicao; setEdicao(null); setGrade(p) }}>{edicao.e_grade ? 'Abrir grade' : 'Criar grade'}</Botao>
              </div>
            )}

            <fieldset className="rounded-xl border border-papel-200 p-4 dark:border-noite-700">
              <legend className="px-1 text-sm font-semibold">Kit</legend>
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={edicao.e_kit} onChange={m('e_kit')} disabled={edicao.e_grade || !!edicao.produto_pai_id || (!!edicao.id && Number(edicao.estoque_atual) !== 0 && !edicao.e_kit)} /> Este produto é um kit (a venda baixa o estoque dos componentes)</label>
              {edicao.e_kit && (
                <div className="mt-3 space-y-2">
                  {edicao.componentes.map((c, i) => (
                    <div key={c.produto_id} className="flex items-center gap-2">
                      <input className="campo num w-20 py-1 text-right" inputMode="decimal" value={c.quantidade} aria-label={`Quantidade de ${c.descricao}`}
                        onChange={(e) => setEdicao((x) => ({ ...x, componentes: x.componentes.map((y, j) => (j === i ? { ...y, quantidade: e.target.value } : y)) }))} />
                      <span className="flex-1 truncate">{c.unidade} de {c.descricao}</span>
                      <span className="num text-sm text-tinta-400">{dinheiro((lerNumero(c.quantidade) || 0) * Number(c.preco_venda ?? 0))}</span>
                      <button type="button" className="rounded p-1 text-tinta-400 hover:text-rubro-600" aria-label={`Remover ${c.descricao}`} onClick={() => setEdicao((x) => ({ ...x, componentes: x.componentes.filter((_, j) => j !== i) }))}><Icone nome="fechar" className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <Botao variante="secundario" icone="mais" className="py-1" onClick={() => setBuscaComp(true)}>Incluir componente</Botao>
                    {edicao.componentes.length > 0 && <span className="text-sm text-tinta-400">Soma dos componentes: <span className="num font-semibold">{dinheiro(edicao.componentes.reduce((s, c) => s + (lerNumero(c.quantidade) || 0) * Number(c.preco_venda ?? 0), 0))}</span></span>}
                  </div>
                </div>
              )}
            </fieldset>

            <fieldset className="rounded-xl border border-papel-200 p-4 dark:border-noite-700">
              <legend className="px-1 text-sm font-semibold">Dados fiscais da NFC-e</legend>
              <div className="grid gap-3 sm:grid-cols-4">
                <Campo rotulo="NCM" ajuda="8 números, obrigatório"><input className="campo num" inputMode="numeric" maxLength={8} value={edicao.ncm ?? ''} onChange={m('ncm')} /></Campo>
                <Campo rotulo="CEST"><input className="campo num" inputMode="numeric" maxLength={7} value={edicao.cest ?? ''} onChange={m('cest')} /></Campo>
                <Campo rotulo="CFOP"><input className="campo num" inputMode="numeric" maxLength={4} value={edicao.cfop ?? ''} onChange={m('cfop')} /></Campo>
                <Campo rotulo="CSOSN" ajuda="Simples Nacional"><input className="campo num" inputMode="numeric" maxLength={3} value={edicao.csosn ?? ''} onChange={m('csosn')} /></Campo>
                <div className="sm:col-span-2"><Campo rotulo="Origem da mercadoria"><Lista valor={Number(edicao.origem)} opcoes={ORIGENS} onMudar={(v) => setEdicao((x) => ({ ...x, origem: v }))} /></Campo></div>
                <Campo rotulo="CST do ICMS" ajuda="Regime normal"><input className="campo num" inputMode="numeric" maxLength={3} value={edicao.cst_icms ?? ''} onChange={m('cst_icms')} /></Campo>
                <Campo rotulo="Código na balança" ajuda="Só para vendidos por peso"><input className="campo num" inputMode="numeric" maxLength={6} value={edicao.codigo_balanca ?? ''} onChange={m('codigo_balanca')} /></Campo>
              </div>
            </fieldset>

            {farmacia && (
              <fieldset className="rounded-xl border border-papel-200 p-4 dark:border-noite-700">
                <legend className="px-1 text-sm font-semibold">Dados farmacêuticos</legend>
                <div className="grid items-end gap-3 sm:grid-cols-3">
                  <Campo rotulo="Registro no Ministério da Saúde"><input className="campo num" value={edicao.registro_ms ?? ''} onChange={m('registro_ms')} /></Campo>
                  <label className="flex items-center gap-2 pb-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={edicao.controlado} onChange={m('controlado')} /> Medicamento sujeito a controle especial</label>
                  <label className="flex items-center gap-2 pb-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={edicao.controla_lote} onChange={m('controla_lote')} /> Controla lote e validade</label>
                  {edicao.controlado && <div className="sm:col-span-2"><Campo rotulo="Lista do controle" ajuda="Define o tipo de receita exigido no caixa"><Lista valor={edicao.lista_controle ?? null} opcoes={LISTAS_CONTROLE} onMudar={(v) => setEdicao((x) => ({ ...x, lista_controle: v }))} /></Campo></div>}
                </div>
              </fieldset>
            )}

            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={edicao.ativo} onChange={m('ativo')} /> Produto ativo para venda</label>
          </div>
        )}
      </TelaSuspensa>

      <TelaSuspensa
        aberta={!!estoque}
        titulo="Movimentar estoque"
        subtitulo={estoque ? `${estoque.produto.descricao}, saldo atual ${Number(estoque.produto.estoque_atual)} ${estoque.produto.unidade}` : ''}
        onFechar={() => setEstoque(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setEstoque(null)}>Cancelar</Botao>
          <Botao onClick={lancar} carregando={enviando}>Registrar movimento</Botao>
        </>}
      >
        {estoque && (
          <div className="space-y-4">
            <Campo rotulo="Tipo de movimento"><Lista valor={estoque.tipo} opcoes={TIPOS_ESTOQUE} onMudar={(v) => setEstoque((x) => ({ ...x, tipo: v }))} /></Campo>
            <Campo rotulo="Quantidade" ajuda={estoque.tipo === 'ajuste' ? 'Use número negativo para reduzir o saldo.' : undefined}><input className="campo num" inputMode="decimal" value={estoque.quantidade} onChange={(e) => setEstoque((x) => ({ ...x, quantidade: e.target.value }))} autoFocus /></Campo>
            {estoque.tipo === 'entrada' && (
              <Campo rotulo="Custo unitário (R$)"><input className="campo num" inputMode="decimal" value={estoque.custo} onChange={(e) => setEstoque((x) => ({ ...x, custo: e.target.value }))} /></Campo>
            )}
            {estoque.produto.controla_lote && estoque.tipo === 'entrada' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Lote"><input className="campo" value={estoque.lote} onChange={(e) => setEstoque((x) => ({ ...x, lote: e.target.value }))} /></Campo>
                <Campo rotulo="Validade"><input type="date" className="campo" value={estoque.validade} onChange={(e) => setEstoque((x) => ({ ...x, validade: e.target.value }))} /></Campo>
              </div>
            )}
            <Campo rotulo="Observação"><input className="campo" value={estoque.obs} onChange={(e) => setEstoque((x) => ({ ...x, obs: e.target.value }))} placeholder="Ex.: nota fiscal 1234" /></Campo>
          </div>
        )}
      </TelaSuspensa>

      {buscaComp && (
        <BuscaProduto titulo="Incluir componente do kit" semKits onFechar={() => setBuscaComp(false)}
          onEscolher={(p) => {
            if (p.id === edicao.id) { avisar('O kit não pode conter ele mesmo.', 'erro'); return }
            setEdicao((x) => ({ ...x, componentes: x.componentes.some((c) => c.produto_id === p.id) ? x.componentes : [...x.componentes, { produto_id: p.id, descricao: p.descricao, unidade: p.unidade, preco_venda: p.preco_venda, quantidade: '1' }] }))
            setBuscaComp(false)
          }} />
      )}

      {grade && <GerenciarGrade produto={grade} onFechar={() => setGrade(null)} onAlterado={carregar} />}

      {etiquetas && <JanelaEtiquetas produtos={etiquetas} onFechar={() => { setEtiquetas(null); setSelecionados({}) }} />}

      <TelaSuspensa aberta={!!lotes} titulo="Lotes e validades" subtitulo={lotes?.produto.descricao} onFechar={() => setLotes(null)} largura="max-w-2xl"
        rodape={<Botao variante="secundario" onClick={() => setLotes(null)}>Fechar</Botao>}>
        {lotes && (lotes.lista.length === 0 ? <Vazio icone="estoque" titulo="Nenhum lote registrado" texto="Os lotes entram pela nota de compra (XML) ou pela entrada manual de estoque." /> : (
          <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
            <thead><tr><th>Lote</th><th>Validade</th><th className="text-right">Saldo</th><th>Situação</th></tr></thead>
            <tbody>
              {lotes.lista.map((l) => {
                const hoje = new Date().toISOString().slice(0, 10)
                const em30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)
                return (
                  <tr key={l.id} className={Number(l.quantidade) <= 0 ? 'opacity-50' : ''}>
                    <td className="font-medium">{l.numero}</td>
                    <td>{l.validade ? new Date(`${l.validade}T12:00:00`).toLocaleDateString('pt-BR') : 'Não informada'}</td>
                    <td className="num text-right">{Number(l.quantidade)} {lotes.produto.unidade}</td>
                    <td>{Number(l.quantidade) <= 0 ? <Etiqueta>Esgotado</Etiqueta> : l.validade && l.validade < hoje ? <Etiqueta tom="critico">Vencido</Etiqueta> : l.validade && l.validade <= em30 ? <Etiqueta tom="alerta">Vence em até 30 dias</Etiqueta> : <Etiqueta tom="positivo">Válido</Etiqueta>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ))}
      </TelaSuspensa>
    </div>
  )
}
