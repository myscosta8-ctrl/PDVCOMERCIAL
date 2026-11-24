import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../../lib/supabase.js'
import { dinheiro } from '../../lib/formato.js'
import { montarRelatorio, compararMeses, mesesAte, paraCsv, baixarArquivo } from '../../lib/financeiro.js'
import { Barra, Botao, Etiqueta, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../../components/ui.jsx'
import { hojeISO, dataBR, MESES, nomeMes, somaMes, ultimoDia, NavegadorMes } from './comum.js'

// Blocos que separam o que é despesa do negócio do que é estoque e retirada
const BLOCOS = [
  { id: 'despesas', titulo: 'Despesas do negócio', grupos: ['deducoes', 'despesas_operacionais', 'despesas_financeiras'], tipo: 'despesa' },
  { id: 'estoque', titulo: 'Compras de mercadoria', grupos: ['estoque'], tipo: 'despesa' },
  { id: 'fora', titulo: 'Retiradas, empréstimos e investimentos', grupos: ['nao_operacional'], tipo: 'despesa' },
  { id: 'receitas', titulo: 'Receitas lançadas no financeiro', grupos: null, tipo: 'receita' },
]
const doBloco = (b, c) => c.tipo === b.tipo && (!b.grupos || b.grupos.includes(c.grupo))

export function Relatorios({ cad, dre }) {
  const [vista, setVista] = useState('mes')
  const VISTAS = [['mes', 'Mês a mês'], ['ano', 'Ano por conta'], ['dre', 'DRE']]
  return (
    <>
      <div className="mb-4 inline-flex gap-1 rounded-lg border border-papel-300 p-1 dark:border-noite-600" role="tablist">
        {VISTAS.map(([id, nome]) => (
          <button key={id} role="tab" aria-selected={vista === id} onClick={() => setVista(id)}
            className={`rounded-md px-3 py-1 text-sm font-medium ${vista === id ? 'bg-caixa-600 text-white' : 'text-tinta-600 hover:bg-papel-200 dark:text-tinta-300 dark:hover:bg-noite-700'}`}>{nome}</button>
        ))}
      </div>
      {vista === 'mes' && <MesAMes cad={cad} />}
      {vista === 'ano' && <AnoPorConta cad={cad} />}
      {vista === 'dre' && dre}
    </>
  )
}

function useRelatorio(inicio, fim, centro) {
  const avisar = useAviso()
  const [linhas, setLinhas] = useState(null)
  useEffect(() => {
    setLinhas(null)
    supabase.rpc('relatorio_contas', { p_inicio: inicio, p_fim: fim, p_centro: centro }).then(({ data, error }) => {
      if (error) { avisar(mensagemErro(error), 'erro'); setLinhas([]) } else setLinhas(data ?? [])
    })
  }, [inicio, fim, centro]) // eslint-disable-line react-hooks/exhaustive-deps
  return linhas
}

// Lançamentos de uma conta num período (para abrir o detalhe de qualquer número)
function DetalheConta({ conta, inicio, fim, centro, onFechar }) {
  const [itens, setItens] = useState(null)
  useEffect(() => {
    if (!conta) return
    setItens(null)
    let q = supabase.from('lancamentos').select('id, descricao, vencimento, competencia, valor, status, parcela, parcelas, fornecedor:fornecedores(razao_social, nome_fantasia), cliente:clientes(nome)')
      .eq('plano_conta_id', conta.id).neq('status', 'cancelado').gte('competencia', inicio).lte('competencia', fim).order('competencia').order('vencimento')
    if (centro) q = q.eq('centro_custo_id', centro)
    q.then(({ data }) => setItens(data ?? []))
  }, [conta, inicio, fim, centro])
  const total = (itens ?? []).reduce((s, l) => s + Number(l.valor), 0)
  return (
    <TelaSuspensa aberta={!!conta} titulo={conta ? `${conta.codigo} ${conta.nome}` : ''} subtitulo={`Competência de ${dataBR(inicio)} a ${dataBR(fim)}`} onFechar={onFechar} largura="max-w-2xl"
      rodape={<Botao variante="secundario" onClick={onFechar}>Fechar</Botao>}>
      {itens === null ? <p className="text-sm text-tinta-400">Carregando…</p> : itens.length === 0 ? <p className="text-sm text-tinta-400">Nenhum lançamento.</p> : (
        <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
          <thead><tr><th>Competência</th><th>Descrição</th><th>Situação</th><th className="text-right">Valor</th></tr></thead>
          <tbody>
            {itens.map((l) => (
              <tr key={l.id}>
                <td className="num">{MESES[Number(l.competencia.slice(5, 7)) - 1]}/{l.competencia.slice(2, 4)}</td>
                <td>{l.descricao}{l.parcelas > 1 && <span className="text-tinta-400"> {l.parcela}/{l.parcelas}</span>}
                  <span className="block text-xs text-tinta-400">{l.fornecedor?.nome_fantasia || l.fornecedor?.razao_social || l.cliente?.nome || ''}{l.fornecedor || l.cliente ? ', ' : ''}vence {dataBR(l.vencimento)}</span></td>
                <td>{l.status === 'pago' ? <Etiqueta tom="positivo">Paga</Etiqueta> : <Etiqueta>Em aberto</Etiqueta>}</td>
                <td className="num text-right">{dinheiro(l.valor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="font-semibold"><td colSpan={3}>{itens.length} lançamento(s)</td><td className="num text-right">{dinheiro(total)}</td></tr></tfoot>
        </table>
      )}
    </TelaSuspensa>
  )
}

const opcoesCentro = (cad) => [{ valor: null, texto: 'Todos os centros de custo' }, ...cad.centros.map((c) => ({ valor: c.id, texto: c.nome }))]

function Variacao({ atual, anterior, despesa = true }) {
  if (!anterior && !atual) return <span className="text-tinta-400">—</span>
  if (!anterior) return <Etiqueta tom={despesa ? 'alerta' : 'positivo'}>novo</Etiqueta>
  const p = Math.round(((atual - anterior) / anterior) * 100)
  if (p === 0) return <Etiqueta>igual</Etiqueta>
  const ruim = despesa ? p > 0 : p < 0
  return <Etiqueta tom={ruim ? (Math.abs(p) >= 20 ? 'critico' : 'alerta') : 'positivo'}>{p > 0 ? '+' : ''}{p}%</Etiqueta>
}

// ------------------------------------------------------------ Mês a mês
function MesAMes({ cad }) {
  const [mes, setMes] = useState(hojeISO().slice(0, 7))
  const [centro, setCentro] = useState(null)
  const [aberta, setAberta] = useState(null)
  const anterior = somaMes(mes, -1)
  const linhas = useRelatorio(`${anterior}-01`, ultimoDia(mes), centro)
  const contas = useMemo(() => (linhas ? montarRelatorio(linhas, [anterior, mes]) : []), [linhas, anterior, mes])
  const comparadas = useMemo(() => compararMeses(contas, mes, anterior), [contas, mes, anterior])
  const soma = (b, m) => contas.filter((c) => doBloco(b, c)).reduce((s, c) => s + (c.meses[m] ?? 0), 0)

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <NavegadorMes mes={mes} onMudar={setMes} />
        <div className="w-60"><Lista valor={centro} opcoes={opcoesCentro(cad)} onMudar={setCentro} /></div>
        <p className="text-sm text-tinta-400">Pela competência (mês a que a despesa pertence), comparado com {nomeMes(anterior)}.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {BLOCOS.map((b) => {
          const a = soma(b, mes), p = soma(b, anterior)
          return <Indicador key={b.id} titulo={b.titulo} icone={b.tipo === 'receita' ? 'dinheiro' : 'grafico'} valor={linhas ? dinheiro(a) : '…'}
            tom={b.id === 'despesas' && p && a > p * 1.1 ? 'alerta' : 'neutro'}
            detalhe={p ? `${a >= p ? '+' : ''}${Math.round(((a - p) / p) * 100)}% sobre ${nomeMes(anterior)} (${dinheiro(p)})` : `Nada em ${nomeMes(anterior)}`} />
        })}
      </div>

      {linhas === null ? <p className="mt-4 text-sm text-tinta-400">Carregando…</p> : comparadas.length === 0 ? (
        <div className="mt-4 cartao"><Vazio icone="grafico" titulo={`Nada lançado em ${nomeMes(mes)}`} texto="Os valores aparecem aqui conforme as contas a pagar e a receber são lançadas." /></div>
      ) : BLOCOS.map((b) => {
        const lista = comparadas.filter((c) => doBloco(b, c))
        if (!lista.length) return null
        const totalAtual = lista.reduce((s, c) => s + c.atual, 0)
        return (
          <div key={b.id} className="mt-4 cartao overflow-hidden">
            <div className="flex items-baseline justify-between border-b border-papel-200 px-4 py-3 dark:border-noite-700">
              <p className="font-semibold">{b.titulo}</p><p className="num font-semibold">{dinheiro(totalAtual)}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="tabela w-full text-[0.95rem]">
                <thead className="bg-papel/70 dark:bg-noite/40"><tr><th>Conta</th><th className="w-40">Peso no mês</th><th className="text-right">{MESES[Number(anterior.slice(5)) - 1]}</th><th className="text-right">{MESES[Number(mes.slice(5)) - 1]}</th><th className="text-right">Diferença</th><th className="text-right">Variação</th></tr></thead>
                <tbody>
                  {lista.map((c) => (
                    <tr key={c.id} onClick={() => setAberta(c)} className="cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40">
                      <td><span className="text-tinta-400">{c.codigo}</span> <span className="font-medium">{c.nome}</span></td>
                      <td><Barra parte={c.atual} total={totalAtual} tom={b.tipo === 'receita' ? 'caixa' : 'ambar'} /></td>
                      <td className="num text-right text-tinta-400">{dinheiro(c.anterior)}</td>
                      <td className="num text-right font-semibold">{dinheiro(c.atual)}</td>
                      <td className={`num text-right ${c.diferenca > 0 === (b.tipo === 'despesa') && c.diferenca !== 0 ? 'text-rubro-600 dark:text-rubro-300' : ''}`}>{c.diferenca > 0 ? '+' : ''}{dinheiro(c.diferenca)}</td>
                      <td className="text-right"><Variacao atual={c.atual} anterior={c.anterior} despesa={b.tipo === 'despesa'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      <DetalheConta conta={aberta} inicio={`${anterior}-01`} fim={ultimoDia(mes)} centro={centro} onFechar={() => setAberta(null)} />
    </>
  )
}

// ------------------------------------------------------------ Ano por conta
function AnoPorConta({ cad }) {
  const anoAtual = new Date().getFullYear()
  const [ano, setAno] = useState(anoAtual)
  const [centro, setCentro] = useState(null)
  const [aberta, setAberta] = useState(null)
  const meses = mesesAte(`${ano}-12`, 12)
  const linhas = useRelatorio(`${ano}-01-01`, `${ano}-12-31`, centro)
  const contas = useMemo(() => (linhas ? montarRelatorio(linhas, meses) : []), [linhas]) // eslint-disable-line react-hooks/exhaustive-deps
  const mesesComDado = meses.filter((m) => contas.some((c) => c.meses[m]))
  const media = (c) => (mesesComDado.length ? c.total / mesesComDado.length : 0)

  const exportar = () => baixarArquivo(`financeiro-por-conta-${ano}.csv`, paraCsv(
    ['Bloco', 'Código', 'Conta', ...meses.map((m) => `${MESES[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`), 'Total', 'Média mensal'],
    BLOCOS.flatMap((b) => contas.filter((c) => doBloco(b, c)).map((c) => [b.titulo, c.codigo, c.nome, ...meses.map((m) => c.meses[m] ?? 0), c.total, Math.round(media(c) * 100) / 100]))))

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-32"><Lista valor={ano} opcoes={[0, 1, 2, 3].map((k) => ({ valor: anoAtual - k, texto: String(anoAtual - k) }))} onMudar={setAno} /></div>
        <div className="w-60"><Lista valor={centro} opcoes={opcoesCentro(cad)} onMudar={setCentro} /></div>
        <Botao variante="secundario" icone="nota" className="ml-auto" onClick={exportar} disabled={!contas.length}>Exportar planilha</Botao>
      </div>
      {linhas === null ? <p className="text-sm text-tinta-400">Carregando…</p> : contas.length === 0 ? (
        <div className="cartao"><Vazio icone="grafico" titulo={`Nada lançado em ${ano}`} texto="Escolha outro ano ou lance contas a pagar e a receber." /></div>
      ) : (
        <div className="cartao overflow-x-auto">
          <table className="tabela w-full whitespace-nowrap text-sm">
            <thead className="bg-papel/70 dark:bg-noite/40">
              <tr><th className="sticky left-0 z-10 bg-papel dark:bg-noite-800">Conta</th>{meses.map((m) => <th key={m} className="text-right">{MESES[Number(m.slice(5)) - 1]}</th>)}<th className="text-right">Total</th><th className="text-right">Média</th></tr>
            </thead>
            <tbody>
              {BLOCOS.map((b) => {
                const lista = contas.filter((c) => doBloco(b, c))
                if (!lista.length) return null
                const sub = (m) => lista.reduce((s, c) => s + (c.meses[m] ?? 0), 0)
                const subTotal = lista.reduce((s, c) => s + c.total, 0)
                return [
                  <tr key={b.id} className="bg-papel-200/60 font-semibold dark:bg-noite-700/60">
                    <td className="sticky left-0 z-10 bg-papel-200 dark:bg-noite-700">{b.titulo}</td>
                    {meses.map((m) => <td key={m} className="num text-right">{sub(m) ? dinheiro(sub(m)) : '—'}</td>)}
                    <td className="num text-right">{dinheiro(subTotal)}</td><td className="num text-right">{dinheiro(mesesComDado.length ? subTotal / mesesComDado.length : 0)}</td>
                  </tr>,
                  ...lista.map((c) => (
                    <tr key={c.id} onClick={() => setAberta(c)} className="cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40">
                      <td className="sticky left-0 z-10 bg-white pl-6 dark:bg-noite-800"><span className="text-tinta-400">{c.codigo}</span> {c.nome}</td>
                      {meses.map((m) => <td key={m} className="num text-right">{c.meses[m] ? dinheiro(c.meses[m]) : <span className="text-tinta-300">—</span>}</td>)}
                      <td className="num text-right font-semibold">{dinheiro(c.total)}</td><td className="num text-right text-tinta-400">{dinheiro(media(c))}</td>
                    </tr>
                  )),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-sm text-tinta-400">Clique numa conta para ver os lançamentos. Vendas do caixa e custo das mercadorias estão na DRE.</p>
      <DetalheConta conta={aberta} inicio={`${ano}-01-01`} fim={`${ano}-12-31`} centro={centro} onFechar={() => setAberta(null)} />
    </>
  )
}
