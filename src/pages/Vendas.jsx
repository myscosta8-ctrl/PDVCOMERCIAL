import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { dinheiro, dataHora } from '../lib/formato.js'
import { Botao, Campo, TelaSuspensa, useAviso } from '../components/ui.jsx'
import { chamarNfce, imprimirDanfe } from '../lib/nfce.js'

export default function Vendas() {
  const avisar = useAviso()
  const hoje = new Date().toISOString().slice(0, 10)
  const [dia, setDia] = useState(hoje)
  const [lista, setLista] = useState([])
  const [detalhe, setDetalhe] = useState(null)
  const [cancelando, setCancelando] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)

  const carregar = async () => {
    const inicio = new Date(`${dia}T00:00:00`)
    const fim = new Date(inicio.getTime() + 86400000)
    const { data, error } = await supabase
      .from('vendas')
      .select('id, numero, total, troco, status, criado_em, motivo_cancelamento, operador:usuarios!vendas_operador_id_fkey(nome)')
      .gte('criado_em', inicio.toISOString())
      .lt('criado_em', fim.toISOString())
      .order('numero', { ascending: false })
    if (error) avisar(mensagemErro(error), 'erro')
    else setLista(data)
  }
  useEffect(() => { carregar() }, [dia]) // eslint-disable-line react-hooks/exhaustive-deps

  const abrir = async (v) => {
    const [itens, pags, notas] = await Promise.all([
      supabase.from('venda_itens').select('sequencia, descricao, quantidade, preco_unitario, total').eq('venda_id', v.id).order('sequencia'),
      supabase.from('venda_pagamentos').select('forma, valor').eq('venda_id', v.id),
      supabase.from('nfce_documentos').select('numero, serie, status, codigo_status, motivo, ambiente').eq('venda_id', v.id).order('criado_em', { ascending: false }).limit(1),
    ])
    setDetalhe({ ...v, itens: itens.data ?? [], pagamentos: pags.data ?? [], nfce: notas.data?.[0] ?? null })
  }

  const [emitindo, setEmitindo] = useState(false)
  const emitir = async () => {
    setEmitindo(true)
    const r = await chamarNfce({ acao: 'emitir', venda_id: detalhe.id })
    setEmitindo(false)
    if (r.erro) avisar(r.erro, 'erro')
    else { avisar(`NFC-e nº ${r.dados.numero} autorizada.`); await imprimirDanfe(detalhe.id) }
    abrir(detalhe)
  }

  const cancelar = async () => {
    setEnviando(true)
    const { error } = await supabase.rpc('cancelar_venda', { p_venda: cancelando.id, p_motivo: motivo })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`Venda nº ${cancelando.numero} cancelada. Estoque estornado.`)
    setCancelando(null); setDetalhe(null); setMotivo('')
    carregar()
  }

  const concluidas = lista.filter((v) => v.status === 'concluida')
  const total = concluidas.reduce((s, v) => s + Number(v.total), 0)

  return (
    <div className="space-y-4">
      <div className="cartao flex flex-wrap items-end gap-4 p-4">
        <Campo rotulo="Data"><input type="date" className="campo" value={dia} onChange={(e) => setDia(e.target.value)} /></Campo>
        <div className="ml-auto text-right">
          <p className="rotulo">{concluidas.length} vendas concluídas</p>
          <p className="text-2xl font-bold text-marca-600">{dinheiro(total)}</p>
        </div>
      </div>
      <div className="cartao overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
            <tr><th className="px-3 py-2">Nº</th><th className="px-3 py-2">Horário</th><th className="px-3 py-2">Operador</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2 text-right">Total</th></tr>
          </thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-400">Nenhuma venda nesta data</td></tr>}
            {lista.map((v) => (
              <tr key={v.id} onClick={() => abrir(v)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                <td className="px-3 py-2 font-semibold">{v.numero}</td>
                <td className="px-3 py-2">{dataHora(v.criado_em)}</td>
                <td className="px-3 py-2">{v.operador?.nome}</td>
                <td className="px-3 py-2">{v.status === 'cancelada' ? <span className="text-red-600">Cancelada</span> : 'Concluída'}</td>
                <td className="px-3 py-2 text-right">{dinheiro(v.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TelaSuspensa
        aberta={!!detalhe && !cancelando}
        titulo={`Venda nº ${detalhe?.numero ?? ''}`}
        onFechar={() => setDetalhe(null)}
        largura="max-w-2xl"
        rodape={<>
          <Botao variante="secundario" onClick={() => setDetalhe(null)}>Fechar</Botao>
          {detalhe?.status === 'concluida' && detalhe?.nfce?.status !== 'autorizada' && <Botao variante="perigo" onClick={() => setCancelando(detalhe)}>Cancelar venda</Botao>}
          {detalhe?.status === 'concluida' && detalhe?.nfce?.status !== 'autorizada' && <Botao onClick={emitir} carregando={emitindo}>{detalhe?.nfce ? 'Reenviar NFC-e' : 'Emitir NFC-e'}</Botao>}
          {detalhe?.nfce?.status === 'autorizada' && <Botao onClick={() => imprimirDanfe(detalhe.id)}>Imprimir DANFE NFC-e</Botao>}
        </>}
      >
        {detalhe && (
          <div className="space-y-3 text-sm">
            {detalhe.itens.map((i) => (
              <div key={i.sequencia} className="flex justify-between">
                <span>{Number(i.quantidade)} × {i.descricao}</span><span>{dinheiro(i.total)}</span>
              </div>
            ))}
            <div className="border-t border-slate-200 pt-2 dark:border-slate-800">
              {detalhe.pagamentos.map((p, n) => <div key={n} className="flex justify-between text-slate-500"><span className="capitalize">{p.forma}</span><span>{dinheiro(p.valor)}</span></div>)}
              <div className="flex justify-between font-bold"><span>Total</span><span>{dinheiro(detalhe.total)}</span></div>
            </div>
            {detalhe.motivo_cancelamento && <p className="text-red-600">Motivo do cancelamento: {detalhe.motivo_cancelamento}</p>}
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <span className="rotulo">NFC-e</span>
              {!detalhe.nfce && <p className="text-slate-500">Não emitida</p>}
              {detalhe.nfce && (
                <p className={detalhe.nfce.status === 'autorizada' ? 'text-emerald-600' : 'text-red-600'}>
                  Nº {detalhe.nfce.numero} · {detalhe.nfce.status}{detalhe.nfce.ambiente === 2 ? ' (homologação)' : ''}
                  {detalhe.nfce.motivo && detalhe.nfce.status !== 'autorizada' ? ` — ${detalhe.nfce.codigo_status ?? ''} ${detalhe.nfce.motivo}` : ''}
                </p>
              )}
            </div>
          </div>
        )}
      </TelaSuspensa>

      <TelaSuspensa
        aberta={!!cancelando}
        titulo={`Cancelar venda nº ${cancelando?.numero ?? ''}`}
        onFechar={() => setCancelando(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setCancelando(null)}>Voltar</Botao>
          <Botao variante="perigo" onClick={cancelar} carregando={enviando} disabled={motivo.trim().length < 15}>Confirmar cancelamento</Botao>
        </>}
      >
        <Campo rotulo="Motivo (mínimo 15 caracteres)">
          <textarea className="campo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </Campo>
        <p className="mt-2 text-xs text-slate-500">Os itens voltam ao estoque e a operação fica registrada na auditoria.</p>
      </TelaSuspensa>
    </div>
  )
}
