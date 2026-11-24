import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { dinheiro, lerNumero } from '../lib/formato.js'
import { Botao, Cabecalho, Campo, Confirmacao, Etiqueta, Icone, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'
import { BuscaProduto } from '../components/BuscaProduto.jsx'
import { TabelaCmed } from '../components/Cmed.jsx'

const TIPOS = [
  { valor: 'preco', texto: 'Preço promocional' },
  { valor: 'percentual', texto: 'Desconto percentual' },
  { valor: 'quantidade', texto: 'Preço por quantidade (atacado)' },
]
const nomeTipo = (t) => TIPOS.find((x) => x.valor === t)?.texto ?? t
const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const dataBR = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '')
const num = (v) => String(v ?? '').replace('.', ',')
const reais = (v) => (v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ','))

function situacao(p) {
  const hoje = hojeISO()
  if (!p.ativo) return { tom: 'neutro', texto: 'Desativada' }
  if (p.fim < hoje) return { tom: 'neutro', texto: 'Encerrada' }
  if (p.inicio > hoje) return { tom: 'alerta', texto: 'Agendada' }
  return { tom: 'positivo', texto: 'Ativa agora' }
}

const PROMO_VAZIA = () => ({ nome: '', tipo: 'preco', inicio: hojeISO(), fim: hojeISO(), percentual: '', categoria_id: null, ativo: true, itens: [] })
const TABELA_VAZIA = { nome: '', ajuste_percentual: '', ativo: true, itens: [] }

