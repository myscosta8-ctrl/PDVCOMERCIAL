import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { dinheiro, lerNumero } from '../lib/formato.js'
import { Botao, Cabecalho, Campo, Etiqueta, Icone, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'

const VAZIO = {
  descricao: '', codigo: '', ean: '', unidade: 'UN', preco_venda: '', preco_custo: '', estoque_minimo: '',
  categoria_id: null, ncm: '', cest: '', cfop: '5102', origem: 0, csosn: '102', cst_icms: '', controla_lote: false,
  registro_ms: '', controlado: false, ativo: true,
}
const UNIDADES = ['UN', 'CX', 'FR', 'CP', 'KG', 'G', 'L', 'ML', 'M', 'PCT', 'PAR'].map((u) => ({ valor: u, texto: u }))
const ORIGENS = [
  { valor: 0, texto: '0 – Nacional' },
  { valor: 1, texto: '1 – Estrangeira, importação direta' },
  { valor: 2, texto: '2 – Estrangeira, mercado interno' },
]
const TIPOS_ESTOQUE = [
  { valor: 'entrada', texto: 'Entrada' },
  { valor: 'ajuste', texto: 'Ajuste (+ ou −)' },
  { valor: 'perda', texto: 'Perda, avaria ou vencimento' },
]
const FILTROS = [
  { id: 'todos', nome: 'Todos' },
  { id: 'baixo', nome: 'Estoque baixo' },
  { id: 'sem_ncm', nome: 'Sem NCM' },
  { id: 'inativos', nome: 'Inativos' },
]
const ncmValido = (p) => /^\d{8}$/.test(p.ncm ?? '')
const estoqueBaixo = (p) => p.ativo && Number(p.estoque_atual) <= Number(p.estoque_minimo)

export default function Produtos() {
  const perfil = useSessao()
  const avisar = useAviso()
  const pode = perfil.papel !== 'operador'
  const farmacia = perfil.empresa.segmento === 'farmacia'
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [lista, setLista] = useState(null)
  const [categorias, setCategorias] = useState([])
  const [edicao, setEdicao] = useState(null)
  const [estoque, setEstoque] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const carregar = async () => {
    const { data, error } = await supabase.from('produtos').select('*').order('descricao').limit(2000)
    if (error) avisar(mensagemErro(error), 'erro')
    else setLista(data)
  }
  useEffect(() => {
    carregar()
    supabase.from('categorias').select('id, nome').eq('ativo', true).order('nome').then(({ data }) => setCategorias(data ?? []))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const resumo = useMemo(() => {
    const ativos = (lista ?? []).filter((p) => p.ativo)
    return {
      ativos: ativos.length,
      baixo: ativos.filter(estoqueBaixo).length,
      semNcm: ativos.filter((p) => !ncmValido(p)).length,
      valorCusto: ativos.reduce((s, p) => s + Math.max(0, Number(p.estoque_atual)) * Number(p.preco_custo), 0),
      valorVenda: ativos.reduce((s, p) => s + Math.max(0, Number(p.estoque_atual)) * Number(p.preco_venda), 0),
    }
  }, [lista])

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (lista ?? []).filter((p) => {
      if (filtro === 'inativos' ? p.ativo : !p.ativo) return false
      if (filtro === 'baixo' && !estoqueBaixo(p)) return false
      if (filtro === 'sem_ncm' && ncmValido(p)) return false
      if (!termo) return true
      return p.descricao.toLowerCase().includes(termo) || p.ean === termo || p.codigo === termo
    })
  }, [lista, busca, filtro])

  const salvar = async () => {
    const p = { ...edicao }
    if (!p.descricao.trim()) { avisar('Informe a descrição.', 'erro'); return }
    for (const c of ['preco_venda', 'preco_custo', 'estoque_minimo']) {
      p[c] = lerNumero(p[c])
      if (Number.isNaN(p[c]) || p[c] < 0) { avisar('Valores numéricos inválidos.', 'erro'); return }
    }
    for (const c of ['codigo', 'ean', 'ncm', 'cest', 'cst_icms', 'registro_ms']) p[c] = p[c]?.trim() || null
    if (p.ncm && !/^\d{8}$/.test(p.ncm)) { avisar('O NCM deve ter 8 números.', 'erro'); return }
    delete p.estoque_atual; delete p.empresa_id; delete p.criado_em; delete p.atualizado_em
    setEnviando(true)
    const r = p.id ? await supabase.from('produtos').update(p).eq('id', p.id) : await supabase.from('produtos').insert(p)
    setEnviando(false)
    if (r.error) {
      avisar(r.error.code === '23505' ? 'Já existe produto com este código ou código de barras.' : mensagemErro(r.error), 'erro')
      return
    }
    avisar('Produto salvo.')
    setEdicao(null)
    carregar()
  }

  const lancar = async () => {
    const q = lerNumero(estoque.quantidade)
    if (Number.isNaN(q) || q === 0 || (estoque.tipo !== 'ajuste' && q < 0)) { avisar('Quantidade inválida.', 'erro'); return }
    setEnviando(true)
    const { error } = await supabase.rpc('lancar_estoque', {
      p_produto: estoque.produto.id, p_tipo: estoque.tipo, p_quantidade: q,
      p_custo: estoque.custo ? lerNumero(estoque.custo) : null, p_obs: estoque.obs || null,
    })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Estoque atualizado.')
    setEstoque(null)
    carregar()
  }

  const m = (c) => (e) => setEdicao((x) => ({ ...x, [c]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const margem = (p) => (Number(p.preco_venda) > 0 && Number(p.preco_custo) > 0 ? ((Number(p.preco_venda) - Number(p.preco_custo)) / Number(p.preco_venda)) * 100 : null)
  const margemEdicao = edicao ? margem({ preco_venda: lerNumero(edicao.preco_venda), preco_custo: lerNumero(edicao.preco_custo) }) : null

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Produtos" descricao="Cadastro, preços, estoque e dados fiscais">
        {pode && <Botao icone="mais" onClick={() => setEdicao({ ...VAZIO })}>Novo produto</Botao>}
      </Cabecalho>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Produtos ativos" icone="produtos" valor={resumo.ativos} detalhe={`${categorias.length} categorias`} />
        <Indicador titulo="Estoque baixo" icone="estoque" valor={resumo.baixo} tom={resumo.baixo ? 'alerta' : 'neutro'} detalhe="No mínimo ou abaixo dele" />
        <Indicador titulo="Sem NCM válido" icone="nota" valor={resumo.semNcm} tom={resumo.semNcm ? 'critico' : 'neutro'} detalhe="Impedem a emissão da NFC-e" />
        <Indicador titulo="Estoque a preço de custo" icone="dinheiro" valor={dinheiro(resumo.valorCusto)} detalhe={`${dinheiro(resumo.valorVenda)} a preço de venda`} />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-papel-200 p-3 dark:border-noite-700">
          <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-papel-300 px-3 dark:border-noite-600">
            <Icone nome="busca" className="h-4 w-4 text-tinta-400" />
            <input className="w-full bg-transparent py-2 outline-none placeholder:text-tinta-300" placeholder="Buscar por descrição, código ou código de barras" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar produtos" />
          </div>
          <div className="flex gap-1 rounded-lg bg-papel-200 p-1 dark:bg-noite-700" role="tablist">
            {FILTROS.map((f) => (
              <button key={f.id} role="tab" aria-selected={filtro === f.id} onClick={() => setFiltro(f.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${filtro === f.id ? 'bg-white shadow-sm dark:bg-noite-800' : 'text-tinta-600 dark:text-tinta-300'}`}>
                {f.nome}
              </button>
            ))}
          </div>
        </div>

        {lista === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : visiveis.length === 0 ? (
          <Vazio icone="produtos" titulo={lista.length ? 'Nenhum produto neste filtro' : 'Nenhum produto cadastrado'} texto={lista.length ? 'Ajuste a busca ou escolha outro filtro.' : 'Cadastre os produtos com código de barras, preço e NCM para vender e emitir NFC-e.'}>
            {!lista.length && pode && <Botao icone="mais" onClick={() => setEdicao({ ...VAZIO })}>Cadastrar o primeiro produto</Botao>}
          </Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead className="bg-papel/70 dark:bg-noite/40">
                <tr><th>Produto</th><th>Código de barras</th><th className="text-right">Custo</th><th className="text-right">Venda</th><th className="text-right">Margem</th><th className="text-right">Estoque</th><th>Situação</th><th /></tr>
              </thead>
              <tbody>
                {visiveis.map((p) => {
                  const mg = margem(p)
                  return (
                    <tr key={p.id} className={p.ativo ? '' : 'opacity-60'}>
                      <td className="max-w-[320px]">
                        <span className="block truncate font-medium">{p.descricao}</span>
                        <span className="text-xs text-tinta-400">{p.codigo ? `Código ${p.codigo}` : 'Sem código interno'}{p.ncm ? `, NCM ${p.ncm}` : ''}</span>
                      </td>
                      <td className="num text-tinta-600 dark:text-tinta-300">{p.ean || '—'}</td>
                      <td className="num text-right text-tinta-600 dark:text-tinta-300">{dinheiro(p.preco_custo)}</td>
                      <td className="num text-right font-semibold">{dinheiro(p.preco_venda)}</td>
                      <td className={`num text-right ${mg === null ? 'text-tinta-300' : mg < 15 ? 'text-ambar-600 dark:text-ambar-300' : 'text-caixa-600 dark:text-caixa-300'}`}>{mg === null ? '—' : `${mg.toFixed(1).replace('.', ',')}%`}</td>
                      <td className={`num text-right font-semibold ${Number(p.estoque_atual) <= 0 ? 'text-rubro-600' : estoqueBaixo(p) ? 'text-ambar-600' : ''}`}>{Number(p.estoque_atual)} <span className="font-sans text-xs font-normal text-tinta-400">{p.unidade}</span></td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {!p.ativo && <Etiqueta>Inativo</Etiqueta>}
                          {p.ativo && !ncmValido(p) && <Etiqueta tom="critico">Sem NCM</Etiqueta>}
                          {estoqueBaixo(p) && <Etiqueta tom="alerta">Repor</Etiqueta>}
                          {p.controlado && <Etiqueta tom="critico">Controlado</Etiqueta>}
                          {p.ativo && ncmValido(p) && !estoqueBaixo(p) && !p.controlado && <Etiqueta tom="positivo">Regular</Etiqueta>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {pode && <>
                          <Botao variante="discreto" className="px-2 py-1" onClick={() => setEstoque({ produto: p, tipo: 'entrada', quantidade: '', custo: '', obs: '' })}>Estoque</Botao>
                          <Botao variante="discreto" className="px-2 py-1" onClick={() => setEdicao({ ...VAZIO, ...p, preco_venda: String(p.preco_venda).replace('.', ','), preco_custo: String(Number(p.preco_custo)).replace('.', ','), estoque_minimo: String(Number(p.estoque_minimo)) })}>Editar</Botao>
                        </>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="border-t border-papel-200 px-4 py-2 text-sm text-tinta-400 dark:border-noite-700">{visiveis.length} de {lista.length} produtos</p>
          </div>
        )}
      </div>

      <TelaSuspensa
        aberta={!!edicao}
        titulo={edicao?.id ? 'Editar produto' : 'Novo produto'}
        subtitulo={edicao?.id ? edicao.descricao : 'Preencha os dados de venda e os dados fiscais exigidos pela NFC-e'}
        onFechar={() => setEdicao(null)}
        largura="max-w-3xl"
        rodape={<>
          <Botao variante="secundario" onClick={() => setEdicao(null)}>Cancelar</Botao>
          <Botao onClick={salvar} carregando={enviando}>Salvar produto</Botao>
        </>}
      >
        {edicao && (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-4"><Campo rotulo="Descrição"><input className="campo" value={edicao.descricao} onChange={m('descricao')} autoFocus /></Campo></div>
              <Campo rotulo="Código interno"><input className="campo" value={edicao.codigo ?? ''} onChange={m('codigo')} /></Campo>
              <div className="sm:col-span-2"><Campo rotulo="Código de barras (GTIN/EAN)"><input className="campo num" inputMode="numeric" value={edicao.ean ?? ''} onChange={m('ean')} /></Campo></div>
              <Campo rotulo="Unidade"><Lista valor={edicao.unidade} opcoes={UNIDADES} onMudar={(v) => setEdicao((x) => ({ ...x, unidade: v }))} /></Campo>
              <Campo rotulo="Preço de custo (R$)"><input className="campo num" inputMode="decimal" value={edicao.preco_custo} onChange={m('preco_custo')} /></Campo>
              <Campo rotulo="Preço de venda (R$)" ajuda={margemEdicao === null ? undefined : `Margem de ${margemEdicao.toFixed(1).replace('.', ',')}% sobre a venda`}><input className="campo num" inputMode="decimal" value={edicao.preco_venda} onChange={m('preco_venda')} /></Campo>
              <Campo rotulo="Estoque mínimo"><input className="campo num" inputMode="decimal" value={edicao.estoque_minimo} onChange={m('estoque_minimo')} /></Campo>
              <Campo rotulo="Categoria"><Lista valor={edicao.categoria_id} opcoes={[{ valor: null, texto: 'Sem categoria' }, ...categorias.map((c) => ({ valor: c.id, texto: c.nome }))]} onMudar={(v) => setEdicao((x) => ({ ...x, categoria_id: v }))} /></Campo>
            </div>

            <fieldset className="rounded-xl border border-papel-200 p-4 dark:border-noite-700">
              <legend className="px-1 text-sm font-semibold">Dados fiscais da NFC-e</legend>
              <div className="grid gap-3 sm:grid-cols-4">
                <Campo rotulo="NCM" ajuda="8 números, obrigatório"><input className="campo num" inputMode="numeric" maxLength={8} value={edicao.ncm ?? ''} onChange={m('ncm')} /></Campo>
                <Campo rotulo="CEST"><input className="campo num" inputMode="numeric" maxLength={7} value={edicao.cest ?? ''} onChange={m('cest')} /></Campo>
                <Campo rotulo="CFOP"><input className="campo num" inputMode="numeric" maxLength={4} value={edicao.cfop ?? ''} onChange={m('cfop')} /></Campo>
                <Campo rotulo="CSOSN" ajuda="Simples Nacional"><input className="campo num" inputMode="numeric" maxLength={3} value={edicao.csosn ?? ''} onChange={m('csosn')} /></Campo>
                <div className="sm:col-span-2"><Campo rotulo="Origem da mercadoria"><Lista valor={Number(edicao.origem)} opcoes={ORIGENS} onMudar={(v) => setEdicao((x) => ({ ...x, origem: v }))} /></Campo></div>
                <Campo rotulo="CST do ICMS" ajuda="Regime normal"><input className="campo num" inputMode="numeric" maxLength={3} value={edicao.cst_icms ?? ''} onChange={m('cst_icms')} /></Campo>
              </div>
            </fieldset>

            {farmacia && (
              <fieldset className="rounded-xl border border-papel-200 p-4 dark:border-noite-700">
                <legend className="px-1 text-sm font-semibold">Dados farmacêuticos</legend>
                <div className="grid items-end gap-3 sm:grid-cols-3">
                  <Campo rotulo="Registro no Ministério da Saúde"><input className="campo num" value={edicao.registro_ms ?? ''} onChange={m('registro_ms')} /></Campo>
                  <label className="flex items-center gap-2 pb-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={edicao.controlado} onChange={m('controlado')} /> Medicamento sujeito a controle especial</label>
                  <label className="flex items-center gap-2 pb-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={edicao.controla_lote} onChange={m('controla_lote')} /> Controla lote e validade</label>
                </div>
              </fieldset>
            )}

            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={edicao.ativo} onChange={m('ativo')} /> Produto ativo para venda</label>
          </div>
        )}
      </TelaSuspensa>

      <TelaSuspensa
        aberta={!!estoque}
        titulo="Movimentar estoque"
        subtitulo={estoque ? `${estoque.produto.descricao}, saldo atual ${Number(estoque.produto.estoque_atual)} ${estoque.produto.unidade}` : ''}
        onFechar={() => setEstoque(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setEstoque(null)}>Cancelar</Botao>
          <Botao onClick={lancar} carregando={enviando}>Registrar movimento</Botao>
        </>}
      >
        {estoque && (
          <div className="space-y-4">
            <Campo rotulo="Tipo de movimento"><Lista valor={estoque.tipo} opcoes={TIPOS_ESTOQUE} onMudar={(v) => setEstoque((x) => ({ ...x, tipo: v }))} /></Campo>
            <Campo rotulo="Quantidade" ajuda={estoque.tipo === 'ajuste' ? 'Use número negativo para reduzir o saldo.' : undefined}><input className="campo num" inputMode="decimal" value={estoque.quantidade} onChange={(e) => setEstoque((x) => ({ ...x, quantidade: e.target.value }))} autoFocus /></Campo>
            {estoque.tipo === 'entrada' && (
              <Campo rotulo="Custo unitário (R$)"><input className="campo num" inputMode="decimal" value={estoque.custo} onChange={(e) => setEstoque((x) => ({ ...x, custo: e.target.value }))} /></Campo>
            )}
            <Campo rotulo="Observação"><input className="campo" value={estoque.obs} onChange={(e) => setEstoque((x) => ({ ...x, obs: e.target.value }))} placeholder="Ex.: nota fiscal 1234" /></Campo>
          </div>
        )}
      </TelaSuspensa>
    </div>
  )
}
