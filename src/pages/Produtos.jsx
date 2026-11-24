import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { dinheiro, lerNumero } from '../lib/formato.js'
import { Botao, Campo, Lista, TelaSuspensa, useAviso } from '../components/ui.jsx'

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
  { valor: 'perda', texto: 'Perda / avaria / vencido' },
]

export default function Produtos() {
  const perfil = useSessao()
  const avisar = useAviso()
  const pode = perfil.papel !== 'operador'
  const farmacia = perfil.empresa.segmento === 'farmacia'
  const [busca, setBusca] = useState('')
  const [lista, setLista] = useState([])
  const [categorias, setCategorias] = useState([])
  const [edicao, setEdicao] = useState(null)
  const [estoque, setEstoque] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const carregar = async () => {
    let q = supabase.from('produtos').select('*').order('descricao').limit(200)
    const termo = busca.trim().replace(/[%,()]/g, '')
    if (termo) q = q.or(`descricao.ilike.%${termo}%,ean.eq.${termo},codigo.eq.${termo}`)
    const { data, error } = await q
    if (error) avisar(mensagemErro(error), 'erro')
    else setLista(data)
  }
  useEffect(() => {
    carregar()
    supabase.from('categorias').select('id, nome').eq('ativo', true).order('nome').then(({ data }) => setCategorias(data ?? []))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = async () => {
    const p = { ...edicao }
    if (!p.descricao.trim()) { avisar('Informe a descrição.', 'erro'); return }
    for (const c of ['preco_venda', 'preco_custo', 'estoque_minimo']) {
      p[c] = lerNumero(p[c])
      if (Number.isNaN(p[c]) || p[c] < 0) { avisar('Valores numéricos inválidos.', 'erro'); return }
    }
    for (const c of ['codigo', 'ean', 'ncm', 'cest', 'cst_icms', 'registro_ms']) p[c] = p[c]?.trim() || null
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

  return (
    <div className="space-y-4">
      <div className="cartao flex flex-wrap items-end gap-3 p-4">
        <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); carregar() }}>
          <input className="campo" placeholder="Buscar por descrição, código ou código de barras" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Botao variante="secundario" type="submit">Buscar</Botao>
        </form>
        {pode && <Botao onClick={() => setEdicao({ ...VAZIO })}>Novo produto</Botao>}
      </div>

      <div className="cartao overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
            <tr><th className="px-3 py-2">Descrição</th><th className="px-3 py-2">Código de barras</th><th className="px-3 py-2 text-right">Preço</th><th className="px-3 py-2 text-right">Estoque</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-400">Nenhum produto encontrado</td></tr>}
            {lista.map((p) => (
              <tr key={p.id} className={`border-t border-slate-100 dark:border-slate-800 ${p.ativo ? '' : 'opacity-50'}`}>
                <td className="px-3 py-2">{p.descricao}{p.controlado && <span className="ml-2 rounded bg-red-100 px-1.5 text-xs text-red-700">Controlado</span>}</td>
                <td className="px-3 py-2 text-slate-500">{p.ean}</td>
                <td className="px-3 py-2 text-right">{dinheiro(p.preco_venda)}</td>
                <td className={`px-3 py-2 text-right ${Number(p.estoque_atual) <= Number(p.estoque_minimo) ? 'font-bold text-red-600' : ''}`}>{Number(p.estoque_atual)} {p.unidade}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {pode && <>
                    <Botao variante="secundario" className="mr-2 py-1" onClick={() => setEstoque({ produto: p, tipo: 'entrada', quantidade: '', custo: '', obs: '' })}>Estoque</Botao>
                    <Botao variante="secundario" className="py-1" onClick={() => setEdicao({ ...VAZIO, ...p, preco_venda: String(p.preco_venda).replace('.', ','), preco_custo: String(p.preco_custo).replace('.', ','), estoque_minimo: String(Number(p.estoque_minimo)) })}>Editar</Botao>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TelaSuspensa
        aberta={!!edicao}
        titulo={edicao?.id ? 'Editar produto' : 'Novo produto'}
        onFechar={() => setEdicao(null)}
        largura="max-w-3xl"
        rodape={<>
          <Botao variante="secundario" onClick={() => setEdicao(null)}>Cancelar</Botao>
          <Botao onClick={salvar} carregando={enviando}>Salvar</Botao>
        </>}
      >
        {edicao && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-4"><Campo rotulo="Descrição"><input className="campo" value={edicao.descricao} onChange={m('descricao')} autoFocus /></Campo></div>
              <Campo rotulo="Código interno"><input className="campo" value={edicao.codigo ?? ''} onChange={m('codigo')} /></Campo>
              <div className="sm:col-span-2"><Campo rotulo="Código de barras (GTIN/EAN)"><input className="campo" inputMode="numeric" value={edicao.ean ?? ''} onChange={m('ean')} /></Campo></div>
              <Campo rotulo="Unidade"><Lista valor={edicao.unidade} opcoes={UNIDADES} onMudar={(v) => setEdicao((x) => ({ ...x, unidade: v }))} /></Campo>
              <Campo rotulo="Preço de venda (R$)"><input className="campo" inputMode="decimal" value={edicao.preco_venda} onChange={m('preco_venda')} /></Campo>
              <Campo rotulo="Preço de custo (R$)"><input className="campo" inputMode="decimal" value={edicao.preco_custo} onChange={m('preco_custo')} /></Campo>
              <Campo rotulo="Estoque mínimo"><input className="campo" inputMode="decimal" value={edicao.estoque_minimo} onChange={m('estoque_minimo')} /></Campo>
              <Campo rotulo="Categoria"><Lista valor={edicao.categoria_id} opcoes={[{ valor: null, texto: 'Sem categoria' }, ...categorias.map((c) => ({ valor: c.id, texto: c.nome }))]} onMudar={(v) => setEdicao((x) => ({ ...x, categoria_id: v }))} /></Campo>
            </div>

            <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <legend className="rotulo px-1">Dados fiscais (NFC-e)</legend>
              <div className="grid gap-3 sm:grid-cols-4">
                <Campo rotulo="NCM"><input className="campo" inputMode="numeric" maxLength={8} value={edicao.ncm ?? ''} onChange={m('ncm')} /></Campo>
                <Campo rotulo="CEST"><input className="campo" inputMode="numeric" maxLength={7} value={edicao.cest ?? ''} onChange={m('cest')} /></Campo>
                <Campo rotulo="CFOP"><input className="campo" inputMode="numeric" maxLength={4} value={edicao.cfop ?? ''} onChange={m('cfop')} /></Campo>
                <Campo rotulo="CSOSN"><input className="campo" inputMode="numeric" maxLength={3} value={edicao.csosn ?? ''} onChange={m('csosn')} /></Campo>
                <div className="sm:col-span-2"><Campo rotulo="Origem da mercadoria"><Lista valor={Number(edicao.origem)} opcoes={ORIGENS} onMudar={(v) => setEdicao((x) => ({ ...x, origem: v }))} /></Campo></div>
                <Campo rotulo="CST ICMS (regime normal)"><input className="campo" inputMode="numeric" maxLength={3} value={edicao.cst_icms ?? ''} onChange={m('cst_icms')} /></Campo>
              </div>
            </fieldset>

            {farmacia && (
              <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <legend className="rotulo px-1">Farmácia</legend>
                <div className="grid items-end gap-3 sm:grid-cols-3">
                  <Campo rotulo="Registro no Ministério da Saúde"><input className="campo" value={edicao.registro_ms ?? ''} onChange={m('registro_ms')} /></Campo>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edicao.controlado} onChange={m('controlado')} /> Medicamento controlado</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edicao.controla_lote} onChange={m('controla_lote')} /> Controla lote e validade</label>
                </div>
              </fieldset>
            )}

            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edicao.ativo} onChange={m('ativo')} /> Produto ativo</label>
          </div>
        )}
      </TelaSuspensa>

      <TelaSuspensa
        aberta={!!estoque}
        titulo={`Movimentar estoque — ${estoque?.produto.descricao ?? ''}`}
        onFechar={() => setEstoque(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setEstoque(null)}>Cancelar</Botao>
          <Botao onClick={lancar} carregando={enviando}>Confirmar</Botao>
        </>}
      >
        {estoque && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">Estoque atual: {Number(estoque.produto.estoque_atual)} {estoque.produto.unidade}</p>
            <Campo rotulo="Tipo de movimento"><Lista valor={estoque.tipo} opcoes={TIPOS_ESTOQUE} onMudar={(v) => setEstoque((x) => ({ ...x, tipo: v }))} /></Campo>
            <Campo rotulo="Quantidade"><input className="campo" inputMode="decimal" value={estoque.quantidade} onChange={(e) => setEstoque((x) => ({ ...x, quantidade: e.target.value }))} autoFocus /></Campo>
            {estoque.tipo === 'entrada' && (
              <Campo rotulo="Custo unitário (R$)"><input className="campo" inputMode="decimal" value={estoque.custo} onChange={(e) => setEstoque((x) => ({ ...x, custo: e.target.value }))} /></Campo>
            )}
            <Campo rotulo="Observação"><input className="campo" value={estoque.obs} onChange={(e) => setEstoque((x) => ({ ...x, obs: e.target.value }))} /></Campo>
          </div>
        )}
      </TelaSuspensa>
    </div>
  )
}
