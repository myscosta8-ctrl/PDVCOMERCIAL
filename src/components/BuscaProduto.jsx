import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { dinheiro } from '../lib/formato.js'
import { Botao, TelaSuspensa, Vazio, useAviso } from './ui.jsx'

// Janela padrão para escolher um produto do cadastro
export function BuscaProduto({ titulo = 'Escolher produto', termoInicial = '', semKits, onFechar, onEscolher }) {
  const avisar = useAviso()
  const [termo, setTermo] = useState(termoInicial)
  const [lista, setLista] = useState([])

  const buscar = async (e) => {
    e?.preventDefault()
    const t = termo.trim().replace(/[%,()]/g, '')
    if (!t) return
    let q = supabase.from('produtos').select('id, descricao, ean, codigo, unidade, preco_venda, preco_custo, markup, estoque_atual, e_kit, controla_lote').eq('ativo', true).order('descricao').limit(30)
    q = /^\d{6,14}$/.test(t) ? q.or(`ean.eq.${t},codigo.eq.${t}`) : q.or(`descricao.ilike.%${t}%,codigo.eq.${t}`)
    if (semKits) q = q.eq('e_kit', false)
    q = q.eq('e_grade', false) // modelo de grade não é vendido nem movimentado; use as variações
    const { data, error } = await q
    if (error) avisar(mensagemErro(error), 'erro')
    else setLista(data)
  }
  useEffect(() => { if (termoInicial) buscar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TelaSuspensa aberta titulo={titulo} subtitulo="Busque por descrição, código ou código de barras" onFechar={onFechar} largura="max-w-2xl">
      <form onSubmit={buscar} className="flex gap-2">
        <input className="campo" value={termo} onChange={(e) => setTermo(e.target.value)} autoFocus aria-label="Buscar produto" />
        <Botao type="submit" icone="busca">Buscar</Botao>
      </form>
      <ul className="-mx-2 mt-3 divide-y divide-papel-200 dark:divide-noite-700">
        {lista.map((p) => (
          <li key={p.id}>
            <button className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-3 text-left hover:bg-caixa-50 dark:hover:bg-noite-700" onClick={() => onEscolher(p)}>
              <span className="min-w-0"><span className="block truncate font-medium">{p.descricao}</span><span className="text-sm text-tinta-400">{p.ean || p.codigo || 'Sem código'}, estoque {Number(p.estoque_atual)} {p.unidade}</span></span>
              <strong className="num">{dinheiro(p.preco_venda)}</strong>
            </button>
          </li>
        ))}
      </ul>
      {!lista.length && <Vazio icone="produtos" titulo="Busque o produto" texto="Digite parte da descrição ou o código e clique em Buscar." />}
    </TelaSuspensa>
  )
}
