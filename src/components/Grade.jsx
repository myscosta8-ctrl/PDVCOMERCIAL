import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { dinheiro, lerNumero } from '../lib/formato.js'
import { Botao, Campo, TelaSuspensa, Vazio, useAviso } from './ui.jsx'

const ORDEM_TAMANHOS = ['RN', 'PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'EG', 'EGG']
function ordenarTamanhos(lista) {
  return [...lista].sort((a, b) => {
    const ia = ORDEM_TAMANHOS.indexOf(a), ib = ORDEM_TAMANHOS.indexOf(b)
    if (ia >= 0 && ib >= 0) return ia - ib
    if (!Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) return Number(a) - Number(b)
    return String(a).localeCompare(String(b), 'pt-BR')
  })
}

async function carregarVariacoes(paiId) {
  const { data } = await supabase.from('produtos')
    .select('id, descricao, ean, codigo, preco_venda, preco_custo, estoque_atual, unidade, atributos, ativo, controla_lote, e_kit, e_grade')
    .eq('produto_pai_id', paiId).order('descricao')
  return data ?? []
}

function matriz(variacoes) {
  const tamanhos = ordenarTamanhos([...new Set(variacoes.map((v) => v.atributos?.tamanho ?? '—'))])
  const cores = [...new Set(variacoes.map((v) => v.atributos?.cor ?? '—'))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const celula = (t, c) => variacoes.find((v) => (v.atributos?.tamanho ?? '—') === t && (v.atributos?.cor ?? '—') === c)
  return { tamanhos, cores, celula }
}

// Frente de caixa: escolha de tamanho e cor
export function EscolherGrade({ modelo, onFechar, onEscolher }) {
  const [variacoes, setVariacoes] = useState(null)
  useEffect(() => { carregarVariacoes(modelo.id).then(setVariacoes) }, [modelo.id])
  const m = useMemo(() => matriz((variacoes ?? []).filter((v) => v.ativo)), [variacoes])

  return (
    <TelaSuspensa aberta titulo="Escolha tamanho e cor" subtitulo={modelo.descricao} onFechar={onFechar} largura="max-w-3xl">
      {variacoes === null ? <p className="text-sm text-tinta-400">Carregando…</p> : !variacoes.length ? (
        <Vazio icone="produtos" titulo="Grade sem variações" texto="Cadastre os tamanhos e cores na tela Produtos." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-center text-[0.95rem]">
            <thead><tr><th className="p-2 text-left text-sm font-medium text-tinta-400">Tamanho</th>{m.cores.map((c) => <th key={c} className="p-2 text-sm font-medium text-tinta-400">{c}</th>)}</tr></thead>
            <tbody>
              {m.tamanhos.map((t) => (
                <tr key={t}>
                  <td className="p-2 text-left font-semibold">{t}</td>
                  {m.cores.map((c) => {
                    const v = m.celula(t, c)
                    if (!v) return <td key={c} className="p-1"><div className="rounded-lg border border-dashed border-papel-300 py-3 text-tinta-300 dark:border-noite-600">—</div></td>
                    const sem = Number(v.estoque_atual) <= 0
                    return (
                      <td key={c} className="p-1">
                        <button onClick={() => onEscolher(v)} className={`w-full rounded-lg border px-2 py-2.5 transition hover:border-caixa-500 hover:bg-caixa-50 dark:hover:bg-noite-700 ${sem ? 'border-papel-200 text-tinta-400 dark:border-noite-700' : 'border-papel-300 dark:border-noite-600'}`}>
                          <span className="num block text-lg font-semibold">{Number(v.estoque_atual)}</span>
                          <span className="text-xs">{sem ? 'sem estoque' : 'em estoque'}</span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TelaSuspensa>
  )
}

// Tela Produtos: criar a grade, ver estoque por tamanho/cor e ajustar código de barras e preço de cada variação
export function GerenciarGrade({ produto, onFechar, onAlterado }) {
  const avisar = useAviso()
  const [variacoes, setVariacoes] = useState(null)
  const [tamanhos, setTamanhos] = useState('')
  const [cores, setCores] = useState('')
  const [edicoes, setEdicoes] = useState({})
  const [enviando, setEnviando] = useState(false)

  const recarregar = async () => {
    const v = await carregarVariacoes(produto.id)
    setVariacoes(v)
    const m = matriz(v)
    setTamanhos(m.tamanhos.filter((x) => x !== '—').join(', '))
    setCores(m.cores.filter((x) => x !== '—').join(', '))
  }
  useEffect(() => { recarregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMemo(() => matriz(variacoes ?? []), [variacoes])
  const total = (variacoes ?? []).reduce((s, v) => s + Number(v.estoque_atual), 0)

  const gerar = async () => {
    const lista = (txt) => txt.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
    setEnviando(true)
    const { data, error } = await supabase.rpc('gerar_grade', { p_pai: produto.id, p_tamanhos: lista(tamanhos), p_cores: lista(cores) })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(data ? `${data} variação(ões) criada(s).` : 'Nenhuma variação nova: a grade já tinha essas combinações.')
    await recarregar(); onAlterado?.()
  }

  const salvar = async () => {
    const mudancas = Object.entries(edicoes)
    if (!mudancas.length) { onFechar(); return }
    setEnviando(true)
    for (const [id, e] of mudancas) {
      const dados = {}
      if ('ean' in e) dados.ean = e.ean.trim() || null
      if ('preco_venda' in e) {
        dados.preco_venda = lerNumero(e.preco_venda)
        if (Number.isNaN(dados.preco_venda) || dados.preco_venda < 0) { setEnviando(false); avisar('Preço inválido.', 'erro'); return }
      }
      const { error } = await supabase.from('produtos').update(dados).eq('id', id)
      if (error) { setEnviando(false); avisar(error.code === '23505' ? 'Código de barras repetido em outra variação ou produto.' : mensagemErro(error), 'erro'); return }
    }
    setEnviando(false)
    avisar('Grade atualizada.')
    onAlterado?.(); onFechar()
  }

  const valor = (v, campo) => edicoes[v.id]?.[campo] ?? (campo === 'preco_venda' ? Number(v.preco_venda).toFixed(2).replace('.', ',') : v[campo] ?? '')
  const mudar = (v, campo, x) => setEdicoes((e) => ({ ...e, [v.id]: { ...e[v.id], [campo]: x } }))

  return (
    <TelaSuspensa aberta titulo="Grade de tamanho e cor" subtitulo={`${produto.descricao}${variacoes?.length ? `, ${variacoes.length} variações, ${total} em estoque` : ''}`} onFechar={onFechar} largura="max-w-5xl"
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Fechar</Botao>
        <Botao onClick={salvar} carregando={enviando} disabled={!Object.keys(edicoes).length}>Salvar alterações</Botao>
      </>}>
      <div className="space-y-5">
        <div className="grid items-end gap-3 rounded-xl border border-papel-200 p-4 sm:grid-cols-[1fr_1fr_auto] dark:border-noite-700">
          <Campo rotulo="Tamanhos" ajuda="Separe por vírgula: P, M, G, GG ou 36, 38, 40"><input className="campo" value={tamanhos} onChange={(e) => setTamanhos(e.target.value)} /></Campo>
          <Campo rotulo="Cores" ajuda="Separe por vírgula: Azul, Preta, Branca"><input className="campo" value={cores} onChange={(e) => setCores(e.target.value)} /></Campo>
          <Botao onClick={gerar} carregando={enviando} className="mb-5">{variacoes?.length ? 'Incluir combinações novas' : 'Criar grade'}</Botao>
        </div>

        {variacoes?.length > 0 && (
          <>
            <div>
              <p className="mb-2 font-semibold">Estoque por tamanho e cor</p>
              <div className="overflow-x-auto">
                <table className="text-center text-[0.95rem]">
                  <thead><tr><th className="px-3 py-1.5 text-left text-sm font-medium text-tinta-400">Tamanho</th>{m.cores.map((c) => <th key={c} className="px-3 py-1.5 text-sm font-medium text-tinta-400">{c}</th>)}<th className="px-3 py-1.5 text-sm font-medium text-tinta-400">Total</th></tr></thead>
                  <tbody>
                    {m.tamanhos.map((t) => (
                      <tr key={t} className="border-t border-papel-200 dark:border-noite-700">
                        <td className="px-3 py-1.5 text-left font-semibold">{t}</td>
                        {m.cores.map((c) => { const v = m.celula(t, c); return <td key={c} className={`num px-3 py-1.5 ${v && Number(v.estoque_atual) <= 0 ? 'text-rubro-600' : ''}`}>{v ? Number(v.estoque_atual) : '—'}</td> })}
                        <td className="num px-3 py-1.5 font-semibold">{m.cores.reduce((s, c) => s + Number(m.celula(t, c)?.estoque_atual ?? 0), 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-papel-200 dark:border-noite-700">
              <table className="tabela w-full text-[0.95rem]">
                <thead><tr><th>Variação</th><th>Código de barras</th><th className="text-right">Preço de venda</th><th className="text-right">Estoque</th></tr></thead>
                <tbody>
                  {variacoes.map((v) => (
                    <tr key={v.id}>
                      <td>{v.descricao}</td>
                      <td><input className="campo num py-1" inputMode="numeric" value={valor(v, 'ean')} onChange={(e) => mudar(v, 'ean', e.target.value)} aria-label={`Código de barras de ${v.descricao}`} /></td>
                      <td className="text-right"><input className="campo num ml-auto w-28 py-1 text-right" inputMode="decimal" value={valor(v, 'preco_venda')} onChange={(e) => mudar(v, 'preco_venda', e.target.value)} aria-label={`Preço de ${v.descricao}`} /></td>
                      <td className="num text-right">{Number(v.estoque_atual)} {v.unidade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-tinta-400">O estoque de cada variação entra pela nota de compra ou pelo botão Estoque da variação na lista de produtos. Use a busca da lista para localizar uma variação.</p>
          </>
        )}
      </div>
    </TelaSuspensa>
  )
}
