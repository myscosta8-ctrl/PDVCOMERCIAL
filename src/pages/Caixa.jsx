import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useCaixaAberto, terminalAtual, definirTerminal } from '../lib/caixa.js'
import { dinheiro, lerNumero, dataHora, arred } from '../lib/formato.js'
import { Botao, Campo, TelaSuspensa, useAviso } from '../components/ui.jsx'

const NOMES = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Cartão de débito', credito: 'Cartão de crédito', crediario: 'Crediário', outro: 'Outro' }

export default function Caixa() {
  const { caixa, recarregar } = useCaixaAberto()
  const avisar = useAviso()
  const [resumo, setResumo] = useState(null)
  const [janela, setJanela] = useState(null) // 'abrir' | 'sangria' | 'suprimento' | 'fechar'
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [terminal, setTerminal] = useState(String(terminalAtual()))
  const [enviando, setEnviando] = useState(false)
  const [fechamento, setFechamento] = useState(null)

  const carregarResumo = async () => {
    if (!caixa) return
    const { data } = await supabase.rpc('resumo_caixa', { p_caixa: caixa.id })
    setResumo(data)
  }
  useEffect(() => { carregarResumo() }, [caixa]) // eslint-disable-line react-hooks/exhaustive-deps

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
    avisar(janela === 'abrir' ? 'Caixa aberto.' : janela === 'fechar' ? 'Caixa fechado.' : 'Movimento registrado.')
    setJanela(null)
    await recarregar()
    carregarResumo()
  }

  if (caixa === undefined) return <p className="text-sm text-slate-500">Carregando…</p>

  const titulos = { abrir: 'Abertura de caixa', sangria: 'Sangria', suprimento: 'Suprimento', fechar: 'Fechamento de caixa' }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {!caixa ? (
        <div className="cartao p-6 text-center">
          <h2 className="mb-1 text-lg font-bold">Caixa fechado</h2>
          <p className="mb-4 text-sm text-slate-500">Terminal {terminalAtual()}</p>
          <Botao onClick={() => abrirJanela('abrir')}>Abrir caixa</Botao>
        </div>
      ) : (
        <>
          <div className="cartao flex flex-wrap items-center gap-3 p-5">
            <div>
              <h2 className="text-lg font-bold">Caixa aberto · Terminal {caixa.numero_terminal}</h2>
              <p className="text-sm text-slate-500">Desde {dataHora(caixa.aberto_em)}</p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Botao variante="secundario" onClick={() => abrirJanela('suprimento')}>Suprimento</Botao>
              <Botao variante="secundario" onClick={() => abrirJanela('sangria')}>Sangria</Botao>
              <Botao variante="perigo" onClick={() => abrirJanela('fechar')}>Fechar caixa</Botao>
            </div>
          </div>
          {resumo && (
            <div className="cartao p-5 text-sm">
              <h3 className="mb-3 font-bold">Resumo</h3>
              <Linha nome="Vendas concluídas" valor={resumo.qtd_vendas} cru />
              <Linha nome="Valor de abertura" valor={resumo.abertura} />
              {Object.entries(resumo.formas).map(([f, v]) => <Linha key={f} nome={NOMES[f] ?? f} valor={v} />)}
              <Linha nome="Suprimentos" valor={resumo.suprimentos} />
              <Linha nome="Sangrias" valor={-resumo.sangrias} />
              <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                <Linha nome="Dinheiro esperado na gaveta" valor={resumo.dinheiro_esperado} forte />
              </div>
            </div>
          )}
        </>
      )}

      {fechamento && (
        <div className="cartao p-5 text-sm">
          <h3 className="mb-3 font-bold">Último fechamento</h3>
          <Linha nome="Dinheiro esperado" valor={fechamento.dinheiro_esperado} />
          <Linha nome="Dinheiro contado" valor={fechamento.informado} />
          <Linha nome="Diferença" valor={arred(fechamento.informado - fechamento.dinheiro_esperado)} forte />
        </div>
      )}

      <TelaSuspensa
        aberta={!!janela}
        titulo={titulos[janela]}
        onFechar={fechar}
        rodape={<>
          <Botao variante="secundario" onClick={fechar}>Cancelar</Botao>
          <Botao variante={janela === 'fechar' ? 'perigo' : 'primario'} onClick={executar} carregando={enviando}>Confirmar</Botao>
        </>}
      >
        <div className="space-y-4">
          {janela === 'abrir' && (
            <Campo rotulo="Número do terminal"><input className="campo" inputMode="numeric" value={terminal} onChange={(e) => setTerminal(e.target.value)} /></Campo>
          )}
          <Campo rotulo={janela === 'abrir' ? 'Fundo de troco (R$)' : janela === 'fechar' ? 'Dinheiro contado na gaveta (R$)' : 'Valor (R$)'}>
            <input className="campo" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" autoFocus />
          </Campo>
          {(janela === 'sangria' || janela === 'suprimento') && (
            <Campo rotulo="Motivo"><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
          )}
        </div>
      </TelaSuspensa>
    </div>
  )
}

function Linha({ nome, valor, forte, cru }) {
  return (
    <div className={`flex justify-between py-1 ${forte ? 'text-base font-bold' : ''}`}>
      <span>{nome}</span>
      <span>{cru ? valor : dinheiro(valor)}</span>
    </div>
  )
}