export default function Precos() {
  const perfil = useSessao()
  const avisar = useAviso()
  const gestor = perfil.papel !== 'operador'
  const farmacia = perfil.empresa.segmento === 'farmacia'
  const [aba, setAba] = useState('promocoes')
  const [promos, setPromos] = useState(null)
  const [tabelas, setTabelas] = useState([])
  const [categorias, setCategorias] = useState([])
  const [promo, setPromo] = useState(null)
  const [tabela, setTabela] = useState(null)
  const [buscando, setBuscando] = useState(null) // 'promo' | 'tabela'
  const [excluir, setExcluir] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const carregar = async () => {
    const [p, t, c] = await Promise.all([
      supabase.from('promocoes').select('*, itens:promocao_itens(id)').order('inicio', { ascending: false }),
      supabase.from('tabelas_preco').select('*, itens:tabela_preco_itens(id), clientes(count)').order('nome'),
      supabase.from('categorias').select('id, nome').eq('ativo', true).order('nome'),
    ])
    if (p.error) avisar(mensagemErro(p.error), 'erro')
    setPromos(p.data ?? []); setTabelas(t.data ?? []); setCategorias(c.data ?? [])
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const abrirPromo = async (p) => {
    const { data } = await supabase.from('promocao_itens').select('produto_id, preco, quantidade_minima, produto:produtos(descricao, preco_venda, unidade)').eq('promocao_id', p.id)
    setPromo({ ...p, percentual: num(p.percentual), itens: (data ?? []).map((i) => ({ produto_id: i.produto_id, descricao: i.produto?.descricao, preco_venda: i.produto?.preco_venda, preco: reais(i.preco), quantidade_minima: num(Number(i.quantidade_minima)) })) })
  }
  const abrirTabela = async (t) => {
    const { data } = await supabase.from('tabela_preco_itens').select('produto_id, preco, produto:produtos(descricao, preco_venda)').eq('tabela_id', t.id)
    setTabela({ ...t, ajuste_percentual: num(t.ajuste_percentual), itens: (data ?? []).map((i) => ({ produto_id: i.produto_id, descricao: i.produto?.descricao, preco_venda: i.produto?.preco_venda, preco: reais(i.preco) })) })
  }

  const salvarPromo = async () => {
    const p = promo
    if (!p.nome.trim()) { avisar('Informe o nome da promoção.', 'erro'); return }
    if (!p.inicio || !p.fim || p.fim < p.inicio) { avisar('Período inválido.', 'erro'); return }
    const percentual = p.tipo === 'percentual' ? lerNumero(p.percentual) : null
    if (p.tipo === 'percentual' && !(percentual > 0 && percentual < 100)) { avisar('Desconto deve ficar entre 0 e 100%.', 'erro'); return }
    if (p.tipo === 'percentual' && !p.categoria_id && !p.itens.length) { avisar('Escolha uma categoria ou inclua produtos.', 'erro'); return }
    if (p.tipo !== 'percentual' && !p.itens.length) { avisar('Inclua os produtos da promoção.', 'erro'); return }
    const itens = []
    for (const i of p.itens) {
      const preco = p.tipo === 'percentual' ? null : lerNumero(i.preco)
      const qmin = p.tipo === 'quantidade' ? lerNumero(i.quantidade_minima) : 1
      if (p.tipo !== 'percentual' && !(preco >= 0)) { avisar(`Preço inválido em ${i.descricao}.`, 'erro'); return }
      if (!(qmin > 0)) { avisar(`Quantidade mínima inválida em ${i.descricao}.`, 'erro'); return }
      itens.push({ produto_id: i.produto_id, preco, quantidade_minima: qmin })
    }
    const dados = { nome: p.nome.trim(), tipo: p.tipo, inicio: p.inicio, fim: p.fim, percentual, categoria_id: p.tipo === 'percentual' ? p.categoria_id : null, ativo: p.ativo }
    setEnviando(true)
    const r = p.id ? await supabase.from('promocoes').update(dados).eq('id', p.id).select('id').single() : await supabase.from('promocoes').insert(dados).select('id').single()
    if (r.error) { setEnviando(false); avisar(mensagemErro(r.error), 'erro'); return }
    await supabase.from('promocao_itens').delete().eq('promocao_id', r.data.id)
    if (itens.length) {
      const { error } = await supabase.from('promocao_itens').insert(itens.map((i) => ({ ...i, promocao_id: r.data.id })))
      if (error) { setEnviando(false); avisar(mensagemErro(error), 'erro'); return }
    }
    setEnviando(false)
    avisar('Promoção salva.'); setPromo(null); carregar()
  }

  const salvarTabela = async () => {
    const t = tabela
    if (!t.nome.trim()) { avisar('Informe o nome da tabela.', 'erro'); return }
    const ajuste = t.ajuste_percentual === '' ? 0 : lerNumero(t.ajuste_percentual)
    if (Number.isNaN(ajuste) || ajuste <= -100) { avisar('Ajuste percentual inválido.', 'erro'); return }
    const itens = []
    for (const i of t.itens) {
      const preco = lerNumero(i.preco)
      if (!(preco >= 0)) { avisar(`Preço inválido em ${i.descricao}.`, 'erro'); return }
      itens.push({ produto_id: i.produto_id, preco })
    }
    setEnviando(true)
    const dados = { nome: t.nome.trim(), ajuste_percentual: ajuste, ativo: t.ativo }
    const r = t.id ? await supabase.from('tabelas_preco').update(dados).eq('id', t.id).select('id').single() : await supabase.from('tabelas_preco').insert(dados).select('id').single()
    if (r.error) { setEnviando(false); avisar(r.error.code === '23505' ? 'Já existe tabela com este nome.' : mensagemErro(r.error), 'erro'); return }
    await supabase.from('tabela_preco_itens').delete().eq('tabela_id', r.data.id)
    if (itens.length) {
      const { error } = await supabase.from('tabela_preco_itens').insert(itens.map((i) => ({ ...i, tabela_id: r.data.id })))
      if (error) { setEnviando(false); avisar(mensagemErro(error), 'erro'); return }
    }
    setEnviando(false)
    avisar('Tabela de preço salva.'); setTabela(null); carregar()
  }

  const confirmarExclusao = async () => {
    const { error } = await supabase.from('promocoes').delete().eq('id', excluir.id)
    if (error) { avisar(error.code === '23503' ? 'Esta promoção já foi usada em vendas; desative-a em vez de excluir.' : mensagemErro(error), 'erro'); setExcluir(null); return }
    avisar('Promoção excluída.'); setExcluir(null); setPromo(null); carregar()
  }

  const incluirProduto = (p) => {
    if (buscando === 'promo') setPromo((x) => x.itens.some((i) => i.produto_id === p.id) && x.tipo !== 'quantidade' ? x : { ...x, itens: [...x.itens, { produto_id: p.id, descricao: p.descricao, preco_venda: p.preco_venda, preco: reais(p.preco_venda), quantidade_minima: '1' }] })
    else setTabela((x) => x.itens.some((i) => i.produto_id === p.id) ? x : { ...x, itens: [...x.itens, { produto_id: p.id, descricao: p.descricao, preco_venda: p.preco_venda, preco: reais(p.preco_venda) }] })
    setBuscando(null)
  }

  const ativas = (promos ?? []).filter((p) => situacao(p).texto === 'Ativa agora')
  const agendadas = (promos ?? []).filter((p) => situacao(p).texto === 'Agendada')

  const barraAbas = (
          <div className="inline-flex abas" role="tablist">
      {[['promocoes', 'Promoções'], ['tabelas', 'Tabelas de preço'], ...(farmacia && gestor ? [['cmed', 'Tabela CMED (medicamentos)']] : [])].map(([id, nome]) => (
        <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
          className={`aba ${aba === id ? 'aba-ativa' : ''}`}>{nome}</button>
      ))}
    </div>
  )

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Preços e promoções" descricao="Promoções por período, preço por quantidade e tabelas de preço para clientes">
        {gestor && aba !== 'cmed' && (aba === 'promocoes'
          ? <Botao icone="mais" onClick={() => setPromo(PROMO_VAZIA())}>Nova promoção</Botao>
          : <Botao icone="mais" onClick={() => setTabela({ ...TABELA_VAZIA, itens: [] })}>Nova tabela de preço</Botao>)}
      </Cabecalho>

      {aba === 'cmed' ? <><div className="mb-4">{barraAbas}</div><TabelaCmed /></> : <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Promoções ativas hoje" icone="dinheiro" tom={ativas.length ? 'positivo' : 'neutro'} valor={ativas.length} detalhe={ativas.slice(0, 2).map((p) => p.nome).join(', ') || 'Nenhuma no momento'} />
        <Indicador titulo="Agendadas" icone="relogio" valor={agendadas.length} detalhe="Começam nos próximos dias" />
        <Indicador titulo="Tabelas de preço" icone="vendas" valor={tabelas.filter((t) => t.ativo).length} detalhe={`${tabelas.reduce((s, t) => s + (t.clientes?.[0]?.count ?? 0), 0)} cliente(s) vinculado(s)`} />
        <Indicador titulo="Produtos em promoção" icone="produtos" valor={ativas.reduce((s, p) => s + (p.itens?.length ?? 0), 0)} detalhe="Sem contar descontos por categoria" />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        <div className="border-b border-papel-200 p-3 dark:border-noite-700">
          {barraAbas}
        </div>
        {promos === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : aba === 'promocoes' ? (
          promos.length === 0 ? <Vazio icone="dinheiro" titulo="Nenhuma promoção" texto="Crie promoções com preço especial, desconto por categoria ou preço de atacado a partir de uma quantidade. O caixa aplica sozinho." /> : (
            <div className="overflow-x-auto">
              <table className="tabela w-full text-[0.95rem]">
                <thead><tr><th>Promoção</th><th>Tipo</th><th>Período</th><th>Abrangência</th><th>Situação</th></tr></thead>
                <tbody>
                  {promos.map((p) => {
                    const s = situacao(p)
                    return (
                      <tr key={p.id} onClick={() => gestor && abrirPromo(p)} className={gestor ? 'cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40' : ''}>
                        <td className="font-medium">{p.nome}</td>
                        <td>{nomeTipo(p.tipo)}{p.tipo === 'percentual' && <span className="text-tinta-400"> de {num(p.percentual)}%</span>}</td>
                        <td>{dataBR(p.inicio)} a {dataBR(p.fim)}</td>
                        <td>{p.categoria_id ? `Categoria ${categorias.find((c) => c.id === p.categoria_id)?.nome ?? ''}` : `${p.itens?.length ?? 0} produto(s)`}</td>
                        <td><Etiqueta tom={s.tom}>{s.texto}</Etiqueta></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          tabelas.length === 0 ? <Vazio icone="vendas" titulo="Nenhuma tabela de preço" texto="Tabelas servem para atacado, revendedores ou parceiros: um ajuste percentual sobre o preço normal e, se quiser, preços fixos por produto." /> : (
            <div className="overflow-x-auto">
              <table className="tabela w-full text-[0.95rem]">
                <thead><tr><th>Tabela</th><th className="text-right">Ajuste geral</th><th className="text-right">Preços fixos</th><th className="text-right">Clientes</th><th>Situação</th></tr></thead>
                <tbody>
                  {tabelas.map((t) => (
                    <tr key={t.id} onClick={() => gestor && abrirTabela(t)} className={gestor ? 'cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40' : ''}>
                      <td className="font-medium">{t.nome}</td>
                      <td className="num text-right">{Number(t.ajuste_percentual) === 0 ? '—' : `${Number(t.ajuste_percentual) > 0 ? '+' : ''}${num(t.ajuste_percentual)}%`}</td>
                      <td className="num text-right">{t.itens?.length ?? 0}</td>
                      <td className="num text-right">{t.clientes?.[0]?.count ?? 0}</td>
                      <td>{t.ativo ? <Etiqueta tom="positivo">Ativa</Etiqueta> : <Etiqueta>Inativa</Etiqueta>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      </>}

      <TelaSuspensa aberta={!!promo} titulo={promo?.id ? 'Editar promoção' : 'Nova promoção'} subtitulo="No caixa vale sempre o menor preço entre o normal, a tabela do cliente e as promoções do dia" onFechar={() => setPromo(null)} largura="max-w-3xl"
        rodape={<>
          {promo?.id && <Botao variante="secundario" className="mr-auto" onClick={() => setExcluir(promo)}>Excluir</Botao>}
          <Botao variante="secundario" onClick={() => setPromo(null)}>Cancelar</Botao>
          <Botao onClick={salvarPromo} carregando={enviando}>Salvar promoção</Botao>
        </>}>
        {promo && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2"><Campo rotulo="Nome"><input className="campo" value={promo.nome} onChange={(e) => setPromo((x) => ({ ...x, nome: e.target.value }))} placeholder="Ex.: Semana da higiene" autoFocus /></Campo></div>
              <div className="sm:col-span-2"><Campo rotulo="Tipo"><Lista valor={promo.tipo} opcoes={TIPOS} onMudar={(v) => setPromo((x) => ({ ...x, tipo: v }))} /></Campo></div>
              <Campo rotulo="Início"><input type="date" className="campo" value={promo.inicio} onChange={(e) => setPromo((x) => ({ ...x, inicio: e.target.value }))} /></Campo>
              <Campo rotulo="Fim"><input type="date" className="campo" value={promo.fim} min={promo.inicio} onChange={(e) => setPromo((x) => ({ ...x, fim: e.target.value }))} /></Campo>
              {promo.tipo === 'percentual' && <>
                <Campo rotulo="Desconto (%)"><input className="campo num" inputMode="decimal" value={promo.percentual} onChange={(e) => setPromo((x) => ({ ...x, percentual: e.target.value }))} /></Campo>
                <Campo rotulo="Categoria inteira"><Lista valor={promo.categoria_id} opcoes={[{ valor: null, texto: 'Só os produtos abaixo' }, ...categorias.map((c) => ({ valor: c.id, texto: c.nome }))]} onMudar={(v) => setPromo((x) => ({ ...x, categoria_id: v }))} /></Campo>
              </>}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">Produtos</p>
                <Botao variante="secundario" icone="mais" className="py-1" onClick={() => setBuscando('promo')}>Incluir produto</Botao>
              </div>
              {promo.itens.length === 0 ? <p className="text-sm text-tinta-400">{promo.tipo === 'percentual' && promo.categoria_id ? 'O desconto vale para toda a categoria escolhida.' : 'Nenhum produto incluído.'}</p> : (
                <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
                  <thead><tr><th>Produto</th><th className="text-right">Preço normal</th>{promo.tipo === 'quantidade' && <th className="text-right">A partir de</th>}{promo.tipo !== 'percentual' && <th className="text-right">Preço na promoção</th>}<th /></tr></thead>
                  <tbody>
                    {promo.itens.map((i, k) => {
                      const preco = lerNumero(i.preco)
                      const pct = Number(i.preco_venda) > 0 && preco >= 0 ? Math.round((1 - preco / Number(i.preco_venda)) * 100) : null
                      return (
                        <tr key={k}>
                          <td>{i.descricao}</td>
                          <td className="num text-right">{dinheiro(i.preco_venda)}</td>
                          {promo.tipo === 'quantidade' && <td className="text-right"><input className="campo num ml-auto w-20 py-1 text-right" inputMode="decimal" value={i.quantidade_minima} onChange={(e) => setPromo((x) => ({ ...x, itens: x.itens.map((y, j) => (j === k ? { ...y, quantidade_minima: e.target.value } : y)) }))} aria-label="Quantidade mínima" /></td>}
                          {promo.tipo !== 'percentual' && <td className="text-right">
                            <input className="campo num ml-auto w-24 py-1 text-right" inputMode="decimal" value={i.preco} onChange={(e) => setPromo((x) => ({ ...x, itens: x.itens.map((y, j) => (j === k ? { ...y, preco: e.target.value } : y)) }))} aria-label="Preço na promoção" />
                            {pct > 0 && <span className="text-xs text-caixa-600 dark:text-caixa-300">{pct}% abaixo</span>}
                          </td>}
                          <td className="text-right"><button className="rounded p-1 text-tinta-400 hover:text-rubro-600" aria-label={`Remover ${i.descricao}`} onClick={() => setPromo((x) => ({ ...x, itens: x.itens.filter((_, j) => j !== k) }))}><Icone nome="fechar" className="h-4 w-4" /></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={promo.ativo} onChange={(e) => setPromo((x) => ({ ...x, ativo: e.target.checked }))} /> Promoção ativa</label>
          </div>
        )}
      </TelaSuspensa>

      <TelaSuspensa aberta={!!tabela} titulo={tabela?.id ? 'Editar tabela de preço' : 'Nova tabela de preço'} subtitulo="Ajuste geral sobre o preço normal e preços fixos opcionais por produto" onFechar={() => setTabela(null)} largura="max-w-3xl"
        rodape={<>
          <Botao variante="secundario" onClick={() => setTabela(null)}>Cancelar</Botao>
          <Botao onClick={salvarTabela} carregando={enviando}>Salvar tabela</Botao>
        </>}>
        {tabela && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2"><Campo rotulo="Nome"><input className="campo" value={tabela.nome} onChange={(e) => setTabela((x) => ({ ...x, nome: e.target.value }))} placeholder="Ex.: Atacado, Revendedor" autoFocus /></Campo></div>
              <Campo rotulo="Ajuste geral (%)" ajuda="Negativo dá desconto: -10 = 10% abaixo do preço normal"><input className="campo num" inputMode="decimal" value={tabela.ajuste_percentual} onChange={(e) => setTabela((x) => ({ ...x, ajuste_percentual: e.target.value }))} placeholder="0" /></Campo>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">Preços fixos por produto</p>
                <Botao variante="secundario" icone="mais" className="py-1" onClick={() => setBuscando('tabela')}>Incluir produto</Botao>
              </div>
              {tabela.itens.length === 0 ? <p className="text-sm text-tinta-400">Sem preços fixos: vale o ajuste geral para todos os produtos.</p> : (
                <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
                  <thead><tr><th>Produto</th><th className="text-right">Preço normal</th><th className="text-right">Preço na tabela</th><th /></tr></thead>
                  <tbody>
                    {tabela.itens.map((i, k) => (
                      <tr key={i.produto_id}>
                        <td>{i.descricao}</td>
                        <td className="num text-right">{dinheiro(i.preco_venda)}</td>
                        <td className="text-right"><input className="campo num ml-auto w-24 py-1 text-right" inputMode="decimal" value={i.preco} onChange={(e) => setTabela((x) => ({ ...x, itens: x.itens.map((y, j) => (j === k ? { ...y, preco: e.target.value } : y)) }))} aria-label="Preço na tabela" /></td>
                        <td className="text-right"><button className="rounded p-1 text-tinta-400 hover:text-rubro-600" aria-label={`Remover ${i.descricao}`} onClick={() => setTabela((x) => ({ ...x, itens: x.itens.filter((_, j) => j !== k) }))}><Icone nome="fechar" className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={tabela.ativo} onChange={(e) => setTabela((x) => ({ ...x, ativo: e.target.checked }))} /> Tabela ativa</label>
            <p className="text-sm text-tinta-400">Para usar a tabela, escolha-a no cadastro do cliente (aplicada automaticamente no caixa) ou selecione na frente de caixa.</p>
          </div>
        )}
      </TelaSuspensa>

      {buscando && <BuscaProduto titulo="Incluir produto" semKits={false} onFechar={() => setBuscando(null)} onEscolher={incluirProduto} />}
      <Confirmacao aberta={!!excluir} titulo="Excluir promoção" mensagem="A promoção será removida. Se ela já foi usada em vendas, desative em vez de excluir." textoConfirmar="Excluir" variante="perigo" onCancelar={() => setExcluir(null)} onConfirmar={confirmarExclusao} />
    </div>
  )
}
