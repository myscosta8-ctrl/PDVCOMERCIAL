import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { dinheiro, dataHora } from '../lib/formato.js'
import { nomeForma } from '../lib/formas.js'
import { paraCsv, baixarArquivo } from '../lib/financeiro.js'
import { periodo, variacao, curvaABC, margem, mapaHoras } from '../lib/relatorios.js'
import { Barra, Botao, Cabecalho, Campo, Etiqueta, Indicador, Lista, Vazio, useAviso } from '../components/ui.jsx'

const PERIODOS = [
  { valor: 'hoje', texto: 'Hoje' }, { valor: 'ontem', texto: 'Ontem' }, { valor: '7d', texto: 'Últimos 7 dias' },
  { valor: '30d', texto: 'Últimos 30 dias' }, { valor: 'mes', texto: 'Este mês' }, { valor: 'mes_passado', texto: 'Mês passado' },
  { valor: 'ano', texto: 'Este ano' }, { valor: 'outro', texto: 'Outro período' },
]
const ABAS = [['geral', 'Visão geral'], ['produtos', 'Produtos (curva ABC)'], ['categorias', 'Categorias'], ['operadores', 'Operadores'],
  ['pagamentos', 'Formas de pagamento'], ['clientes', 'Clientes'], ['parados', 'Produtos sem venda']]
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const CLASSES = [{ valor: 'todas', texto: 'Todas as classes' }, { valor: 'A', texto: 'Classe A' }, { valor: 'B', texto: 'Classe B' }, { valor: 'C', texto: 'Classe C' }]
const pct = (v, casas = 1) => (v == null ? '—' : `${v.toFixed(casas).replace('.', ',')}%`)
const qtdBR = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const dataBR = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
const curta = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

function Comparacao({ atual, anterior, inverter = false }) {
  const v = variacao(atual, anterior)
  if (v == null) return <span>Sem base no período anterior</span>
  const bom = inverter ? v <= 0 : v >= 0
  return <span className={bom ? 'text-caixa-700 dark:text-caixa-300' : 'text-rubro-600 dark:text-rubro-300'}>{v >= 0 ? '+' : ''}{pct(v)} em relação ao período anterior</span>
}

