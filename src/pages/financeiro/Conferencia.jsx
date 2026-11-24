import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../../lib/supabase.js'
import { dinheiro, dataHora } from '../../lib/formato.js'
import { conferirLancamentos, semAcento } from '../../lib/financeiro.js'
import { Botao, Campo, Confirmacao, Etiqueta, Icone, Lista, TelaSuspensa, Vazio, useAviso } from '../../components/ui.jsx'
import { hojeISO, dataBR, somaMeses, ultimoDia, NavegadorMes } from './comum.js'

export function Conferencia({ cad, lancs, recarregar }) {
  const [vista, setVista] = useState('conferencia')
  const VISTAS = [['conferencia', 'Conferência'], ['reclassificar', 'Reclassificar em grupo'], ['historico', 'Histórico de alterações']]
  return (
    <>
      <div className="mb-4 subabas" role="tablist">
        {VISTAS.map(([id, nome]) => (
          <button key={id} role="tab" aria-selected={vista === id} onClick={() => setVista(id)}
            className={`subaba ${vista === id ? 'subaba-ativa' : ''}`}>{nome}</button>
        ))}
      </div>
      {lancs === null ? <p className="text-sm text-tinta-400">Carregando…</p> : <>
        {vista === 'conferencia' && <Problemas lancs={lancs} recarregar={recarregar} />}
        {vista === 'reclassificar' && <Reclassificar cad={cad} lancs={lancs} recarregar={recarregar} />}
        {vista === 'historico' && <Historico cad={cad} />}
      </>}
    </>
  )
}

const pessoa = (l) => l.fornecedor?.nome_fantasia || l.fornecedor?.razao_social || l.cliente?.nome || ''

