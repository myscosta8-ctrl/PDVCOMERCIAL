import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { chamarNfce } from '../lib/nfce.js'
import { baixarArquivo } from '../lib/financeiro.js'
import { dinheiro, dataHora, lerNumero } from '../lib/formato.js'
import { Botao, Cabecalho, Campo, Etiqueta, Icone, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map((u) => ({ valor: u, texto: u }))
const TP_ROD = [['01', 'Truck'], ['02', 'Toco'], ['03', 'Cavalo mecânico'], ['04', 'Van'], ['05', 'Utilitário'], ['06', 'Outros']].map(([valor, texto]) => ({ valor, texto }))
const TP_CAR = [['00', 'Não aplicável'], ['01', 'Aberta'], ['02', 'Fechada / baú'], ['03', 'Graneleira'], ['04', 'Porta-contêiner'], ['05', 'Sider']].map(([valor, texto]) => ({ valor, texto }))
const TP_CARGA = [['05', 'Carga geral'], ['01', 'Granel sólido'], ['02', 'Granel líquido'], ['03', 'Frigorificada'], ['04', 'Conteinerizada'], ['06', 'Neogranel'],
  ['07', 'Perigosa (granel sólido)'], ['08', 'Perigosa (granel líquido)'], ['09', 'Perigosa (frigorificada)'], ['10', 'Perigosa (conteinerizada)'], ['11', 'Perigosa (carga geral)']].map(([valor, texto]) => ({ valor, texto }))
const UNIDADES = [{ valor: '01', texto: 'Quilos (kg)' }, { valor: '02', texto: 'Toneladas' }]
const SITUACOES = {
  rascunho: ['Rascunho', 'neutro'], pendente: ['Sem resposta', 'alerta'], autorizada: ['Em viagem', 'positivo'],
  rejeitada: ['Rejeitado', 'critico'], encerrada: ['Encerrado', 'neutro'], cancelada: ['Cancelado', 'critico'],
}
const num = (v) => String(v ?? '').replace('.', ',')
const so = (v) => String(v ?? '').replace(/\D/g, '')

// Código IBGE pelo nome do município
async function municipioIbge(uf, nome) {
  const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`)
  const lista = await r.json()
  const norm = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const m = lista.find((x) => norm(x.nome) === norm(nome))
  return m ? { codigo: String(m.id), nome: m.nome } : null
}

// Agrupa as NF-e escolhidas pelo município do destinatário (cada um vira uma descarga)
export function descargasDasNotas(notas) {
  const grupos = new Map()
  for (const n of notas) {
    const e = n.destinatario?.endereco ?? {}
    const k = so(e.municipio_ibge)
    if (!grupos.has(k)) grupos.set(k, { codigo: k, nome: e.municipio || '', uf: e.uf || '', chaves: [] })
    grupos.get(k).chaves.push(n.chave)
  }
  return [...grupos.values()]
}

export default function Manifestos() {
  const avisar = useAviso()
  const [lista, setLista] = useState(null)
  const [empresa, setEmpresa] = useState(null)
  const [form, setForm] = useState(null)
  const [detalhe, setDetalhe] = useState(null)

  const carregar = async () => {
    const [{ data, error }, { data: e }] = await Promise.all([
      supabase.from('mdfe_documentos').select('*').order('criado_em', { ascending: false }).limit(200),
      supabase.from('empresas').select('*').single(),
    ])
    if (error) avisar(mensagemErro(error), 'erro')
    setLista(data ?? []); setEmpresa(e)
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const nova = () => {
    const ultimo = (lista ?? [])[0]
    setForm({
      uf_inicio: empresa?.uf ?? '', percurso: [], notas: [],
      carregamento: [{ codigo: empresa?.municipio_ibge ?? '', nome: empresa?.endereco?.municipio ?? '' }],
      veiculo: ultimo?.veiculo ?? { placa: '', renavam: '', tara: '', capKG: '', tpRod: '01', tpCar: '02', uf: empresa?.uf ?? '' },
      condutores: ultimo?.condutores?.length ? ultimo.condutores : [{ nome: '', cpf: '' }],
      produto: ultimo?.produto ?? { tpCarga: '05', xProd: '', ncm: '' },
      valor_carga: '', unidade: '01', peso_carga: '', informacoes: '',
    })
  }
  const abrir = (m) => (['rascunho', 'rejeitada'].includes(m.status) ? setForm({ ...m, notas: null }) : setDetalhe(m))

  const emViagem = (lista ?? []).filter((m) => m.status === 'autorizada')
  const doMes = (lista ?? []).filter((m) => ['autorizada', 'encerrada'].includes(m.status) && (m.emitida_em ?? '').slice(0, 7) === new Date().toISOString().slice(0, 7))

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Manifestos de carga (MDF-e)" descricao="Transporte de mercadoria própria em veículo próprio, com as NF-e da viagem">
        <Botao icone="mais" onClick={nova}>Novo MDF-e</Botao>
      </Cabecalho>
      {empresa && !empresa.certificado_titular && <p className="mb-4 flex items-center gap-2 rounded-xl bg-ambar-50 px-4 py-3 text-sm text-ambar-700 dark:bg-ambar-600/15 dark:text-ambar-300"><Icone nome="alerta" className="h-4 w-4" />Configure e teste o certificado digital em Configurações para emitir. Os rascunhos já podem ser preparados.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Indicador titulo="Em viagem" icone="relogio" tom={emViagem.length ? 'alerta' : 'neutro'} valor={emViagem.length} detalhe="Encerre ao chegar ao destino" />
        <Indicador titulo="Emitidos no mês" icone="nota" tom="positivo" valor={doMes.length} detalhe={dinheiro(doMes.reduce((s, m) => s + Number(m.valor_carga), 0)) + ' em carga'} />
        <Indicador titulo="Série do MDF-e" icone="configuracoes" valor={empresa?.mdfe_serie ?? 1} detalhe={Number(empresa?.nfce_ambiente) === 1 ? 'Produção' : 'Homologação, sem valor fiscal'} />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        {lista === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : !lista.length ? (
          <Vazio icone="nota" titulo="Nenhum MDF-e ainda" texto="O manifesto acompanha a viagem quando você leva a própria mercadoria, com NF-e, em veículo da empresa.">
            <Botao icone="mais" onClick={nova}>Novo MDF-e</Botao>
          </Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr><th>Número</th><th>Data</th><th>Percurso</th><th>Veículo</th><th className="text-right">NF-e</th><th className="text-right">Carga</th><th>Situação</th></tr></thead>
              <tbody>
                {lista.map((m) => {
                  const [txt, tom] = SITUACOES[m.status] ?? [m.status, 'neutro']
                  const qtd = (m.descargas ?? []).reduce((s, d) => s + (d.chaves?.length ?? 0), 0)
                  return (
                    <tr key={m.id} onClick={() => abrir(m)} className="cursor-pointer">
                      <td className="font-semibold">{m.numero ? `Nº ${m.numero}` : '—'}</td>
                      <td>{dataHora(m.emitida_em ?? m.criado_em)}</td>
                      <td>{m.uf_inicio || '?'} → {m.uf_fim || '?'}<span className="block text-xs text-tinta-400">{(m.descargas ?? []).map((d) => d.nome).join(', ')}</span></td>
                      <td>{m.veiculo?.placa || '—'}<span className="block text-xs text-tinta-400">{m.condutores?.[0]?.nome}</span></td>
                      <td className="num text-right">{qtd}</td>
                      <td className="num text-right font-semibold">{dinheiro(m.valor_carga)}</td>
                      <td><Etiqueta tom={tom}>{txt}</Etiqueta>{m.status === 'rejeitada' && <span className="mt-1 block max-w-xs text-xs text-rubro-600 dark:text-rubro-300">{m.codigo_status} {m.motivo}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form && <FormMdfe form={form} setForm={setForm} onFeito={(doc) => { setForm(null); carregar(); if (doc) setDetalhe(doc) }} />}
      {detalhe && <DetalheMdfe mdfe={detalhe} empresa={empresa} onFechar={() => setDetalhe(null)} onMudou={(d) => { setDetalhe(d); carregar() }} />}
    </div>
  )
}

function FormMdfe({ form, setForm, onFeito }) {
  const avisar = useAviso()
  const [notas, setNotas] = useState(null)
  const [enviando, setEnviando] = useState('')
  const escolhidas = new Set((form.descargas ?? []).flatMap((d) => d.chaves))

  useEffect(() => {
    supabase.from('nfe_documentos').select('id, numero, chave, destinatario, valor_total, emitida_em, frete')
      .eq('status', 'autorizada').order('emitida_em', { ascending: false }).limit(200)
      .then(({ data }) => setNotas(data ?? []))
  }, [])

  const m = (c) => (e) => setForm((f) => ({ ...f, [c]: e?.target ? e.target.value : e }))
  const mv = (c) => (e) => setForm((f) => ({ ...f, veiculo: { ...f.veiculo, [c]: e?.target ? e.target.value : e } }))
  const mp = (c) => (e) => setForm((f) => ({ ...f, produto: { ...f.produto, [c]: e?.target ? e.target.value : e } }))
  const mc = (k, c) => (e) => setForm((f) => ({ ...f, condutores: f.condutores.map((x, j) => (j === k ? { ...x, [c]: e.target.value } : x)) }))

  const alternar = (n) => {
    const atual = (notas ?? []).filter((x) => escolhidas.has(x.chave))
    const novas = escolhidas.has(n.chave) ? atual.filter((x) => x.chave !== n.chave) : [...atual, n]
    const descargas = descargasDasNotas(novas)
    const peso = novas.reduce((s, x) => s + Number(x.frete?.volumes?.pesoBruto || 0), 0)
    setForm((f) => ({ ...f, descargas: descargas.map(({ uf, ...d }) => d), uf_fim: descargas[0]?.uf ?? f.uf_fim,
      valor_carga: num(novas.reduce((s, x) => s + Number(x.valor_total), 0).toFixed(2)), peso_carga: peso ? num(peso) : f.peso_carga }))
  }

  const buscarCarregamento = async () => {
    const c = form.carregamento?.[0] ?? {}
    if (!form.uf_inicio || !c.nome) { avisar('Informe a UF de início e o município de carregamento.', 'erro'); return }
    try {
      const r = await municipioIbge(form.uf_inicio, c.nome)
      if (!r) { avisar(`Município "${c.nome}" não encontrado em ${form.uf_inicio}.`, 'erro'); return }
      setForm((f) => ({ ...f, carregamento: [r] }))
    } catch { avisar('Não foi possível consultar o IBGE agora. Digite o código.', 'erro') }
  }

  const salvar = async (emitir) => {
    const ufsDescarga = new Set(descargasDasNotas((notas ?? []).filter((n) => escolhidas.has(n.chave))).map((d) => d.uf))
    if (ufsDescarga.size > 1) { avisar('Todas as NF-e do manifesto precisam ter destino na mesma UF (a UF de fim). Faça um MDF-e por UF.', 'erro'); return }
    const dados = {
      uf_inicio: form.uf_inicio, uf_fim: form.uf_fim, carregamento: form.carregamento, descargas: form.descargas ?? [],
      percurso: (Array.isArray(form.percurso) ? form.percurso : String(form.percurso).split(/[\s,;]+/)).map((u) => u.trim().toUpperCase()).filter(Boolean),
      veiculo: { ...form.veiculo, placa: String(form.veiculo.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''), tara: lerNumero(form.veiculo.tara || '0'), capKG: lerNumero(form.veiculo.capKG || '0') },
      condutores: form.condutores.filter((c) => c.nome || c.cpf).map((c) => ({ nome: c.nome.trim(), cpf: so(c.cpf) })),
      produto: form.produto, valor_carga: lerNumero(form.valor_carga || '0'), unidade: form.unidade, peso_carga: lerNumero(form.peso_carga || '0'),
      informacoes: form.informacoes?.trim() || null, status: 'rascunho',
    }
    setEnviando(emitir ? 'emitir' : 'salvar')
    const r = form.id ? await supabase.from('mdfe_documentos').update(dados).eq('id', form.id).select('*').single()
      : await supabase.from('mdfe_documentos').insert(dados).select('*').single()
    if (r.error) { setEnviando(''); avisar(mensagemErro(r.error), 'erro'); return }
    setForm((f) => ({ ...f, id: r.data.id }))
    if (!emitir) { setEnviando(''); avisar('Rascunho salvo.'); onFeito(null); return }
    const { dados: doc, erro } = await chamarNfce({ acao: 'mdfe_emitir', mdfe_id: r.data.id })
    setEnviando('')
    if (erro) { avisar(erro, 'erro'); return }
    avisar(`MDF-e nº ${doc.numero} autorizado. Boa viagem!`)
    onFeito(doc)
  }

  const percursoTexto = Array.isArray(form.percurso) ? form.percurso.join(', ') : form.percurso
  return (
    <TelaSuspensa aberta largura="max-w-4xl" titulo={form.id ? 'MDF-e em rascunho' : 'Novo MDF-e'} subtitulo="Escolha as NF-e da viagem, o veículo e o motorista"
      onFechar={() => setForm(null)}
      rodape={<>
        <Botao variante="secundario" onClick={() => setForm(null)}>Cancelar</Botao>
        <Botao variante="secundario" onClick={() => salvar(false)} carregando={enviando === 'salvar'}>Salvar rascunho</Botao>
        <Botao icone="nota" onClick={() => salvar(true)} carregando={enviando === 'emitir'}>Emitir MDF-e</Botao>
      </>}>
      <div className="space-y-5">
        <section>
          <p className="mb-2 font-semibold">NF-e da viagem</p>
          {notas === null ? <p className="text-sm text-tinta-400">Carregando…</p> : !notas.length ? (
            <p className="rounded-xl border border-dashed border-papel-300 p-4 text-center text-sm text-tinta-400 dark:border-noite-600">Nenhuma NF-e autorizada. Emita as notas na tela Notas fiscais antes do manifesto.</p>
          ) : (
            <div className="max-h-56 overflow-auto rounded-xl border border-papel-200 dark:border-noite-700">
              <table className="tabela w-full text-[0.95rem]">
                <thead><tr><th></th><th>NF-e</th><th>Destinatário</th><th>Destino</th><th className="text-right">Valor</th></tr></thead>
                <tbody>
                  {notas.map((n) => (
                    <tr key={n.id} className="cursor-pointer" onClick={() => alternar(n)}>
                      <td><input type="checkbox" readOnly checked={escolhidas.has(n.chave)} className="h-4 w-4 accent-caixa-600" aria-label={`Incluir NF-e ${n.numero}`} /></td>
                      <td className="font-semibold">Nº {n.numero}</td>
                      <td>{n.destinatario?.nome}</td>
                      <td>{n.destinatario?.endereco?.municipio}/{n.destinatario?.endereco?.uf}</td>
                      <td className="num text-right">{dinheiro(n.valor_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <p className="mb-2 font-semibold">Percurso</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Campo rotulo="UF de início"><Lista valor={form.uf_inicio} opcoes={UFS} onMudar={m('uf_inicio')} /></Campo>
            <Campo rotulo="Município de carregamento"><input className="campo" value={form.carregamento?.[0]?.nome ?? ''} onChange={(e) => setForm((f) => ({ ...f, carregamento: [{ codigo: '', nome: e.target.value }] }))} /></Campo>
            <Campo rotulo="Código IBGE"><div className="flex gap-2"><input className="campo num" inputMode="numeric" maxLength={7} value={form.carregamento?.[0]?.codigo ?? ''} onChange={(e) => setForm((f) => ({ ...f, carregamento: [{ ...f.carregamento[0], codigo: e.target.value }] }))} /><Botao variante="secundario" onClick={buscarCarregamento}>Buscar</Botao></div></Campo>
            <Campo rotulo="UF de fim" ajuda="Vem das NF-e escolhidas"><Lista valor={form.uf_fim} opcoes={UFS} onMudar={m('uf_fim')} /></Campo>
            <div className="sm:col-span-4"><Campo rotulo="UFs atravessadas no caminho" ajuda="Na ordem, separadas por vírgula. Deixe em branco se não passar por outros estados."><input className="campo" value={percursoTexto} onChange={m('percurso')} placeholder="Ex.: TO, GO" /></Campo></div>
          </div>
        </section>

        <section>
          <p className="mb-2 font-semibold">Veículo e motorista</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Campo rotulo="Placa"><input className="campo uppercase" value={form.veiculo.placa ?? ''} onChange={mv('placa')} placeholder="ABC1D23" /></Campo>
            <Campo rotulo="RENAVAM"><input className="campo num" inputMode="numeric" value={form.veiculo.renavam ?? ''} onChange={mv('renavam')} /></Campo>
            <Campo rotulo="Tara (kg)" ajuda="Peso do veículo vazio"><input className="campo num" inputMode="decimal" value={num(form.veiculo.tara)} onChange={mv('tara')} /></Campo>
            <Campo rotulo="Capacidade (kg)"><input className="campo num" inputMode="decimal" value={num(form.veiculo.capKG)} onChange={mv('capKG')} /></Campo>
            <Campo rotulo="Tipo de rodado"><Lista valor={form.veiculo.tpRod} opcoes={TP_ROD} onMudar={mv('tpRod')} /></Campo>
            <Campo rotulo="Tipo de carroceria"><Lista valor={form.veiculo.tpCar} opcoes={TP_CAR} onMudar={mv('tpCar')} /></Campo>
            <Campo rotulo="UF do licenciamento"><Lista valor={form.veiculo.uf} opcoes={UFS} onMudar={mv('uf')} /></Campo>
            <div />
            {form.condutores.map((c, k) => (
              <div key={k} className="contents">
                <div className="sm:col-span-2"><Campo rotulo={k ? `Condutor ${k + 1}` : 'Condutor'}><input className="campo" value={c.nome} onChange={mc(k, 'nome')} /></Campo></div>
                <Campo rotulo="CPF"><input className="campo num" inputMode="numeric" value={c.cpf} onChange={mc(k, 'cpf')} /></Campo>
                <div className="flex items-end">{k > 0
                  ? <Botao variante="secundario" onClick={() => setForm((f) => ({ ...f, condutores: f.condutores.filter((_, j) => j !== k) }))}>Tirar</Botao>
                  : form.condutores.length < 10 && <Botao variante="secundario" icone="mais" onClick={() => setForm((f) => ({ ...f, condutores: [...f.condutores, { nome: '', cpf: '' }] }))}>Outro condutor</Botao>}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <p className="mb-2 font-semibold">Carga</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Campo rotulo="Tipo de carga"><Lista valor={form.produto.tpCarga} opcoes={TP_CARGA} onMudar={mp('tpCarga')} /></Campo>
            <div className="sm:col-span-2"><Campo rotulo="Produto predominante"><input className="campo" value={form.produto.xProd ?? ''} onChange={mp('xProd')} placeholder="Ex.: Medicamentos" /></Campo></div>
            <Campo rotulo="NCM (opcional)"><input className="campo num" inputMode="numeric" maxLength={8} value={form.produto.ncm ?? ''} onChange={mp('ncm')} /></Campo>
            <Campo rotulo="Valor da carga (R$)"><input className="campo num" inputMode="decimal" value={form.valor_carga} onChange={m('valor_carga')} /></Campo>
            <Campo rotulo="Peso"><input className="campo num" inputMode="decimal" value={num(form.peso_carga)} onChange={m('peso_carga')} /></Campo>
            <Campo rotulo="Unidade"><Lista valor={form.unidade} opcoes={UNIDADES} onMudar={m('unidade')} /></Campo>
            <div />
            <div className="sm:col-span-4"><Campo rotulo="Informações complementares (opcional)"><textarea className="campo min-h-[4rem]" value={form.informacoes ?? ''} onChange={m('informacoes')} /></Campo></div>
          </div>
        </section>
      </div>
    </TelaSuspensa>
  )
}

function DetalheMdfe({ mdfe, empresa, onFechar, onMudou }) {
  const avisar = useAviso()
  const [fazendo, setFazendo] = useState('')
  const [encerrar, setEncerrar] = useState(null)
  const [cancelar, setCancelar] = useState(null)
  const [txt, tom] = SITUACOES[mdfe.status] ?? [mdfe.status, 'neutro']
  const ultima = (mdfe.descargas ?? []).slice(-1)[0]

  const acao = async (nome, corpo, ok) => {
    setFazendo(nome)
    const { dados, erro } = await chamarNfce({ acao: nome, mdfe_id: mdfe.id, ...corpo })
    setFazendo('')
    if (erro) { avisar(erro, 'erro'); return false }
    avisar(ok); onMudou(dados); return true
  }
  const baixarXml = async () => {
    const { data } = await supabase.from('mdfe_documentos').select('xml_autorizado, xml_evento').eq('id', mdfe.id).single()
    if (!data?.xml_autorizado) { avisar('XML ainda não disponível.', 'erro'); return }
    baixarArquivo(`MDFe${mdfe.chave}.xml`, data.xml_autorizado, 'application/xml')
  }
  const confirmarEncerramento = async () => {
    let codigo = so(encerrar.codigo)
    if (codigo.length !== 7) {
      try { codigo = (await municipioIbge(encerrar.uf, encerrar.nome))?.codigo ?? '' } catch { codigo = '' }
      if (!codigo) { avisar('Município de encerramento não encontrado. Confira o nome ou digite o código IBGE.', 'erro'); return }
    }
    if (await acao('mdfe_encerrar', { uf: encerrar.uf, municipio: codigo }, 'MDF-e encerrado na SEFAZ.')) setEncerrar(null)
  }

  return (
    <TelaSuspensa aberta largura="max-w-2xl" onFechar={onFechar} titulo={`MDF-e nº ${mdfe.numero ?? '—'}`}
      subtitulo={`${mdfe.uf_inicio} → ${mdfe.uf_fim}, ${dataHora(mdfe.emitida_em ?? mdfe.criado_em)}`}
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Fechar</Botao>
        {mdfe.status === 'pendente' && <Botao variante="secundario" onClick={() => acao('mdfe_consultar', {}, 'Situação atualizada.')} carregando={fazendo === 'mdfe_consultar'}>Consultar</Botao>}
        {['autorizada', 'encerrada', 'cancelada'].includes(mdfe.status) && <Botao variante="secundario" onClick={baixarXml}>Baixar XML</Botao>}
        {mdfe.status === 'autorizada' && <Botao variante="perigo" onClick={() => setCancelar({ justificativa: '' })}>Cancelar MDF-e</Botao>}
        {mdfe.status === 'autorizada' && <Botao onClick={() => setEncerrar({ uf: mdfe.uf_fim, nome: ultima?.nome ?? '', codigo: ultima?.codigo ?? '' })}>Encerrar viagem</Botao>}
      </>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Etiqueta tom={tom}>{txt}</Etiqueta>{mdfe.ambiente === 2 && <Etiqueta>Homologação</Etiqueta>}
        <span className="num ml-auto text-2xl font-semibold">{dinheiro(mdfe.valor_carga)}</span>
      </div>
      {mdfe.chave && <p className="mb-3 rounded-xl bg-papel-100 px-3 py-2 font-mono text-sm dark:bg-noite-800">{mdfe.chave.replace(/(\d{4})/g, '$1 ').trim()}</p>}
      <ul className="space-y-1.5 text-sm text-tinta-500 dark:text-tinta-300">
        <li>Veículo {mdfe.veiculo?.placa}, condutor {mdfe.condutores?.map((c) => c.nome).join(', ')}.</li>
        <li>Descarga: {(mdfe.descargas ?? []).map((d) => `${d.nome} (${d.chaves.length} NF-e)`).join('; ')}.</li>
        <li>Carga: {mdfe.produto?.xProd}, {num(mdfe.peso_carga)} {mdfe.unidade === '02' ? 't' : 'kg'}.</li>
        {mdfe.protocolo && <li>Protocolo de autorização: {mdfe.protocolo}.</li>}
        {mdfe.status === 'autorizada' && <li className="text-ambar-700 dark:text-ambar-300">Encerre ao chegar ao destino: enquanto estiver aberto, a SEFAZ não aceita outro MDF-e para esta placa.</li>}
        {mdfe.encerrada_em && <li>Encerrado em {dataHora(mdfe.encerrada_em)}.</li>}
        {mdfe.cancelada_em && <li>Cancelado em {dataHora(mdfe.cancelada_em)}: {mdfe.justificativa_cancelamento}</li>}
      </ul>

      <TelaSuspensa aberta={!!encerrar} onFechar={() => setEncerrar(null)} titulo="Encerrar viagem" subtitulo="Informe onde a viagem terminou"
        rodape={<><Botao variante="secundario" onClick={() => setEncerrar(null)}>Voltar</Botao><Botao onClick={confirmarEncerramento} carregando={fazendo === 'mdfe_encerrar'}>Encerrar na SEFAZ</Botao></>}>
        {encerrar && <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="UF"><Lista valor={encerrar.uf} opcoes={UFS} onMudar={(v) => setEncerrar((x) => ({ ...x, uf: v, codigo: '' }))} /></Campo>
          <Campo rotulo="Município"><input className="campo" value={encerrar.nome} onChange={(e) => setEncerrar((x) => ({ ...x, nome: e.target.value, codigo: '' }))} /></Campo>
          <Campo rotulo="Código IBGE" ajuda="Preenchido sozinho pelo nome"><input className="campo num" inputMode="numeric" maxLength={7} value={encerrar.codigo} onChange={(e) => setEncerrar((x) => ({ ...x, codigo: e.target.value }))} /></Campo>
        </div>}
      </TelaSuspensa>
      <TelaSuspensa aberta={!!cancelar} onFechar={() => setCancelar(null)} titulo="Cancelar MDF-e" subtitulo="Só antes de encerrar e dentro de 24 horas da autorização"
        rodape={<><Botao variante="secundario" onClick={() => setCancelar(null)}>Voltar</Botao><Botao variante="perigo" onClick={async () => { if (await acao('mdfe_cancelar', { justificativa: cancelar.justificativa }, 'MDF-e cancelado na SEFAZ.')) setCancelar(null) }} carregando={fazendo === 'mdfe_cancelar'}>Cancelar na SEFAZ</Botao></>}>
        {cancelar && <Campo rotulo="Motivo" ajuda="Pelo menos 15 letras. Vai para a SEFAZ."><textarea className="campo min-h-[5rem]" value={cancelar.justificativa} onChange={(e) => setCancelar({ justificativa: e.target.value })} /></Campo>}
      </TelaSuspensa>
    </TelaSuspensa>
  )
}
