import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useCaixaAberto } from '../lib/caixa.js'
import { adicionar, alterarQuantidade, remover, totais, totalItem, paraEnvio, lerCodigo } from '../lib/carrinho.js'
import { dinheiro, lerNumero, arred } from '../lib/formato.js'
import { Botao, Campo, Confirmacao, TelaSuspensa, useAviso } from '../components/ui.jsx'

const FORMAS = [
  { forma: 'dinheiro', texto: 'Dinheiro', tecla: '1' },
  { forma: 'pix', texto: 'PIX', tecla: '2' },
  { forma: 'debito', texto: 'Cartão de débito', tecla: '3' },
  { forma: 'credito', texto: 'Cartão de crédito', tecla: '4' },
  { forma: 'crediario', texto: 'Crediário', tecla: '5' },
]
const nomeForma = (f) => FORMAS.find((x) => x.forma === f)?.texto ?? f

export default function PDV() {
  const { caixa } = useCaixaAberto()
  const avisar = useAviso()
  const busca = useRef(null)
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState([])
  const [itens, setItens] = useState([])
  const [pagamentoAberto, setPagamentoAberto] = useState(false)
  const [limparAberto, setLimparAberto] = useState(false)
  const [ultima, setUltima] = useState(null)
  const t = useMemo(() => totais(itens), [itens])

  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'F2') { e.preventDefault(); busca.current?.focus() }
      if (e.key === 'F4' && itens.length) { e.preventDefault(); setPagamentoAberto(true) }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [itens.length])

  if (caixa === undefined) return <p className="text-sm text-slate-500">Carregando…</p>
  if (!caixa) {
    return (
      <div className="cartao mx-auto max-w-md p-6 text-center">
        <h2 className="mb-2 text-lg font-bold">Caixa fechado</h2>
        <p className="text-sm text-slate-500">Abra o caixa na tela “Caixa” para iniciar as vendas.</p>
      </div>
    )
  }

  const pesquisar = async (e) => {
    e.preventDefault()
    const { quantidade, termo: q } = lerCodigo(termo)
    if (!q) return
    if (!(quantidade > 0)) { avisar('Quantidade inválida.', 'erro'); return }
    const soNumeros = /^\d{6,14}$/.test(q)
    let consulta = supabase.from('produtos').select('id, descricao, unidade, preco_venda, estoque_atual, ean, codigo').eq('ativo', true).limit(20)
    consulta = soNumeros ? consulta.or(`ean.eq.${q},codigo.eq.${q}`) : consulta.or(`descricao.ilike.%${q.replace(/[%,()]/g, '')}%,codigo.eq.${q.replace(/[%,()]/g, '')}`)
    const { data, error } = await consulta
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    if (data.length === 1) {
      setItens((c) => adicionar(c, data[0], quantidade))
      setTermo(''); setResultados([])
    } else if (data.length === 0) {
      avisar('Produto não encontrado.', 'erro')
    } else {
      setResultados(data.map((p) => ({ ...p, _qtd: quantidade })))
    }
  }

  const escolher = (p) => {
    setItens((c) => adicionar(c, p, p._qtd))
    setResultados([]); setTermo(''); busca.current?.focus()
  }

  const concluida = (r) => {
    setUltima(r); setItens([]); setPagamentoAberto(false)
    avisar(`Venda nº ${r.numero} concluída.`)
    busca.current?.focus()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className="space-y-4">
        <form onSubmit={pesquisar} className="cartao p-4">
          <label className="rotulo">Código de barras, código ou descrição (F2) — use 3*código para quantidade</label>
          <input ref={busca} className="campo text-lg" value={termo} onChange={(e) => setTermo(e.target.value)} autoFocus placeholder="Bipe ou digite e tecle Enter" />
        </form>

        <div className="cartao overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
              <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Produto</th><th className="px-3 py-2 text-right">Qtd</th><th className="px-3 py-2 text-right">Unitário</th><th className="px-3 py-2 text-right">Total</th><th /></tr>
            </thead>
            <tbody>
              {itens.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">Nenhum item na venda</td></tr>}
              {itens.map((i, n) => (
                <tr key={i.chave} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 text-slate-400">{n + 1}</td>
                  <td className="px-3 py-2">{i.descricao}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      key={i.quantidade}
                      className="campo w-20 py-1 text-right"
                      inputMode="decimal"
                      defaultValue={String(i.quantidade).replace('.', ',')}
                      onBlur={(e) => {
                        const q = lerNumero(e.target.value)
                        setItens((c) => alterarQuantidade(c, i.chave, Number.isNaN(q) ? i.quantidade : q))
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">{dinheiro(i.preco_unitario)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{dinheiro(totalItem(i))}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="text-red-500 hover:text-red-700" onClick={() => setItens((c) => remover(c, i.chave))} title="Remover item">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="cartao p-5">
          <p className="rotulo">Total da venda</p>
          <p className="text-4xl font-bold text-marca-600">{dinheiro(t.total)}</p>
          <p className="mt-1 text-sm text-slate-500">{itens.length} {itens.length === 1 ? 'item' : 'itens'}</p>
          <div className="mt-5 flex gap-2">
            <Botao variante="secundario" className="flex-1" disabled={!itens.length} onClick={() => setLimparAberto(true)}>Cancelar venda</Botao>
            <Botao variante="sucesso" className="flex-1" disabled={!itens.length} onClick={() => setPagamentoAberto(true)}>Finalizar (F4)</Botao>
          </div>
        </div>
        {ultima && (
          <div className="cartao p-4 text-sm">
            <p className="rotulo">Última venda</p>
            <p>Nº {ultima.numero} · {dinheiro(ultima.total)}</p>
            {Number(ultima.troco) > 0 && <p className="text-lg font-bold text-emerald-600">Troco: {dinheiro(ultima.troco)}</p>}
          </div>
        )}
      </aside>

      <TelaSuspensa aberta={resultados.length > 0} titulo="Selecione o produto" onFechar={() => setResultados([])} largura="max-w-2xl">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {resultados.map((p) => (
            <li key={p.id}>
              <button className="flex w-full items-center justify-between px-2 py-3 text-left hover:bg-marca-50 dark:hover:bg-slate-800" onClick={() => escolher(p)}>
                <span>{p.descricao}<span className="block text-xs text-slate-400">{p.ean || p.codigo} · estoque {Number(p.estoque_atual)}</span></span>
                <strong>{dinheiro(p.preco_venda)}</strong>
              </button>
            </li>
          ))}
        </ul>
      </TelaSuspensa>

      <Confirmacao
        aberta={limparAberto}
        titulo="Cancelar venda em andamento"
        mensagem="Todos os itens serão removidos. Deseja continuar?"
        textoConfirmar="Cancelar venda"
        variante="perigo"
        onCancelar={() => setLimparAberto(false)}
        onConfirmar={() => { setItens([]); setLimparAberto(false) }}
      />

      {pagamentoAberto && (
        <Pagamento caixa={caixa} itens={itens} onFechar={() => setPagamentoAberto(false)} onConcluir={concluida} />
      )}
    </div>
  )
}

function Pagamento({ caixa, itens, onFechar, onConcluir }) {
  const avisar = useAviso()
  const [desconto, setDesconto] = useState('')
  const [cpf, setCpf] = useState('')
  const [pagamentos, setPagamentos] = useState([])
  const [valor, setValor] = useState('')
  const [enviando, setEnviando] = useState(false)
  const desc = lerNumero(desconto) || 0
  const t = totais(itens, desc, pagamentos)

  const incluir = (forma) => {
    const v = valor === '' ? t.falta : lerNumero(valor)
    if (!(v > 0)) { avisar('Informe um valor válido.', 'erro'); return }
    if (forma !== 'dinheiro' && v > t.falta) { avisar('Só o dinheiro pode gerar troco.', 'erro'); return }
    setPagamentos((p) => [...p, { forma, valor: arred(v) }])
    setValor('')
  }

  useEffect(() => {
    const tecla = (e) => {
      if (e.target.tagName === 'INPUT' && e.target.dataset.valor !== 'sim') return
      const f = FORMAS.find((x) => x.tecla === e.key)
      if (f && t.falta > 0) { e.preventDefault(); incluir(f.forma) }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  const finalizar = async () => {
    setEnviando(true)
    const { data, error } = await supabase.rpc('finalizar_venda', {
      p_caixa: caixa.id,
      p_itens: paraEnvio(itens),
      p_pagamentos: pagamentos,
      p_desconto: desc,
      p_cpf: cpf.replace(/\D/g, '') || null,
    })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    onConcluir(data)
  }

  const podeFinalizar = t.falta === 0 && t.trocoValido && t.total >= 0

  return (
    <TelaSuspensa
      aberta
      titulo="Pagamento"
      onFechar={onFechar}
      largura="max-w-xl"
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Voltar</Botao>
        <Botao variante="sucesso" onClick={finalizar} disabled={!podeFinalizar} carregando={enviando}>Concluir venda</Botao>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Desconto na venda (R$)"><input className="campo" inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" /></Campo>
        <Campo rotulo="CPF/CNPJ na nota (opcional)"><input className="campo" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} /></Campo>
      </div>

      <div className="my-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center text-sm dark:bg-slate-800/60">
        <div><p className="rotulo">Total</p><p className="text-lg font-bold">{dinheiro(t.total)}</p></div>
        <div><p className="rotulo">Falta</p><p className="text-lg font-bold text-red-600">{dinheiro(t.falta)}</p></div>
        <div><p className="rotulo">Troco</p><p className="text-lg font-bold text-emerald-600">{dinheiro(t.troco)}</p></div>
      </div>

      {t.falta > 0 && (
        <>
          <Campo rotulo="Valor recebido (vazio = valor que falta)">
            <input className="campo" inputMode="decimal" data-valor="sim" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={dinheiro(t.falta)} autoFocus />
          </Campo>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FORMAS.map((f) => (
              <Botao key={f.forma} variante="secundario" onClick={() => incluir(f.forma)}>{f.tecla} · {f.texto}</Botao>
            ))}
          </div>
        </>
      )}

      {pagamentos.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {pagamentos.map((p, i) => (
            <li key={i} className="flex items-center justify-between py-2">
              <span>{nomeForma(p.forma)}</span>
              <span className="flex items-center gap-3">
                <strong>{dinheiro(p.valor)}</strong>
                <button className="text-red-500" onClick={() => setPagamentos((x) => x.filter((_, j) => j !== i))} title="Remover pagamento">✕</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!t.trocoValido && <p className="mt-2 text-sm text-red-600">O troco só pode sair de pagamento em dinheiro.</p>}
    </TelaSuspensa>
  )
}