// ------------------------------------------------------------ Conferência
function Problemas({ lancs, recarregar }) {
  const avisar = useAviso()
  const [cancelar, setCancelar] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const problemas = useMemo(() => conferirLancamentos(lancs, hojeISO()), [lancs])

  const confirmar = async () => {
    setEnviando(true)
    const { error } = await supabase.from('lancamentos').update({ status: 'cancelado' }).eq('id', cancelar.id)
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Lançamento cancelado.'); setCancelar(null); recarregar()
  }

  if (!problemas.length) {
    return <div className="cartao"><Vazio icone="ok" titulo="Nada para corrigir" texto="Sem lançamentos repetidos, contas esquecidas em aberto, pagamentos parciais parados ou valores estimados para conferir." /></div>
  }
  return (
    <div className="space-y-4">
      {problemas.map((p, i) => (
        <div key={`${p.tipo}-${i}`} className={`cartao overflow-hidden ${p.nivel === 'critico' ? 'border-rubro-300/60 dark:border-rubro-600/40' : ''}`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-papel-200 px-4 py-3 dark:border-noite-700">
            <Etiqueta tom={p.nivel}><Icone nome="alerta" className="h-3.5 w-3.5" />{p.nivel === 'critico' ? 'Atenção' : 'Conferir'}</Etiqueta>
            <p className="min-w-0 flex-1 font-semibold">{p.titulo}</p>
            {p.valor != null && <span className="num font-semibold">{dinheiro(p.valor)}</span>}
            <p className="w-full text-sm text-tinta-400">{p.texto}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <tbody>
                {p.lancamentos.slice(0, 20).map((l) => (
                  <tr key={l.id}>
                    <td className="num whitespace-nowrap">{dataBR(l.vencimento)}</td>
                    <td className="font-medium">{l.descricao}{l.parcelas > 1 && <span className="font-normal text-tinta-400"> {l.parcela}/{l.parcelas}</span>}
                      <span className="block text-xs font-normal text-tinta-400">{[l.tipo === 'pagar' ? 'A pagar' : 'A receber', pessoa(l), l.plano?.nome, l.criado_em && `lançado em ${dataBR(l.criado_em)}`].filter(Boolean).join(', ')}</span></td>
                    <td className="num text-right">{dinheiro(l.valor)}</td>
                    <td>{l.status === 'pago' ? <Etiqueta tom="positivo">Paga</Etiqueta> : Number(l.valor_pago) > 0 ? <Etiqueta tom="alerta">Pago {dinheiro(l.valor_pago)}</Etiqueta> : <Etiqueta>Em aberto</Etiqueta>}</td>
                    <td className="text-right">{p.tipo === 'duplicado' || p.tipo === 'antigo'
                      ? (l.status === 'aberto' && Number(l.valor_pago) === 0 && <button className="text-sm font-medium text-rubro-600 hover:underline dark:text-rubro-300" onClick={() => setCancelar(l)}>Cancelar</button>)
                      : null}</td>
                  </tr>
                ))}
                {p.lancamentos.length > 20 && <tr><td colSpan={5} className="text-sm text-tinta-400">e mais {p.lancamentos.length - 20}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <Confirmacao aberta={!!cancelar} titulo="Cancelar lançamento" variante="perigo" textoConfirmar="Cancelar lançamento" carregando={enviando}
        mensagem={cancelar ? `"${cancelar.descricao}" de ${dinheiro(cancelar.valor)}, vencimento ${dataBR(cancelar.vencimento)}, deixa de contar no fluxo de caixa e nos relatórios.` : ''}
        onCancelar={() => setCancelar(null)} onConfirmar={confirmar} />
    </div>
  )
}

// ------------------------------------------------------------ Reclassificar em grupo
const chaveDescricao = (d) => semAcento(d).replace(/\s+\d+\/\d+$/, '').replace(/ duplicata .*$/, '').replace(/\s+/g, ' ').trim()

function Reclassificar({ cad, lancs, recarregar }) {
  const avisar = useAviso()
  const [tipo, setTipo] = useState('pagar')
  const [busca, setBusca] = useState('')
  const [grupo, setGrupo] = useState(null)
  const [plano, setPlano] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const desde = somaMeses(hojeISO(), -12)

  // Agrupa por descrição parecida: mostra em quantas contas do plano cada uma está espalhada
  const grupos = useMemo(() => {
    const m = new Map()
    for (const l of lancs) {
      if (l.tipo !== tipo || l.status === 'cancelado' || l.competencia < desde) continue
      const k = chaveDescricao(l.descricao)
      if (!m.has(k)) m.set(k, { chave: k, descricao: l.descricao.replace(/ duplicata .*$/, ''), itens: [], planos: new Map() })
      const g = m.get(k)
      g.itens.push(l)
      g.planos.set(l.plano_conta_id, (g.planos.get(l.plano_conta_id) ?? 0) + 1)
    }
    const t = semAcento(busca).trim()
    return [...m.values()].filter((g) => !t || g.chave.includes(t))
      .map((g) => ({ ...g, total: g.itens.reduce((s, l) => s + Number(l.valor), 0) }))
      .sort((a, b) => (b.planos.size - a.planos.size) || (b.itens.length - a.itens.length))
  }, [lancs, tipo, busca, desde])

  const nomePlano = (id) => { const p = cad.planos.find((x) => x.id === id); return p ? `${p.codigo} ${p.nome}` : '—' }
  const planos = cad.planos.filter((p) => p.ativo && p.tipo === (tipo === 'pagar' ? 'despesa' : 'receita'))

  const aplicar = async () => {
    if (!plano) { avisar('Escolha a nova conta.', 'erro'); return }
    const ids = grupo.itens.filter((l) => l.plano_conta_id !== plano).map((l) => l.id)
    if (!ids.length) { avisar('Todos já estão nesta conta.'); setGrupo(null); return }
    setEnviando(true)
    const { error } = await supabase.from('lancamentos').update({ plano_conta_id: plano }).in('id', ids)
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`${ids.length} lançamento(s) movido(s) para ${nomePlano(plano)}.`); setGrupo(null); recarregar()
  }

  return (
    <div className="cartao overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-papel-200 p-3 dark:border-noite-700">
        <div className="w-44"><Lista valor={tipo} opcoes={[{ valor: 'pagar', texto: 'Contas a pagar' }, { valor: 'receber', texto: 'Contas a receber' }]} onMudar={setTipo} /></div>
        <div className="relative min-w-[14rem] flex-1">
          <Icone nome="busca" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tinta-400" />
          <input className="campo pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar descrição" />
        </div>
        <p className="w-full text-sm text-tinta-400">Lançamentos dos últimos 12 meses agrupados pela descrição. Os espalhados em várias contas aparecem primeiro. Vale também para contas já pagas.</p>
      </div>
      {grupos.length === 0 ? <Vazio icone="busca" titulo="Nada encontrado" texto="Nenhum lançamento com esta descrição nos últimos 12 meses." /> : (
        <div className="max-h-[36rem] overflow-auto">
          <table className="tabela w-full text-[0.95rem]">
            <thead className="sticky top-0 bg-papel dark:bg-noite-800"><tr><th>Descrição</th><th>Está em</th><th className="text-right">Lançamentos</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {grupos.slice(0, 200).map((g) => (
                <tr key={g.chave} onClick={() => { setGrupo(g); setPlano(g.planos.size === 1 ? [...g.planos.keys()][0] : null) }} className="cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40">
                  <td className="font-medium">{g.descricao}</td>
                  <td>{g.planos.size > 1 ? <Etiqueta tom="alerta">{g.planos.size} contas diferentes</Etiqueta> : <span className="text-sm">{nomePlano([...g.planos.keys()][0])}</span>}</td>
                  <td className="num text-right">{g.itens.length}</td>
                  <td className="num text-right">{dinheiro(g.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TelaSuspensa aberta={!!grupo} titulo="Reclassificar em grupo" subtitulo={grupo ? `${grupo.itens.length} lançamento(s) "${grupo.descricao}"` : ''} onFechar={() => setGrupo(null)}
        rodape={<><Botao variante="secundario" onClick={() => setGrupo(null)}>Cancelar</Botao><Botao onClick={aplicar} carregando={enviando}>Mover todos</Botao></>}>
        {grupo && (
          <div className="space-y-4">
            <div className="rounded-lg border border-papel-200 p-3 text-sm dark:border-noite-700">
              <p className="mb-1 font-semibold">Hoje estão em</p>
              {[...grupo.planos.entries()].map(([id, n]) => <p key={id} className="flex justify-between"><span>{nomePlano(id)}</span><span className="num">{n}</span></p>)}
            </div>
            <Campo rotulo="Mover todos para"><Lista valor={plano} opcoes={planos.map((p) => ({ valor: p.id, texto: `${p.codigo} ${p.nome}` }))} onMudar={setPlano} /></Campo>
            <p className="text-sm text-tinta-400">Valores, vencimentos e pagamentos não mudam. Os relatórios e a DRE passam a mostrar na nova conta.</p>
          </div>
        )}
      </TelaSuspensa>
    </div>
  )
}

// ------------------------------------------------------------ Histórico
const ACOES = {
  criou: ['Criou', 'positivo'], gerou_fixa: ['Despesa fixa lançada', 'neutro'], editou: ['Editou', 'alerta'], reclassificou: ['Reclassificou', 'alerta'],
  cancelou: ['Cancelou', 'critico'], pagou: ['Pagou', 'positivo'], recebeu: ['Recebeu', 'positivo'], estornar_baixa: ['Estornou pagamento', 'critico'],
}
const CAMPOS = { descricao: 'Descrição', valor: 'Valor', vencimento: 'Vencimento', competencia: 'Competência', plano_conta_id: 'Conta', centro_custo_id: 'Centro de custo',
  fornecedor_id: 'Fornecedor', cliente_id: 'Cliente', documento: 'Documento', linha_digitavel: 'Linha digitável', observacao: 'Observação' }

function Historico({ cad }) {
  const avisar = useAviso()
  const [mes, setMes] = useState(hojeISO().slice(0, 7))
  const [acao, setAcao] = useState(null)
  const [itens, setItens] = useState(null)
  useEffect(() => {
    setItens(null)
    supabase.rpc('historico_financeiro', { p_inicio: `${mes}-01`, p_fim: ultimoDia(mes) }).then(({ data, error }) => {
      if (error) { avisar(mensagemErro(error), 'erro'); setItens([]) } else setItens(data ?? [])
    })
  }, [mes]) // eslint-disable-line react-hooks/exhaustive-deps

  const valorCampo = (campo, v) => {
    if (v == null || v === '') return '(vazio)'
    if (campo === 'valor') return dinheiro(v)
    if (campo === 'vencimento' || campo === 'competencia') return dataBR(v)
    if (campo === 'plano_conta_id') { const p = cad.planos.find((x) => x.id === v); return p ? `${p.codigo} ${p.nome}` : 'outra conta' }
    if (campo === 'centro_custo_id') return cad.centros.find((x) => x.id === v)?.nome ?? 'outro centro'
    if (campo === 'fornecedor_id') { const f = cad.fornecedores.find((x) => x.id === v); return f ? f.nome_fantasia || f.razao_social : 'outro fornecedor' }
    if (campo === 'cliente_id') return cad.clientes.find((x) => x.id === v)?.nome ?? 'outro cliente'
    return String(v)
  }
  const visiveis = (itens ?? []).filter((h) => !acao || h.acao === acao)

  return (
    <div className="cartao overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-papel-200 p-3 dark:border-noite-700">
        <NavegadorMes mes={mes} onMudar={setMes} max={hojeISO().slice(0, 7)} />
        <div className="w-56"><Lista valor={acao} opcoes={[{ valor: null, texto: 'Todas as ações' }, ...Object.entries(ACOES).map(([k, [t]]) => ({ valor: k, texto: t }))]} onMudar={setAcao} /></div>
        <p className="ml-auto text-sm text-tinta-400">{itens ? `${visiveis.length} registro(s)` : ''}</p>
      </div>
      {itens === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : visiveis.length === 0 ? (
        <Vazio icone="relogio" titulo="Nenhuma alteração neste mês" texto="Tudo o que for criado, editado, pago, cancelado ou reclassificado no financeiro fica registrado aqui, com quem fez e quando." />
      ) : (
        <ul className="divide-y divide-papel-200 dark:divide-noite-700">
          {visiveis.map((h) => {
            const [nome, tom] = ACOES[h.acao] ?? [h.acao, 'neutro']
            const d = h.detalhes || {}
            const mudancas = d.depois ? Object.keys(d.depois) : []
            return (
              <li key={h.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                <span className="w-32 shrink-0 text-sm text-tinta-400">{dataHora(h.quando)}</span>
                <span className="w-40 shrink-0"><Etiqueta tom={tom}>{nome}</Etiqueta></span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{h.descricao ?? 'Lançamento'} <span className="font-normal text-tinta-400">{h.tipo === 'receber' ? 'a receber' : 'a pagar'}</span></p>
                  {mudancas.map((k) => <p key={k} className="text-sm"><span className="text-tinta-400">{CAMPOS[k] ?? k}:</span> {valorCampo(k, d.antes?.[k])} <span className="text-tinta-400">→</span> {valorCampo(k, d.depois[k])}</p>)}
                  {(h.acao === 'pagou' || h.acao === 'recebeu') && d.data && <p className="text-sm text-tinta-400">Data {dataBR(d.data)}{Number(d.juros) ? `, juros ${dinheiro(d.juros)}` : ''}{Number(d.desconto) ? `, desconto ${dinheiro(d.desconto)}` : ''}</p>}
                  <p className="text-xs text-tinta-400">por {h.usuario ?? 'sistema'}</p>
                </div>
                <span className="num shrink-0 font-semibold">{h.valor != null ? dinheiro(h.valor) : ''}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
