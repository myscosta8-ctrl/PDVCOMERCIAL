import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { Botao, Cabecalho, Etiqueta, Vazio, useAviso } from '../components/ui.jsx'

const minutos = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))

// Tela da cozinha: pedidos das comandas abertas, do mais antigo para o mais novo
export default function Cozinha() {
  const avisar = useAviso()
  const [itens, setItens] = useState(null)
  const [, setRelogio] = useState(0)

  const carregar = async () => {
    const { data, error } = await supabase.from('comanda_itens')
      .select('id, descricao, quantidade, observacao, status, lancado_em, pronto_em, comanda:comandas!inner(id, numero, identificacao, status, mesa:mesas(numero))')
      .eq('cozinha', true).in('status', ['pendente', 'pronto']).eq('comanda.status', 'aberta').order('lancado_em')
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    setItens(data)
  }
  useEffect(() => {
    carregar()
    const t = setInterval(() => { carregar(); setRelogio((x) => x + 1) }, 10000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const mudar = async (i, status) => {
    setItens((l) => l.map((x) => (x.id === i.id ? { ...x, status } : x)).filter((x) => x.status !== 'entregue'))
    const { error } = await supabase.rpc('situacao_item_comanda', { p_item: i.id, p_status: status })
    if (error) { avisar(mensagemErro(error), 'erro'); carregar() }
  }

  // Agrupa por comanda, na ordem do pedido mais antigo
  const grupos = useMemo(() => {
    const g = new Map()
    for (const i of itens ?? []) {
      if (!g.has(i.comanda.id)) g.set(i.comanda.id, { comanda: i.comanda, itens: [] })
      g.get(i.comanda.id).itens.push(i)
    }
    return [...g.values()]
  }, [itens])
  const pendentes = (itens ?? []).filter((i) => i.status === 'pendente').length

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Cozinha" descricao={`${pendentes} item(ns) em preparo. A lista se atualiza sozinha a cada 10 segundos.`} />
      {itens === null ? <p className="text-sm text-tinta-400">Carregando…</p> : !grupos.length ? (
        <div className="cartao"><Vazio icone="ok" titulo="Nenhum pedido na fila" texto="Os itens marcados como preparados na cozinha aparecem aqui quando o garçom envia o pedido." /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {grupos.map(({ comanda, itens: lista }) => {
            const espera = minutos(lista[0].lancado_em)
            const atraso = espera >= 25 ? 'critico' : espera >= 15 ? 'alerta' : 'neutro'
            return (
              <section key={comanda.id} className="cartao overflow-hidden">
                <header className={`flex items-center justify-between px-4 py-3 ${atraso === 'critico' ? 'bg-rubro-50 dark:bg-rubro-600/15' : atraso === 'alerta' ? 'bg-ambar-50 dark:bg-ambar-600/10' : 'bg-papel-100 dark:bg-noite-700'}`}>
                  <span className="text-[1.15rem] font-bold">{comanda.mesa ? `Mesa ${comanda.mesa.numero}` : comanda.identificacao}<span className="ml-2 text-sm font-normal text-tinta-400">nº {comanda.numero}</span></span>
                  <Etiqueta tom={atraso}>{espera} min</Etiqueta>
                </header>
                <ul className="divide-y divide-papel-200 dark:divide-noite-700">
                  {lista.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="num text-xl font-bold">{Number(i.quantidade).toLocaleString('pt-BR')}×</span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[1.05rem] font-semibold ${i.status === 'pronto' ? 'text-tinta-400 line-through' : ''}`}>{i.descricao}</span>
                        {i.observacao && <span className="block text-sm font-semibold text-ambar-600 dark:text-ambar-300">{i.observacao}</span>}
                      </span>
                      {i.status === 'pendente'
                        ? <Botao variante="sucesso" icone="ok" onClick={() => mudar(i, 'pronto')}>Pronto</Botao>
                        : <span className="flex gap-1"><Botao variante="secundario" onClick={() => mudar(i, 'pendente')}>Voltar</Botao><Botao onClick={() => mudar(i, 'entregue')}>Entregue</Botao></span>}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
