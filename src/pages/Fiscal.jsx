import { useEffect, useMemo, useState } from 'react'
import { NotasNfce } from './fiscal/NotasNfce.jsx'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { dinheiro, lerNumero } from '../lib/formato.js'
import { gerarSped, arquivoLatin1 } from '../lib/sped.js'
import { Botao, Cabecalho, Campo, Confirmacao, Etiqueta, Icone, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'

const CSOSN = [
  { valor: '102', texto: '102: tributada pelo Simples, sem crédito' }, { valor: '103', texto: '103: isenta por faixa de receita' },
  { valor: '300', texto: '300: imune' }, { valor: '400', texto: '400: não tributada' }, { valor: '500', texto: '500: ICMS já cobrado por substituição' },
]
const CST = [
  { valor: '00', texto: '00: tributada integralmente' }, { valor: '20', texto: '20: com redução de base de cálculo' },
  { valor: '40', texto: '40: isenta' }, { valor: '41', texto: '41: não tributada' }, { valor: '50', texto: '50: suspensão' },
  { valor: '60', texto: '60: ICMS já cobrado por substituição' },
]
const CFOP = [
  { valor: '5102', texto: '5102: venda de mercadoria de terceiros' }, { valor: '5405', texto: '5405: venda com ICMS já retido (substituído)' },
  { valor: '5101', texto: '5101: venda de produção própria' }, { valor: '5103', texto: '5103: venda de produção fora do estabelecimento' },
  { valor: '5656', texto: '5656: venda de combustível a consumidor' }, { valor: '5933', texto: '5933: prestação de serviço tributado pelo ISS' },
]
const CST_PC = [
  { valor: null, texto: 'Padrão do sistema (99)' }, { valor: '01', texto: '01: tributável, alíquota básica' },
  { valor: '04', texto: '04: monofásica, revenda a alíquota zero' }, { valor: '06', texto: '06: alíquota zero' }, { valor: '07', texto: '07: isenta' },
  { valor: '08', texto: '08: sem incidência' }, { valor: '09', texto: '09: com suspensão' }, { valor: '49', texto: '49: outras operações de saída' },
  { valor: '99', texto: '99: outras operações' },
]
const ORIGENS = [
  { valor: null, texto: 'Qualquer origem' }, { valor: 0, texto: '0: nacional' }, { valor: 1, texto: '1: estrangeira, importação direta' },
  { valor: 2, texto: '2: estrangeira, adquirida no mercado interno' }, { valor: 3, texto: '3: nacional com mais de 40% importado' },
  { valor: 5, texto: '5: nacional com até 40% importado' }, { valor: 8, texto: '8: nacional com mais de 70% importado' },
]
const MOTIVOS = [
  { valor: '01', texto: '01: no final do período' }, { valor: '02', texto: '02: mudança de forma de tributação' },
  { valor: '03', texto: '03: baixa cadastral ou paralisação' }, { valor: '04', texto: '04: alteração de regime de pagamento' },
  { valor: '05', texto: '05: por determinação do fisco' }, { valor: '06', texto: '06: controle de mercadorias com substituição tributária' },
]
const num = (v) => (v == null ? '' : String(v).replace('.', ','))
const simples = (regime) => regime === 'simples' || regime === 'mei'

export default function Fiscal() {
  const avisar = useAviso()
  const [aba, setAba] = useState('regras')
  const [empresa, setEmpresa] = useState(null)
  const carregarEmpresa = async () => {
    const { data, error } = await supabase.from('empresas').select('*').single()
    if (error) avisar(mensagemErro(error), 'erro')
    setEmpresa(data)
  }
  useEffect(() => { carregarEmpresa() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Fiscal" descricao="NFC-e, regras de tributação dos produtos e arquivo do SPED Fiscal" />
      <div className="mb-4 inline-flex gap-1 rounded-lg bg-papel-200 p-1 dark:bg-noite-700" role="tablist">
        {[['regras', 'Regras de tributação'], ['nfce', 'NFC-e: contingência e inutilização'], ['sped', 'SPED Fiscal']].map(([id, nome]) => (
          <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${aba === id ? 'bg-white shadow-sm dark:bg-noite-800' : 'text-tinta-600 dark:text-tinta-300'}`}>{nome}</button>
        ))}
      </div>
      {!empresa ? <p className="text-sm text-tinta-400">Carregando…</p> : aba === 'regras' ? <Regras empresa={empresa} /> : aba === 'nfce' ? <NotasNfce empresa={empresa} /> : <Sped empresa={empresa} recarregar={carregarEmpresa} />}
    </div>
  )
}

// ---------------------------------------------------------------- Regras de tributação
function Regras({ empresa }) {
  const avisar = useAviso()
  const sn = simples(empresa.regime_tributario)
  const [regras, setRegras] = useState(null)
  const [produtos, setProdutos] = useState([])
  const [form, setForm] = useState(null)
  const [excluir, setExcluir] = useState(null)
  const [simulacao, setSimulacao] = useState(null)
  const [lista, setLista] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const carregar = async () => {
    const [r, p] = await Promise.all([
      supabase.from('regras_fiscais').select('*').order('prioridade').order('nome'),
      supabase.from('produtos').select('id, descricao, ncm, ean, regra_fiscal_id, e_kit, e_grade').eq('ativo', true).limit(20000),
    ])
    if (r.error) avisar(mensagemErro(r.error), 'erro')
    setRegras(r.data ?? []); setProdutos(p.data ?? [])
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const usoPorRegra = useMemo(() => {
    const m = {}
    for (const p of produtos) if (p.regra_fiscal_id) m[p.regra_fiscal_id] = (m[p.regra_fiscal_id] ?? 0) + 1
    return m
  }, [produtos])
  const semNcm = produtos.filter((p) => !p.e_grade && !p.e_kit && String(p.ncm ?? '').replace(/\D/g, '').length !== 8)
  const semRegra = produtos.filter((p) => !p.regra_fiscal_id)

  const nova = (padrao) => setForm({
    nome: padrao ? 'Padrão' : '', ncm_prefixo: '', origem: null, prioridade: '100', cfop: '5102',
    csosn: sn ? '102' : null, cst_icms: sn ? null : '00', aliquota_icms: '', reducao_bc: '', cbenef: '',
    cst_pis: null, aliquota_pis: '', cst_cofins: null, aliquota_cofins: '', cst_ibscbs: '', cclasstrib: '', observacao: '', ativo: true,
  })
  const editar = (r) => setForm({ ...r, ncm_prefixo: r.ncm_prefixo ?? '', prioridade: String(r.prioridade), aliquota_icms: num(r.aliquota_icms), reducao_bc: num(r.reducao_bc),
    aliquota_pis: num(r.aliquota_pis), aliquota_cofins: num(r.aliquota_cofins), cbenef: r.cbenef ?? '', cst_ibscbs: r.cst_ibscbs ?? '', cclasstrib: r.cclasstrib ?? '', observacao: r.observacao ?? '' })
  const mudar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }))

  const salvar = async () => {
    const f = form
    const ncm = f.ncm_prefixo.replace(/\D/g, '')
    if (!f.nome.trim()) { avisar('Informe o nome da regra.', 'erro'); return }
    if (ncm && (ncm.length < 2 || ncm.length > 8)) { avisar('O NCM deve ter de 2 a 8 dígitos (o começo do código vale para todos os NCM que começam assim).', 'erro'); return }
    if (!/^\d{4}$/.test(f.cfop)) { avisar('CFOP inválido.', 'erro'); return }
    const n = (v) => (v === '' || v == null ? 0 : lerNumero(v))
    const dados = {
      nome: f.nome.trim(), ncm_prefixo: ncm || null, origem: f.origem, prioridade: parseInt(f.prioridade, 10) || 100, cfop: f.cfop,
      csosn: sn ? f.csosn : null, cst_icms: sn ? null : f.cst_icms, aliquota_icms: sn ? 0 : n(f.aliquota_icms), reducao_bc: !sn && f.cst_icms === '20' ? n(f.reducao_bc) : 0,
      cbenef: f.cbenef.trim() || null, cst_pis: f.cst_pis, aliquota_pis: f.cst_pis === '01' ? n(f.aliquota_pis) : 0,
      cst_cofins: f.cst_cofins, aliquota_cofins: f.cst_cofins === '01' ? n(f.aliquota_cofins) : 0,
      cst_ibscbs: f.cst_ibscbs.trim() || null, cclasstrib: f.cclasstrib.trim() || null, observacao: f.observacao.trim() || null, ativo: f.ativo,
    }
    if ([dados.aliquota_icms, dados.reducao_bc, dados.aliquota_pis, dados.aliquota_cofins].some((x) => Number.isNaN(x) || x < 0 || x > 100)) { avisar('Alíquotas devem ficar entre 0 e 100.', 'erro'); return }
    if (!sn && ['00', '20'].includes(dados.cst_icms) && !(dados.aliquota_icms > 0)) { avisar('Informe a alíquota do ICMS.', 'erro'); return }
    setEnviando(true)
    const r = f.id ? await supabase.from('regras_fiscais').update(dados).eq('id', f.id) : await supabase.from('regras_fiscais').insert(dados)
    setEnviando(false)
    if (r.error) { avisar(mensagemErro(r.error), 'erro'); return }
    avisar('Regra salva. Use "Aplicar aos produtos" para atualizar o cadastro.'); setForm(null); carregar()
  }
  const confirmarExclusao = async () => {
    const { error } = await supabase.from('regras_fiscais').delete().eq('id', excluir.id)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Regra excluída.'); setExcluir(null); setForm(null); carregar()
  }
  const simular = async () => {
    setEnviando(true)
    const { data, error } = await supabase.rpc('aplicar_regras_fiscais', { p_simular: true })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    setSimulacao(data)
  }
  const aplicar = async () => {
    setEnviando(true)
    const { data, error } = await supabase.rpc('aplicar_regras_fiscais', { p_simular: false })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`${data.alterados} produto(s) atualizado(s).`); setSimulacao(null); carregar()
  }
  const icms = (r) => (r.csosn ? `CSOSN ${r.csosn}` : `CST ${r.cst_icms}${Number(r.aliquota_icms) ? ` ${num(r.aliquota_icms)}%` : ''}${Number(r.reducao_bc) ? `, base reduzida ${num(r.reducao_bc)}%` : ''}`)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Regime tributário" icone="nota" valor={{ simples: 'Simples Nacional', mei: 'MEI', simples_excesso: 'Simples, excesso', normal: 'Regime normal' }[empresa.regime_tributario]} detalhe={sn ? 'ICMS pelo CSOSN' : 'ICMS pelo CST'} />
        <Indicador titulo="Regras ativas" icone="ok" valor={(regras ?? []).filter((r) => r.ativo).length} detalhe="A do NCM mais específico vence" />
        <Indicador titulo="Produtos sem regra" icone="alerta" tom={semRegra.length ? 'alerta' : 'positivo'} valor={semRegra.length} detalhe="Ficam com a tributação do cadastro" />
        <Indicador titulo="NCM inválido ou vazio" icone="alerta" tom={semNcm.length ? 'critico' : 'positivo'} valor={semNcm.length} detalhe={semNcm.length ? <button className="underline" onClick={() => setLista(semNcm)}>Ver produtos</button> : 'A NFC-e exige NCM de 8 dígitos'} />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-papel-200 px-4 py-3 dark:border-noite-700">
          <div><p className="font-semibold">Regras de tributação</p><p className="text-sm text-tinta-400">Produto novo ou com NCM alterado recebe a regra na hora. Confira as regras com o contador.</p></div>
          <div className="flex gap-2">
            <Botao variante="secundario" onClick={simular} carregando={enviando}>Aplicar aos produtos</Botao>
            <Botao icone="mais" onClick={() => nova(false)}>Nova regra</Botao>
          </div>
        </div>
        {regras === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : regras.length === 0 ? (
          <Vazio icone="nota" titulo="Nenhuma regra cadastrada" texto="Comece pela regra padrão, que vale para todos os produtos, e depois crie regras por NCM para as exceções (substituição tributária, monofásicos, isentos).">
            <Botao icone="mais" onClick={() => nova(true)}>Criar regra padrão</Botao>
          </Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead className="bg-papel/70 dark:bg-noite/40"><tr><th>Regra</th><th>NCM</th><th>CFOP</th><th>ICMS</th><th>PIS e COFINS</th><th className="text-right">Produtos</th><th>Situação</th></tr></thead>
              <tbody>
                {regras.map((r) => (
                  <tr key={r.id} onClick={() => editar(r)} className="cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40">
                    <td className="font-medium">{r.nome}{r.origem != null && <span className="block text-xs font-normal text-tinta-400">Origem {r.origem}</span>}</td>
                    <td className="num">{r.ncm_prefixo ? `${r.ncm_prefixo}${r.ncm_prefixo.length < 8 ? '…' : ''}` : <span className="text-tinta-400">todos</span>}</td>
                    <td className="num">{r.cfop}</td>
                    <td>{icms(r)}</td>
                    <td>{r.cst_pis || r.cst_cofins ? `CST ${r.cst_pis ?? '99'}${Number(r.aliquota_pis) ? ` ${num(r.aliquota_pis)}%` : ''} / ${r.cst_cofins ?? '99'}${Number(r.aliquota_cofins) ? ` ${num(r.aliquota_cofins)}%` : ''}` : <span className="text-tinta-400">padrão (99)</span>}</td>
                    <td className="num text-right">{usoPorRegra[r.id] ?? 0}</td>
                    <td>{r.ativo ? <Etiqueta tom="positivo">Ativa</Etiqueta> : <Etiqueta>Inativa</Etiqueta>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-2 text-sm text-tinta-400">Os campos do IBS e da CBS (reforma tributária) ainda não são cobrados do Simples Nacional em 2026. Os códigos já podem ser guardados em cada regra e passam a sair na nota quando a emissão for adaptada.</p>

      <TelaSuspensa aberta={!!form} titulo={form?.id ? 'Editar regra' : 'Nova regra'} subtitulo="Vale para os produtos cujo NCM começa com o código informado" onFechar={() => setForm(null)} largura="max-w-3xl"
        rodape={<>
          {form?.id && <Botao variante="secundario" className="mr-auto" onClick={() => setExcluir(form)}>Excluir</Botao>}
          <Botao variante="secundario" onClick={() => setForm(null)}>Cancelar</Botao>
          <Botao onClick={salvar} carregando={enviando}>Salvar regra</Botao>
        </>}>
        {form && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2"><Campo rotulo="Nome"><input className="campo" value={form.nome} onChange={mudar('nome')} placeholder="Ex.: Medicamentos com substituição" autoFocus /></Campo></div>
              <Campo rotulo="NCM (começo do código)" ajuda="Vazio = todos os produtos"><input className="campo num" inputMode="numeric" value={form.ncm_prefixo} onChange={mudar('ncm_prefixo')} placeholder="Ex.: 3004" /></Campo>
              <Campo rotulo="Origem"><Lista valor={form.origem} opcoes={ORIGENS} onMudar={mudar('origem')} /></Campo>
            </div>
            <div>
              <p className="mb-2 font-semibold">ICMS</p>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2"><Campo rotulo="CFOP"><Lista valor={form.cfop} opcoes={CFOP.some((c) => c.valor === form.cfop) ? CFOP : [...CFOP, { valor: form.cfop, texto: form.cfop }]} onMudar={mudar('cfop')} /></Campo></div>
                {sn
                  ? <div className="sm:col-span-2"><Campo rotulo="CSOSN"><Lista valor={form.csosn} opcoes={CSOSN} onMudar={mudar('csosn')} /></Campo></div>
                  : <>
                    <div className="sm:col-span-2"><Campo rotulo="CST"><Lista valor={form.cst_icms} opcoes={CST} onMudar={mudar('cst_icms')} /></Campo></div>
                    {['00', '20'].includes(form.cst_icms) && <Campo rotulo="Alíquota (%)"><input className="campo num" inputMode="decimal" value={form.aliquota_icms} onChange={mudar('aliquota_icms')} /></Campo>}
                    {form.cst_icms === '20' && <Campo rotulo="Redução da base (%)"><input className="campo num" inputMode="decimal" value={form.reducao_bc} onChange={mudar('reducao_bc')} /></Campo>}
                  </>}
                <Campo rotulo="Código de benefício (cBenef)" ajuda="Só se o estado exigir"><input className="campo" value={form.cbenef} onChange={mudar('cbenef')} /></Campo>
                <Campo rotulo="Prioridade" ajuda="Empate de NCM: menor vence"><input className="campo num" inputMode="numeric" value={form.prioridade} onChange={mudar('prioridade')} /></Campo>
              </div>
            </div>
            <div>
              <p className="mb-2 font-semibold">PIS e COFINS</p>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2"><Campo rotulo="CST do PIS"><Lista valor={form.cst_pis} opcoes={CST_PC} onMudar={mudar('cst_pis')} /></Campo></div>
                <div className="sm:col-span-2"><Campo rotulo="CST da COFINS"><Lista valor={form.cst_cofins} opcoes={CST_PC} onMudar={mudar('cst_cofins')} /></Campo></div>
                {form.cst_pis === '01' && <Campo rotulo="Alíquota do PIS (%)"><input className="campo num" inputMode="decimal" value={form.aliquota_pis} onChange={mudar('aliquota_pis')} placeholder="0,65 ou 1,65" /></Campo>}
                {form.cst_cofins === '01' && <Campo rotulo="Alíquota da COFINS (%)"><input className="campo num" inputMode="decimal" value={form.aliquota_cofins} onChange={mudar('aliquota_cofins')} placeholder="3 ou 7,6" /></Campo>}
              </div>
            </div>
            <div>
              <p className="mb-2 font-semibold">Reforma tributária (IBS e CBS)</p>
              <div className="grid gap-3 sm:grid-cols-4">
                <Campo rotulo="CST do IBS/CBS"><input className="campo num" value={form.cst_ibscbs} onChange={mudar('cst_ibscbs')} placeholder="Ex.: 000" /></Campo>
                <Campo rotulo="Classificação (cClassTrib)"><input className="campo num" value={form.cclasstrib} onChange={mudar('cclasstrib')} placeholder="Ex.: 000001" /></Campo>
                <div className="sm:col-span-2"><Campo rotulo="Observação"><input className="campo" value={form.observacao} onChange={mudar('observacao')} placeholder="Ex.: conferido com o contador em novembro" /></Campo></div>
              </div>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={form.ativo} onChange={mudar('ativo')} /> Regra ativa</label>
          </div>
        )}
      </TelaSuspensa>

      <TelaSuspensa aberta={!!simulacao} titulo="Aplicar regras aos produtos" subtitulo="Prévia do que muda no cadastro" onFechar={() => setSimulacao(null)} largura="max-w-3xl"
        rodape={<>
          <Botao variante="secundario" onClick={() => setSimulacao(null)}>Cancelar</Botao>
          <Botao onClick={aplicar} carregando={enviando} disabled={!simulacao?.alterados}>Aplicar em {simulacao?.alterados ?? 0} produto(s)</Botao>
        </>}>
        {simulacao && (
          <div className="space-y-3">
            <p className="text-[0.95rem]">{simulacao.alterados} produto(s) mudam de tributação. {simulacao.sem_regra > 0 && <span className="text-ambar-600 dark:text-ambar-300">{simulacao.sem_regra} produto(s) não se encaixam em nenhuma regra e ficam como estão.</span>}</p>
            {simulacao.amostra.length > 0 && (
              <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.9rem]">
                <thead><tr><th>Produto</th><th>Regra</th><th>Hoje</th><th>Passa a ser</th></tr></thead>
                <tbody>
                  {simulacao.amostra.map((a, k) => (
                    <tr key={k}>
                      <td>{a.descricao}<span className="block text-xs text-tinta-400">NCM {a.ncm || 'vazio'}</span></td>
                      <td>{a.regra}</td>
                      <td className="num text-tinta-400">{a.antes.cfop} {a.antes.csosn ?? a.antes.cst ?? ''}</td>
                      <td className="num font-semibold">{a.depois.cfop} {a.depois.csosn ?? a.depois.cst ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {simulacao.alterados > simulacao.amostra.length && <p className="text-sm text-tinta-400">Mostrando {simulacao.amostra.length} de {simulacao.alterados}.</p>}
          </div>
        )}
      </TelaSuspensa>

      <TelaSuspensa aberta={!!lista} titulo="Produtos sem NCM válido" subtitulo="Corrija na tela Produtos; sem NCM de 8 dígitos a NFC-e é rejeitada" onFechar={() => setLista(null)} largura="max-w-2xl"
        rodape={<Botao variante="secundario" onClick={() => setLista(null)}>Fechar</Botao>}>
        {lista && (
          <ul className="divide-y divide-papel-200 dark:divide-noite-700">
            {lista.slice(0, 200).map((p) => <li key={p.id} className="flex justify-between py-2 text-[0.95rem]"><span>{p.descricao}</span><span className="num text-tinta-400">{p.ncm || 'sem NCM'}</span></li>)}
          </ul>
        )}
      </TelaSuspensa>
      <Confirmacao aberta={!!excluir} titulo="Excluir regra" mensagem="Os produtos mantêm a tributação atual até que outra regra seja aplicada." textoConfirmar="Excluir" variante="perigo" onCancelar={() => setExcluir(null)} onConfirmar={confirmarExclusao} />
    </>
  )
}

// ---------------------------------------------------------------- SPED Fiscal
const mesAnterior = () => {
  const h = new Date(); const ini = new Date(h.getFullYear(), h.getMonth() - 1, 1); const fim = new Date(h.getFullYear(), h.getMonth(), 0)
  const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return [f(ini), f(fim)]
}
const somaDias = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }

function Sped({ empresa, recarregar }) {
  const perfil = useSessao()
  const avisar = useAviso()
  const admin = perfil.papel === 'administrador'
  const [ini, fim] = mesAnterior()
  const [op, setOp] = useState({ inicio: ini, fim, finalidade: '0', saldo: '', vencimento: somaDias(fim, 10), inventario: false, dataInv: fim, motivo: '01', conta: '' })
  const [resultado, setResultado] = useState(null)
  const [gerando, setGerando] = useState(false)
  const [dadosEsc, setDadosEsc] = useState(null)
  const mudar = (campo) => (e) => setOp((o) => ({ ...o, [campo]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }))
  const ct = empresa.contador ?? {}
  const contadorOk = ct.nome && ct.cpf && ct.crc

  const gerar = async () => {
    if (!op.inicio || !op.fim || op.fim < op.inicio) { avisar('Período inválido.', 'erro'); return }
    if (op.inicio.slice(0, 7) !== op.fim.slice(0, 7)) { avisar('O SPED Fiscal é mensal: escolha datas dentro do mesmo mês.', 'erro'); return }
    const saldo = op.saldo === '' ? 0 : lerNumero(op.saldo)
    if (Number.isNaN(saldo) || saldo < 0) { avisar('Saldo credor inválido.', 'erro'); return }
    setGerando(true); setResultado(null)
    const { data: dados, error } = await supabase.rpc('dados_sped', { p_inicio: op.inicio, p_fim: op.fim, p_inventario: op.inventario ? op.dataInv : null })
    if (error) { setGerando(false); avisar(mensagemErro(error), 'erro'); return }
    // NFC-e de produção do período, em páginas
    const nfce = []
    for (let de = 0; ; de += 500) {
      const { data, error: e2 } = await supabase.from('nfce_documentos').select('numero, serie, chave, status, emitida_em, xml_autorizado')
        .eq('ambiente', 1).in('status', ['autorizada', 'cancelada'])
        .gte('emitida_em', `${op.inicio}T00:00:00-03:00`).lte('emitida_em', `${op.fim}T23:59:59-03:00`).order('numero').range(de, de + 499)
      if (e2) { setGerando(false); avisar(mensagemErro(e2), 'erro'); return }
      nfce.push(...(data ?? []))
      if (!data || data.length < 500) break
    }
    const { data: inutilizadas } = await supabase.from('nfce_inutilizacoes').select('serie, inicio, fim').eq('ambiente', 1)
      .gte('criado_em', `${op.inicio}T00:00:00-03:00`).lte('criado_em', `${op.fim}T23:59:59-03:00`)
    try {
      const r = gerarSped(dados, nfce, { inicio: op.inicio, fim: op.fim, finalidade: op.finalidade, saldoCredorAnterior: saldo, vencimentoIcms: op.vencimento, inutilizadas: inutilizadas ?? [],
        inventario: op.inventario ? { data: op.dataInv, motivo: op.motivo, conta: op.conta.trim() } : null })
      setResultado({ ...r, nome: `SPED_EFD_${String(empresa.cnpj ?? '').replace(/\D/g, '')}_${op.inicio.slice(0, 7).replace('-', '')}.txt` })
    } catch (e) { avisar(e.message || 'Não foi possível gerar o arquivo.', 'erro') }
    setGerando(false)
  }
  const baixar = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(arquivoLatin1(resultado.texto)); a.download = resultado.nome; a.click(); URL.revokeObjectURL(a.href)
  }
  const salvarEsc = async () => {
    const d = dadosEsc
    if (d.contador.cpf && String(d.contador.cpf).replace(/\D/g, '').length !== 11) { avisar('CPF do contador inválido.', 'erro'); return }
    const { error } = await supabase.from('empresas').update({ contador: d.contador, sped_perfil: d.sped_perfil, inscricao_municipal: d.inscricao_municipal || null, cod_receita_icms: d.cod_receita_icms || null }).eq('id', empresa.id)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Dados da escrituração salvos.'); setDadosEsc(null); recarregar()
  }
  const mc = (campo) => (e) => setDadosEsc((d) => ({ ...d, contador: { ...d.contador, [campo]: e.target.value } }))

  return (
    <>
      {simples(empresa.regime_tributario) && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-ambar-50 px-4 py-3 text-[0.95rem] dark:bg-ambar-600/10"><Icone nome="alerta" className="mt-0.5 h-4 w-4 shrink-0 text-ambar-600" />
          Empresas do Simples Nacional normalmente são dispensadas da EFD ICMS/IPI. Gere o arquivo só se o contador confirmar a obrigação no seu estado.</p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="cartao p-4 lg:col-span-2">
          <p className="font-semibold">Gerar arquivo do mês</p>
          <p className="text-sm text-tinta-400">EFD ICMS/IPI com notas de compra (C100, C170), NFC-e de produção (C100, C190), apuração do ICMS (E110) e inventário (bloco H).</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Campo rotulo="Início"><input type="date" className="campo" value={op.inicio} onChange={mudar('inicio')} /></Campo>
            <Campo rotulo="Fim"><input type="date" className="campo" value={op.fim} onChange={mudar('fim')} /></Campo>
            <div className="sm:col-span-2"><Campo rotulo="Finalidade"><Lista valor={op.finalidade} opcoes={[{ valor: '0', texto: 'Remessa original' }, { valor: '1', texto: 'Remessa substituta (retificação)' }]} onMudar={mudar('finalidade')} /></Campo></div>
            <Campo rotulo="Saldo credor anterior (R$)" ajuda="Do mês anterior, se houver"><input className="campo num" inputMode="decimal" value={op.saldo} onChange={mudar('saldo')} placeholder="0,00" /></Campo>
            <Campo rotulo="Vencimento do ICMS"><input type="date" className="campo" value={op.vencimento} onChange={mudar('vencimento')} /></Campo>
          </div>
          <div className="mt-4 rounded-lg border border-papel-200 p-3 dark:border-noite-700">
            <label className="flex items-center gap-2 font-medium"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={op.inventario} onChange={mudar('inventario')} /> Incluir inventário (bloco H)</label>
            <p className="ml-6 text-sm text-tinta-400">Obrigatório no arquivo de fevereiro, com o estoque de 31 de dezembro. O estoque da data é recalculado pelas movimentações.</p>
            {op.inventario && (
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <Campo rotulo="Data do inventário"><input type="date" className="campo" value={op.dataInv} onChange={mudar('dataInv')} /></Campo>
                <div className="sm:col-span-2"><Campo rotulo="Motivo"><Lista valor={op.motivo} opcoes={MOTIVOS} onMudar={mudar('motivo')} /></Campo></div>
                <Campo rotulo="Conta contábil do estoque" ajuda="Peça ao contador"><input className="campo" value={op.conta} onChange={mudar('conta')} placeholder="Ex.: 1.1.4.01" /></Campo>
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <Botao icone="nota" onClick={gerar} carregando={gerando}>Gerar arquivo</Botao>
            {resultado && <Botao variante="secundario" onClick={baixar}>Baixar {resultado.nome}</Botao>}
          </div>
        </div>

        <div className="cartao p-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Dados da escrituração</p>
            {admin && <Botao variante="secundario" className="py-1" onClick={() => setDadosEsc({ contador: { ...ct }, sped_perfil: empresa.sped_perfil || 'A', inscricao_municipal: empresa.inscricao_municipal ?? '', cod_receita_icms: empresa.cod_receita_icms ?? '' })}>Editar</Botao>}
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-tinta-400">Contador</dt><dd className="text-right">{ct.nome || <Etiqueta tom="critico">não informado</Etiqueta>}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-tinta-400">CRC</dt><dd>{ct.crc || '—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-tinta-400">Perfil</dt><dd>{empresa.sped_perfil || 'A'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-tinta-400">Código de receita do ICMS</dt><dd>{empresa.cod_receita_icms || '—'}</dd></div>
          </dl>
          {!contadorOk && <p className="mt-3 text-sm text-ambar-600 dark:text-ambar-300">Nome, CPF e CRC do contador são obrigatórios no arquivo.</p>}
          <p className="mt-3 text-xs text-tinta-400">Depois de baixar, abra o arquivo no programa validador (PVA) da Receita, confira, assine com o certificado e transmita.</p>
        </div>
      </div>

      {resultado && (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador titulo="Notas de compra" icone="estoque" valor={resultado.resumo.entradas} detalhe={`Crédito de ICMS ${dinheiro(resultado.resumo.credito)}`} />
            <Indicador titulo="NFC-e" icone="vendas" valor={resultado.resumo.saidas} detalhe={`Débito de ICMS ${dinheiro(resultado.resumo.debito)}`} />
            <Indicador titulo={resultado.resumo.recolher > 0 ? 'ICMS a recolher' : 'Saldo credor a transportar'} icone="dinheiro" tom={resultado.resumo.recolher > 0 ? 'alerta' : 'positivo'} valor={dinheiro(resultado.resumo.recolher || resultado.resumo.transportar)} detalhe="Apuração do E110" />
            <Indicador titulo="Linhas do arquivo" icone="nota" valor={resultado.resumo.linhas.toLocaleString('pt-BR')} detalhe="Leiaute 020 (2026)" />
          </div>
          <div className="mt-4 cartao p-4">
            <p className="font-semibold">{resultado.avisos.length ? `${resultado.avisos.length} ponto(s) para conferir antes de validar` : 'Nenhuma pendência encontrada'}</p>
            {resultado.avisos.length > 0 && (
              <ul className="mt-2 space-y-1.5 text-[0.95rem]">
                {resultado.avisos.map((a, k) => <li key={k} className="flex gap-2"><Icone nome="alerta" className="mt-1 h-4 w-4 shrink-0 text-ambar-600" />{a}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      <TelaSuspensa aberta={!!dadosEsc} titulo="Dados da escrituração" subtitulo="Registro 0100 (contador) e configurações do arquivo" onFechar={() => setDadosEsc(null)} largura="max-w-3xl"
        rodape={<>
          <Botao variante="secundario" onClick={() => setDadosEsc(null)}>Cancelar</Botao>
          <Botao onClick={salvarEsc}>Salvar</Botao>
        </>}>
        {dadosEsc && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2"><Campo rotulo="Nome do contador"><input className="campo" value={dadosEsc.contador.nome ?? ''} onChange={mc('nome')} autoFocus /></Campo></div>
              <Campo rotulo="CPF"><input className="campo num" inputMode="numeric" value={dadosEsc.contador.cpf ?? ''} onChange={mc('cpf')} /></Campo>
              <Campo rotulo="CRC"><input className="campo" value={dadosEsc.contador.crc ?? ''} onChange={mc('crc')} placeholder="PA-012345/O" /></Campo>
              <Campo rotulo="CNPJ do escritório"><input className="campo num" inputMode="numeric" value={dadosEsc.contador.cnpj ?? ''} onChange={mc('cnpj')} /></Campo>
              <Campo rotulo="E-mail"><input className="campo" value={dadosEsc.contador.email ?? ''} onChange={mc('email')} /></Campo>
              <Campo rotulo="Telefone"><input className="campo num" value={dadosEsc.contador.fone ?? ''} onChange={mc('fone')} /></Campo>
              <Campo rotulo="CEP"><input className="campo num" value={dadosEsc.contador.cep ?? ''} onChange={mc('cep')} /></Campo>
              <div className="sm:col-span-2"><Campo rotulo="Endereço"><input className="campo" value={dadosEsc.contador.endereco ?? ''} onChange={mc('endereco')} /></Campo></div>
              <Campo rotulo="Número"><input className="campo" value={dadosEsc.contador.numero ?? ''} onChange={mc('numero')} /></Campo>
              <Campo rotulo="Bairro"><input className="campo" value={dadosEsc.contador.bairro ?? ''} onChange={mc('bairro')} /></Campo>
              <Campo rotulo="Código IBGE do município" ajuda="7 dígitos"><input className="campo num" value={dadosEsc.contador.municipio_ibge ?? ''} onChange={mc('municipio_ibge')} /></Campo>
            </div>
            <div className="grid gap-3 border-t border-papel-200 pt-4 sm:grid-cols-3 dark:border-noite-700">
              <Campo rotulo="Perfil de apresentação" ajuda="Definido pela SEFAZ do estado"><Lista valor={dadosEsc.sped_perfil} opcoes={[{ valor: 'A', texto: 'Perfil A' }, { valor: 'B', texto: 'Perfil B' }, { valor: 'C', texto: 'Perfil C' }]} onMudar={(v) => setDadosEsc((d) => ({ ...d, sped_perfil: v }))} /></Campo>
              <Campo rotulo="Inscrição municipal"><input className="campo" value={dadosEsc.inscricao_municipal} onChange={(e) => setDadosEsc((d) => ({ ...d, inscricao_municipal: e.target.value }))} /></Campo>
              <Campo rotulo="Código de receita do ICMS" ajuda="Tabela da SEFAZ do estado"><input className="campo" value={dadosEsc.cod_receita_icms} onChange={(e) => setDadosEsc((d) => ({ ...d, cod_receita_icms: e.target.value }))} /></Campo>
            </div>
          </div>
        )}
      </TelaSuspensa>
    </>
  )
}
