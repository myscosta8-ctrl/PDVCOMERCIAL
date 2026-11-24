import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { dinheiro, dataHora } from '../lib/formato.js'
import { Botao, Cabecalho, Campo, Etiqueta, Icone, Indicador, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'
import { chamarNfce, imprimirDanfe } from '../lib/nfce.js'

const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Cartão de débito', credito: 'Cartão de crédito', crediario: 'Crediário', outro: 'Outros' }

function situacaoNota(notas) {
  const n = notas?.find((x) => x.status === 'autorizada') ?? notas?.[0]
  if (!n) return { tom: 'neutro', texto: 'Sem NFC-e' }
  if (n.status === 'autorizada') return { tom: 'positivo', texto: `NFC-e ${n.numero}` }
  if (n.status === 'rejeitada') return { tom: 'critico', texto: 'NFC-e rejeitada' }
  return { tom: 'alerta', texto: 'NFC-e pendente' }
}

export default function Vendas() {
  const avisar = useAviso()
  const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const [dia, setDia] = useState(hoje)
  const [lista, setLista] = useState(null)
  const [detalhe, setDetalhe] = useState(null)
  const [cancelando, setCancelando] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [emitindo, setEmitindo] = useState(false)

  const carregar = async () => {
    const inicio = new Date(`${dia}T00:00:00`)
    const fim = new Date(inicio.getTime() + 86400000)
    const { data, error } = await supabase
      .from('vendas')
      .select('id, numero, subtotal, desconto, total, troco, status, criado_em, cpf_consumidor, motivo_cancelamento, operador:usuarios!vendas_operador_id_fkey(nome), pagamentos:venda_pagamentos(forma, valor), notas:nfce_documentos(numero, status)')
      .gte('criado_em', inicio.toISOString())
      .lt('criado_em', fim.toISOString())
      .order('numero', { ascending: false })
    if (error) avisar(mensagemErro(error), 'erro')
    else setLista(data)
  }
  useEffect(() => { carregar() }, [dia]) // eslint-disable-line react-hooks/exhaustive-deps

  const abrir = async (v) => {
    const [itens, notas] = await Promise.all([
      supabase.from('venda_itens').select('sequencia, descricao, quantidade, preco_unitario, desconto, total').eq('venda_id', v.id).order('sequencia'),
      supabase.from('nfce_documentos').select('numero, serie, status, codigo_status, motivo, ambiente, chave').eq('venda_id', v.id).order('criado_em', { ascending: false }).limit(1),
    ])
    setDetalhe({ ...v, itens: itens.data ?? [], nfce: notas.data?.[0] ?? null })
  }

  const emitir = async () => {
    setEmitindo(true)
    const r = await chamarNfce({ acao: 'emitir', venda_id: detalhe.id })
    setEmitindo(false)
    if (r.erro) avisar(r.erro, 'erro')
    else { avisar(`NFC-e nº ${r.dados.numero} autorizada.`); await imprimirDanfe(detalhe.id) }
    abrir(detalhe); carregar()
  }

  const cancelar = async () => {
    setEnviando(true)
    const { error } = await supabase.rpc('cancelar_venda', { p_venda: cancelando.id, p_motivo: motivo })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`Venda nº ${cancelando.numero} cancelada. Os itens voltaram ao estoque.`)
    setCancelando(null); setDetalhe(null); setMotivo('')
    carregar()
  }

  const concluidas = (lista ?? []).filter((v) => v.status === 'concluida')
  const total = concluidas.reduce((s, v) => s + Number(v.total), 0)
  const canceladas = (lista ?? []).length - concluidas.length
  const semNota = concluidas.filter((v) => !v.notas?.some((n) => n.status === 'autorizada')).length

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Vendas" descricao="Consulta por dia, detalhes, NFC-e e cancelamentos">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-tinta-400">Data</span>
          <input type="date" className="campo w-auto" value={dia} max={hoje} onChange={(e) => setDia(e.target.value)} />
        </label>
      </Cabecalho>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Faturamento" icone="dinheiro" tom="positivo" valor={dinheiro(total)} detalhe={dia === hoje ? 'Hoje' : new Date(`${dia}T12:00:00`).toLocaleDateString('pt-BR')} />
        <Indicador titulo="Vendas concluídas" icone="vendas" valor={concluidas.length} detalhe={`Ticket médio ${dinheiro(concluidas.length ? total / concluidas.length : 0)}`} />
        <Indicador titulo="Canceladas" icone="fechar" valor={canceladas} tom={canceladas ? 'critico' : 'neutro'} detalhe="Itens devolvidos ao estoque" />
        <Indicador titulo="Sem NFC-e autorizada" icone="nota" valor={semNota} tom={semNota ? 'alerta' : 'neutro'} detalhe="Vendas concluídas no dia" />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        {lista === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : lista.length === 0 ? (
          <Vazio icone="vendas" titulo="Nenhuma venda nesta data" texto="Escolha outra data ou registre vendas na frente de caixa." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead className="bg-papel/70 dark:bg-noite/40">
                <tr><th>Venda</th><th>Horário</th><th>Operador</th><th>Pagamento</th><th>Nota fiscal</th><th className="text-right">Total</th></tr>
              </thead>
              <tbody>
                {lista.map((v) => {
                  const nota = situacaoNota(v.notas)
                  return (
                    <tr key={v.id} onClick={() => abrir(v)} className="cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40">
                      <td className="font-semibold">Nº {v.numero}</td>
                      <td>{new Date(v.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{v.operador?.nome}</td>
                      <td className="text-tinta-600 dark:text-tinta-300">{[...new Set(v.pagamentos.map((p) => FORMAS[p.forma] ?? p.forma))].join(', ')}</td>
                      <td>{v.status === 'cancelada' ? <Etiqueta tom="critico">Venda cancelada</Etiqueta> : <Etiqueta tom={nota.tom}>{nota.texto}</Etiqueta>}</td>
                      <td className={`num text-right font-semibold ${v.status === 'cancelada' ? 'text-tinta-300 line-through' : ''}`}>{dinheiro(v.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TelaSuspensa
        aberta={!!detalhe && !cancelando}
        titulo={`Venda nº ${detalhe?.numero ?? ''}`}
        subtitulo={detalhe ? `${dataHora(detalhe.criado_em)}, operador ${detalhe.operador?.nome ?? ''}` : ''}
        onFechar={() => setDetalhe(null)}
        largura="max-w-2xl"
        rodape={<>
          <Botao variante="secundario" onClick={() => setDetalhe(null)}>Fechar</Botao>
          {detalhe?.status === 'concluida' && detalhe?.nfce?.status !== 'autorizada' && <Botao variante="perigo" onClick={() => setCancelando(detalhe)}>Cancelar venda</Botao>}
          {detalhe?.status === 'concluida' && detalhe?.nfce?.status !== 'autorizada' && <Botao icone="nota" onClick={emitir} carregando={emitindo}>{detalhe?.nfce ? 'Reenviar NFC-e' : 'Emitir NFC-e'}</Botao>}
          {detalhe?.nfce?.status === 'autorizada' && <Botao icone="impressora" onClick={() => imprimirDanfe(detalhe.id)}>Imprimir DANFE NFC-e</Botao>}
        </>}
      >
        {detalhe && (
          <div className="space-y-4">
            <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
              <thead><tr><th>Produto</th><th className="text-right">Qtd.</th><th className="text-right">Unitário</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {detalhe.itens.map((i) => (
                  <tr key={i.sequencia}>
                    <td>{i.descricao}</td>
                    <td className="num text-right">{Number(i.quantidade)}</td>
                    <td className="num text-right">{dinheiro(i.preco_unitario)}</td>
                    <td className="num text-right">{dinheiro(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 text-[0.95rem]">
                <p className="font-semibold">Pagamento</p>
                {detalhe.pagamentos.map((p, n) => <div key={n} className="flex justify-between"><span>{FORMAS[p.forma] ?? p.forma}</span><span className="num">{dinheiro(p.valor)}</span></div>)}
                {Number(detalhe.troco) > 0 && <div className="flex justify-between text-tinta-400"><span>Troco</span><span className="num">{dinheiro(detalhe.troco)}</span></div>}
              </div>
              <div className="space-y-1 text-[0.95rem]">
                <p className="font-semibold">Totais</p>
                <div className="flex justify-between"><span>Subtotal</span><span className="num">{dinheiro(detalhe.subtotal)}</span></div>
                {Number(detalhe.desconto) > 0 && <div className="flex justify-between"><span>Desconto</span><span className="num">−{dinheiro(detalhe.desconto)}</span></div>}
                <div className="flex justify-between text-lg font-semibold"><span>Total</span><span className="num">{dinheiro(detalhe.total)}</span></div>
              </div>
            </div>
            {detalhe.motivo_cancelamento && <p className="rounded-lg bg-rubro-50 px-3 py-2 text-sm text-rubro-600">Cancelada: {detalhe.motivo_cancelamento}</p>}
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-papel-200 p-3 dark:border-noite-700">
              <Icone nome="nota" className="h-5 w-5 text-tinta-400" />
              {!detalhe.nfce && <span className="text-tinta-600 dark:text-tinta-300">NFC-e ainda não emitida para esta venda.</span>}
              {detalhe.nfce && (
                <span className="flex-1">
                  <Etiqueta tom={detalhe.nfce.status === 'autorizada' ? 'positivo' : detalhe.nfce.status === 'rejeitada' ? 'critico' : 'alerta'}>
                    NFC-e nº {detalhe.nfce.numero}, {detalhe.nfce.status}{detalhe.nfce.ambiente === 2 ? ' em homologação' : ''}
                  </Etiqueta>
                  {detalhe.nfce.motivo && detalhe.nfce.status !== 'autorizada' && <span className="mt-1 block text-sm text-rubro-600">{detalhe.nfce.codigo_status} {detalhe.nfce.motivo}</span>}
                </span>
              )}
            </div>
          </div>
        )}
      </TelaSuspensa>

      <TelaSuspensa
        aberta={!!cancelando}
        titulo={`Cancelar venda nº ${cancelando?.numero ?? ''}`}
        subtitulo="Os itens voltam ao estoque e a operação fica registrada na auditoria."
        onFechar={() => setCancelando(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setCancelando(null)}>Voltar</Botao>
          <Botao variante="perigo" onClick={cancelar} carregando={enviando} disabled={motivo.trim().length < 15}>Cancelar venda</Botao>
        </>}
      >
        <Campo rotulo="Motivo do cancelamento" ajuda={`${motivo.trim().length} de no mínimo 15 caracteres`}>
          <textarea className="campo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </Campo>
      </TelaSuspensa>
    </div>
  )
}