export default function Relatorios() {
  const avisar = useAviso()
  const [tipo, setTipo] = useState('mes')
  const [datas, setDatas] = useState(periodo('mes'))
  const [r, setR] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [aba, setAba] = useState('geral')
  const [classe, setClasse] = useState('todas')

  const carregar = async (p = datas) => {
    if (!p.inicio || !p.fim || p.fim < p.inicio) { avisar('Confira as datas do período.', 'erro'); return }
    setCarregando(true)
    const { data, error } = await supabase.rpc('relatorio_gerencial', { p_inicio: p.inicio, p_fim: p.fim })
    setCarregando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    setR(data)
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const escolher = (t) => { setTipo(t); if (t !== 'outro') { const p = periodo(t); setDatas(p); carregar(p) } }

  const abc = useMemo(() => (r ? curvaABC(r.produtos) : []), [r])
  const s = r?.resumo ?? {}, a = r?.anterior ?? {}
  const mg = margem(s.total_com_custo, s.custo), mgAnt = margem(a.total_com_custo, a.custo)

  const exportar = () => {
    if (!r) return
    const nome = (t) => `${t}-${r.periodo.inicio}-a-${r.periodo.fim}.csv`
    const n = (v) => Math.round(Number(v || 0) * 100) / 100
    const tabelas = {
      geral: [['Dia', 'Vendas', 'Faturamento'], r.por_dia.map((d) => [dataBR(d.dia), d.qtd, n(d.total)]), 'vendas-por-dia'],
      produtos: [['Classe', 'Produto', 'Categoria', 'Quantidade', 'Faturamento', 'Participação (%)', 'Acumulado (%)', 'Margem (%)'],
        abc.map((p) => [p.classe, p.descricao, p.categoria, n(p.quantidade), n(p.total), n(p.participacao), n(p.acumulado), p.margem == null ? '' : n(p.margem)]), 'curva-abc'],
      categorias: [['Categoria', 'Produtos', 'Quantidade', 'Faturamento', 'Margem (%)'],
        r.categorias.map((c) => [c.nome, c.produtos, n(c.quantidade), n(c.total), c.custo == null ? '' : n(margem(c.total_com_custo, c.custo))]), 'categorias'],
      operadores: [['Operador', 'Vendas', 'Faturamento', 'Ticket médio', 'Descontos', 'Canceladas'],
        r.operadores.map((o) => [o.nome, o.vendas, n(o.total), o.vendas ? n(o.total / o.vendas) : 0, n(o.descontos), o.canceladas]), 'operadores'],
      pagamentos: [['Forma', 'Vendas', 'Recebido'], r.formas.map((f) => [nomeForma(f.forma), f.vendas, n(f.total)]), 'formas-de-pagamento'],
      clientes: [['Cliente', 'Vendas', 'Total', 'Última compra'], r.clientes.map((c) => [c.nome, c.vendas, n(c.total), dataBR(c.ultima)]), 'clientes'],
      parados: [['Produto', 'Estoque', 'Unidade', 'Custo unitário', 'Valor em estoque', 'Última venda'],
        r.parados.map((p) => [p.descricao, n(p.estoque_atual), p.unidade, n(p.preco_custo), n(p.valor_estoque), p.ultima_venda ? dataBR(p.ultima_venda) : 'Nunca vendido']), 'produtos-sem-venda'],
    }
    const [cab, linhas, arq] = tabelas[aba]
    baixarArquivo(nome(arq), paraCsv(cab, linhas))
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Relatórios de vendas" descricao="Desempenho do período comparado ao período anterior de mesmo tamanho">
        <Botao variante="secundario" icone="nota" onClick={exportar} disabled={!r}>Exportar planilha</Botao>
      </Cabecalho>

      <div className="cartao mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="w-56"><Campo rotulo="Período"><Lista valor={tipo} opcoes={PERIODOS} onMudar={escolher} /></Campo></div>
        {tipo === 'outro' && <>
          <Campo rotulo="De"><input type="date" className="campo" value={datas.inicio} onChange={(e) => setDatas((d) => ({ ...d, inicio: e.target.value }))} /></Campo>
          <Campo rotulo="Até"><input type="date" className="campo" value={datas.fim} onChange={(e) => setDatas((d) => ({ ...d, fim: e.target.value }))} /></Campo>
          <Botao onClick={() => carregar()} carregando={carregando}>Gerar relatório</Botao>
        </>}
        {r && <p className="ml-auto pb-2.5 text-sm text-tinta-400">{dataBR(r.periodo.inicio)} a {dataBR(r.periodo.fim)}, comparado a {dataBR(r.periodo.anterior_inicio)} a {dataBR(r.periodo.anterior_fim)}</p>}
      </div>

      {!r ? <p className="text-sm text-tinta-400">{carregando ? 'Gerando relatório…' : ''}</p> : (<>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Indicador titulo="Faturamento" icone="dinheiro" tom="positivo" valor={dinheiro(s.total)} detalhe={<Comparacao atual={s.total} anterior={a.total} />} />
          <Indicador titulo="Vendas e ticket médio" icone="vendas" valor={Number(s.qtd).toLocaleString('pt-BR')}
            detalhe={<>Ticket médio {dinheiro(s.qtd ? s.total / s.qtd : 0)}; {qtdBR(s.itens)} itens</>} />
          <Indicador titulo="Margem bruta" icone="grafico" tom={mg == null ? 'neutro' : mg < 20 ? 'alerta' : 'positivo'} valor={pct(mg)}
            detalhe={mg == null ? 'Cadastre o custo dos produtos' : <>Lucro bruto {dinheiro(s.total_com_custo - s.custo)}{mgAnt != null ? `; antes ${pct(mgAnt)}` : ''}</>} />
          <Indicador titulo="Descontos e devoluções" icone="alerta" tom={s.devolucoes > 0 || s.canceladas > 0 ? 'alerta' : 'neutro'} valor={dinheiro(Number(s.descontos) + Number(s.devolucoes))}
            detalhe={`Descontos ${dinheiro(s.descontos)}; devoluções ${dinheiro(s.devolucoes)}; ${s.canceladas} cancelada(s)`} />
        </div>
        {Number(s.taxa_servico) > 0 && <p className="mt-2 text-sm text-tinta-400">Taxa de serviço recebida no período: {dinheiro(s.taxa_servico)}. Fica fora do faturamento, porque pertence à equipe.</p>}

        <div className="mb-4 mt-5 inline-flex flex-wrap abas" role="tablist">
          {ABAS.map(([id, nome]) => (
            <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className={`aba ${aba === id ? 'aba-ativa' : ''}`}>{nome}</button>
          ))}
        </div>

        {aba === 'geral' && <VisaoGeral r={r} />}
        {aba === 'produtos' && (
          <section className="cartao overflow-hidden">
            <div className="flex flex-wrap items-end gap-3 border-b border-papel-200 p-4 dark:border-noite-700">
              <div className="w-52"><Campo rotulo="Mostrar"><Lista valor={classe} opcoes={CLASSES} onMudar={setClasse} /></Campo></div>
              <div className="flex flex-wrap gap-4 pb-2.5 text-sm text-tinta-400">
                {['A', 'B', 'C'].map((c) => {
                  const da = abc.filter((p) => p.classe === c)
                  return <span key={c}><Etiqueta tom={c === 'A' ? 'positivo' : c === 'B' ? 'alerta' : 'neutro'}>Classe {c}</Etiqueta> {da.length} produto(s), {dinheiro(da.reduce((x, p) => x + Number(p.total), 0))}</span>
                })}
              </div>
            </div>
            <Tabela vazio="Nenhum produto vendido no período." cab={['Classe', 'Produto', 'Quantidade', 'Faturamento', 'Participação', 'Acumulado', 'Margem']} dir={[2, 3, 4, 5, 6]}
              linhas={abc.filter((p) => classe === 'todas' || p.classe === classe).map((p) => [
                <Etiqueta key="c" tom={p.classe === 'A' ? 'positivo' : p.classe === 'B' ? 'alerta' : 'neutro'}>{p.classe}</Etiqueta>,
                <span key="d" className="font-medium">{p.descricao}<span className="block text-xs font-normal text-tinta-400">{p.categoria}</span></span>,
                qtdBR(p.quantidade), dinheiro(p.total), pct(p.participacao), pct(p.acumulado), <span key="m" className={p.margem != null && p.margem < 15 ? 'text-rubro-600 dark:text-rubro-300' : ''}>{pct(p.margem)}</span>])} />
          </section>
        )}
        {aba === 'categorias' && (
          <section className="cartao overflow-hidden">
            <Tabela vazio="Nenhuma venda no período." cab={['Categoria', 'Produtos', 'Quantidade', 'Faturamento', 'Participação', 'Margem']} dir={[1, 2, 3, 4, 5]}
              linhas={r.categorias.map((c) => [<span key="n" className="font-medium">{c.nome}</span>, c.produtos, qtdBR(c.quantidade), dinheiro(c.total),
                <div key="b" className="ml-auto flex w-40 items-center gap-2"><Barra parte={Number(c.total)} total={Number(s.total)} /><span className="num w-12 text-right">{pct(s.total ? (c.total / s.total) * 100 : 0, 0)}</span></div>,
                pct(margem(c.total_com_custo, c.custo))])} />
          </section>
        )}
        {aba === 'operadores' && (
          <section className="cartao overflow-hidden">
            <Tabela vazio="Nenhuma venda no período." cab={['Operador', 'Vendas', 'Faturamento', 'Ticket médio', 'Descontos', 'Canceladas']} dir={[1, 2, 3, 4, 5]}
              linhas={r.operadores.map((o) => [<span key="n" className="font-medium">{o.nome}</span>, o.vendas, dinheiro(o.total), dinheiro(o.vendas ? o.total / o.vendas : 0),
                dinheiro(o.descontos), o.canceladas ? <span key="c" className="font-semibold text-ambar-600">{o.canceladas}</span> : 0])} />
          </section>
        )}
        {aba === 'pagamentos' && (
          <section className="cartao p-5">
            {!r.formas.length ? <Vazio icone="dinheiro" titulo="Nenhum recebimento no período" /> : (
              <ul className="space-y-4">
                {r.formas.map((f) => (
                  <li key={f.forma}>
                    <div className="mb-1 flex justify-between text-[0.95rem]"><span>{nomeForma(f.forma)}<span className="ml-2 text-sm text-tinta-400">{f.vendas} venda(s)</span></span>
                      <span className="num font-semibold">{dinheiro(f.total)} <span className="font-normal text-tinta-400">({pct(s.total ? (f.total / s.total) * 100 : 0)})</span></span></div>
                    <Barra parte={Number(f.total)} total={Number(s.total)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {aba === 'clientes' && (
          <section className="cartao overflow-hidden">
            <p className="border-b border-papel-200 px-5 py-3 text-sm text-tinta-400 dark:border-noite-700">{s.clientes} cliente(s) identificado(s) no período. Os 20 que mais compraram:</p>
            <Tabela vazio="Nenhuma venda com cliente identificado no período." cab={['Cliente', 'Compras', 'Total', 'Ticket médio', 'Última compra']} dir={[1, 2, 3]}
              linhas={r.clientes.map((c) => [<span key="n" className="font-medium">{c.nome}</span>, c.vendas, dinheiro(c.total), dinheiro(c.total / c.vendas), dataHora(c.ultima)])} />
          </section>
        )}
        {aba === 'parados' && (
          <section className="cartao overflow-hidden">
            <p className="border-b border-papel-200 px-5 py-3 text-sm text-tinta-400 dark:border-noite-700">
              Produtos com estoque que não venderam no período: {r.parados.length}{r.parados.length === 100 ? ' (os 100 de maior valor)' : ''}, somando {dinheiro(r.parados.reduce((x, p) => x + Number(p.valor_estoque), 0))} parados em estoque.
            </p>
            <Tabela vazio="Todos os produtos com estoque venderam no período." cab={['Produto', 'Estoque', 'Custo unitário', 'Valor em estoque', 'Última venda']} dir={[1, 2, 3]}
              linhas={r.parados.map((p) => [<span key="n" className="font-medium">{p.descricao}</span>, `${qtdBR(p.estoque_atual)} ${p.unidade}`, dinheiro(p.preco_custo),
                dinheiro(p.valor_estoque), p.ultima_venda ? dataBR(p.ultima_venda) : <span key="u" className="text-ambar-600">Nunca vendido</span>])} />
          </section>
        )}
      </>)}
    </div>
  )
}

function Tabela({ cab, linhas, dir = [], vazio }) {
  if (!linhas.length) return <Vazio icone="grafico" titulo={vazio} />
  return (
    <div className="overflow-x-auto">
      <table className="tabela w-full text-[0.95rem]">
        <thead><tr>{cab.map((c, i) => <th key={c} className={dir.includes(i) ? 'text-right' : ''}>{c}</th>)}</tr></thead>
        <tbody>{linhas.map((l, k) => <tr key={k}>{l.map((c, i) => <td key={i} className={dir.includes(i) ? 'num text-right' : ''}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

function VisaoGeral({ r }) {
  const max = Math.max(...r.por_dia.map((d) => Number(d.total)), 0)
  const melhor = r.por_dia.reduce((m, d) => (Number(d.total) > Number(m?.total ?? -1) ? d : m), null)
  const mapa = mapaHoras(r.mapa_horas)
  const poucos = r.por_dia.length <= 31
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <section className="cartao p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="titulo-secao">Faturamento por dia</h2>
          {melhor && Number(melhor.total) > 0 && <span className="text-sm text-tinta-400">melhor dia: {dataBR(melhor.dia)}, {dinheiro(melhor.total)}</span>}
        </div>
        <div className="mt-4 flex h-52 items-end gap-[3px]">
          {r.por_dia.map((d) => (
            <div key={d.dia} className="group relative flex h-full flex-1 items-end" title={`${dataBR(d.dia)}: ${dinheiro(d.total)} em ${d.qtd} venda(s)`}>
              <div className={`w-full rounded-t ${d === melhor && max > 0 ? 'bg-caixa-600' : 'bg-caixa-200 group-hover:bg-caixa-400 dark:bg-caixa-700/60 dark:group-hover:bg-caixa-500'}`}
                style={{ height: max ? `${Math.max(Number(d.total) > 0 ? 3 : 0.5, (Number(d.total) / max) * 100)}%` : '0.5%' }} />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[0.72rem] text-tinta-400">
          {poucos ? r.por_dia.filter((_, i) => i % Math.ceil(r.por_dia.length / 8) === 0).map((d) => <span key={d.dia} className="num">{curta(d.dia)}</span>)
            : [r.por_dia[0], r.por_dia[Math.floor(r.por_dia.length / 2)], r.por_dia.at(-1)].map((d) => <span key={d.dia} className="num">{curta(d.dia)}</span>)}
        </div>
      </section>
      <section className="cartao p-5">
        <h2 className="titulo-secao">Movimento por dia da semana e hora</h2>
        <p className="mt-1 text-sm text-tinta-400">Quanto mais escuro, maior o faturamento. Ajuda a montar a escala do caixa.</p>
        {!mapa.max ? <p className="mt-6 text-sm text-tinta-400">Sem vendas no período.</p> : (
          <div className="mt-4 overflow-x-auto">
            <table className="border-separate border-spacing-[3px] text-[0.72rem]">
              <thead><tr><th />{mapa.horas.map((h) => <th key={h} className="num w-6 font-normal text-tinta-400">{h}</th>)}</tr></thead>
              <tbody>
                {DIAS_SEMANA.map((nome, dow) => (
                  <tr key={dow}>
                    <th className="pr-1 text-left font-medium text-tinta-500 dark:text-tinta-300">{nome}</th>
                    {mapa.horas.map((h) => {
                      const v = mapa.m[dow][h], int = v / mapa.max
                      return <td key={h} title={`${nome}, ${h}h: ${dinheiro(v)}`} className={`h-6 w-6 rounded ${v ? '' : 'bg-papel-100 dark:bg-noite-700'}`}
                        style={v ? { backgroundColor: `rgba(20,145,125,${0.15 + int * 0.85})` } : undefined} />
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
