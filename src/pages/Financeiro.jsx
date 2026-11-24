import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { dinheiro, lerNumero, arred } from '../lib/formato.js'
import { lerBoleto, NOMES_BANCOS } from '../lib/boleto.js'
import { LeitorBoleto } from '../components/LeitorCamera.jsx'
import { contaPorPalavra, semAvisoEstimado, paraCsv, baixarArquivo } from '../lib/financeiro.js'
import { DespesasFixas } from './financeiro/DespesasFixas.jsx'
import { Relatorios } from './financeiro/Relatorios.jsx'
import { Conferencia } from './financeiro/Conferencia.jsx'
import { Botao, Cabecalho, Campo, Confirmacao, Etiqueta, Icone, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'

import { hojeISO, somaDias, somaMeses, dataBR, reais, MESES } from './financeiro/comum.js'

const FORMAS = [
  { valor: 'pix', texto: 'PIX' }, { valor: 'boleto', texto: 'Boleto' }, { valor: 'transferencia', texto: 'Transferência' },
  { valor: 'dinheiro', texto: 'Dinheiro' }, { valor: 'debito', texto: 'Débito automático' }, { valor: 'cartao', texto: 'Cartão de crédito' },
  { valor: 'cheque', texto: 'Cheque' },
]
export const GRUPOS_DRE = [
  { valor: 'receita_bruta', texto: 'Receita bruta' }, { valor: 'deducoes', texto: 'Deduções e impostos sobre vendas' },
  { valor: 'despesas_operacionais', texto: 'Despesas operacionais' }, { valor: 'despesas_financeiras', texto: 'Despesas financeiras' },
  { valor: 'receitas_financeiras', texto: 'Receitas financeiras' }, { valor: 'outras_receitas', texto: 'Outras receitas' },
  { valor: 'estoque', texto: 'Compras para estoque (vai ao CMV, fora da DRE)' }, { valor: 'nao_operacional', texto: 'Não operacional (fora da DRE)' },
]
const SITUACOES = [
  { valor: 'aberto', texto: 'Em aberto' }, { valor: 'vencido', texto: 'Vencidas' }, { valor: 'semana', texto: 'Vencem em 7 dias' },
  { valor: 'mes', texto: 'Vencem neste mês' }, { valor: 'pago', texto: 'Pagas' },
  { valor: 'cancelado', texto: 'Canceladas' }, { valor: 'todos', texto: 'Todas' },
]
const REPETICAO = [
  { valor: 'unica', texto: 'Parcela única' }, { valor: 'parcelada', texto: 'Parcelado (divide o valor)' }, { valor: 'mensal', texto: 'Repetir todo mês (mesmo valor)' },
]

function situacao(l, hoje) {
  if (l.status === 'cancelado') return { tom: 'neutro', texto: 'Cancelada' }
  if (l.status === 'pago') return { tom: 'positivo', texto: l.tipo === 'pagar' ? 'Paga' : 'Recebida' }
  if (l.vencimento < hoje) return { tom: 'critico', texto: `Vencida há ${Math.round((new Date(`${hoje}T12:00`) - new Date(`${l.vencimento}T12:00`)) / 864e5)} dia(s)` }
  if (l.vencimento === hoje) return { tom: 'alerta', texto: 'Vence hoje' }
  return { tom: Number(l.valor_pago) > 0 ? 'alerta' : 'neutro', texto: Number(l.valor_pago) > 0 ? 'Pago em parte' : 'A vencer' }
}
const aberto = (l) => arred(Number(l.valor) - Number(l.valor_pago))

export default function Financeiro() {
  const perfil = useSessao()
  const avisar = useAviso()
  const admin = perfil.papel === 'administrador'
  const [aba, setAba] = useState('geral')
  const [cad, setCad] = useState({ planos: [], centros: [], contas: [], fornecedores: [], clientes: [] })
  const [lancs, setLancs] = useState(null)
  const [cliTitulos, setCliTitulos] = useState([])

  const carregarCadastros = async () => {
    const [p, c, b, f, cl] = await Promise.all([
      supabase.from('plano_contas').select('*').order('codigo'),
      supabase.from('centros_custo').select('*').order('nome'),
      supabase.from('contas_bancarias').select('*').order('nome'),
      supabase.from('fornecedores').select('id, razao_social, nome_fantasia').order('razao_social'),
      supabase.from('clientes').select('id, nome').eq('ativo', true).order('nome'),
    ])
    if (p.error) avisar(mensagemErro(p.error), 'erro')
    setCad({ planos: p.data ?? [], centros: c.data ?? [], contas: b.data ?? [], fornecedores: f.data ?? [], clientes: cl.data ?? [] })
  }
  const carregarLancamentos = async () => {
    const [l, cr] = await Promise.all([
      supabase.from('lancamentos')
        .select('*, fornecedor:fornecedores(razao_social, nome_fantasia), cliente:clientes(nome), plano:plano_contas(codigo, nome), centro:centros_custo(nome), baixas:lancamento_baixas(*)')
        .order('vencimento').limit(3000),
      supabase.from('contas_receber').select('*, cliente:clientes(nome, telefone)').eq('status', 'aberta').order('vencimento'),
    ])
    if (l.error) avisar(mensagemErro(l.error), 'erro')
    setLancs(l.data ?? []); setCliTitulos(cr.data ?? [])
  }
  useEffect(() => {
    carregarCadastros()
    // Lança as despesas fixas do mês antes de mostrar as contas (não duplica)
    supabase.rpc('gerar_despesas_fixas').then(({ data }) => {
      if (data > 0) avisar(`${data} despesa(s) fixa(s) lançada(s) para este mês.`)
      carregarLancamentos()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ABAS = [['geral', 'Visão geral'], ['pagar', 'Contas a pagar'], ['receber', 'Contas a receber'], ['fixas', 'Despesas fixas'], ['fluxo', 'Fluxo de caixa'],
    ['relatorios', 'Relatórios e DRE'], ['conferencia', 'Conferência e histórico'], ['cadastros', 'Plano de contas e cadastros']]

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Financeiro" descricao="Contas a pagar e a receber, fluxo de caixa e resultado do negócio" />
      <div className="mb-4 inline-flex flex-wrap abas" role="tablist">
        {ABAS.map(([id, nome]) => (
          <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
            className={`aba ${aba === id ? 'aba-ativa' : ''}`}>{nome}</button>
        ))}
      </div>
      {(aba === 'pagar' || aba === 'receber') && (
        <Contas key={aba} tipo={aba} lancs={lancs} cliTitulos={cliTitulos} cad={cad} admin={admin} recarregar={carregarLancamentos} />
      )}
      {aba === 'geral' && <VisaoGeral admin={admin} irPara={setAba} />}
      {aba === 'fluxo' && <Fluxo />}
      {aba === 'fixas' && <DespesasFixas cad={cad} lancs={lancs} recarregarLancamentos={carregarLancamentos} />}
      {aba === 'relatorios' && <Relatorios cad={cad} dre={<Dre centros={cad.centros} />} />}
      {aba === 'conferencia' && <Conferencia cad={cad} lancs={lancs} recarregar={carregarLancamentos} />}
      {aba === 'cadastros' && <Cadastros cad={cad} recarregar={carregarCadastros} />}
    </div>
  )
}

// ---------------------------------------------------------------- Visão geral
const TIPOS_MOV = [
  { valor: 'deposito_vendas', texto: 'Entrada das vendas (repasse de cartão, PIX ou depósito do caixa)' },
  { valor: 'transferencia', texto: 'Transferência entre contas' },
  { valor: 'ajuste', texto: 'Ajuste de saldo (conferência com o extrato)' },
]
function VisaoGeral({ admin, irPara }) {
  const perfil = useSessao()
  const avisar = useAviso()
  const [p, setP] = useState(null)
  const [mov, setMov] = useState(null)
  const [metas, setMetas] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const carregar = async () => {
    const { data, error } = await supabase.rpc('painel_financeiro')
    if (error) avisar(mensagemErro(error), 'erro')
    setP(data ?? null)
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <p className="text-sm text-tinta-400">Carregando…</p>

  const saldos = (p.saldos ?? []).filter((c) => c.ativo)
  const saldoTotal = saldos.reduce((s, c) => s + Number(c.saldo), 0)
  const aPagar = Number(p.a_pagar_total)
  const livre = saldoTotal - aPagar
  // Projeção pelo ritmo: média diária do mês esticada até o último dia (não conta hoje se ainda não vendeu)
  const dia = Number(p.hoje.slice(8, 10))
  const base = Math.max(1, Number(p.venda_hoje) > 0 ? dia : dia - 1)
  const confiavel = base >= 4
  const projetada = (Number(p.vendas_mes) / base) * p.dias_mes
  const hist = (p.vendas_3_meses ?? []).map((x) => Number(x.t)).filter((x) => x > 0)
  const media = hist.length ? hist.reduce((s, x) => s + x, 0) / hist.length : null
  const comprometido = Number(p.pagos_mes) + Number(p.a_vencer_mes)
  const teto = Number(p.teto_gastos) || null
  const pctTeto = teto ? Math.round((comprometido / teto) * 100) : null
  const metaPct = Number(p.meta_retirada_pct) || null
  const baseRetirada = saldoTotal - Number(p.a_vencer_mes)
  const alvo = metaPct ? Math.max(0, baseRetirada * (metaPct / 100)) : null
  const restante = alvo != null ? alvo - Number(p.retiradas_mes) : null
  const rotMes = (k) => { const d = new Date(`${p.hoje.slice(0, 7)}-15T12:00:00`); d.setMonth(d.getMonth() + k); return MESES[d.getMonth()] }
  const despesas = (p.despesas ?? []).map((d) => {
    const v = (k) => Number(d.meses.find((m) => m.k === k)?.v ?? 0)
    return { ...d, serie: [-5, -4, -3, -2, -1, 0].map(v), total: [-5, -4, -3, -2, -1, 0].reduce((s, k) => s + v(k), 0) }
  }).sort((a, b) => b.total - a.total).slice(0, 10)
  const variacao = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null)

  const salvarMov = async () => {
    const valor = lerNumero(mov.valor)
    if (!mov.conta) { avisar('Escolha a conta.', 'erro'); return }
    if (Number.isNaN(valor) || valor === 0) { avisar('Informe o valor.', 'erro'); return }
    if (mov.tipo === 'transferencia' && !mov.destino) { avisar('Escolha a conta de destino.', 'erro'); return }
    const atual = saldos.find((c) => c.id === mov.conta)
    const v = mov.tipo === 'ajuste' ? arred(valor - Number(atual?.saldo ?? 0)) : valor
    if (mov.tipo === 'ajuste' && v === 0) { avisar('O saldo informado já é o saldo do sistema.', 'erro'); return }
    setEnviando(true)
    const { error } = await supabase.rpc('movimentar_conta', { p_conta: mov.conta, p_valor: v, p_tipo: mov.tipo, p_descricao: mov.descricao || TIPOS_MOV.find((t) => t.valor === mov.tipo).texto.replace(/ \(.*\)$/, ''), p_data: mov.data, p_destino: mov.destino })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Movimento registrado.'); setMov(null); carregar()
  }
  const salvarMetas = async () => {
    const t = metas.teto === '' ? null : lerNumero(metas.teto)
    const r = metas.retirada === '' ? null : lerNumero(metas.retirada)
    if ((t != null && !(t >= 0)) || (r != null && !(r >= 0 && r <= 100))) { avisar('Valores inválidos.', 'erro'); return }
    setEnviando(true)
    const { error } = await supabase.from('empresas').update({ teto_gastos: t, meta_retirada_pct: r }).eq('id', perfil.empresa.id)
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Metas salvas.'); setMetas(null); carregar()
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Saldo nas contas" icone="dinheiro" tom={saldoTotal < 0 ? 'critico' : 'neutro'} valor={dinheiro(saldoTotal)} detalhe={`${saldos.length} conta(s) e caixa(s)`} />
        <Indicador titulo="Caixa livre" icone="ok" tom={livre < 0 ? 'critico' : 'positivo'} valor={dinheiro(livre)} detalhe={`Saldo menos ${dinheiro(aPagar)} a pagar`} />
        <Indicador titulo="A receber" icone="relogio" valor={dinheiro(p.a_receber_total)} detalhe="Lançamentos, crediário e convênio" />
        <Indicador titulo="Vendas no mês" icone="vendas" valor={dinheiro(p.vendas_mes)} detalhe={`${p.dias_com_venda} dia(s) com venda`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="cartao overflow-hidden">
          <div className="flex items-center justify-between border-b border-papel-200 px-4 py-3 dark:border-noite-700">
            <p className="font-semibold">Contas e saldos</p>
            <Botao variante="secundario" icone="mais" className="py-1" onClick={() => setMov({ tipo: 'deposito_vendas', conta: saldos.find((c) => c.tipo === 'banco')?.id ?? saldos[0]?.id ?? null, destino: null, valor: '', descricao: '', data: hojeISO() })}>Movimentar</Botao>
          </div>
          {saldos.length === 0 ? <p className="p-4 text-sm text-tinta-400">Cadastre contas na aba Plano de contas e cadastros.</p> : (
            <ul className="divide-y divide-papel-200 dark:divide-noite-700">
              {saldos.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-4 py-3">
                  <span>{c.nome}<span className="block text-xs text-tinta-400">{{ caixa: 'Caixa', banco: 'Conta bancária', carteira: 'Carteira digital' }[c.tipo]}</span></span>
                  <span className={`num font-semibold ${Number(c.saldo) < 0 ? 'text-rubro-600 dark:text-rubro-300' : ''}`}>{dinheiro(c.saldo)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-papel-200 px-4 py-2 text-xs text-tinta-400 dark:border-noite-700">Saldo inicial + pagamentos e recebimentos baixados na conta + movimentos.</p>
        </div>

        <div className="cartao p-4">
          <p className="font-semibold">Projeção do mês</p>
          {!confiavel ? <p className="mt-2 text-sm text-tinta-400">Ainda cedo no mês ({base} dia(s) de venda). A projeção fica confiável a partir do 4º dia.</p> : <>
            <p className="mt-2 text-sm text-tinta-400">No ritmo atual, as vendas devem fechar em</p>
            <p className="num text-[1.9rem] font-semibold leading-tight">{dinheiro(projetada)}</p>
            {media && (() => { const v = variacao(projetada, media); return <p className="text-sm"><Etiqueta tom={v > 0 ? 'positivo' : v < 0 ? 'critico' : 'neutro'}>{v > 0 ? '+' : ''}{v}% frente à média dos últimos {hist.length} mês(es)</Etiqueta></p> })()}
          </>}
          <div className="mt-3 space-y-1.5 border-t border-papel-200 pt-3 text-sm dark:border-noite-700">
            <p className="flex justify-between"><span>Despesas já pagas no mês</span><span className="num">{dinheiro(p.pagos_mes)}</span></p>
            <p className="flex justify-between"><span>Ainda vencem até o fim do mês</span><span className="num">{dinheiro(p.a_vencer_mes)}</span></p>
            <p className="flex justify-between"><span>Compras de mercadoria pagas</span><span className="num text-tinta-400">{dinheiro(p.compras_mes)}</span></p>
            {confiavel && <p className="flex justify-between font-semibold"><span>Vendas projetadas menos despesas</span><span className={`num ${projetada - comprometido < 0 ? 'text-rubro-600 dark:text-rubro-300' : 'text-caixa-600 dark:text-caixa-300'}`}>{dinheiro(projetada - comprometido)}</span></p>}
          </div>
          <p className="mt-2 text-xs text-tinta-400">Despesas sem compras de mercadoria, que voltam como venda. Não considera sazonalidade.</p>
        </div>

        <div className="cartao p-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Metas do mês</p>
            {admin && <Botao variante="secundario" className="py-1" onClick={() => setMetas({ teto: teto ? reais(teto) : '', retirada: metaPct ? String(metaPct).replace('.', ',') : '' })}>Definir metas</Botao>}
          </div>
          <div className="mt-3">
            <p className="flex justify-between text-sm"><span>Teto de gastos</span><strong className={`num ${pctTeto > 100 ? 'text-rubro-600 dark:text-rubro-300' : ''}`}>{teto ? `${pctTeto}%` : 'não definido'}</strong></p>
            {teto && <>
              <div className="mt-1.5 h-2 w-full rounded-full bg-papel-200 dark:bg-noite-700"><div className={`h-2 rounded-full ${pctTeto > 100 ? 'bg-rubro-600' : pctTeto > 85 ? 'bg-ambar-600' : 'bg-caixa-500'}`} style={{ width: `${Math.min(100, pctTeto)}%` }} /></div>
              <p className="mt-1 text-xs text-tinta-400">{dinheiro(comprometido)} comprometidos de {dinheiro(teto)}</p>
            </>}
          </div>
          <div className="mt-4 border-t border-papel-200 pt-3 dark:border-noite-700">
            <p className="flex justify-between text-sm"><span>Retirada dos sócios</span><strong className="num">{metaPct ? `${String(metaPct).replace('.', ',')}% do disponível` : 'meta não definida'}</strong></p>
            <div className="mt-2 space-y-1 text-sm">
              <p className="flex justify-between"><span>Já retirado no mês</span><span className="num">{dinheiro(p.retiradas_mes)}</span></p>
              {alvo != null && <>
                <p className="flex justify-between"><span>Meta do mês</span><span className="num">{dinheiro(alvo)}</span></p>
                <p className="flex justify-between font-semibold"><span>{restante >= 0 ? 'Ainda cabe retirar' : 'Passou da meta em'}</span><span className={`num ${restante >= 0 ? 'text-caixa-600 dark:text-caixa-300' : 'text-rubro-600 dark:text-rubro-300'}`}>{dinheiro(Math.abs(restante))}</span></p>
              </>}
            </div>
            <p className="mt-2 text-xs text-tinta-400">Base: saldo nas contas menos o que vence até o fim do mês. Conta pró-labore (4.04) e retirada dos sócios (6.01).</p>
          </div>
        </div>
      </div>

      <div className="mt-4 cartao overflow-hidden">
        <div className="flex items-center justify-between border-b border-papel-200 px-4 py-3 dark:border-noite-700">
          <div><p className="font-semibold">Despesas por conta nos últimos 6 meses</p><p className="text-sm text-tinta-400">Por competência, sem compras de mercadoria. Variação do mês atual frente ao anterior.</p></div>
          <Botao variante="secundario" className="py-1" onClick={() => irPara('dre')}>Ver DRE</Botao>
        </div>
        {despesas.length === 0 ? <Vazio icone="grafico" titulo="Sem despesas lançadas" texto="As despesas aparecem aqui conforme forem lançadas em Contas a pagar." /> : (
          <div className="overflow-x-auto">
            <table className="tabela w-full whitespace-nowrap text-[0.95rem]">
              <thead><tr><th>Conta</th>{[-5, -4, -3, -2, -1, 0].map((k) => <th key={k} className="text-right">{rotMes(k)}</th>)}<th className="text-right">Variação</th></tr></thead>
              <tbody>
                {despesas.map((d) => {
                  const v = variacao(d.serie[5], d.serie[4])
                  return (
                    <tr key={d.codigo}>
                      <td><span className="text-tinta-400">{d.codigo}</span> {d.nome}</td>
                      {d.serie.map((x, k) => <td key={k} className={`num text-right ${k === 5 ? 'font-semibold' : ''}`}>{x ? x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>)}
                      <td className="text-right">{v == null ? '—' : <Etiqueta tom={v > 10 ? 'critico' : v < -10 ? 'positivo' : 'neutro'}>{v > 0 ? '+' : ''}{v}%</Etiqueta>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TelaSuspensa aberta={!!mov} titulo="Movimentar conta" subtitulo="Dinheiro que entra ou muda de conta sem passar por um lançamento" onFechar={() => setMov(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setMov(null)}>Cancelar</Botao>
          <Botao onClick={salvarMov} carregando={enviando}>Registrar</Botao>
        </>}>
        {mov && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Campo rotulo="Tipo"><Lista valor={mov.tipo} opcoes={TIPOS_MOV} onMudar={(v) => setMov((m) => ({ ...m, tipo: v }))} /></Campo></div>
            <Campo rotulo={mov.tipo === 'transferencia' ? 'Sai da conta' : 'Conta'}><Lista valor={mov.conta} opcoes={saldos.map((c) => ({ valor: c.id, texto: c.nome }))} onMudar={(v) => setMov((m) => ({ ...m, conta: v }))} /></Campo>
            {mov.tipo === 'transferencia'
              ? <Campo rotulo="Entra na conta"><Lista valor={mov.destino} opcoes={saldos.filter((c) => c.id !== mov.conta).map((c) => ({ valor: c.id, texto: c.nome }))} onMudar={(v) => setMov((m) => ({ ...m, destino: v }))} /></Campo>
              : <Campo rotulo="Data"><input type="date" className="campo" value={mov.data} onChange={(e) => setMov((m) => ({ ...m, data: e.target.value }))} /></Campo>}
            <Campo rotulo={mov.tipo === 'ajuste' ? 'Saldo correto no extrato' : 'Valor'} ajuda={mov.tipo === 'ajuste' ? `Saldo no sistema: ${dinheiro(saldos.find((c) => c.id === mov.conta)?.saldo ?? 0)}` : null}>
              <input className="campo num" inputMode="decimal" value={mov.valor} onChange={(e) => setMov((m) => ({ ...m, valor: e.target.value }))} placeholder="0,00" />
            </Campo>
            <Campo rotulo="Descrição"><input className="campo" value={mov.descricao} onChange={(e) => setMov((m) => ({ ...m, descricao: e.target.value }))} placeholder={mov.tipo === 'deposito_vendas' ? 'Ex.: Repasse da maquininha' : ''} /></Campo>
          </div>
        )}
      </TelaSuspensa>

      <TelaSuspensa aberta={!!metas} titulo="Metas financeiras" subtitulo="Valem para todos os meses até serem alteradas" onFechar={() => setMetas(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setMetas(null)}>Cancelar</Botao>
          <Botao onClick={salvarMetas} carregando={enviando}>Salvar metas</Botao>
        </>}>
        {metas && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Teto de gastos mensal (R$)" ajuda="Despesas pagas e a vencer no mês, sem mercadoria"><input className="campo num" inputMode="decimal" value={metas.teto} onChange={(e) => setMetas((m) => ({ ...m, teto: e.target.value }))} placeholder="Sem teto" /></Campo>
            <Campo rotulo="Meta de retirada (%)" ajuda="Do saldo disponível no mês"><input className="campo num" inputMode="decimal" value={metas.retirada} onChange={(e) => setMetas((m) => ({ ...m, retirada: e.target.value }))} placeholder="Sem meta" /></Campo>
          </div>
        )}
      </TelaSuspensa>
    </>
  )
}

// ---------------------------------------------------------------- Contas a pagar / a receber
function Contas({ tipo, lancs, cliTitulos, cad, admin, recarregar }) {
  const avisar = useAviso()
  const hoje = hojeISO()
  const pagar = tipo === 'pagar'
  const [filtro, setFiltro] = useState('aberto')
  const [mesFiltro, setMesFiltro] = useState(null)
  const [reclassificar, setReclassificar] = useState(null)
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState(null)
  const [detalhe, setDetalhe] = useState(null)
  const [baixa, setBaixa] = useState(null)
  const [cancelar, setCancelar] = useState(null)
  const [estorno, setEstorno] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const doTipo = (lancs ?? []).filter((l) => l.tipo === tipo)
  const abertos = doTipo.filter((l) => l.status === 'aberto')
  const somaAberto = (ls) => ls.reduce((s, l) => s + aberto(l), 0)
  const vencidos = abertos.filter((l) => l.vencimento < hoje)
  const deHoje = abertos.filter((l) => l.vencimento === hoje)
  const semana = abertos.filter((l) => l.vencimento > hoje && l.vencimento <= somaDias(hoje, 7))
  const mes = hoje.slice(0, 7)
  const pagoMes = doTipo.flatMap((l) => l.baixas ?? []).filter((b) => b.data.slice(0, 7) === mes).reduce((s, b) => s + Number(b.valor), 0)

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return doTipo.filter((l) => {
      if (filtro === 'aberto' && l.status !== 'aberto') return false
      if (filtro === 'vencido' && !(l.status === 'aberto' && l.vencimento < hoje)) return false
      if (filtro === 'semana' && !(l.status === 'aberto' && l.vencimento >= hoje && l.vencimento <= somaDias(hoje, 7))) return false
      if (filtro === 'mes' && !(l.status === 'aberto' && l.vencimento.slice(0, 7) === hoje.slice(0, 7))) return false
      if (mesFiltro && l.vencimento.slice(0, 7) !== mesFiltro) return false
      if ((filtro === 'pago' || filtro === 'cancelado') && l.status !== filtro) return false
      if (!t) return true
      return [l.descricao, l.documento, l.fornecedor?.razao_social, l.fornecedor?.nome_fantasia, l.cliente?.nome, l.plano?.nome]
        .some((x) => String(x ?? '').toLowerCase().includes(t))
    })
  }, [doTipo, filtro, busca, hoje, mesFiltro])
  const totalLista = visiveis.reduce((t, l) => ({ valor: t.valor + Number(l.valor), aberto: t.aberto + (l.status === 'aberto' ? aberto(l) : 0) }), { valor: 0, aberto: 0 })
  const mesesFiltro = useMemo(() => {
    const ms = [...new Set(doTipo.map((l) => l.vencimento.slice(0, 7)))].sort().reverse()
    return [{ valor: null, texto: 'Todos os meses' }, ...ms.map((m) => ({ valor: m, texto: `${MESES[Number(m.slice(5)) - 1]} de ${m.slice(0, 4)}` }))]
  }, [doTipo])
  const exportar = () => {
    baixarArquivo(`contas-a-${pagar ? 'pagar' : 'receber'}-${hoje}.csv`, paraCsv(
      ['Vencimento', 'Competência', 'Descrição', pagar ? 'Fornecedor' : 'Cliente', 'Código', 'Conta', 'Centro de custo', 'Documento', 'Valor', 'Pago', 'Em aberto', 'Situação'],
      visiveis.map((l) => [dataBR(l.vencimento), dataBR(l.competencia), l.descricao, pessoa(l), l.plano?.codigo, l.plano?.nome, l.centro?.nome, l.documento,
        Number(l.valor), Number(l.valor_pago), l.status === 'aberto' ? aberto(l) : 0, situacao(l, hoje).texto])))
  }
  const copiarLinha = async (linha) => {
    try { await navigator.clipboard.writeText(linha); avisar('Linha digitável copiada.') } catch { avisar('Não foi possível copiar. Selecione e copie a linha.', 'erro') }
  }

  const titulosCliente = !pagar ? cliTitulos : []
  const pessoa = (l) => (pagar ? l.fornecedor?.nome_fantasia || l.fornecedor?.razao_social : l.cliente?.nome) || '—'

  const novo = () => setForm({
    tipo, descricao: '', pessoa_id: null, plano_conta_id: null, centro_custo_id: cad.centros.find((c) => c.ativo)?.id ?? null,
    documento: '', linha_digitavel: '', valor: '', vencimento: hoje, competencia: hoje, repeticao: 'unica', vezes: '2', observacao: '',
    ja_pago: false, conta_pagamento: (cad.contas.find((c) => c.ativo && c.tipo === 'banco') ?? cad.contas.find((c) => c.ativo))?.id ?? null, forma: pagar ? 'pix' : 'pix',
  })
  const editar = (l) => setForm({
    id: l.id, tipo, descricao: l.descricao, pessoa_id: pagar ? l.fornecedor_id : l.cliente_id, plano_conta_id: l.plano_conta_id,
    centro_custo_id: l.centro_custo_id, documento: l.documento ?? '', linha_digitavel: l.linha_digitavel ?? '', valor: reais(l.valor),
    vencimento: l.vencimento, competencia: l.competencia, observacao: l.observacao ?? '', valor_pago: l.valor_pago,
  })

  const confirmarCancelamento = async () => {
    setEnviando(true)
    const { error } = await supabase.from('lancamentos').update({ status: 'cancelado' }).eq('id', cancelar.id)
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Lançamento cancelado.'); setCancelar(null); setDetalhe(null); recarregar()
  }
  const confirmarEstorno = async () => {
    setEnviando(true)
    const { error } = await supabase.rpc('estornar_baixa', { p_baixa: estorno.id })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Baixa estornada.'); setEstorno(null); setDetalhe(null); recarregar()
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Vencidas" icone="alerta" tom={vencidos.length ? 'critico' : 'neutro'} valor={dinheiro(somaAberto(vencidos) + (!pagar ? titulosCliente.filter((t) => t.vencimento < hoje).reduce((s, t) => s + Number(t.valor) - Number(t.valor_pago), 0) : 0))} detalhe={`${vencidos.length} lançamento(s)${!pagar ? ' + crediário e convênio' : ''}`} />
        <Indicador titulo="Vencem hoje" icone="relogio" tom={deHoje.length ? 'alerta' : 'neutro'} valor={dinheiro(somaAberto(deHoje))} detalhe={`${deHoje.length} lançamento(s)`} />
        <Indicador titulo="Próximos 7 dias" icone="nota" valor={dinheiro(somaAberto(semana))} detalhe={`${semana.length} lançamento(s)`} />
        <Indicador titulo={pagar ? 'Pago no mês' : 'Recebido no mês'} icone="dinheiro" tom="positivo" valor={dinheiro(pagoMes)} detalhe="Baixas lançadas neste mês" />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-papel-200 p-3 dark:border-noite-700">
          <div className="w-48"><Lista valor={filtro} opcoes={SITUACOES} onMudar={setFiltro} /></div>
          <div className="w-48"><Lista valor={mesFiltro} opcoes={mesesFiltro} onMudar={setMesFiltro} /></div>
          <div className="relative min-w-[14rem] flex-1">
            <Icone nome="busca" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tinta-400" />
            <input className="campo pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={`Buscar por descrição, documento, ${pagar ? 'fornecedor' : 'cliente'} ou conta`} />
          </div>
          <Botao variante="secundario" icone="nota" onClick={exportar} disabled={!visiveis.length}>Exportar</Botao>
          <Botao icone="mais" onClick={novo}>{pagar ? 'Nova conta a pagar' : 'Nova conta a receber'}</Botao>
        </div>
        {lancs === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : visiveis.length === 0 ? (
          <Vazio icone="dinheiro" titulo={doTipo.length ? 'Nada encontrado neste filtro' : pagar ? 'Nenhuma conta a pagar' : 'Nenhuma conta a receber'}
            texto={pagar ? 'Lance aluguel, energia, salários e boletos. As notas de compra geram as contas sozinhas ao serem importadas.' : 'Lance receitas de serviços, aluguéis e outros valores a receber. O crediário e o convênio dos clientes aparecem abaixo.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr><th>Vencimento</th><th>Descrição</th><th>{pagar ? 'Fornecedor' : 'Cliente'}</th><th>Conta</th><th className="text-right">Valor</th><th className="text-right">Em aberto</th><th>Situação</th></tr></thead>
              <tbody>
                {visiveis.map((l) => {
                  const s = situacao(l, hoje)
                  return (
                    <tr key={l.id} onClick={() => setDetalhe(l)} className="cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40">
                      <td className="num whitespace-nowrap">{dataBR(l.vencimento)}</td>
                      <td className="font-medium">{l.descricao}{l.parcelas > 1 && <span className="font-normal text-tinta-400"> {l.parcela}/{l.parcelas}</span>}
                        {l.documento && <span className="block text-xs font-normal text-tinta-400">Doc. {l.documento}</span>}</td>
                      <td>{pessoa(l)}</td>
                      <td><span className="text-tinta-400">{l.plano?.codigo}</span> {l.plano?.nome}</td>
                      <td className="num text-right">{dinheiro(l.valor)}</td>
                      <td className="num text-right font-semibold">{l.status === 'aberto' ? dinheiro(aberto(l)) : '—'}</td>
                      <td><Etiqueta tom={s.tom}>{s.texto}</Etiqueta></td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot><tr className="font-semibold"><td colSpan={4}>{visiveis.length} lançamento(s)</td><td className="num text-right">{dinheiro(totalLista.valor)}</td><td className="num text-right">{dinheiro(totalLista.aberto)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </div>

      {!pagar && titulosCliente.length > 0 && (
        <div className="mt-4 cartao overflow-hidden">
          <div className="border-b border-papel-200 px-4 py-3 dark:border-noite-700">
            <p className="font-semibold">Crediário e convênio dos clientes</p>
            <p className="text-sm text-tinta-400">Gerados nas vendas a prazo. Recebimento pela tela Clientes, aba Contas a receber.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr><th>Vencimento</th><th>Cliente</th><th>Origem</th><th className="text-right">Em aberto</th><th>Situação</th></tr></thead>
              <tbody>
                {titulosCliente.slice(0, 50).map((t) => (
                  <tr key={t.id}>
                    <td className="num">{dataBR(t.vencimento)}</td>
                    <td>{t.cliente?.nome}</td>
                    <td>{t.origem === 'convenio' ? 'Convênio' : 'Crediário'} {t.parcelas > 1 && <span className="text-tinta-400">{t.parcela}/{t.parcelas}</span>}</td>
                    <td className="num text-right font-semibold">{dinheiro(Number(t.valor) - Number(t.valor_pago))}</td>
                    <td>{t.vencimento < hoje ? <Etiqueta tom="critico">Vencida</Etiqueta> : <Etiqueta>A vencer</Etiqueta>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {form && <FormLancamento form={form} setForm={setForm} cad={cad} lancs={lancs ?? []} onSalvo={() => { setForm(null); setDetalhe(null); recarregar() }} />}

      <TelaSuspensa aberta={!!detalhe} titulo={detalhe?.descricao ?? ''} subtitulo={detalhe ? `${pessoa(detalhe)}, vencimento ${dataBR(detalhe.vencimento)}` : ''} onFechar={() => setDetalhe(null)} largura="max-w-2xl"
        rodape={detalhe && <>
          {detalhe.status === 'aberto' && Number(detalhe.valor_pago) === 0 && <Botao variante="secundario" className="mr-auto" onClick={() => setCancelar(detalhe)}>Cancelar lançamento</Botao>}
          {detalhe.status === 'aberto' && <Botao variante="secundario" onClick={() => { editar(detalhe); setDetalhe(null) }}>Editar</Botao>}
          {detalhe.status === 'pago' && <Botao variante="secundario" onClick={() => { setReclassificar({ l: detalhe, plano_conta_id: detalhe.plano_conta_id, centro_custo_id: detalhe.centro_custo_id }); setDetalhe(null) }}>Reclassificar</Botao>}
          {detalhe.status === 'aberto'
            ? <Botao icone="ok" onClick={() => { setBaixa({ l: detalhe, data: hoje, valor: reais(aberto(detalhe)), juros: '', desconto: '', conta: (cad.contas.find((c) => c.ativo && c.tipo === 'banco') ?? cad.contas.find((c) => c.ativo))?.id ?? null, forma: pagar ? 'boleto' : 'pix' }); setDetalhe(null) }}>{pagar ? 'Registrar pagamento' : 'Registrar recebimento'}</Botao>
            : <Botao variante="secundario" onClick={() => setDetalhe(null)}>Fechar</Botao>}
        </>}>
        {detalhe && (
          <div className="space-y-4">
            <div className="grid gap-3 text-[0.95rem] sm:grid-cols-3">
              <Dado rotulo="Valor" valor={dinheiro(detalhe.valor)} />
              <Dado rotulo={pagar ? 'Já pago' : 'Já recebido'} valor={dinheiro(detalhe.valor_pago)} />
              <Dado rotulo="Em aberto" valor={detalhe.status === 'aberto' ? dinheiro(aberto(detalhe)) : '—'} forte />
              <Dado rotulo="Plano de contas" valor={`${detalhe.plano?.codigo} ${detalhe.plano?.nome}`} />
              <Dado rotulo="Centro de custo" valor={detalhe.centro?.nome ?? '—'} />
              <Dado rotulo="Competência" valor={dataBR(detalhe.competencia)} />
              {detalhe.documento && <Dado rotulo="Documento" valor={detalhe.documento} />}
              {detalhe.parcelas > 1 && <Dado rotulo="Parcela" valor={`${detalhe.parcela} de ${detalhe.parcelas}`} />}
            </div>
            {detalhe.linha_digitavel && (
              <div className="flex items-start gap-2 rounded-lg bg-papel-200 px-3 py-2 dark:bg-noite-700">
                <p className="min-w-0 flex-1 break-all font-mono text-sm">{detalhe.linha_digitavel}</p>
                <button className="shrink-0 text-sm font-semibold text-caixa-600 hover:underline dark:text-caixa-300" onClick={() => copiarLinha(detalhe.linha_digitavel)}>Copiar</button>
              </div>
            )}
            {detalhe.observacao && <p className="text-sm text-tinta-400">{detalhe.observacao}</p>}
            <div>
              <p className="mb-1 font-semibold">{pagar ? 'Pagamentos' : 'Recebimentos'}</p>
              {(detalhe.baixas ?? []).length === 0 ? <p className="text-sm text-tinta-400">Nenhum registrado.</p> : (
                <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
                  <thead><tr><th>Data</th><th>Forma</th><th>Conta</th><th className="text-right">Valor</th><th className="text-right">Juros</th><th className="text-right">Desconto</th>{admin && <th />}</tr></thead>
                  <tbody>
                    {detalhe.baixas.map((b) => (
                      <tr key={b.id}>
                        <td className="num">{dataBR(b.data)}</td>
                        <td>{FORMAS.find((f) => f.valor === b.forma)?.texto ?? '—'}</td>
                        <td>{cad.contas.find((c) => c.id === b.conta_bancaria_id)?.nome ?? '—'}</td>
                        <td className="num text-right">{dinheiro(b.valor)}</td>
                        <td className="num text-right">{Number(b.juros) ? dinheiro(b.juros) : '—'}</td>
                        <td className="num text-right">{Number(b.desconto) ? dinheiro(b.desconto) : '—'}</td>
                        {admin && <td className="text-right"><button className="text-sm font-medium text-rubro-600 hover:underline" onClick={() => setEstorno(b)}>Estornar</button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </TelaSuspensa>

      {reclassificar && <JanelaReclassificar item={reclassificar} setItem={setReclassificar} cad={cad} pagar={pagar} onFeito={() => { setReclassificar(null); recarregar() }} />}
      {baixa && <FormBaixa baixa={baixa} setBaixa={setBaixa} contas={cad.contas} pagar={pagar} onFeito={() => { setBaixa(null); setDetalhe(null); recarregar() }} />}
      <Confirmacao aberta={!!cancelar} titulo="Cancelar lançamento" mensagem="O lançamento deixa de contar no fluxo de caixa e na DRE. Esta ação não pode ser desfeita." textoConfirmar="Cancelar lançamento" variante="perigo" carregando={enviando} onCancelar={() => setCancelar(null)} onConfirmar={confirmarCancelamento} />
      <Confirmacao aberta={!!estorno} titulo="Estornar baixa" mensagem={estorno ? `A baixa de ${dinheiro(estorno.valor)} em ${dataBR(estorno.data)} será desfeita e o lançamento volta a ficar em aberto.` : ''} textoConfirmar="Estornar" variante="perigo" carregando={enviando} onCancelar={() => setEstorno(null)} onConfirmar={confirmarEstorno} />
    </>
  )
}

function Dado({ rotulo, valor, forte }) {
  return <div><p className="text-xs text-tinta-400">{rotulo}</p><p className={`num ${forte ? 'font-semibold' : ''}`}>{valor}</p></div>
}

// Sugere fornecedor, plano e centro a partir do histórico (mesmo cedente do boleto, mesmo fornecedor ou mesma descrição)
function sugestaoDoHistorico(lancs, tipo, { boleto, pessoa_id, descricao }) {
  const doTipo = lancs.filter((l) => l.tipo === tipo && l.status !== 'cancelado').sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1))
  if (boleto?.tipo === 'bancario') {
    const livre = boleto.codigoBarras.slice(19)
    let melhor = null, ponto = 0, segundo = 0
    for (const l of doTipo) {
      const b = l.linha_digitavel && lerBoleto(l.linha_digitavel)
      if (!b?.valido || b.banco !== boleto.banco) continue
      const outro = b.codigoBarras.slice(19)
      let iguais = 0
      for (let k = 0; k < 25; k++) if (outro[k] === livre[k]) iguais++
      if (iguais > ponto) { segundo = ponto; ponto = iguais; melhor = l } else if (iguais > segundo && l.fornecedor_id !== melhor?.fornecedor_id) segundo = iguais
    }
    if (melhor && ponto >= 13 && ponto - segundo >= 2) return { ...melhor, motivo: 'mesmo cedente do boleto' }
  }
  if (pessoa_id) {
    const l = doTipo.find((x) => (tipo === 'pagar' ? x.fornecedor_id : x.cliente_id) === pessoa_id)
    if (l) return { ...l, motivo: 'último lançamento deste fornecedor' }
  }
  const d = descricao?.trim().toLowerCase()
  if (d && d.length >= 4) {
    const l = doTipo.find((x) => x.descricao.toLowerCase().startsWith(d))
    if (l) return { ...l, motivo: 'lançamento parecido' }
  }
  return null
}

function FormLancamento({ form, setForm, cad, lancs, onSalvo }) {
  const avisar = useAviso()
  const [enviando, setEnviando] = useState(false)
  const [repetido, setRepetido] = useState(null)
  const pagar = form.tipo === 'pagar'
  const mudar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e?.target ? e.target.value : e }))
  const boleto = form.linha_digitavel ? lerBoleto(form.linha_digitavel) : null
  const planos = cad.planos.filter((p) => p.ativo && p.tipo === (pagar ? 'despesa' : 'receita'))
  const pessoas = pagar
    ? cad.fornecedores.map((f) => ({ valor: f.id, texto: f.nome_fantasia || f.razao_social }))
    : cad.clientes.map((c) => ({ valor: c.id, texto: c.nome }))

  // Completa só o que ainda está vazio, para não desfazer o que a pessoa escolheu
  const aplicarSugestao = (f, sug) => (!sug || f.id ? f : {
    ...f,
    pessoa_id: f.pessoa_id ?? (pagar ? sug.fornecedor_id : sug.cliente_id) ?? null,
    plano_conta_id: f.plano_conta_id ?? sug.plano_conta_id,
    centro_custo_id: f.centro_custo_id ?? sug.centro_custo_id,
    descricao: f.descricao || sug.descricao.replace(/ duplicata .*$/, ''),
    sugestao: sug.motivo,
  })
  const [camera, setCamera] = useState(false)
  const lerLinha = (e) => preencherLinha(e.target.value)
  const preencherLinha = (texto) => {
    const b = lerBoleto(texto)
    setForm((f) => {
      const base = {
        ...f, linha_digitavel: texto,
        ...(b?.valido && b.valor ? { valor: reais(b.valor) } : {}),
        ...(b?.valido && b.vencimento ? { vencimento: b.vencimento } : {}),
      }
      return b?.valido ? aplicarSugestao(base, sugestaoDoHistorico(lancs, f.tipo, { boleto: b })) : base
    })
  }
  const escolherPessoa = (v) => setForm((f) => aplicarSugestao({ ...f, pessoa_id: v }, v ? sugestaoDoHistorico(lancs, f.tipo, { pessoa_id: v }) : null))
  const sairDescricao = () => setForm((f) => {
    if (f.plano_conta_id) return f
    const sug = sugestaoDoHistorico(lancs, f.tipo, { descricao: f.descricao })
    if (sug) return aplicarSugestao(f, sug)
    const plano = contaPorPalavra(f.descricao, cad.planos, f.tipo)
    return plano && !f.id ? { ...f, plano_conta_id: plano, sugestao: 'nome da descrição' } : f
  })

  const valor = lerNumero(form.valor)
  const vezes = form.repeticao === 'unica' || form.id ? 1 : Math.max(1, Math.min(120, parseInt(form.vezes, 10) || 1))
  const parcelas = useMemo(() => {
    if (!(valor > 0)) return []
    const base = form.repeticao === 'parcelada' ? Math.floor((valor / vezes) * 100) / 100 : valor
    return Array.from({ length: vezes }, (_, i) => ({
      parcela: i + 1,
      vencimento: somaMeses(form.vencimento, i),
      competencia: form.repeticao === 'mensal' ? somaMeses(form.competencia, i) : form.competencia,
      valor: form.repeticao === 'parcelada' && i === vezes - 1 ? arred(valor - base * (vezes - 1)) : base,
    }))
  }, [valor, vezes, form.repeticao, form.vencimento, form.competencia])

  const salvar = async (confirmado) => {
    if (!form.descricao.trim()) { avisar('Informe a descrição.', 'erro'); return }
    if (!form.plano_conta_id) { avisar('Escolha a conta do plano de contas.', 'erro'); return }
    if (!(valor > 0)) { avisar('Informe um valor maior que zero.', 'erro'); return }
    if (!form.vencimento || !form.competencia) { avisar('Informe vencimento e competência.', 'erro'); return }
    if (form.linha_digitavel && !boleto?.valido) { avisar('A linha digitável não confere. Verifique os números ou deixe em branco.', 'erro'); return }
    if (form.id && valor < Number(form.valor_pago)) { avisar('O valor não pode ficar menor que o já pago.', 'erro'); return }
    if (form.ja_pago && !form.conta_pagamento) { avisar(`Escolha a conta de onde ${pagar ? 'saiu' : 'entrou'} o dinheiro.`, 'erro'); return }
    if (!form.id && confirmado !== true) {
      const dup = lancs.find((l) => l.tipo === form.tipo && l.status !== 'cancelado' && Math.abs(Number(l.valor) - parcelas[0]?.valor) < 0.005
        && l.vencimento === parcelas[0]?.vencimento
        && ((form.pessoa_id && (pagar ? l.fornecedor_id : l.cliente_id) === form.pessoa_id) || l.descricao.trim().toLowerCase() === form.descricao.trim().toLowerCase()))
      if (dup) { setRepetido(dup); return }
    }
    const comum = {
      descricao: form.descricao.trim(), plano_conta_id: form.plano_conta_id, centro_custo_id: form.centro_custo_id,
      fornecedor_id: pagar ? form.pessoa_id : null, cliente_id: pagar ? null : form.pessoa_id,
      documento: form.documento.trim() || null, linha_digitavel: boleto?.linha ?? boleto?.codigoBarras ?? null, observacao: form.observacao.trim() || null,
    }
    setEnviando(true)
    let r
    if (form.id) {
      r = await supabase.from('lancamentos').update({ ...comum, observacao: semAvisoEstimado(comum.observacao) || null, valor, vencimento: form.vencimento, competencia: form.competencia }).eq('id', form.id)
    } else {
      const grupo = crypto.randomUUID()
      r = await supabase.from('lancamentos').insert(parcelas.map((p, i) => ({
        ...comum, tipo: form.tipo, valor: p.valor, vencimento: p.vencimento, competencia: p.competencia,
        parcela: p.parcela, parcelas: vezes, grupo_id: grupo, linha_digitavel: i === 0 ? comum.linha_digitavel : null,
      }))).select('id, valor')
      // "Já pago": registra a baixa da primeira parcela na hora
      if (!r.error && form.ja_pago && r.data?.[0]) {
        const b = await supabase.rpc('baixar_lancamento', { p_lancamento: r.data[0].id, p_valor: r.data[0].valor, p_data: form.vencimento <= hojeISO() ? form.vencimento : hojeISO(), p_conta: form.conta_pagamento, p_forma: form.forma, p_juros: 0, p_desconto: 0 })
        if (b.error) avisar(`Lançado, mas o pagamento não foi registrado: ${mensagemErro(b.error)}`, 'erro')
      }
    }
    setEnviando(false)
    if (r.error) { avisar(r.error.code === '23505' ? 'Este boleto já foi lançado.' : mensagemErro(r.error), 'erro'); return }
    avisar(form.id ? 'Lançamento atualizado.' : vezes > 1 ? `${vezes} lançamentos criados.` : 'Lançamento criado.')
    onSalvo()
  }

  return (
    <TelaSuspensa aberta titulo={form.id ? 'Editar lançamento' : pagar ? 'Nova conta a pagar' : 'Nova conta a receber'}
      subtitulo={pagar ? 'Digite ou cole a linha do boleto para preencher valor e vencimento' : 'Receitas que não passam pelo caixa'} onFechar={() => setForm(null)} largura="max-w-3xl"
      rodape={<>
        <Botao variante="secundario" onClick={() => setForm(null)}>Cancelar</Botao>
        <Botao onClick={() => salvar()} carregando={enviando}>{form.id ? 'Salvar alterações' : vezes > 1 ? `Criar ${vezes} lançamentos` : 'Salvar lançamento'}</Botao>
      </>}>
      <div className="space-y-4">
        {pagar && (
          <Campo rotulo="Linha digitável ou código de barras (opcional)"
            ajuda={boleto ? (boleto.valido ? `Boleto conferido${boleto.banco ? `: ${NOMES_BANCOS[boleto.banco] ?? `banco ${boleto.banco}`}` : ': concessionária ou tributo'}${boleto.valor ? `, ${dinheiro(boleto.valor)}` : ''}${boleto.vencimento ? `, vence ${dataBR(boleto.vencimento)}` : ''}` : 'Os dígitos verificadores não conferem') : 'Com leitor de código de barras, basta passar o boleto aqui.'}>
            <div className="flex gap-2">
              <input className={`campo min-w-0 flex-1 font-mono ${boleto && !boleto.valido ? 'border-rubro-600' : ''}`} value={form.linha_digitavel} onChange={lerLinha} inputMode="numeric" placeholder="00000.00000 00000.000000 00000.000000 0 00000000000000" />
              <Botao variante="secundario" icone="camera" onClick={() => setCamera(true)} title="Ler o código de barras pela câmera">Câmera</Botao>
            </div>
          </Campo>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Descrição"><input className="campo" value={form.descricao} onChange={mudar('descricao')} onBlur={sairDescricao} placeholder={pagar ? 'Ex.: Aluguel da loja' : 'Ex.: Aluguel da sala comercial'} autoFocus /></Campo>
          <Campo rotulo={pagar ? 'Fornecedor (opcional)' : 'Cliente (opcional)'}><Lista valor={form.pessoa_id} opcoes={[{ valor: null, texto: 'Nenhum' }, ...pessoas]} onMudar={escolherPessoa} /></Campo>
          <Campo rotulo="Plano de contas"><Lista valor={form.plano_conta_id} opcoes={planos.map((p) => ({ valor: p.id, texto: `${p.codigo} ${p.nome}` }))} onMudar={mudar('plano_conta_id')} /></Campo>
          <Campo rotulo="Centro de custo"><Lista valor={form.centro_custo_id} opcoes={[{ valor: null, texto: 'Nenhum' }, ...cad.centros.filter((c) => c.ativo).map((c) => ({ valor: c.id, texto: c.nome }))]} onMudar={mudar('centro_custo_id')} /></Campo>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Campo rotulo={form.repeticao === 'parcelada' && !form.id ? 'Valor total' : 'Valor'}><input className="campo num" inputMode="decimal" value={form.valor} onChange={mudar('valor')} placeholder="0,00" /></Campo>
          <Campo rotulo={vezes > 1 ? '1º vencimento' : 'Vencimento'}><input type="date" className="campo" value={form.vencimento} onChange={mudar('vencimento')} /></Campo>
          <Campo rotulo="Competência" ajuda="Mês em que conta na DRE"><input type="date" className="campo" value={form.competencia} onChange={mudar('competencia')} /></Campo>
          <Campo rotulo="Documento"><input className="campo" value={form.documento} onChange={mudar('documento')} placeholder="Nº da nota ou fatura" /></Campo>
        </div>
        {!form.id && (
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2"><Campo rotulo="Repetição"><Lista valor={form.repeticao} opcoes={REPETICAO} onMudar={mudar('repeticao')} /></Campo></div>
            {form.repeticao !== 'unica' && <Campo rotulo={form.repeticao === 'parcelada' ? 'Parcelas' : 'Meses'}><input className="campo num" inputMode="numeric" value={form.vezes} onChange={mudar('vezes')} /></Campo>}
          </div>
        )}
        {parcelas.length > 1 && (
          <div className="rounded-lg border border-papel-200 dark:border-noite-700">
            <p className="border-b border-papel-200 px-3 py-2 text-sm font-semibold dark:border-noite-700">Serão criados {parcelas.length} lançamentos</p>
            <div className="grid max-h-40 gap-x-6 overflow-auto px-3 py-2 text-sm sm:grid-cols-2">
              {parcelas.map((p) => <p key={p.parcela} className="flex justify-between"><span>{p.parcela}/{parcelas.length}, vence {dataBR(p.vencimento)}</span><span className="num">{dinheiro(p.valor)}</span></p>)}
            </div>
          </div>
        )}
        <Campo rotulo="Observação"><input className="campo" value={form.observacao} onChange={mudar('observacao')} /></Campo>
        {form.sugestao && <p className="flex items-center gap-2 text-sm text-caixa-600 dark:text-caixa-300"><Icone nome="ok" className="h-4 w-4" />Campos completados pelo {form.sugestao}. Confira antes de salvar.</p>}
        {!form.id && (
          <div className="rounded-lg border border-papel-200 p-3 dark:border-noite-700">
            <label className="flex items-center gap-2 font-medium"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={form.ja_pago} onChange={(e) => setForm((f) => ({ ...f, ja_pago: e.target.checked }))} />
              {pagar ? 'Já está pago' : 'Já foi recebido'}{vezes > 1 ? ' (só a 1ª parcela)' : ''}</label>
            {form.ja_pago && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Campo rotulo={pagar ? 'Saiu da conta' : 'Entrou na conta'}><Lista valor={form.conta_pagamento} opcoes={cad.contas.filter((c) => c.ativo).map((c) => ({ valor: c.id, texto: c.nome }))} onMudar={mudar('conta_pagamento')} /></Campo>
                <Campo rotulo="Forma"><Lista valor={form.forma} opcoes={FORMAS} onMudar={mudar('forma')} /></Campo>
              </div>
            )}
          </div>
        )}
      </div>
      <LeitorBoleto aberta={camera} onFechar={() => setCamera(false)} onLido={(b) => { setCamera(false); preencherLinha(b.linha); avisar('Boleto lido pela câmera. Confira os dados.') }} />
      <Confirmacao aberta={!!repetido} titulo="Possível lançamento repetido" textoConfirmar="Lançar mesmo assim" onCancelar={() => setRepetido(null)} onConfirmar={() => { setRepetido(null); salvar(true) }}
        mensagem={repetido ? `Já existe "${repetido.descricao}" de ${dinheiro(repetido.valor)} com vencimento em ${dataBR(repetido.vencimento)}${repetido.status === 'pago' ? ', já pago' : ''}. Lançar de novo pode duplicar a conta.` : ''} />
    </TelaSuspensa>
  )
}

// Título pago: só troca a conta do plano e o centro de custo (corrige relatórios sem mexer no pagamento)
function JanelaReclassificar({ item, setItem, cad, pagar, onFeito }) {
  const avisar = useAviso()
  const [enviando, setEnviando] = useState(false)
  const planos = cad.planos.filter((p) => p.ativo && p.tipo === (pagar ? 'despesa' : 'receita'))
  const salvar = async () => {
    setEnviando(true)
    const { error } = await supabase.from('lancamentos').update({ plano_conta_id: item.plano_conta_id, centro_custo_id: item.centro_custo_id }).eq('id', item.l.id)
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Lançamento reclassificado.'); onFeito()
  }
  return (
    <TelaSuspensa aberta titulo="Reclassificar lançamento" subtitulo={`${item.l.descricao}, ${dinheiro(item.l.valor)}. O pagamento não muda.`} onFechar={() => setItem(null)}
      rodape={<><Botao variante="secundario" onClick={() => setItem(null)}>Cancelar</Botao><Botao onClick={salvar} carregando={enviando}>Salvar</Botao></>}>
      <div className="space-y-3">
        <Campo rotulo="Plano de contas"><Lista valor={item.plano_conta_id} opcoes={planos.map((p) => ({ valor: p.id, texto: `${p.codigo} ${p.nome}` }))} onMudar={(v) => setItem((x) => ({ ...x, plano_conta_id: v }))} /></Campo>
        <Campo rotulo="Centro de custo"><Lista valor={item.centro_custo_id} opcoes={[{ valor: null, texto: 'Nenhum' }, ...cad.centros.filter((c) => c.ativo).map((c) => ({ valor: c.id, texto: c.nome }))]} onMudar={(v) => setItem((x) => ({ ...x, centro_custo_id: v }))} /></Campo>
      </div>
    </TelaSuspensa>
  )
}

function FormBaixa({ baixa, setBaixa, contas, pagar, onFeito }) {
  const avisar = useAviso()
  const [enviando, setEnviando] = useState(false)
  const mudar = (campo) => (e) => setBaixa((b) => ({ ...b, [campo]: e?.target ? e.target.value : e }))
  const valor = lerNumero(baixa.valor), juros = lerNumero(baixa.juros), desconto = lerNumero(baixa.desconto)
  const saldo = aberto(baixa.l)
  const restante = arred(saldo - (valor || 0) - (desconto || 0))
  const salvar = async () => {
    if (!(valor > 0)) { avisar('Informe o valor.', 'erro'); return }
    if (Number.isNaN(juros) || Number.isNaN(desconto) || juros < 0 || desconto < 0) { avisar('Juros e desconto inválidos.', 'erro'); return }
    if (restante < 0) { avisar(`O valor passa do saldo em aberto (${dinheiro(saldo)}).`, 'erro'); return }
    setEnviando(true)
    const { error } = await supabase.rpc('baixar_lancamento', {
      p_lancamento: baixa.l.id, p_valor: valor, p_data: baixa.data, p_conta: baixa.conta, p_forma: baixa.forma, p_juros: juros || 0, p_desconto: desconto || 0,
    })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(restante > 0 ? `Baixa parcial registrada. Restam ${dinheiro(restante)}.` : pagar ? 'Pagamento registrado.' : 'Recebimento registrado.')
    onFeito()
  }
  return (
    <TelaSuspensa aberta titulo={pagar ? 'Registrar pagamento' : 'Registrar recebimento'} subtitulo={`${baixa.l.descricao}: em aberto ${dinheiro(saldo)}`} onFechar={() => setBaixa(null)}
      rodape={<>
        <Botao variante="secundario" onClick={() => setBaixa(null)}>Cancelar</Botao>
        <Botao onClick={salvar} carregando={enviando}>Confirmar {dinheiro((valor || 0) + (juros || 0))}</Botao>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Data"><input type="date" className="campo" value={baixa.data} onChange={mudar('data')} /></Campo>
        <Campo rotulo="Forma"><Lista valor={baixa.forma} opcoes={FORMAS} onMudar={mudar('forma')} /></Campo>
        <div className="sm:col-span-2"><Campo rotulo={pagar ? 'Saiu da conta' : 'Entrou na conta'}><Lista valor={baixa.conta} opcoes={contas.filter((c) => c.ativo).map((c) => ({ valor: c.id, texto: c.nome }))} onMudar={mudar('conta')} /></Campo></div>
        <Campo rotulo="Valor principal" ajuda={restante > 0 ? `Ficam ${dinheiro(restante)} em aberto` : 'Quita o lançamento'}><input className="campo num" inputMode="decimal" value={baixa.valor} onChange={mudar('valor')} /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Juros e multa"><input className="campo num" inputMode="decimal" value={baixa.juros} onChange={mudar('juros')} placeholder="0,00" /></Campo>
          <Campo rotulo="Desconto"><input className="campo num" inputMode="decimal" value={baixa.desconto} onChange={mudar('desconto')} placeholder="0,00" /></Campo>
        </div>
      </div>
    </TelaSuspensa>
  )
}

// ---------------------------------------------------------------- Fluxo de caixa
const PERIODOS = [
  { valor: 'prox30', texto: 'Próximos 30 dias' }, { valor: 'mes', texto: 'Este mês' }, { valor: 'proxmes', texto: 'Próximo mês' },
  { valor: 'ult30', texto: 'Últimos 30 dias' }, { valor: 'mespassado', texto: 'Mês passado' },
]
function intervalo(p) {
  const h = hojeISO(), ini = `${h.slice(0, 7)}-01`
  if (p === 'prox30') return [h, somaDias(h, 30)]
  if (p === 'mes') return [ini, somaDias(somaMeses(ini, 1), -1)]
  if (p === 'proxmes') return [somaMeses(ini, 1), somaDias(somaMeses(ini, 2), -1)]
  if (p === 'ult30') return [somaDias(h, -30), h]
  return [somaMeses(ini, -1), somaDias(ini, -1)]
}

function Fluxo() {
  const avisar = useAviso()
  const [periodo, setPeriodo] = useState('mes')
  const [dados, setDados] = useState(null)
  useEffect(() => {
    const [ini, fim] = intervalo(periodo)
    setDados(null)
    supabase.rpc('fluxo_caixa', { p_inicio: ini, p_fim: fim }).then(({ data, error }) => {
      if (error) avisar(mensagemErro(error), 'erro')
      setDados(data ?? { dias: [], vencidos_pagar: 0, vencidos_receber: 0 })
    })
  }, [periodo]) // eslint-disable-line react-hooks/exhaustive-deps

  const hoje = hojeISO()
  const linhas = useMemo(() => {
    let acum = 0
    return (dados?.dias ?? []).map((d) => {
      const realizadoE = Number(d.vendas) + Number(d.recebimentos) + Number(d.outras_entradas)
      const realizadoS = Number(d.saidas)
      const futuro = d.dia >= hoje
      const entradas = realizadoE + (futuro ? Number(d.previsto_entradas) : 0)
      const saidas = realizadoS + (futuro ? Number(d.previsto_saidas) : 0)
      acum = arred(acum + entradas - saidas)
      return { ...d, realizadoE, realizadoS, entradas, saidas, futuro, acum }
    })
  }, [dados, hoje])
  const tot = (k) => linhas.reduce((s, l) => s + l[k], 0)
  const prevE = linhas.filter((l) => l.futuro).reduce((s, l) => s + Number(l.previsto_entradas), 0)
  const prevS = linhas.filter((l) => l.futuro).reduce((s, l) => s + Number(l.previsto_saidas), 0)
  const comMov = linhas.filter((l) => l.entradas || l.saidas)

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="w-52"><Lista valor={periodo} opcoes={PERIODOS} onMudar={setPeriodo} /></div>
        {dados && (Number(dados.vencidos_pagar) > 0 || Number(dados.vencidos_receber) > 0) && (
          <p className="text-sm text-ambar-600 dark:text-ambar-300">Fora do gráfico, já vencidos: {dinheiro(dados.vencidos_pagar)} a pagar e {dinheiro(dados.vencidos_receber)} a receber.</p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Entradas realizadas" icone="dinheiro" tom="positivo" valor={dinheiro(tot('realizadoE'))} detalhe="Vendas à vista, recebimentos e baixas" />
        <Indicador titulo="Saídas realizadas" icone="vendas" tom={tot('realizadoS') ? 'critico' : 'neutro'} valor={dinheiro(tot('realizadoS'))} detalhe="Pagamentos e devoluções em dinheiro" />
        <Indicador titulo="Previsto a receber" icone="relogio" valor={dinheiro(prevE)} detalhe="De hoje em diante" />
        <Indicador titulo="Previsto a pagar" icone="nota" tom={prevS > prevE ? 'alerta' : 'neutro'} valor={dinheiro(prevS)} detalhe="De hoje em diante" />
      </div>
      <div className="mt-4 cartao p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">Entradas e saídas por dia</p>
          <div className="flex gap-4 text-sm text-tinta-400">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-caixa-500" />Entradas</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rubro-600" />Saídas</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-tinta-400" />Acumulado</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-tinta-400" />Previsto</span>
          </div>
        </div>
        {dados === null ? <p className="py-10 text-center text-sm text-tinta-400">Carregando…</p> : <GraficoFluxo linhas={linhas} hoje={hoje} />}
      </div>
      <div className="mt-4 cartao overflow-hidden">
        {comMov.length === 0 ? <Vazio icone="dinheiro" titulo="Sem movimento no período" texto="Vendas, recebimentos e contas lançadas aparecem aqui." /> : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr><th>Dia</th><th className="text-right">Vendas à vista</th><th className="text-right">Recebimentos</th><th className="text-right">Outras entradas</th><th className="text-right">Saídas</th><th className="text-right">Previsto</th><th className="text-right">Acumulado</th></tr></thead>
              <tbody>
                {comMov.map((l) => (
                  <tr key={l.dia} className={l.dia === hoje ? 'bg-caixa-50/60 dark:bg-caixa-700/10' : ''}>
                    <td className="num">{dataBR(l.dia)}{l.dia === hoje && <span className="ml-2 text-xs font-semibold text-caixa-600 dark:text-caixa-300">hoje</span>}</td>
                    <td className="num text-right">{Number(l.vendas) ? dinheiro(l.vendas) : '—'}</td>
                    <td className="num text-right">{Number(l.recebimentos) ? dinheiro(l.recebimentos) : '—'}</td>
                    <td className="num text-right">{Number(l.outras_entradas) ? dinheiro(l.outras_entradas) : '—'}</td>
                    <td className={`num text-right ${l.realizadoS ? 'text-rubro-600 dark:text-rubro-300' : ''}`}>{l.realizadoS ? dinheiro(-l.realizadoS) : '—'}</td>
                    <td className="num text-right text-tinta-400">{l.futuro && (Number(l.previsto_entradas) || Number(l.previsto_saidas)) ? `${dinheiro(Number(l.previsto_entradas) - Number(l.previsto_saidas))}` : '—'}</td>
                    <td className={`num text-right font-semibold ${l.acum < 0 ? 'text-rubro-600 dark:text-rubro-300' : ''}`}>{dinheiro(l.acum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

function GraficoFluxo({ linhas, hoje }) {
  const L = 900, A = 240, m = { e: 64, d: 12, t: 10, b: 26 }
  const n = Math.max(linhas.length, 1)
  const topo = Math.max(1, ...linhas.map((l) => Math.max(l.entradas, l.acum)))
  const fundo = Math.min(0, ...linhas.map((l) => Math.min(-l.saidas, l.acum)))
  const y = (v) => m.t + ((topo - v) / (topo - fundo)) * (A - m.t - m.b)
  const larg = (L - m.e - m.d) / n
  const x = (i) => m.e + i * larg
  const passo = (topo - fundo) / 4
  const marcas = [...new Set([0, ...[0, 1, 2, 3, 4].map((k) => topo - k * passo).filter((v) => Math.abs(v) > passo * 0.4)])]
  const curto = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')} mil` : Math.round(v).toString())
  return (
    <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img" aria-label="Gráfico de entradas, saídas e saldo acumulado por dia">
      {marcas.map((v) => (
        <g key={v}>
          <line x1={m.e} x2={L - m.d} y1={y(v)} y2={y(v)} className={v === 0 ? 'stroke-tinta-300' : 'stroke-papel-200 dark:stroke-noite-700'} strokeWidth="1" />
          <text x={m.e - 8} y={y(v) + 4} textAnchor="end" className="fill-tinta-400 text-[11px]">{curto(v)}</text>
        </g>
      ))}
      {linhas.map((l, i) => {
        const w = Math.max(2, larg * 0.62), cx = x(i) + (larg - w) / 2
        const tracejado = l.futuro && l.dia !== hoje
        return (
          <g key={l.dia}>
            {l.entradas > 0 && <rect x={cx} y={y(l.entradas)} width={w} height={y(0) - y(l.entradas)} rx="1.5" className={tracejado ? 'fill-caixa-500/25 stroke-caixa-500' : 'fill-caixa-500'} strokeDasharray={tracejado ? '3 2' : undefined} />}
            {l.saidas > 0 && <rect x={cx} y={y(0)} width={w} height={y(-l.saidas) - y(0)} rx="1.5" className={tracejado ? 'fill-rubro-600/20 stroke-rubro-600' : 'fill-rubro-600'} strokeDasharray={tracejado ? '3 2' : undefined} />}
            {(i % Math.ceil(n / 10) === 0) && <text x={x(i) + larg / 2} y={A - 8} textAnchor="middle" className="fill-tinta-400 text-[11px]">{l.dia.slice(8, 10)}/{l.dia.slice(5, 7)}</text>}
            <title>{`${dataBR(l.dia)}: entradas ${dinheiro(l.entradas)}, saídas ${dinheiro(l.saidas)}, acumulado ${dinheiro(l.acum)}`}</title>
          </g>
        )
      })}
      <polyline fill="none" className="stroke-tinta-600 dark:stroke-tinta-300" strokeWidth="2" points={linhas.map((l, i) => `${x(i) + larg / 2},${y(l.acum)}`).join(' ')} />
    </svg>
  )
}

// ---------------------------------------------------------------- DRE
const LINHAS_DRE = [
  { k: 'receita_bruta', t: 'Receita bruta de vendas', nivel: 0 },
  { k: 'devolucoes', t: '(−) Devoluções', nivel: 1, neg: true },
  { k: 'deducoes', t: '(−) Impostos sobre vendas', nivel: 1, neg: true, grupo: 'deducoes' },
  { k: 'receita_liquida', t: 'Receita líquida', total: true },
  { k: 'cmv', t: '(−) Custo das mercadorias vendidas', nivel: 1, neg: true },
  { k: 'lucro_bruto', t: 'Lucro bruto', total: true, margem: true },
  { k: 'despesas_operacionais', t: '(−) Despesas operacionais', nivel: 1, neg: true, grupo: 'despesas_operacionais' },
  { k: 'resultado_operacional', t: 'Resultado operacional', total: true, margem: true },
  { k: 'despesas_financeiras', t: '(−) Despesas financeiras', nivel: 1, neg: true, grupo: 'despesas_financeiras' },
  { k: 'outras_receitas', t: '(+) Receitas financeiras e outras', nivel: 1 },
  { k: 'resultado', t: 'Resultado líquido', total: true, margem: true, final: true },
]

function Dre({ centros }) {
  const avisar = useAviso()
  const anoAtual = new Date().getFullYear()
  const [ano, setAno] = useState(anoAtual)
  const [centro, setCentro] = useState(null)
  const [dados, setDados] = useState(null)
  const [abertos, setAbertos] = useState({ despesas_operacionais: true })
  useEffect(() => {
    setDados(null)
    supabase.rpc('dre', { p_ano: ano, p_centro: centro }).then(({ data, error }) => {
      if (error) avisar(mensagemErro(error), 'erro')
      setDados(data ?? { meses: [], detalhe: [] })
    })
  }, [ano, centro]) // eslint-disable-line react-hooks/exhaustive-deps

  const ultimoMes = ano === anoAtual ? new Date().getMonth() + 1 : 12
  const meses = (dados?.meses ?? []).filter((m) => m.mes <= ultimoMes)
  const total = (k) => meses.reduce((s, m) => s + Number(m[k] ?? 0), 0)
  const rl = total('receita_liquida')
  const contasDe = (grupo) => {
    const mapa = {}
    for (const d of dados?.detalhe ?? []) {
      if (d.grupo !== grupo || d.mes > ultimoMes) continue
      mapa[d.codigo] ??= { codigo: d.codigo, nome: d.nome, meses: {} }
      mapa[d.codigo].meses[d.mes] = Number(d.valor)
    }
    return Object.values(mapa)
  }
  const fmt = (v, neg) => (Number(v) ? (neg ? -Math.abs(v) : Number(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—')
  const pct = (v) => (rl ? `${(Math.round((v / rl) * 1000) / 10).toString().replace('.', ',')}%` : '—')

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="w-32"><Lista valor={ano} opcoes={[anoAtual, anoAtual - 1, anoAtual - 2].map((a) => ({ valor: a, texto: String(a) }))} onMudar={setAno} /></div>
        <div className="w-56"><Lista valor={centro} opcoes={[{ valor: null, texto: 'Todos os centros de custo' }, ...centros.map((c) => ({ valor: c.id, texto: c.nome }))]} onMudar={setCentro} /></div>
        {centro && <p className="text-sm text-ambar-600 dark:text-ambar-300">Por centro de custo a DRE mostra só os lançamentos; vendas e CMV entram em Todos.</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Receita líquida no ano" icone="dinheiro" valor={dinheiro(rl)} detalhe={`${meses.length} mês(es) apurado(s)`} />
        <Indicador titulo="Lucro bruto" icone="vendas" tom={total('lucro_bruto') >= 0 ? 'positivo' : 'critico'} valor={dinheiro(total('lucro_bruto'))} detalhe={`Margem bruta ${pct(total('lucro_bruto'))}`} />
        <Indicador titulo="Despesas operacionais" icone="nota" valor={dinheiro(total('despesas_operacionais'))} detalhe={`${pct(total('despesas_operacionais'))} da receita líquida`} />
        <Indicador titulo="Resultado líquido" icone="grafico" tom={total('resultado') >= 0 ? 'positivo' : 'critico'} valor={dinheiro(total('resultado'))} detalhe={`Margem líquida ${pct(total('resultado'))}`} />
      </div>
      <div className="mt-4 cartao overflow-hidden">
        {dados === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : (
          <div className="overflow-x-auto">
            <table className="tabela w-full whitespace-nowrap text-[0.9rem]">
              <thead>
                <tr><th className="sticky left-0 z-10 bg-papel dark:bg-noite-800">Valores em R$</th>{meses.map((m) => <th key={m.mes} className="text-right">{MESES[m.mes - 1]}</th>)}<th className="text-right">Total</th><th className="text-right">% RL</th></tr>
              </thead>
              <tbody>
                {LINHAS_DRE.map((ln) => {
                  const contas = ln.grupo ? contasDe(ln.grupo) : []
                  const v = total(ln.k)
                  return [
                    <tr key={ln.k} className={ln.total ? `font-semibold ${ln.final ? 'bg-papel-200/70 dark:bg-noite-700/60' : 'bg-papel/50 dark:bg-noite/30'}` : ''}>
                      <td className={`sticky left-0 z-10 ${ln.total ? (ln.final ? 'bg-papel-200 dark:bg-noite-700' : 'bg-papel dark:bg-noite-800') : 'bg-white dark:bg-noite-800'}`}>
                        <span className={`inline-block ${ln.nivel ? 'pl-4' : ''}`}>
                        {contas.length > 0
                          ? <button className="flex items-center gap-1 hover:underline" onClick={() => setAbertos((a) => ({ ...a, [ln.k]: !a[ln.k] }))} aria-expanded={!!abertos[ln.k]}>
                              <Icone nome="seta-baixo" className={`h-3.5 w-3.5 transition ${abertos[ln.k] ? '' : '-rotate-90'}`} />{ln.t}</button>
                          : ln.t}
                        </span>
                      </td>
                      {meses.map((m) => <td key={m.mes} className={`num text-right ${ln.total && Number(m[ln.k]) < 0 ? 'text-rubro-600 dark:text-rubro-300' : ''}`}>{fmt(m[ln.k], ln.neg)}</td>)}
                      <td className={`num text-right font-semibold ${ln.total && v < 0 ? 'text-rubro-600 dark:text-rubro-300' : ''}`}>{fmt(v, ln.neg)}</td>
                      <td className="num text-right text-tinta-400">{ln.k === 'receita_bruta' ? '' : pct(v)}</td>
                    </tr>,
                    ...(abertos[ln.k] ? contas.map((c) => (
                      <tr key={`${ln.k}-${c.codigo}`} className="text-tinta-600 dark:text-tinta-300">
                        <td className="sticky left-0 z-10 bg-white dark:bg-noite-800"><span className="inline-block pl-9"><span className="text-tinta-400">{c.codigo}</span> {c.nome}</span></td>
                        {meses.map((m) => <td key={m.mes} className="num text-right">{fmt(c.meses[m.mes], true)}</td>)}
                        <td className="num text-right">{fmt(Object.values(c.meses).reduce((s, x) => s + x, 0), true)}</td>
                        <td className="num text-right text-tinta-400">{pct(Object.values(c.meses).reduce((s, x) => s + x, 0))}</td>
                      </tr>
                    )) : []),
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-2 text-sm text-tinta-400">Regime de competência. O CMV usa o custo do produto no momento da venda. Compras para estoque, retiradas dos sócios e empréstimos ficam fora da DRE, mas entram no fluxo de caixa.</p>
    </>
  )
}

// ---------------------------------------------------------------- Cadastros
function Cadastros({ cad, recarregar }) {
  const avisar = useAviso()
  const [form, setForm] = useState(null) // { entidade, ...campos }
  const [enviando, setEnviando] = useState(false)
  const mudar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }))

  const salvar = async () => {
    const { entidade, id, ...c } = form
    let dados
    if (entidade === 'plano_contas') {
      if (!c.codigo.trim() || !c.nome.trim()) { avisar('Informe código e nome.', 'erro'); return }
      dados = { codigo: c.codigo.trim(), nome: c.nome.trim(), tipo: c.tipo, grupo_dre: c.grupo_dre, ativo: c.ativo }
    } else if (entidade === 'centros_custo') {
      if (!c.nome.trim()) { avisar('Informe o nome.', 'erro'); return }
      dados = { nome: c.nome.trim(), ativo: c.ativo }
    } else {
      if (!c.nome.trim()) { avisar('Informe o nome.', 'erro'); return }
      const saldo = lerNumero(c.saldo_inicial)
      if (Number.isNaN(saldo)) { avisar('Saldo inicial inválido.', 'erro'); return }
      dados = { nome: c.nome.trim(), tipo: c.tipo, saldo_inicial: saldo, data_saldo: c.data_saldo, ativo: c.ativo }
    }
    setEnviando(true)
    const r = id ? await supabase.from(entidade).update(dados).eq('id', id) : await supabase.from(entidade).insert(dados)
    setEnviando(false)
    if (r.error) { avisar(r.error.code === '23505' ? 'Já existe um cadastro com este código ou nome.' : mensagemErro(r.error), 'erro'); return }
    avisar('Cadastro salvo.'); setForm(null); recarregar()
  }

  const titulos = { plano_contas: 'conta do plano', centros_custo: 'centro de custo', contas_bancarias: 'conta bancária' }
  const linha = 'cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40'

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="cartao overflow-hidden lg:col-span-2">
        <div className="flex items-center justify-between border-b border-papel-200 px-4 py-3 dark:border-noite-700">
          <div><p className="font-semibold">Plano de contas</p><p className="text-sm text-tinta-400">Classifica receitas e despesas e define a linha da DRE</p></div>
          <Botao variante="secundario" icone="mais" className="py-1" onClick={() => setForm({ entidade: 'plano_contas', codigo: '', nome: '', tipo: 'despesa', grupo_dre: 'despesas_operacionais', ativo: true })}>Nova conta</Botao>
        </div>
        <div className="max-h-[32rem] overflow-auto">
          <table className="tabela w-full text-[0.95rem]">
            <thead className="sticky top-0 bg-papel dark:bg-noite-800"><tr><th>Código</th><th>Conta</th><th>Linha da DRE</th><th>Situação</th></tr></thead>
            <tbody>
              {cad.planos.map((p) => (
                <tr key={p.id} className={linha} onClick={() => setForm({ entidade: 'plano_contas', ...p })}>
                  <td className="num text-tinta-400">{p.codigo}</td>
                  <td className="font-medium">{p.nome}</td>
                  <td>{GRUPOS_DRE.find((g) => g.valor === p.grupo_dre)?.texto.replace(/ \(.*\)$/, '')}</td>
                  <td>{p.ativo ? <Etiqueta tom={p.tipo === 'receita' ? 'positivo' : 'neutro'}>{p.tipo === 'receita' ? 'Receita' : 'Despesa'}</Etiqueta> : <Etiqueta>Inativa</Etiqueta>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="space-y-4">
        <div className="cartao overflow-hidden">
          <div className="flex items-center justify-between border-b border-papel-200 px-4 py-3 dark:border-noite-700">
            <p className="font-semibold">Contas e caixas</p>
            <Botao variante="secundario" icone="mais" className="py-1" onClick={() => setForm({ entidade: 'contas_bancarias', nome: '', tipo: 'banco', saldo_inicial: '', data_saldo: hojeISO(), ativo: true })}>Nova</Botao>
          </div>
          <table className="tabela w-full text-[0.95rem]"><tbody>
            {cad.contas.map((c) => (
              <tr key={c.id} className={linha} onClick={() => setForm({ entidade: 'contas_bancarias', ...c, saldo_inicial: reais(c.saldo_inicial) })}>
                <td className="font-medium">{c.nome}<span className="block text-xs font-normal text-tinta-400">{{ caixa: 'Caixa', banco: 'Conta bancária', carteira: 'Carteira digital' }[c.tipo]}</span></td>
                <td className="text-right">{!c.ativo && <Etiqueta>Inativa</Etiqueta>}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <div className="cartao overflow-hidden">
          <div className="flex items-center justify-between border-b border-papel-200 px-4 py-3 dark:border-noite-700">
            <p className="font-semibold">Centros de custo</p>
            <Botao variante="secundario" icone="mais" className="py-1" onClick={() => setForm({ entidade: 'centros_custo', nome: '', ativo: true })}>Novo</Botao>
          </div>
          <table className="tabela w-full text-[0.95rem]"><tbody>
            {cad.centros.map((c) => (
              <tr key={c.id} className={linha} onClick={() => setForm({ entidade: 'centros_custo', ...c })}>
                <td className="font-medium">{c.nome}</td><td className="text-right">{!c.ativo && <Etiqueta>Inativo</Etiqueta>}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </div>

      <TelaSuspensa aberta={!!form} titulo={form ? `${form.id ? 'Editar' : 'Nova'} ${titulos[form.entidade]}` : ''} onFechar={() => setForm(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setForm(null)}>Cancelar</Botao>
          <Botao onClick={salvar} carregando={enviando}>Salvar</Botao>
        </>}>
        {form?.entidade === 'plano_contas' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Código"><input className="campo num" value={form.codigo} onChange={mudar('codigo')} placeholder="4.12" autoFocus /></Campo>
            <div className="sm:col-span-2"><Campo rotulo="Nome"><input className="campo" value={form.nome} onChange={mudar('nome')} /></Campo></div>
            <Campo rotulo="Tipo"><Lista valor={form.tipo} opcoes={[{ valor: 'despesa', texto: 'Despesa' }, { valor: 'receita', texto: 'Receita' }]} onMudar={mudar('tipo')} /></Campo>
            <div className="sm:col-span-2"><Campo rotulo="Linha da DRE"><Lista valor={form.grupo_dre} opcoes={GRUPOS_DRE} onMudar={mudar('grupo_dre')} /></Campo></div>
          </div>
        )}
        {form?.entidade === 'centros_custo' && <Campo rotulo="Nome"><input className="campo" value={form.nome} onChange={mudar('nome')} placeholder="Ex.: Loja do centro, Delivery" autoFocus /></Campo>}
        {form?.entidade === 'contas_bancarias' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Campo rotulo="Nome"><input className="campo" value={form.nome} onChange={mudar('nome')} placeholder="Ex.: Banco do Brasil, conta 12345-6" autoFocus /></Campo></div>
            <Campo rotulo="Tipo"><Lista valor={form.tipo} opcoes={[{ valor: 'banco', texto: 'Conta bancária' }, { valor: 'caixa', texto: 'Caixa' }, { valor: 'carteira', texto: 'Carteira digital' }]} onMudar={mudar('tipo')} /></Campo>
            <div />
            <Campo rotulo="Saldo inicial"><input className="campo num" inputMode="decimal" value={form.saldo_inicial} onChange={mudar('saldo_inicial')} placeholder="0,00" /></Campo>
            <Campo rotulo="Na data"><input type="date" className="campo" value={form.data_saldo} onChange={mudar('data_saldo')} /></Campo>
          </div>
        )}
        {form && <label className="mt-4 flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={form.ativo} onChange={mudar('ativo')} /> Ativo</label>}
      </TelaSuspensa>
    </div>
  )
}
