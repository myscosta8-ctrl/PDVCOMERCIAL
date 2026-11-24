import { useEffect, useState } from 'react'
import { NOMES_FORMAS as FORMAS } from '../lib/formas.js'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { dinheiro, dataHora } from '../lib/formato.js'
import { Botao, Cabecalho, Campo, Etiqueta, Icone, Indicador, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'
import { chamarNfce, imprimirDanfe } from '../lib/nfce.js'
import { imprimirComprovanteVenda } from '../lib/impressao.js'
import { useSessao } from '../lib/sessao.js'
import { useCaixaAberto } from '../lib/caixa.js'
import { lerNumero } from '../lib/formato.js'
import { SeletorCliente } from '../components/Clientes.jsx'
import { criarRascunhoDaVenda } from './NotasFiscais.jsx'


function situacaoNota(notas) {
  const n = notas?.find((x) => ['autorizada', 'contingencia', 'cancelada'].includes(x.status)) ?? notas?.[0]
  if (!n) return { tom: 'neutro', texto: 'Sem NFC-e' }
  if (n.status === 'autorizada') return { tom: 'positivo', texto: `NFC-e ${n.numero}` }
  if (n.status === 'rejeitada') return { tom: 'critico', texto: 'NFC-e rejeitada' }
  if (n.status === 'contingencia') return { tom: 'alerta', texto: `NFC-e ${n.numero} em contingência` }
  if (n.status === 'cancelada') return { tom: 'neutro', texto: `NFC-e ${n.numero} cancelada` }
  return { tom: 'alerta', texto: 'NFC-e pendente' }
}

export default function Vendas({ irPara }) {
  const avisar = useAviso()
  const perfil = useSessao()
  const { caixa } = useCaixaAberto()
  const [devolvendo, setDevolvendo] = useState(null)
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
      .select('id, numero, subtotal, desconto, total, troco, status, criado_em, cpf_consumidor, motivo_cancelamento, cliente_id, cliente:clientes(nome), operador:usuarios!vendas_operador_id_fkey(nome), pagamentos:venda_pagamentos(forma, valor), notas:nfce_documentos(numero, status)')
      .gte('criado_em', inicio.toISOString())
      .lt('criado_em', fim.toISOString())
      .order('numero', { ascending: false })
    if (error) avisar(mensagemErro(error), 'erro')
    else setLista(data)
  }
  useEffect(() => { carregar() }, [dia]) // eslint-disable-line react-hooks/exhaustive-deps

  const abrir = async (v) => {
    const [itens, notas] = await Promise.all([
      supabase.from('venda_itens').select('id, sequencia, descricao, quantidade, quantidade_devolvida, preco_unitario, desconto, total').eq('venda_id', v.id).order('sequencia'),
      supabase.from('nfce_documentos').select('numero, serie, status, codigo_status, motivo, ambiente, chave, emitida_em, protocolo_cancelamento, justificativa_cancelamento, cancelada_em').eq('venda_id', v.id).order('criado_em', { ascending: false }),
    ])
    const lista = notas.data ?? []
    setDetalhe({ ...v, itens: itens.data ?? [], nfce: lista.find((n) => ['autorizada', 'contingencia', 'cancelada'].includes(n.status)) ?? lista[0] ?? null })
  }

  const [gerandoNfe, setGerandoNfe] = useState(false)
  const nfeDaVenda = async () => {
    setGerandoNfe(true)
    const { data: existente } = await supabase.from('nfe_documentos').select('id').eq('venda_id', detalhe.id).neq('status', 'cancelada').limit(1).maybeSingle()
    const r = existente ? { data: existente } : await criarRascunhoDaVenda(detalhe)
    setGerandoNfe(false)
    if (r.error) { avisar(mensagemErro(r.error), 'erro'); return }
    try { localStorage.setItem('nfe:abrir', r.data.id) } catch {}
    irPara?.('notas')
  }

  const emitir = async () => {
    setEmitindo(true)
    const r = await chamarNfce({ acao: 'emitir', venda_id: detalhe.id })
    setEmitindo(false)
    if (r.erro) avisar(r.erro, 'erro')
    else {
      avisar(r.dados.status === 'contingencia' ? `SEFAZ sem resposta: NFC-e nº ${r.dados.numero} emitida em contingência. Será transmitida depois.` : `NFC-e nº ${r.dados.numero} autorizada.`, r.dados.status === 'contingencia' ? 'erro' : undefined)
      const x = await imprimirDanfe(detalhe.id); if (x.erro) avisar(x.erro, 'erro')
    }
    abrir(detalhe); carregar()
  }

  const comNota = cancelando?.nfce?.status === 'autorizada'
  const minutosNota = comNota && cancelando.nfce.emitida_em ? Math.floor((Date.now() - new Date(cancelando.nfce.emitida_em)) / 60000) : 0
  const cancelar = async () => {
    setEnviando(true)
    if (comNota) {
      // Primeiro a SEFAZ cancela a nota; depois o servidor cancela a venda e devolve o estoque
      const r = await chamarNfce({ acao: 'cancelar', venda_id: cancelando.id, justificativa: motivo })
      setEnviando(false)
      if (r.erro) { avisar(r.erro, 'erro'); return }
      if (r.dados.aviso) avisar(r.dados.aviso, 'erro')
      else avisar(`NFC-e nº ${cancelando.nfce.numero} e venda nº ${cancelando.numero} canceladas. Os itens voltaram ao estoque.`)
    } else {
      const { error } = await supabase.rpc('cancelar_venda', { p_venda: cancelando.id, p_motivo: motivo })
      setEnviando(false)
      if (error) { avisar(mensagemErro(error), 'erro'); return }
      avisar(`Venda nº ${cancelando.numero} cancelada. Os itens voltaram ao estoque.`)
    }
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
              <thead>
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
        aberta={!!detalhe && !cancelando && !devolvendo}
        titulo={`Venda nº ${detalhe?.numero ?? ''}`}
        subtitulo={detalhe ? `${dataHora(detalhe.criado_em)}, operador ${detalhe.operador?.nome ?? ''}` : ''}
        onFechar={() => setDetalhe(null)}
        largura="max-w-[54rem]"
        rodape={<>
          <Botao variante="secundario" onClick={() => setDetalhe(null)}>Fechar</Botao>
          <Botao variante="secundario" icone="impressora" onClick={async () => { const x = await imprimirComprovanteVenda(detalhe.id); if (x.erro) avisar(x.erro, 'erro') }}>Comprovante</Botao>
          {detalhe?.status === 'concluida' && perfil.papel !== 'operador' && detalhe.itens.some((i) => Number(i.quantidade) > Number(i.quantidade_devolvida)) && <Botao variante="secundario" onClick={() => setDevolvendo(detalhe)}>Devolução ou troca</Botao>}
          {detalhe?.status === 'concluida' && perfil.papel !== 'operador' && !['contingencia', 'pendente'].includes(detalhe?.nfce?.status) && (
            <Botao variante="perigo" onClick={() => setCancelando(detalhe)}>{detalhe?.nfce?.status === 'autorizada' ? 'Cancelar NFC-e e venda' : 'Cancelar venda'}</Botao>)}
          {detalhe?.status === 'concluida' && perfil.papel !== 'operador' && !['autorizada', 'contingencia', 'pendente'].includes(detalhe?.nfce?.status) && <Botao variante="secundario" icone="nota" onClick={nfeDaVenda} carregando={gerandoNfe}>NF-e (modelo 55)</Botao>}
          {detalhe?.status === 'concluida' && !['autorizada', 'contingencia', 'cancelada'].includes(detalhe?.nfce?.status) && <Botao icone="nota" onClick={emitir} carregando={emitindo}>{detalhe?.nfce ? 'Reenviar NFC-e' : 'Emitir NFC-e'}</Botao>}
          {['autorizada', 'contingencia'].includes(detalhe?.nfce?.status) && <Botao icone="impressora" onClick={async () => { const x = await imprimirDanfe(detalhe.id); if (x.erro) avisar(x.erro, 'erro') }}>Imprimir DANFE NFC-e</Botao>}
        </>}
      >
        {detalhe && (
          <div className="space-y-4">
            <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
              <thead><tr><th>Produto</th><th className="text-right">Qtd.</th><th className="text-right">Unitário</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {detalhe.itens.map((i) => (
                  <tr key={i.sequencia}>
                    <td>{i.descricao}{Number(i.quantidade_devolvida) > 0 && <span className="ml-2"><Etiqueta tom="alerta">{Number(i.quantidade_devolvida)} devolvido(s)</Etiqueta></span>}</td>
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
                  <Etiqueta tom={{ autorizada: 'positivo', rejeitada: 'critico', cancelada: 'neutro' }[detalhe.nfce.status] ?? 'alerta'}>
                    NFC-e nº {detalhe.nfce.numero}, {{ contingencia: 'em contingência', pendente: 'sem resposta da SEFAZ' }[detalhe.nfce.status] ?? detalhe.nfce.status}{detalhe.nfce.ambiente === 2 ? ' em homologação' : ''}
                  </Etiqueta>
                  {detalhe.nfce.status === 'contingencia' && <span className="mt-1 block text-sm text-tinta-400">Emitida sem a SEFAZ. É transmitida sozinha quando a conexão voltar (prazo de 24 horas). Para cancelar, espere a autorização.</span>}
                  {detalhe.nfce.status === 'cancelada' && <span className="mt-1 block text-sm text-tinta-400">Cancelada em {dataHora(detalhe.nfce.cancelada_em)}, protocolo {detalhe.nfce.protocolo_cancelamento}. {detalhe.nfce.justificativa_cancelamento}</span>}
                  {detalhe.nfce.motivo && ['rejeitada', 'pendente'].includes(detalhe.nfce.status) && <span className="mt-1 block text-sm text-rubro-600">{detalhe.nfce.codigo_status} {detalhe.nfce.motivo}</span>}
                </span>
              )}
            </div>
          </div>
        )}
      </TelaSuspensa>

      {devolvendo && (
        <Devolucao venda={devolvendo} caixa={caixa} onFechar={() => setDevolvendo(null)}
          onConcluir={() => { const v = devolvendo; setDevolvendo(null); abrir(v); carregar() }} />
      )}

      <TelaSuspensa
        aberta={!!cancelando}
        titulo={comNota ? `Cancelar NFC-e nº ${cancelando?.nfce?.numero} e venda nº ${cancelando?.numero}` : `Cancelar venda nº ${cancelando?.numero ?? ''}`}
        subtitulo={comNota ? 'O cancelamento vai primeiro para a SEFAZ; depois os itens voltam ao estoque.' : 'Os itens voltam ao estoque e a operação fica registrada na auditoria.'}
        onFechar={() => setCancelando(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setCancelando(null)}>Voltar</Botao>
          <Botao variante="perigo" onClick={cancelar} carregando={enviando} disabled={motivo.trim().length < 15}>{comNota ? 'Cancelar NFC-e e venda' : 'Cancelar venda'}</Botao>
        </>}
      >
        {comNota && (
          <p className={`mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${minutosNota > 30 ? 'bg-rubro-50 text-rubro-600 dark:bg-rubro-600/20 dark:text-rubro-300' : 'bg-papel-200 dark:bg-noite-700'}`}>
            <Icone nome="alerta" className="mt-0.5 h-4 w-4 shrink-0" />
            {minutosNota > 30
              ? `A nota foi autorizada há ${minutosNota} minutos. O prazo comum de cancelamento é de 30 minutos; a SEFAZ pode recusar. Fora do prazo, faça uma devolução.`
              : `Nota autorizada há ${minutosNota} minuto(s). O cancelamento na SEFAZ costuma ser aceito até 30 minutos após a autorização.`}
          </p>
        )}
        <Campo rotulo="Motivo do cancelamento" ajuda={`${motivo.trim().length} de no mínimo 15 caracteres`}>
          <textarea className="campo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </Campo>
      </TelaSuspensa>
    </div>
  )
}

function Devolucao({ venda, caixa, onFechar, onConcluir }) {
  const avisar = useAviso()
  const [qtds, setQtds] = useState({})
  const [destino, setDestino] = useState('vale')
  const [cliente, setCliente] = useState(venda.cliente_id ? { id: venda.cliente_id, nome: venda.cliente?.nome } : null)
  const [escolher, setEscolher] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const aPrazo = venda.pagamentos.some((p) => p.forma === 'crediario' || p.forma === 'convenio')
  const proporcao = Number(venda.subtotal) > 0 ? Number(venda.total) / Number(venda.subtotal) : 1
  const disponivel = (i) => Number(i.quantidade) - Number(i.quantidade_devolvida)
  const selecionados = venda.itens.map((i) => ({ i, q: lerNumero(qtds[i.id] ?? '') || 0 })).filter((x) => x.q > 0)
  const valor = selecionados.reduce((s, { i, q }) => s + Math.round((Number(i.total) / Number(i.quantidade)) * q * proporcao * 100) / 100, 0)
  const invalido = selecionados.some(({ i, q }) => q > disponivel(i))

  const confirmar = async () => {
    if (!selecionados.length) { avisar('Informe a quantidade devolvida de pelo menos um item.', 'erro'); return }
    if (invalido) { avisar('Quantidade maior que a disponível para devolução.', 'erro'); return }
    if (destino === 'vale' && !cliente) { avisar('Identifique o cliente para gerar o vale-troca.', 'erro'); return }
    if (destino === 'dinheiro' && !caixa) { avisar('Abra o caixa para devolver em dinheiro.', 'erro'); return }
    setEnviando(true)
    const { data, error } = await supabase.rpc('devolver_itens', {
      p_venda: venda.id, p_itens: selecionados.map(({ i, q }) => ({ venda_item_id: i.id, quantidade: q })),
      p_destino: destino, p_motivo: motivo, p_caixa: caixa?.id ?? null, p_cliente: cliente?.id ?? null,
    })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(destino === 'vale' ? `Vale-troca de ${dinheiro(data.valor)} gerado para ${cliente.nome}.` : `Devolva ${dinheiro(data.valor)} em dinheiro ao cliente.`)
    onConcluir()
  }

  if (escolher) return <SeletorCliente aberta titulo="Cliente do vale-troca" onFechar={() => setEscolher(false)} onEscolher={(c) => { setCliente(c); setEscolher(false) }} />

  return (
    <TelaSuspensa aberta titulo={`Devolução ou troca da venda nº ${venda.numero}`} subtitulo="Os itens devolvidos voltam ao estoque" onFechar={onFechar} largura="max-w-2xl"
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Cancelar</Botao>
        <Botao onClick={confirmar} carregando={enviando} disabled={!selecionados.length || invalido || motivo.trim().length < 10}>
          {destino === 'vale' ? `Gerar vale de ${dinheiro(valor)}` : `Devolver ${dinheiro(valor)}`}
        </Botao>
      </>}>
      <div className="space-y-4">
        <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
          <thead><tr><th>Produto</th><th className="text-right">Vendido</th><th className="text-right">Disponível</th><th className="text-right">Devolver</th></tr></thead>
          <tbody>
            {venda.itens.map((i) => (
              <tr key={i.id} className={disponivel(i) <= 0 ? 'opacity-50' : ''}>
                <td>{i.descricao}</td>
                <td className="num text-right">{Number(i.quantidade)}</td>
                <td className="num text-right">{disponivel(i)}</td>
                <td className="text-right">
                  <input className="campo num ml-auto w-20 py-1 text-right" inputMode="decimal" disabled={disponivel(i) <= 0} aria-label={`Quantidade devolvida de ${i.descricao}`}
                    value={qtds[i.id] ?? ''} onChange={(e) => setQtds((x) => ({ ...x, [i.id]: e.target.value }))} placeholder="0" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <span className="rotulo">Como devolver o valor</span>
          <div className="grid grid-cols-2 gap-2">
            {[{ id: 'vale', t: 'Vale-troca para o cliente', d: 'Crédito para usar em outra compra' }, { id: 'dinheiro', t: 'Dinheiro do caixa', d: aPrazo ? 'Indisponível para venda a prazo' : 'Sai da gaveta do caixa aberto' }].map((o) => (
              <button key={o.id} disabled={o.id === 'dinheiro' && aPrazo} onClick={() => setDestino(o.id)} aria-pressed={destino === o.id}
                className={`rounded-xl border px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-45 ${destino === o.id ? 'border-caixa-500 bg-caixa-50 dark:bg-caixa-700/20' : 'border-papel-300 dark:border-noite-600'}`}>
                <span className="block font-medium">{o.t}</span><span className="text-sm text-tinta-400">{o.d}</span>
              </button>
            ))}
          </div>
        </div>
        {destino === 'vale' && (
          <div className="flex items-center justify-between rounded-xl border border-papel-200 px-3 py-2 dark:border-noite-700">
            <span>{cliente ? <>Cliente: <strong>{cliente.nome}</strong></> : <span className="text-ambar-600">Identifique o cliente que receberá o vale</span>}</span>
            <Botao variante="discreto" className="px-2 py-1" onClick={() => setEscolher(true)}>{cliente ? 'Trocar' : 'Identificar'}</Botao>
          </div>
        )}
        <Campo rotulo="Motivo da devolução" ajuda={`${motivo.trim().length} de no mínimo 10 caracteres`}>
          <input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: produto com defeito, troca de tamanho" />
        </Campo>
        <p className="flex items-start gap-2 text-sm text-tinta-400"><Icone nome="alerta" className="mt-0.5 h-4 w-4 shrink-0" />Se a venda teve NFC-e autorizada, a devolução fiscal da mercadoria ainda deve ser feita com nota de entrada (será incluída no módulo de NF-e).</p>
      </div>
    </TelaSuspensa>
  )
}
