import { useEffect, useState } from 'react'
import { NOMES_FORMAS as NOMES } from '../lib/formas.js'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useCaixaAberto, terminalAtual, definirTerminal } from '../lib/caixa.js'
import { dinheiro, lerNumero, dataHora, arred } from '../lib/formato.js'
import { ReceberConta } from '../components/ReceberConta.jsx'
import { Barra, Botao, Cabecalho, Campo, Etiqueta, Icone, Indicador, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'

const TITULOS = { abrir: 'Abertura de caixa', sangria: 'Sangria', suprimento: 'Suprimento', fechar: 'Fechamento de caixa' }
const DESCRICOES = {
  abrir: 'Informe o dinheiro que fica na gaveta para troco.',
  sangria: 'Retirada de dinheiro da gaveta (depósito, pagamento etc.).',
  suprimento: 'Entrada de dinheiro na gaveta para reforçar o troco.',
  fechar: 'Conte o dinheiro da gaveta e informe o valor encontrado.',
}

export default function Caixa() {
  const { caixa, recarregar } = useCaixaAberto()
  const avisar = useAviso()
  const [resumo, setResumo] = useState(null)
  const [movimentos, setMovimentos] = useState([])
  const [historico, setHistorico] = useState([])
  const [janela, setJanela] = useState(null)
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [terminal, setTerminal] = useState(String(terminalAtual()))
  const [enviando, setEnviando] = useState(false)
  const [fechamento, setFechamento] = useState(null)
  const [recebendo, setRecebendo] = useState(false)

  const carregar = async () => {
    const { data: h } = await supabase.from('caixas').select('*').eq('status', 'fechado').order('fechado_em', { ascending: false }).limit(8)
    setHistorico(h ?? [])
    if (!caixa) return
    const [{ data: r }, { data: m }] = await Promise.all([
      supabase.rpc('resumo_caixa', { p_caixa: caixa.id }),
      supabase.from('caixa_movimentos').select('*').eq('caixa_id', caixa.id).order('criado_em', { ascending: false }),
    ])
    setResumo(r); setMovimentos(m ?? [])
  }
  useEffect(() => { carregar() }, [caixa]) // eslint-disable-line react-hooks/exhaustive-deps

  const abrirJanela = (j) => { setValor(''); setMotivo(''); setJanela(j) }
  const fechar = () => setJanela(null)

  const executar = async () => {
    const v = lerNumero(valor)
    if (Number.isNaN(v) || v < 0 || (janela !== 'abrir' && janela !== 'fechar' && v <= 0)) {
      avisar('Informe um valor válido.', 'erro'); return
    }
    setEnviando(true)
    let r
    if (janela === 'abrir') {
      const n = Number(terminal)
      if (!(n >= 1 && n <= 99)) { setEnviando(false); avisar('Terminal inválido (1 a 99).', 'erro'); return }
      definirTerminal(n)
      r = await supabase.rpc('abrir_caixa', { p_terminal: n, p_valor: v })
    } else if (janela === 'fechar') {
      r = await supabase.rpc('fechar_caixa', { p_caixa: caixa.id, p_valor_informado: v })
      if (!r.error) setFechamento({ ...r.data, informado: v })
    } else {
      r = await supabase.rpc('movimentar_caixa', { p_caixa: caixa.id, p_tipo: janela, p_valor: v, p_motivo: motivo || null })
    }
    setEnviando(false)
    if (r.error) { avisar(mensagemErro(r.error), 'erro'); return }
    avisar({ abrir: 'Caixa aberto.', fechar: 'Caixa fechado.', sangria: 'Sangria registrada.', suprimento: 'Suprimento registrado.' }[janela])
    setJanela(null)
    await recarregar()
    carregar()
  }

  if (caixa === undefined) return <p className="text-sm text-tinta-400">Carregando…</p>

  const formas = resumo ? Object.entries(resumo.formas) : []
  const totalVendas = formas.reduce((s, [, v]) => s + Number(v), 0)

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho
        titulo="Caixa"
        descricao={caixa ? `Terminal ${caixa.numero_terminal}, aberto em ${dataHora(caixa.aberto_em)}` : `Terminal ${terminalAtual()} sem caixa aberto`}
      >
        {caixa ? <>
          <Botao variante="secundario" icone="usuario" onClick={() => setRecebendo(true)}>Receber conta</Botao>
          <Botao variante="secundario" icone="mais" onClick={() => abrirJanela('suprimento')}>Suprimento</Botao>
          <Botao variante="secundario" icone="dinheiro" onClick={() => abrirJanela('sangria')}>Sangria</Botao>
          <Botao variante="perigo" onClick={() => abrirJanela('fechar')}>Fechar caixa</Botao>
        </> : <Botao icone="caixa" onClick={() => abrirJanela('abrir')}>Abrir caixa</Botao>}
      </Cabecalho>

      {fechamento && (
        <div className={`mb-4 flex flex-wrap items-center gap-4 rounded-xl border p-4 ${Math.abs(fechamento.informado - fechamento.dinheiro_esperado) < 0.01 ? 'border-caixa-100 bg-caixa-50 dark:border-caixa-700 dark:bg-caixa-700/20' : 'border-ambar-300 bg-ambar-50 dark:border-ambar-600 dark:bg-ambar-600/10'}`}>
          <Icone nome="ok" className="h-6 w-6" />
          <div className="flex-1">
            <p className="font-semibold">Caixa fechado</p>
            <p className="text-sm">Esperado {dinheiro(fechamento.dinheiro_esperado)}, contado {dinheiro(fechamento.informado)}</p>
          </div>
          <div className="num text-right"><p className="font-sans text-sm">Diferença</p><p className="text-2xl font-semibold">{dinheiro(arred(fechamento.informado - fechamento.dinheiro_esperado))}</p></div>
        </div>
      )}

      {!caixa ? (
        <div className="cartao"><Vazio icone="caixa" titulo="Nenhum caixa aberto neste terminal" texto="Abra o caixa informando o fundo de troco para começar a vender." /></div>
      ) : resumo && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador titulo="Fundo de troco" icone="caixa" valor={dinheiro(resumo.abertura)} detalhe="Valor informado na abertura" />
            <Indicador titulo="Vendas no caixa" icone="vendas" valor={resumo.qtd_vendas} detalhe={`${dinheiro(totalVendas)} recebidos`} />
            <Indicador titulo="Contas recebidas" icone="usuario" valor={dinheiro(Object.values(resumo.recebimentos ?? {}).reduce((a, b) => a + Number(b), 0))} detalhe={Number(resumo.devolucoes_dinheiro) > 0 ? `${dinheiro(resumo.devolucoes_dinheiro)} devolvidos em dinheiro` : 'Crediário e convênio'} />
            <Indicador titulo="Dinheiro na gaveta" icone="ok" tom="positivo" valor={dinheiro(resumo.dinheiro_esperado)} detalhe={`Suprimentos ${dinheiro(resumo.suprimentos)}, sangrias ${dinheiro(resumo.sangrias)}`} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="cartao p-5">
              <h2 className="titulo-secao">Recebimentos por forma de pagamento</h2>
              {formas.length === 0 ? <p className="mt-4 text-sm text-tinta-400">Nenhuma venda neste caixa ainda.</p> : (
                <ul className="mt-4 space-y-3">
                  {formas.sort((a, b) => b[1] - a[1]).map(([f, v]) => (
                    <li key={f}>
                      <div className="mb-1 flex justify-between"><span>{NOMES[f] ?? f}</span><span className="num font-semibold">{dinheiro(v)}</span></div>
                      <Barra parte={Number(v)} total={totalVendas} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="cartao">
              <h2 className="titulo-secao px-5 pt-4">Sangrias e suprimentos</h2>
              {movimentos.length === 0 ? <Vazio icone="dinheiro" titulo="Nenhuma movimentação" texto="Retiradas e reforços de troco aparecem aqui." /> : (
                <ul className="mt-2 divide-y divide-papel-200 dark:divide-noite-700">
                  {movimentos.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <span className="min-w-0">
                        <Etiqueta tom={m.tipo === 'sangria' ? 'alerta' : 'positivo'}>{m.tipo === 'sangria' ? 'Sangria' : 'Suprimento'}</Etiqueta>
                        <span className="ml-2 text-sm text-tinta-400">{dataHora(m.criado_em)}{m.motivo ? `, ${m.motivo}` : ''}</span>
                      </span>
                      <span className={`num font-semibold ${m.tipo === 'sangria' ? 'text-ambar-600 dark:text-ambar-300' : 'text-caixa-600 dark:text-caixa-300'}`}>{m.tipo === 'sangria' ? '−' : '+'}{dinheiro(m.valor)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      <section className="cartao mt-4 overflow-hidden">
        <h2 className="titulo-secao px-5 pt-4">Últimos fechamentos</h2>
        {historico.length === 0 ? <Vazio icone="relogio" titulo="Nenhum fechamento registrado" texto="O histórico de caixas fechados aparece aqui, com a diferença apurada." /> : (
          <div className="overflow-x-auto">
            <table className="tabela mt-2 w-full text-[0.95rem]">
              <thead><tr><th>Terminal</th><th>Abertura</th><th>Fechamento</th><th className="text-right">Esperado</th><th className="text-right">Contado</th><th className="text-right">Diferença</th></tr></thead>
              <tbody>
                {historico.map((c) => {
                  const dif = arred(Number(c.valor_informado) - Number(c.valor_esperado))
                  return (
                    <tr key={c.id}>
                      <td>{c.numero_terminal}</td>
                      <td>{dataHora(c.aberto_em)}</td>
                      <td>{dataHora(c.fechado_em)}</td>
                      <td className="num text-right">{dinheiro(c.valor_esperado)}</td>
                      <td className="num text-right">{dinheiro(c.valor_informado)}</td>
                      <td className="text-right">{dif === 0 ? <Etiqueta tom="positivo">Sem diferença</Etiqueta> : <Etiqueta tom={dif < 0 ? 'critico' : 'alerta'}>{dif > 0 ? 'Sobra' : 'Falta'} {dinheiro(Math.abs(dif))}</Etiqueta>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {recebendo && caixa && <ReceberConta caixa={caixa} onFechar={() => setRecebendo(false)} onConcluir={() => { setRecebendo(false); carregar() }} />}

      <TelaSuspensa
        aberta={!!janela}
        titulo={TITULOS[janela]}
        subtitulo={DESCRICOES[janela]}
        onFechar={fechar}
        rodape={<>
          <Botao variante="secundario" onClick={fechar}>Cancelar</Botao>
          <Botao variante={janela === 'fechar' ? 'perigo' : 'primario'} onClick={executar} carregando={enviando}>{janela === 'fechar' ? 'Fechar caixa' : janela === 'abrir' ? 'Abrir caixa' : 'Registrar'}</Botao>
        </>}
      >
        <div className="space-y-4">
          {janela === 'abrir' && (
            <Campo rotulo="Número do terminal" ajuda="Identifica este computador. Cada terminal tem o próprio caixa."><input className="campo num" inputMode="numeric" value={terminal} onChange={(e) => setTerminal(e.target.value)} /></Campo>
          )}
          <Campo rotulo={janela === 'abrir' ? 'Fundo de troco (R$)' : janela === 'fechar' ? 'Dinheiro contado na gaveta (R$)' : 'Valor (R$)'}>
            <input className="campo num text-lg" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" autoFocus />
          </Campo>
          {(janela === 'sangria' || janela === 'suprimento') && (
            <Campo rotulo="Motivo"><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={janela === 'sangria' ? 'Ex.: depósito bancário' : 'Ex.: reforço de troco'} /></Campo>
          )}
        </div>
      </TelaSuspensa>
    </div>
  )
}
