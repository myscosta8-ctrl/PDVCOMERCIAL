import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { dinheiro, dataHora, lerNumero } from '../lib/formato.js'
import { imprimirComEmpresa } from '../lib/impressao.js'
import { SITUACOES_LISTA, MOTIVOS_SUGESTAO, totaisLista, textoLista, htmlLista, qtd } from '../lib/compras.js'
import { useSessao } from '../lib/sessao.js'
import { Botao, Cabecalho, Campo, Confirmacao, Etiqueta, Icone, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'

const FILTROS = [
  { valor: 'andamento', texto: 'Em andamento' }, { valor: 'aberta', texto: 'Em montagem' }, { valor: 'enviada', texto: 'Enviadas ao fornecedor' },
  { valor: 'concluida', texto: 'Concluídas' }, { valor: 'cancelada', texto: 'Canceladas' }, { valor: 'todas', texto: 'Todas' },
]
const CRITERIOS = [
  { valor: 'minimo', texto: 'Sem estoque ou abaixo do mínimo' },
  { valor: 'consumo', texto: 'Pelo consumo (vendas recentes)' },
]
const DIAS_VENDAS = [7, 15, 30, 60, 90].map((d) => ({ valor: d, texto: `Últimos ${d} dias` }))
const COBERTURAS = [7, 15, 30, 45, 60].map((d) => ({ valor: d, texto: `${d} dias` }))
const nomeFornecedor = (f) => f?.nome_fantasia || f?.razao_social || ''
const hojeBR = () => new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const nova = () => ({ nome: `Compras de ${hojeBR()}`, fornecedor_id: null, observacoes: '', status: 'aberta' })
const txtNum = (v) => (v == null || v === '' ? '' : String(Number(v)).replace('.', ','))

export default function ListasCompra() {
  const avisar = useAviso()
  const [listas, setListas] = useState(null)
  const [itensPorLista, setItensPorLista] = useState({})
  const [fornecedores, setFornecedores] = useState([])
  const [faltando, setFaltando] = useState(null)
  const [filtro, setFiltro] = useState('andamento')
  const [busca, setBusca] = useState('')
  const [aberta, setAberta] = useState(null)

  const carregar = async () => {
    const [{ data, error }, { data: it }, { data: fs }, { data: sg }] = await Promise.all([
      supabase.from('listas_compra').select('*').order('criado_em', { ascending: false }).limit(500),
      supabase.from('lista_compra_itens').select('lista_id, quantidade, custo_estimado, comprado'),
      supabase.from('fornecedores').select('id, razao_social, nome_fantasia, telefone').order('razao_social'),
      supabase.rpc('sugestao_compra', { p_dias: 30, p_cobertura: 0 }),
    ])
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    const g = {}
    for (const i of it ?? []) (g[i.lista_id] ??= []).push(i)
    setListas(data); setItensPorLista(g); setFornecedores(fs ?? []); setFaltando(sg ?? [])
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return (listas ?? []).filter((l) => {
      const f = fornecedores.find((x) => x.id === l.fornecedor_id)
      if (t && !`${l.numero} ${l.nome} ${nomeFornecedor(f)}`.toLowerCase().includes(t)) return false
      if (filtro === 'andamento') return ['aberta', 'enviada'].includes(l.status)
      return filtro === 'todas' || l.status === filtro
    })
  }, [listas, filtro, busca, fornecedores])
  const conta = (s) => (listas ?? []).filter((l) => l.status === s).length
  const andamento = (listas ?? []).filter((l) => ['aberta', 'enviada'].includes(l.status))
  const aComprar = andamento.flatMap((l) => itensPorLista[l.id] ?? []).filter((i) => !i.comprado)
  const zerados = (faltando ?? []).filter((s) => s.motivo === 'zerado').length

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Listas de compras" descricao="Monte a lista pelo estoque ou digitando os itens, envie ao fornecedor e confira a compra">
        <Botao variante="secundario" icone="mais" onClick={() => setAberta({ lista: nova(), inicio: 'manual' })}>Lista em branco</Botao>
        <Botao icone="estoque" onClick={() => setAberta({ lista: nova(), inicio: 'estoque' })}>Gerar pelo estoque</Botao>
      </Cabecalho>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Em montagem" icone="nota" valor={conta('aberta')} detalhe="Listas ainda sendo preparadas" />
        <Indicador titulo="Enviadas ao fornecedor" icone="relogio" tom={conta('enviada') ? 'alerta' : 'neutro'} valor={conta('enviada')} detalhe="Aguardando a mercadoria" />
        <Indicador titulo="Itens a comprar" icone="caixa" valor={aComprar.length} detalhe={`${dinheiro(totaisLista(aComprar).total)} estimados`} />
        <Indicador titulo="Precisam de reposição" icone="alerta" tom={zerados ? 'critico' : (faltando?.length ? 'alerta' : 'neutro')} valor={faltando?.length ?? '…'}
          detalhe={zerados ? `${zerados} sem estoque` : 'Abaixo do estoque mínimo'} />
      </div>
      <div className="mt-4 cartao overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-papel-200 p-4 dark:border-noite-700">
          <div className="min-w-[16rem] flex-1"><Campo rotulo="Buscar"><input className="campo" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Número, nome da lista ou fornecedor" /></Campo></div>
          <div className="w-60"><Campo rotulo="Mostrar"><Lista valor={filtro} opcoes={FILTROS} onMudar={setFiltro} /></Campo></div>
        </div>
        {listas === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : !filtradas.length ? (
          <Vazio icone="nota" titulo={listas.length ? 'Nenhuma lista neste filtro' : 'Nenhuma lista de compras ainda'}
            texto="Gere a lista pelo estoque (produtos sem estoque, abaixo do mínimo ou pelo consumo) ou comece em branco e digite os itens.">
            {!listas.length && <Botao icone="estoque" onClick={() => setAberta({ lista: nova(), inicio: 'estoque' })}>Gerar pelo estoque</Botao>}
          </Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr><th>Nº</th><th>Criada</th><th>Lista</th><th>Fornecedor</th><th className="text-right">Itens</th><th className="text-right">Total estimado</th><th>Situação</th></tr></thead>
              <tbody>
                {filtradas.map((l) => {
                  const s = SITUACOES_LISTA[l.status]
                  const t = totaisLista(itensPorLista[l.id] ?? [])
                  return (
                    <tr key={l.id} onClick={() => setAberta({ lista: l, inicio: null })} className="cursor-pointer">
                      <td className="num font-semibold">{l.numero}</td>
                      <td>{dataHora(l.criado_em)}</td>
                      <td>{l.nome}{l.observacoes && <span className="block max-w-xs truncate text-xs text-tinta-400">{l.observacoes}</span>}</td>
                      <td>{nomeFornecedor(fornecedores.find((f) => f.id === l.fornecedor_id)) || '—'}</td>
                      <td className="num text-right">{t.itens}{t.comprados > 0 && <span className="block text-xs text-tinta-400">{t.comprados} comprado(s)</span>}</td>
                      <td className="num text-right font-semibold">{dinheiro(t.total)}</td>
                      <td><Etiqueta tom={s.tom}>{s.texto}</Etiqueta></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {aberta && <FormLista inicial={aberta.lista} inicio={aberta.inicio} fornecedores={fornecedores} onFechar={() => setAberta(null)} onMudou={carregar} />}
    </div>
  )
}

function FormLista({ inicial, inicio, fornecedores, onFechar, onMudou }) {
  const avisar = useAviso()
  const perfil = useSessao()
  const [lista, setLista] = useState(inicial)
  const [itens, setItens] = useState(null)
  const [novo, setNovo] = useState({ descricao: '', quantidade: '1', unidade: 'UN', produto: null })
  const [achados, setAchados] = useState([])
  const [sugestao, setSugestao] = useState(inicio === 'estoque')
  const [salvando, setSalvando] = useState('')
  const [cancelar, setCancelar] = useState(false)
  const fechada = ['concluida', 'cancelada'].includes(lista.status)
  const fornecedor = fornecedores.find((f) => f.id === lista.fornecedor_id)

  useEffect(() => {
    if (!lista.id) { setItens([]); return }
    supabase.from('lista_compra_itens').select('*, produto:produtos(estoque_atual, estoque_minimo)').eq('lista_id', lista.id).order('criado_em')
      .then(({ data }) => setItens((data ?? []).map((i) => ({ ...i, chave: i.id, quantidade: txtNum(i.quantidade), custo_estimado: txtNum(i.custo_estimado) }))))
  }, [lista.id])

  // Busca no cadastro enquanto digita; sem escolher, o item entra como avulso
  useEffect(() => {
    const t = novo.descricao.trim().replace(/[%,()]/g, '')
    if (novo.produto || t.length < 3) { setAchados([]); return }
    const id = setTimeout(async () => {
      let q = supabase.from('produtos').select('id, descricao, codigo, ean, unidade, preco_custo, estoque_atual, estoque_minimo').eq('ativo', true).eq('e_grade', false).eq('e_kit', false).order('descricao').limit(8)
      q = /^\d{3,14}$/.test(t) ? q.or(`ean.eq.${t},codigo.eq.${t}`) : q.or(`descricao.ilike.%${t}%,codigo.eq.${t}`)
      const { data } = await q
      setAchados(data ?? [])
    }, 250)
    return () => clearTimeout(id)
  }, [novo.descricao, novo.produto])

  const m = (c) => (e) => setLista((x) => ({ ...x, [c]: e?.target ? e.target.value : e }))
  const numItens = (itens ?? []).map((i) => ({ ...i, quantidade: lerNumero(i.quantidade), custo_estimado: i.custo_estimado === '' ? null : lerNumero(i.custo_estimado) }))
  const t = totaisLista(numItens)
  const mudaItem = (k, c, v) => setItens((l) => l.map((x, j) => (j === k ? { ...x, [c]: v } : x)))

  const incluirDigitado = (e) => {
    e?.preventDefault()
    const descricao = novo.descricao.trim()
    const quantidade = lerNumero(novo.quantidade)
    if (!descricao) { avisar('Digite o item.', 'erro'); return }
    if (!(quantidade > 0)) { avisar('Informe a quantidade.', 'erro'); return }
    const p = novo.produto
    if (p && itens.some((i) => i.produto_id === p.id)) { avisar(`${p.descricao} já está na lista. Ajuste a quantidade na linha dele.`, 'erro'); return }
    setItens((l) => [...l, {
      chave: crypto.randomUUID(), produto_id: p?.id ?? null, descricao: p?.descricao ?? descricao, unidade: p?.unidade ?? (novo.unidade.trim().toUpperCase() || 'UN'),
      quantidade: novo.quantidade, custo_estimado: p && Number(p.preco_custo) > 0 ? txtNum(p.preco_custo) : '', comprado: false, origem: 'manual',
      produto: p ? { estoque_atual: p.estoque_atual, estoque_minimo: p.estoque_minimo } : null,
    }])
    setNovo({ descricao: '', quantidade: '1', unidade: 'UN', produto: null })
  }
  const escolher = (p) => { setNovo((x) => ({ ...x, descricao: p.descricao, unidade: p.unidade, produto: p })); setAchados([]) }

  const incluirSugestao = (escolhidos) => {
    let novos = 0, atualizados = 0
    setItens((l) => {
      const r = [...l]
      for (const s of escolhidos) {
        const k = r.findIndex((i) => i.produto_id === s.produto_id)
        if (k >= 0) { r[k] = { ...r[k], quantidade: txtNum(s.quantidade) }; atualizados++ }
        else {
          r.push({ chave: crypto.randomUUID(), produto_id: s.produto_id, descricao: s.descricao, unidade: s.unidade, quantidade: txtNum(s.quantidade),
            custo_estimado: txtNum(s.custo), comprado: false, origem: 'estoque', produto: { estoque_atual: s.estoque_atual, estoque_minimo: s.estoque_minimo } })
          novos++
        }
      }
      return r
    })
    setSugestao(false)
    avisar(`${novos} item(ns) incluído(s)${atualizados ? `, ${atualizados} quantidade(s) atualizada(s)` : ''}. Salve a lista para gravar.`)
  }

  const salvar = async (mudanca = {}) => {
    if (!lista.nome?.trim()) { avisar('Dê um nome à lista.', 'erro'); return null }
    if (numItens.some((i) => !(i.quantidade > 0))) { avisar('Confira a quantidade dos itens.', 'erro'); return null }
    if (numItens.some((i) => i.custo_estimado != null && (Number.isNaN(i.custo_estimado) || i.custo_estimado < 0))) { avisar('Confira o custo estimado dos itens.', 'erro'); return null }
    const { id, numero, criado_em, criado_por, atualizado_em, empresa_id, ...dados } = { ...lista, ...mudanca }
    const r = id ? await supabase.from('listas_compra').update(dados).eq('id', id).select('*').single() : await supabase.from('listas_compra').insert(dados).select('*').single()
    if (r.error) { avisar(mensagemErro(r.error), 'erro'); return null }
    // Os itens são gravados antes de concluir ou cancelar, porque depois a lista fica travada
    if (!fechada) {
      const del = await supabase.from('lista_compra_itens').delete().eq('lista_id', r.data.id)
      if (del.error) { avisar(mensagemErro(del.error), 'erro'); return null }
      if (numItens.length) {
        const ins = await supabase.from('lista_compra_itens').insert(numItens.map((i) => ({
          lista_id: r.data.id, produto_id: i.produto_id, descricao: i.descricao, unidade: i.unidade, quantidade: i.quantidade,
          custo_estimado: i.custo_estimado, comprado: !!i.comprado, observacao: i.observacao || null, origem: i.origem || 'manual',
        })))
        if (ins.error) { avisar(mensagemErro(ins.error), 'erro'); return null }
      }
    }
    setLista(r.data); onMudou()
    return r.data
  }
  const acao = async (status, texto) => {
    setSalvando(status ?? 'salvar')
    // Status de fechamento: primeiro grava os itens com a lista aberta, depois muda o status
    const fecha = ['concluida', 'cancelada'].includes(status)
    let r = await salvar(status && !fecha ? { status } : {})
    if (r && fecha) {
      const u = await supabase.from('listas_compra').update({ status }).eq('id', r.id).select('*').single()
      if (u.error) { avisar(mensagemErro(u.error), 'erro'); r = null } else { r = u.data; setLista(u.data); onMudou() }
    }
    setSalvando('')
    if (r) avisar(texto ?? `Lista nº ${r.numero} salva.`)
    return r
  }

  const dadosImpressao = (gravada) => ({ lista: gravada, itens: numItens, fornecedor })
  const imprimir = async () => {
    const x = await imprimirComEmpresa((empresa) => htmlLista({ empresa, ...dadosImpressao(lista) }))
    if (x?.erro) avisar(x.erro, 'erro')
  }
  const texto = () => textoLista({ empresa: perfil?.empresa, ...dadosImpressao(lista) })
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto()); avisar('Lista copiada. Cole na mensagem para o fornecedor.') }
    catch { avisar('Não foi possível copiar. Use Imprimir ou o envio por WhatsApp.', 'erro') }
  }
  const whatsapp = () => {
    const fone = String(fornecedor?.telefone ?? '').replace(/\D/g, '')
    const destino = fone.length >= 10 ? `55${fone.replace(/^55(?=\d{10,11}$)/, '')}` : ''
    window.open(`https://wa.me/${destino}?text=${encodeURIComponent(texto())}`, '_blank', 'noopener')
  }

  const s = SITUACOES_LISTA[lista.status]
  return (<>
    <TelaSuspensa aberta titulo={lista.id ? `Lista de compras nº ${lista.numero}` : 'Nova lista de compras'}
      subtitulo={lista.id ? `${s.texto}; criada em ${dataHora(lista.criado_em)}` : 'Inclua itens pelo estoque ou digitando; itens fora do cadastro entram como avulsos'}
      largura="max-w-5xl" onFechar={onFechar}
      rodape={<>
        {lista.id && !fechada && <Botao variante="secundario" onClick={() => setCancelar(true)}>Cancelar lista</Botao>}
        {lista.id && <Botao variante="secundario" icone="impressora" onClick={imprimir}>Imprimir</Botao>}
        {lista.id && numItens.length > 0 && <Botao variante="secundario" onClick={whatsapp}>Enviar por WhatsApp</Botao>}
        {!fechada && <Botao variante="secundario" onClick={() => acao(null)} carregando={salvando === 'salvar'}>{lista.id ? 'Salvar' : 'Criar lista'}</Botao>}
        {lista.status === 'aberta' && lista.id && <Botao onClick={() => acao('enviada', 'Lista marcada como enviada ao fornecedor.')} carregando={salvando === 'enviada'}>Marcar como enviada</Botao>}
        {lista.status === 'enviada' && <Botao variante="sucesso" icone="ok" onClick={() => acao('concluida', 'Compra concluída. Dê entrada da nota em Entrada de mercadorias.')} carregando={salvando === 'concluida'}>Concluir compra</Botao>}
      </>}>
      {fechada && <p className={`mb-4 rounded-xl px-4 py-3 text-sm ${lista.status === 'concluida' ? 'bg-caixa-50 text-caixa-700 dark:bg-caixa-900/30 dark:text-caixa-300' : 'bg-rubro-50 text-rubro-700 dark:bg-rubro-600/15 dark:text-rubro-300'}`}>
        {lista.status === 'concluida' ? 'Compra concluída. A lista não pode mais ser alterada.' : 'Lista cancelada. Não pode mais ser alterada.'}</p>}
      <fieldset disabled={fechada} className="space-y-5">
        <section className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><Campo rotulo="Nome da lista"><input className="campo" value={lista.nome} onChange={m('nome')} /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="Fornecedor (opcional)">
            <Lista valor={lista.fornecedor_id} opcoes={[{ valor: null, texto: 'Nenhum (cotar com vários)' }, ...fornecedores.map((f) => ({ valor: f.id, texto: nomeFornecedor(f) }))]} onMudar={m('fornecedor_id')} />
          </Campo></div>
          <div className="sm:col-span-4"><Campo rotulo="Observações"><input className="campo" value={lista.observacoes ?? ''} onChange={m('observacoes')} placeholder="Ex.: entregar até sexta; pagamento em 28 dias" /></Campo></div>
        </section>

        <section className="border-t border-papel-200 pt-4 dark:border-noite-700">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="titulo-secao">Itens</h3>
            {!fechada && <Botao variante="secundario" icone="estoque" onClick={() => setSugestao(true)}>Gerar pelo estoque</Botao>}
          </div>
          {!fechada && (
            <form onSubmit={incluirDigitado} className="relative mb-3 grid gap-2 sm:grid-cols-[1fr_7rem_6rem_auto]">
              <div className="relative">
                <input className="campo" value={novo.descricao} aria-label="Item"
                  onChange={(e) => setNovo((x) => ({ ...x, descricao: e.target.value, produto: null }))}
                  placeholder="Digite o item (busca no cadastro ou entra como avulso)" />
                {novo.produto && <span className="absolute right-3 top-1/2 -translate-y-1/2"><Etiqueta tom="positivo">Do cadastro</Etiqueta></span>}
                {achados.length > 0 && (
                  <ul className="absolute z-40 mt-1.5 max-h-56 w-full overflow-auto rounded-xl bg-white p-1 shadow-elevado ring-1 ring-papel-200 dark:bg-noite-700 dark:ring-noite-600">
                    {achados.map((p) => (
                      <li key={p.id}><button type="button" onClick={() => escolher(p)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[0.95rem] hover:bg-caixa-50 dark:hover:bg-noite-600">
                        <span>{p.descricao}</span>
                        <span className={`num shrink-0 text-sm ${Number(p.estoque_atual) <= Number(p.estoque_minimo) ? 'text-ambar-600' : 'text-tinta-400'}`}>{qtd(p.estoque_atual)} {p.unidade} em estoque</span>
                      </button></li>
                    ))}
                  </ul>
                )}
              </div>
              <input className="campo num text-right" inputMode="decimal" value={novo.quantidade} aria-label="Quantidade" onChange={(e) => setNovo((x) => ({ ...x, quantidade: e.target.value }))} />
              <input className="campo uppercase" value={novo.unidade} aria-label="Unidade" maxLength={6} disabled={!!novo.produto} onChange={(e) => setNovo((x) => ({ ...x, unidade: e.target.value }))} />
              <Botao type="submit" icone="mais">Incluir</Botao>
            </form>
          )}
          {itens === null ? <p className="text-sm text-tinta-400">Carregando…</p> : !itens.length ? (
            <p className="rounded-xl border border-dashed border-papel-300 px-4 py-6 text-center text-sm text-tinta-400 dark:border-noite-600">
              Nenhum item. Use Gerar pelo estoque ou digite os itens acima.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-papel-200 dark:border-noite-700">
              <table className="tabela w-full text-[0.95rem]">
                <thead><tr><th className="w-10" title="Comprado">✓</th><th>Item</th><th className="text-right">Estoque</th><th className="w-24 text-right">Qtd.</th><th className="w-24">Un.</th><th className="w-28 text-right">Custo est.</th><th className="text-right">Total</th><th className="w-10" /></tr></thead>
                <tbody>
                  {itens.map((i, k) => {
                    const n = numItens[k]
                    const baixo = i.produto && Number(i.produto.estoque_atual) <= Number(i.produto.estoque_minimo)
                    return (
                      <tr key={i.chave} className={i.comprado ? 'opacity-60' : ''}>
                        <td><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={!!i.comprado} aria-label={`Comprado: ${i.descricao}`} onChange={(e) => mudaItem(k, 'comprado', e.target.checked)} /></td>
                        <td className={i.comprado ? 'line-through' : ''}>{i.descricao}
                          {!i.produto_id && <span className="ml-2"><Etiqueta>Avulso</Etiqueta></span>}</td>
                        <td className={`num text-right ${baixo ? 'font-semibold text-ambar-600' : ''}`}>{i.produto ? <>{qtd(i.produto.estoque_atual)}<span className="block text-xs font-normal text-tinta-400">mín. {qtd(i.produto.estoque_minimo)}</span></> : '—'}</td>
                        <td><input className="campo num py-1.5 text-right" inputMode="decimal" value={i.quantidade} aria-label="Quantidade" onChange={(e) => mudaItem(k, 'quantidade', e.target.value)} /></td>
                        <td>{i.produto_id ? i.unidade : <input className="campo px-2 py-1.5 uppercase" value={i.unidade} maxLength={6} aria-label="Unidade" onChange={(e) => mudaItem(k, 'unidade', e.target.value.toUpperCase())} />}</td>
                        <td><input className="campo num py-1.5 text-right" inputMode="decimal" value={i.custo_estimado} placeholder="—" aria-label="Custo estimado" onChange={(e) => mudaItem(k, 'custo_estimado', e.target.value)} /></td>
                        <td className="num text-right font-semibold">{n.custo_estimado != null && !Number.isNaN(n.custo_estimado) ? dinheiro(n.quantidade * n.custo_estimado || 0) : '—'}</td>
                        <td>{!fechada && <button type="button" className="rounded p-1 text-tinta-400 hover:text-rubro-600" onClick={() => setItens((l) => l.filter((_, j) => j !== k))} aria-label={`Remover ${i.descricao}`}><Icone nome="fechar" className="h-4 w-4" /></button>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-tinta-400">{t.itens} {t.itens === 1 ? 'item' : 'itens'}{t.comprados ? `, ${t.comprados} comprado(s)` : ''}{t.semCusto ? `; ${t.semCusto} sem custo estimado` : ''}
              {lista.id && t.itens > 0 && <button type="button" className="ml-3 font-semibold text-caixa-600 hover:underline dark:text-caixa-300" onClick={copiar}>Copiar texto da lista</button>}</span>
            <span className="text-tinta-400">Total estimado <span className="num ml-2 text-xl font-semibold text-tinta dark:text-papel">{dinheiro(t.total)}</span></span>
          </div>
        </section>
      </fieldset>
    </TelaSuspensa>

    {sugestao && <SugestaoEstoque fornecedor={fornecedor} naLista={new Set((itens ?? []).map((i) => i.produto_id).filter(Boolean))}
      onFechar={() => setSugestao(false)} onIncluir={incluirSugestao} />}
    <Confirmacao aberta={cancelar} titulo={`Cancelar a lista nº ${lista.numero}`} variante="perigo" textoConfirmar="Cancelar lista"
      mensagem="A lista fica registrada como cancelada e não pode mais ser alterada."
      onCancelar={() => setCancelar(false)}
      onConfirmar={async () => { const r = await acao('cancelada', 'Lista cancelada.'); if (r) setCancelar(false) }} />
  </>)
}

function SugestaoEstoque({ fornecedor, naLista, onFechar, onIncluir }) {
  const avisar = useAviso()
  const [criterio, setCriterio] = useState('minimo')
  const [dias, setDias] = useState(30)
  const [cobertura, setCobertura] = useState(15)
  const [soFornecedor, setSoFornecedor] = useState(!!fornecedor)
  const [linhas, setLinhas] = useState(null)

  useEffect(() => {
    setLinhas(null)
    supabase.rpc('sugestao_compra', { p_dias: dias, p_cobertura: criterio === 'consumo' ? cobertura : 0, p_fornecedor: soFornecedor && fornecedor ? fornecedor.id : null })
      .then(({ data, error }) => {
        if (error) { avisar(mensagemErro(error), 'erro'); setLinhas([]); return }
        setLinhas((data ?? []).map((s) => ({ ...s, marcado: !naLista.has(s.produto_id), qtdTexto: txtNum(s.sugerida) })))
      })
  }, [criterio, dias, cobertura, soFornecedor]) // eslint-disable-line react-hooks/exhaustive-deps

  const marcados = (linhas ?? []).filter((l) => l.marcado)
  const todos = linhas?.length > 0 && marcados.length === linhas.length
  const muda = (k, c, v) => setLinhas((l) => l.map((x, j) => (j === k ? { ...x, [c]: v } : x)))
  const incluir = () => {
    const escolhidos = marcados.map((l) => ({ ...l, quantidade: lerNumero(l.qtdTexto) }))
    if (escolhidos.some((l) => !(l.quantidade > 0))) { avisar('Confira as quantidades marcadas.', 'erro'); return }
    onIncluir(escolhidos)
  }

  return (
    <TelaSuspensa aberta titulo="Gerar pelo estoque" subtitulo="Produtos que precisam de reposição; ajuste as quantidades e desmarque o que não quiser comprar"
      largura="max-w-5xl" onFechar={onFechar}
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Voltar à lista</Botao>
        <Botao icone="mais" onClick={incluir} disabled={!marcados.length}>Incluir {marcados.length} {marcados.length === 1 ? 'item' : 'itens'}</Botao>
      </>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Critério"><Lista valor={criterio} opcoes={CRITERIOS} onMudar={setCriterio} /></Campo>
        {criterio === 'consumo' && <Campo rotulo="Vendas consideradas"><Lista valor={dias} opcoes={DIAS_VENDAS} onMudar={setDias} /></Campo>}
        {criterio === 'consumo' && <Campo rotulo="Comprar para cobrir"><Lista valor={cobertura} opcoes={COBERTURAS} onMudar={setCobertura} /></Campo>}
      </div>
      <p className="mt-2 text-sm text-tinta-400">
        {criterio === 'minimo' ? 'Repõe cada produto até o estoque mínimo do cadastro.' : `Média vendida por dia nos últimos ${dias} dias vezes ${cobertura} dias, menos o estoque atual; nunca abaixo do mínimo.`}</p>
      {fornecedor && (
        <label className="mt-3 flex items-center gap-2 text-[0.95rem]">
          <input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={soFornecedor} onChange={(e) => setSoFornecedor(e.target.checked)} />
          Só produtos já comprados de {nomeFornecedor(fornecedor)}
        </label>
      )}
      <div className="mt-4">
        {linhas === null ? <p className="text-sm text-tinta-400">Calculando…</p> : !linhas.length ? (
          <p className="rounded-xl border border-dashed border-papel-300 px-4 py-6 text-center text-sm text-tinta-400 dark:border-noite-600">
            Nenhum produto precisa de reposição por este critério. Confira o estoque mínimo no cadastro de produtos.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-papel-200 dark:border-noite-700">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr>
                <th className="w-10"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={todos} aria-label="Marcar todos" onChange={(e) => setLinhas((l) => l.map((x) => ({ ...x, marcado: e.target.checked })))} /></th>
                <th>Produto</th><th>Motivo</th><th className="text-right">Estoque</th><th className="text-right">Mínimo</th>{criterio === 'consumo' && <th className="text-right">Venda por dia</th>}
                <th className="w-28 text-right">Comprar</th><th className="text-right">Custo</th>
              </tr></thead>
              <tbody>
                {linhas.map((l, k) => {
                  const mt = MOTIVOS_SUGESTAO[l.motivo]
                  return (
                    <tr key={l.produto_id} className={l.marcado ? '' : 'opacity-50'}>
                      <td><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={l.marcado} aria-label={`Incluir ${l.descricao}`} onChange={(e) => muda(k, 'marcado', e.target.checked)} /></td>
                      <td>{l.descricao}{naLista.has(l.produto_id) && <span className="block text-xs text-tinta-400">Já está na lista; se marcar, a quantidade da lista passa a ser esta</span>}</td>
                      <td><Etiqueta tom={mt.tom}>{mt.texto}</Etiqueta></td>
                      <td className={`num text-right ${Number(l.estoque_atual) <= 0 ? 'font-semibold text-rubro-600 dark:text-rubro-300' : ''}`}>{qtd(l.estoque_atual)} {l.unidade}</td>
                      <td className="num text-right">{qtd(l.estoque_minimo)}</td>
                      {criterio === 'consumo' && <td className="num text-right">{qtd(l.media_dia)}</td>}
                      <td><input className="campo num py-1.5 text-right" inputMode="decimal" value={l.qtdTexto} aria-label={`Quantidade de ${l.descricao}`} onChange={(e) => muda(k, 'qtdTexto', e.target.value)} /></td>
                      <td className="num text-right">{l.custo != null ? dinheiro(l.custo) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TelaSuspensa>
  )
}
