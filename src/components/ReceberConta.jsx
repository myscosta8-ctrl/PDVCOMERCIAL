import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { dinheiro, lerNumero, arred } from '../lib/formato.js'
import { htmlComprovanteRecebimento, imprimirComEmpresa } from '../lib/impressao.js'
import { useSessao } from '../lib/sessao.js'
import { nomeForma } from '../lib/formas.js'
import { Botao, Campo, TelaSuspensa, useAviso } from './ui.jsx'
import { SeletorCliente, SituacaoCliente, carregarSituacao } from './Clientes.jsx'

const FORMAS = ['dinheiro', 'pix', 'debito', 'credito']

// Recebimento de parcelas de crediário/convênio no caixa aberto
export function ReceberConta({ caixa, cliente: inicial, onFechar, onConcluir }) {
  const avisar = useAviso()
  const perfil = useSessao()
  const [cliente, setCliente] = useState(null)
  const [escolhendo, setEscolhendo] = useState(!inicial)
  const [valor, setValor] = useState('')
  const [forma, setForma] = useState('dinheiro')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (inicial) carregarSituacao(inicial.id).then((s) => setCliente({ ...inicial, situacao: s }))
  }, [inicial])

  const devedor = Number(cliente?.situacao?.saldo_devedor ?? 0)
  const atraso = Number(cliente?.situacao?.em_atraso ?? 0)

  const receber = async () => {
    const v = valor === '' ? devedor : lerNumero(valor)
    if (!(v > 0) || v > devedor) { avisar(`Informe um valor entre R$ 0,01 e ${dinheiro(devedor)}.`, 'erro'); return }
    setEnviando(true)
    const { data, error } = await supabase.rpc('receber_contas', { p_caixa: caixa.id, p_cliente: cliente.id, p_valor: v, p_forma: forma })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`Recebimento de ${dinheiro(v)} registrado para ${cliente.nome}.`)
    // Comprovante de pagamento para o cliente
    const x = await imprimirComEmpresa((empresa, config) => htmlComprovanteRecebimento({
      empresa, cliente, valor: v, forma, parcelas: data?.parcelas ?? [], saldo: arred(devedor - v), operador: perfil.nome, config,
    }), { automatica: true })
    if (x.erro) avisar(x.erro, 'erro')
    onConcluir?.()
  }

  if (escolhendo) {
    return <SeletorCliente aberta titulo="Receber conta de cliente" onFechar={onFechar} onEscolher={(c) => { setCliente(c); setEscolhendo(false) }} />
  }

  return (
    <TelaSuspensa
      aberta={!!cliente}
      titulo="Receber pagamento"
      subtitulo="As parcelas mais antigas são quitadas primeiro"
      onFechar={onFechar}
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Cancelar</Botao>
        <Botao onClick={receber} carregando={enviando} disabled={devedor <= 0}>Registrar recebimento</Botao>
      </>}
    >
      {cliente && (
        <div className="space-y-4">
          <SituacaoCliente cliente={cliente} compacto />
          <div className="flex flex-wrap gap-2 text-sm">
            <button className="rounded-lg border border-papel-300 px-3 py-1.5 hover:border-caixa-500 dark:border-noite-600" onClick={() => setValor(String(devedor).replace('.', ','))}>Quitar tudo ({dinheiro(devedor)})</button>
            {atraso > 0 && atraso < devedor && <button className="rounded-lg border border-papel-300 px-3 py-1.5 hover:border-caixa-500 dark:border-noite-600" onClick={() => setValor(String(atraso).replace('.', ','))}>Só o atrasado ({dinheiro(atraso)})</button>}
          </div>
          <Campo rotulo="Valor recebido (R$)" ajuda="Vazio recebe o saldo devedor inteiro">
            <input className="campo num text-lg" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={dinheiro(devedor)} autoFocus />
          </Campo>
          <div>
            <span className="rotulo">Forma de recebimento</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FORMAS.map((f) => (
                <button key={f} onClick={() => setForma(f)} aria-pressed={forma === f}
                  className={`rounded-xl border px-2 py-2.5 text-sm font-medium ${forma === f ? 'border-caixa-500 bg-caixa-50 text-caixa-700 dark:bg-caixa-700/20 dark:text-caixa-300' : 'border-papel-300 hover:border-caixa-500 dark:border-noite-600'}`}>
                  {nomeForma(f)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </TelaSuspensa>
  )
}
