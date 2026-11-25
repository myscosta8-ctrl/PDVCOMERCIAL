import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { dinheiro, dataHora, lerNumero } from '../lib/formato.js'
import { Botao, Cabecalho, Campo, Confirmacao, Etiqueta, Icone, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map((u) => ({ valor: u, texto: u }))
const SEGMENTOS = [
  { valor: 'varejo', texto: 'Varejo em geral' }, { valor: 'farmacia', texto: 'Farmácia' },
  { valor: 'mercado', texto: 'Mercado' }, { valor: 'restaurante', texto: 'Restaurante / lanchonete' },
  { valor: 'vestuario', texto: 'Vestuário' }, { valor: 'materiais', texto: 'Materiais de construção' },
  { valor: 'servicos', texto: 'Serviços' }, { valor: 'outro', texto: 'Outro' },
]
const REGIMES = [
  { valor: 'simples', texto: 'Simples Nacional' }, { valor: 'simples_excesso', texto: 'Simples – excesso de sublimite' },
  { valor: 'mei', texto: 'MEI' }, { valor: 'normal', texto: 'Regime normal' },
]
const PLANOS = [
  { valor: 'essencial', texto: 'Essencial' }, { valor: 'fiscal', texto: 'Fiscal' }, { valor: 'completo', texto: 'Completo' },
]
const PAPEIS = [{ valor: 'administrador', texto: 'Administrador' }, { valor: 'gerente', texto: 'Gerente' }, { valor: 'operador', texto: 'Operador de caixa' }]
const DIAS = Array.from({ length: 28 }, (_, i) => ({ valor: i + 1, texto: `Dia ${i + 1}` }))
const FILTROS = [
  { valor: 'todos', texto: 'Todos os clientes' }, { valor: 'ativos', texto: 'Ativos' }, { valor: 'inadimplentes', texto: 'Com mensalidade vencida' },
  { valor: 'suspensos', texto: 'Suspensos' }, { valor: 'sem_uso', texto: 'Sem vendas há 7 dias' }, { valor: 'encerrados', texto: 'Encerrados' },
]
const FORMAS = ['PIX', 'Boleto', 'Transferência', 'Dinheiro', 'Cartão'].map((f) => ({ valor: f, texto: f }))
const nomeSeg = (v) => SEGMENTOS.find((s) => s.valor === v)?.texto ?? v
const nomePlano = (v) => PLANOS.find((s) => s.valor === v)?.texto ?? v
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—')
const mesBR = (d) => { const t = new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1) }
const cnpjBR = (c) => { const d = String(c || '').replace(/\D/g, ''); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c || '' }

function situacao(c) {
  if (!c.ativa) return ['Encerrado', 'neutro']
  if (c.bloqueada_em) return ['Suspenso', 'critico']
  if (c.vencidas > 0) return ['Mensalidade vencida', 'alerta']
  if (c.convite_pendente) return ['Aguardando 1º acesso', 'neutro']
  return ['Ativo', 'positivo']
}

export default function Revenda() {
  const avisar = useAviso()
  const [p, setP] = useState(null)
  const [filtro, setFiltro] = useState('todos')
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState(null)
  const [detalhe, setDetalhe] = useState(null)
  const [gerar, setGerar] = useState(false)
  const [gerando, setGerando] = useState(false)

  const carregar = async () => {
    const { data, error } = await supabase.rpc('revenda_painel')
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    setP(data)
    if (detalhe) setDetalhe(data.clientes.find((c) => c.id === detalhe.id) ?? null)
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const seteDias = Date.now() - 7 * 864e5
    return (p?.clientes ?? []).filter((c) => {
      if (t && !`${c.razao_social} ${c.nome_fantasia ?? ''} ${c.cnpj ?? ''}`.toLowerCase().includes(t)) return false
      if (filtro === 'ativos') return c.ativa && !c.bloqueada_em
      if (filtro === 'inadimplentes') return c.ativa && c.vencidas > 0
      if (filtro === 'suspensos') return c.ativa && c.bloqueada_em
      if (filtro === 'encerrados') return !c.ativa
      if (filtro === 'sem_uso') return c.ativa && !c.bloqueada_em && (!c.ultima_venda || new Date(c.ultima_venda).getTime() < seteDias)
      return true
    })
  }, [p, filtro, busca])

  const gerarMes = async () => {
    setGerando(true)
    const { data, error } = await supabase.rpc('revenda_gerar_mensalidades', { p_competencia: hoje() })
    setGerando(false); setGerar(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(data ? `${data} mensalidade(s) gerada(s) para ${mesBR(hoje())}.` : 'As mensalidades deste mês já estavam geradas.')
    carregar()
  }

  const t = p?.totais ?? {}
  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Revenda" descricao="Empresas clientes, mensalidades do sistema e uso de cada loja">
        <Botao variante="secundario" icone="relogio" onClick={() => setGerar(true)}>Gerar mensalidades do mês</Botao>
        <Botao icone="mais" onClick={() => setForm({ novo: true, segmento: 'varejo', regime_tributario: 'simples', plano: 'completo', dia_vencimento: 10, mensalidade: '', cliente_desde: hoje(), contato: {} })}>Nova empresa</Botao>
      </Cabecalho>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Clientes ativos" icone="usuario" tom="positivo" valor={t.ativos ?? '—'} detalhe={`${t.suspensos ?? 0} suspenso(s), ${t.encerrados ?? 0} encerrado(s)`} />
        <Indicador titulo="Receita mensal" icone="dinheiro" valor={dinheiro(t.receita_mensal ?? 0)} detalhe={`Recebido neste mês: ${dinheiro(t.recebido_mes ?? 0)}`} />
        <Indicador titulo="Mensalidades vencidas" icone="alerta" tom={t.inadimplentes ? 'alerta' : 'neutro'} valor={dinheiro(t.valor_vencido ?? 0)} detalhe={t.inadimplentes ? `${t.inadimplentes} cliente(s) em atraso` : 'Nenhum cliente em atraso'} />
        <Indicador titulo="Sem vendas há 7 dias" icone="relogio" tom={t.sem_uso_7d ? 'alerta' : 'neutro'} valor={t.sem_uso_7d ?? 0} detalhe="Clientes ativos que podem precisar de ajuda" />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-papel-200 p-4 dark:border-noite-700">
          <div className="min-w-[16rem] flex-1"><Campo rotulo="Buscar"><input className="campo" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou CNPJ" /></Campo></div>
          <div className="w-64"><Campo rotulo="Mostrar"><Lista valor={filtro} opcoes={FILTROS} onMudar={setFiltro} /></Campo></div>
        </div>
        {p === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : !lista.length ? (
          <Vazio icone="usuario" titulo={p.clientes.length ? 'Nenhum cliente neste filtro' : 'Nenhuma empresa cliente ainda'} texto="Cadastre a empresa e o e-mail do administrador. Ele cria a senha no primeiro acesso." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr><th>Empresa</th><th>Plano</th><th className="text-right">Mensalidade</th><th>Próximo vencimento</th><th className="text-right">Vendas em 30 dias</th><th>Última venda</th><th>Situação</th></tr></thead>
              <tbody>
                {lista.map((c) => {
                  const [txt, tom] = situacao(c)
                  return (
                    <tr key={c.id} onClick={() => setDetalhe(c)} className="cursor-pointer">
                      <td className="font-semibold">{c.nome_fantasia || c.razao_social}<span className="block text-xs font-normal text-tinta-400">{nomeSeg(c.segmento)}{c.uf ? ` · ${c.uf}` : ''}{c.cnpj ? ` · ${cnpjBR(c.cnpj)}` : ''}</span></td>
                      <td>{nomePlano(c.plano)}</td>
                      <td className="num text-right">{dinheiro(c.mensalidade)}</td>
                      <td>{dataBR(c.proximo_vencimento)}{c.vencidas > 0 && <span className="block text-xs font-semibold text-ambar-600">{c.vencidas} vencida(s): {dinheiro(c.valor_vencido)}</span>}</td>
                      <td className="num text-right">{dinheiro(c.faturamento_30d)}<span className="block text-xs text-tinta-400">{c.vendas_30d} venda(s), {c.nfce_30d} NFC-e</span></td>
                      <td>{c.ultima_venda ? dataHora(c.ultima_venda) : 'Nenhuma'}</td>
                      <td><Etiqueta tom={tom}>{txt}</Etiqueta></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && <FormEmpresa form={form} setForm={setForm} onSalvo={() => { setForm(null); carregar() }} />}
      {detalhe && !form && <DetalheCliente cliente={detalhe} onFechar={() => setDetalhe(null)} onEditar={() => setForm({ ...detalhe, mensalidade: String(detalhe.mensalidade).replace('.', ',') })} onMudou={carregar} />}
      <Confirmacao aberta={gerar} titulo="Gerar mensalidades do mês"
        mensagem={`Cria a mensalidade de ${mesBR(hoje()).toLowerCase()} para cada empresa ativa com valor cadastrado. As que já existem não são duplicadas.`}
        textoConfirmar="Gerar mensalidades" carregando={gerando} onCancelar={() => setGerar(false)} onConfirmar={gerarMes} />
    </div>
  )
}

function FormEmpresa({ form, setForm, onSalvo }) {
  const avisar = useAviso()
  const [salvando, setSalvando] = useState(false)
  const m = (c) => (e) => setForm((f) => ({ ...f, [c]: e?.target ? e.target.value : e }))
  const mc = (c) => (e) => setForm((f) => ({ ...f, contato: { ...(f.contato ?? {}), [c]: e.target.value } }))

  const salvar = async () => {
    const valor = form.mensalidade === '' ? 0 : lerNumero(form.mensalidade)
    if (!(valor >= 0)) { avisar('Mensalidade inválida.', 'erro'); return }
    const dados = {
      razao_social: form.razao_social, nome_fantasia: form.nome_fantasia, cnpj: form.cnpj, uf: form.uf, segmento: form.segmento,
      regime_tributario: form.regime_tributario, plano: form.plano, mensalidade: valor, dia_vencimento: form.dia_vencimento,
      cliente_desde: form.cliente_desde, contato: form.contato ?? {}, obs_revenda: form.obs_revenda,
    }
    setSalvando(true)
    const { error } = form.novo
      ? await supabase.rpc('revenda_criar_empresa', { p_dados: dados, p_admin_nome: form.admin_nome, p_admin_email: form.admin_email })
      : await supabase.rpc('revenda_atualizar_empresa', { p_empresa: form.id, p_dados: dados })
    setSalvando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(form.novo ? `Empresa cadastrada. Peça a ${form.admin_nome} para criar a senha com o e-mail ${form.admin_email.trim().toLowerCase()}.` : 'Dados da empresa salvos.')
    onSalvo()
  }

  return (
    <TelaSuspensa aberta titulo={form.novo ? 'Nova empresa cliente' : 'Editar empresa'} subtitulo={form.novo ? 'Os dados fiscais completos o próprio cliente preenche em Configurações' : form.razao_social}
      largura="max-w-3xl" onFechar={() => setForm(null)}
      rodape={<>
        <Botao variante="secundario" onClick={() => setForm(null)}>Cancelar</Botao>
        <Botao onClick={salvar} carregando={salvando}>{form.novo ? 'Cadastrar empresa' : 'Salvar alterações'}</Botao>
      </>}>
      <div className="space-y-5">
        <section className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><Campo rotulo="Razão social"><input className="campo" value={form.razao_social ?? ''} onChange={m('razao_social')} autoFocus /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="Nome fantasia"><input className="campo" value={form.nome_fantasia ?? ''} onChange={m('nome_fantasia')} /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="CNPJ"><input className="campo num" inputMode="numeric" value={form.cnpj ?? ''} onChange={m('cnpj')} /></Campo></div>
          <Campo rotulo="UF"><Lista valor={form.uf} opcoes={UFS} onMudar={m('uf')} /></Campo>
          <Campo rotulo="Cliente desde"><input type="date" className="campo" value={form.cliente_desde ?? ''} onChange={m('cliente_desde')} /></Campo>
          <div className="sm:col-span-2"><Campo rotulo="Segmento"><Lista valor={form.segmento} opcoes={SEGMENTOS} onMudar={m('segmento')} /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="Regime tributário"><Lista valor={form.regime_tributario} opcoes={REGIMES} onMudar={m('regime_tributario')} /></Campo></div>
        </section>
        <section className="grid gap-3 border-t border-papel-200 pt-4 sm:grid-cols-4 dark:border-noite-700">
          <h3 className="titulo-secao sm:col-span-4">Licença</h3>
          <Campo rotulo="Plano"><Lista valor={form.plano} opcoes={PLANOS} onMudar={m('plano')} /></Campo>
          <Campo rotulo="Mensalidade (R$)"><input className="campo num" inputMode="decimal" value={form.mensalidade ?? ''} onChange={m('mensalidade')} placeholder="0,00" /></Campo>
          <Campo rotulo="Vencimento"><Lista valor={Number(form.dia_vencimento)} opcoes={DIAS} onMudar={m('dia_vencimento')} /></Campo>
        </section>
        <section className="grid gap-3 border-t border-papel-200 pt-4 sm:grid-cols-3 dark:border-noite-700">
          <h3 className="titulo-secao sm:col-span-3">Contato</h3>
          <Campo rotulo="Responsável"><input className="campo" value={form.contato?.nome ?? ''} onChange={mc('nome')} /></Campo>
          <Campo rotulo="Telefone"><input className="campo num" inputMode="tel" value={form.contato?.telefone ?? ''} onChange={mc('telefone')} /></Campo>
          <Campo rotulo="E-mail"><input className="campo" inputMode="email" value={form.contato?.email ?? ''} onChange={mc('email')} /></Campo>
          <div className="sm:col-span-3"><Campo rotulo="Observações internas" ajuda="Só a revenda vê"><textarea className="campo" rows={2} value={form.obs_revenda ?? ''} onChange={m('obs_revenda')} /></Campo></div>
        </section>
        {form.novo && (
          <section className="grid gap-3 border-t border-papel-200 pt-4 sm:grid-cols-2 dark:border-noite-700">
            <h3 className="titulo-secao sm:col-span-2">Administrador da empresa</h3>
            <Campo rotulo="Nome"><input className="campo" value={form.admin_nome ?? ''} onChange={m('admin_nome')} /></Campo>
            <Campo rotulo="E-mail de acesso" ajuda="Ele cria a senha no primeiro acesso, com este e-mail"><input className="campo" inputMode="email" value={form.admin_email ?? ''} onChange={m('admin_email')} /></Campo>
          </section>
        )}
      </div>
    </TelaSuspensa>
  )
}

function DetalheCliente({ cliente: c, onFechar, onEditar, onMudou }) {
  const avisar = useAviso()
  const [mens, setMens] = useState(null)
  const [acao, setAcao] = useState(null)       // suspender | encerrar | reativar
  const [motivo, setMotivo] = useState('')
  const [pagar, setPagar] = useState(null)
  const [convite, setConvite] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const carregarMens = () => supabase.rpc('revenda_mensalidades', { p_empresa: c.id }).then(({ data }) => setMens(data ?? []))
  useEffect(() => { carregarMens() }, [c.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [txt, tom] = situacao(c)

  const mudarSituacao = async () => {
    setEnviando(true)
    const { error } = await supabase.rpc('revenda_situacao_empresa', { p_empresa: c.id, p_acao: acao, p_motivo: motivo || null })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(acao === 'reativar' ? 'Acesso reativado.' : acao === 'suspender' ? 'Acesso suspenso. Os dados continuam guardados.' : 'Contrato encerrado.')
    setAcao(null); setMotivo(''); onMudou()
  }
  const baixar = async (id, tipo, extra = {}) => {
    setEnviando(true)
    const { error } = await supabase.rpc('revenda_baixar_mensalidade', { p_id: id, p_acao: tipo, p_data: extra.data ?? null, p_forma: extra.forma ?? null, p_obs: extra.obs ?? null })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(tipo === 'pagar' ? 'Pagamento registrado.' : tipo === 'estornar' ? 'Pagamento estornado.' : 'Mensalidade cancelada.')
    setPagar(null); carregarMens(); onMudou()
  }
  const convidar = async () => {
    setEnviando(true)
    const { error } = await supabase.rpc('revenda_convidar', { p_empresa: c.id, p_nome: convite.nome, p_email: convite.email, p_papel: convite.papel })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`Convite criado. ${convite.nome} entra com o e-mail ${convite.email.trim().toLowerCase()} e cria a senha.`)
    setConvite(null); onMudou()
  }

  const linha = (rotulo, valor) => <div><dt className="text-xs text-tinta-400">{rotulo}</dt><dd className="mt-0.5">{valor || '—'}</dd></div>
  return (<>
    <TelaSuspensa aberta titulo={c.nome_fantasia || c.razao_social} subtitulo={`${c.razao_social}${c.cnpj ? ` · CNPJ ${cnpjBR(c.cnpj)}` : ''}`} largura="max-w-3xl" onFechar={onFechar}
      rodape={<>
        {c.ativa && !c.bloqueada_em && <Botao variante="secundario" onClick={() => setAcao('suspender')}>Suspender acesso</Botao>}
        {(c.bloqueada_em || !c.ativa) && <Botao variante="secundario" onClick={() => setAcao('reativar')}>Reativar acesso</Botao>}
        {c.ativa && <Botao variante="secundario" onClick={() => setAcao('encerrar')}>Encerrar contrato</Botao>}
        <Botao variante="secundario" icone="usuario" onClick={() => setConvite({ nome: '', email: '', papel: 'administrador' })}>Convidar usuário</Botao>
        <Botao onClick={onEditar}>Editar dados</Botao>
      </>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Etiqueta tom={tom}>{txt}</Etiqueta>
          {c.bloqueada_em && <span className="text-sm text-rubro-600 dark:text-rubro-300">Desde {dataHora(c.bloqueada_em)}{c.motivo_bloqueio ? `: ${c.motivo_bloqueio}` : ''}</span>}
          {c.convite_pendente && <span className="text-sm text-tinta-400">Convite aguardando: {c.convite_pendente}</span>}
        </div>
        <dl className="grid gap-3 text-[0.95rem] sm:grid-cols-4">
          {linha('Plano', nomePlano(c.plano))}
          {linha('Mensalidade', `${dinheiro(c.mensalidade)}, dia ${c.dia_vencimento}`)}
          {linha('Cliente desde', dataBR(c.cliente_desde))}
          {linha('Segmento', nomeSeg(c.segmento))}
          {linha('Usuários ativos', c.usuarios)}
          {linha('NFC-e', c.nfce_ambiente === 1 ? 'Produção' : 'Homologação')}
          {linha('Certificado vence', c.certificado_validade ? dataBR(c.certificado_validade) : 'Não enviado')}
          {linha('Última venda', c.ultima_venda ? dataHora(c.ultima_venda) : 'Nenhuma')}
          {linha('Responsável', c.contato?.nome)}
          {linha('Telefone', c.contato?.telefone)}
          <div className="sm:col-span-2">{linha('E-mail', c.contato?.email)}</div>
          {c.obs_revenda && <div className="sm:col-span-4">{linha('Observações internas', c.obs_revenda)}</div>}
        </dl>
        <section>
          <h3 className="titulo-secao mb-2">Mensalidades</h3>
          {mens === null ? <p className="text-sm text-tinta-400">Carregando…</p> : !mens.length ? (
            <p className="rounded-xl border border-dashed border-papel-300 px-4 py-6 text-center text-sm text-tinta-400 dark:border-noite-600">Nenhuma mensalidade gerada. Use "Gerar mensalidades do mês" na tela anterior.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-papel-200 dark:border-noite-700">
              <table className="tabela w-full text-[0.95rem]">
                <thead><tr><th>Referência</th><th>Vencimento</th><th className="text-right">Valor</th><th>Situação</th><th className="text-right">Ações</th></tr></thead>
                <tbody>
                  {mens.map((x) => {
                    const vencida = x.status === 'aberta' && x.vencimento < hoje()
                    return (
                      <tr key={x.id}>
                        <td>{mesBR(x.competencia)}</td>
                        <td>{dataBR(x.vencimento)}</td>
                        <td className="num text-right">{dinheiro(x.valor)}</td>
                        <td>
                          {x.status === 'paga' ? <Etiqueta tom="positivo">Paga em {dataBR(x.pago_em)}{x.forma ? ` (${x.forma})` : ''}</Etiqueta>
                            : x.status === 'cancelada' ? <Etiqueta tom="neutro">Cancelada</Etiqueta>
                            : vencida ? <Etiqueta tom="alerta">Vencida</Etiqueta> : <Etiqueta tom="neutro">Em aberto</Etiqueta>}
                        </td>
                        <td className="text-right">
                          {x.status === 'aberta' && <>
                            <button className="mr-3 text-sm font-semibold text-caixa-600 hover:underline dark:text-caixa-300" onClick={() => setPagar({ id: x.id, data: hoje(), forma: 'PIX', obs: '', valor: x.valor })}>Registrar pagamento</button>
                            <button className="text-sm font-medium text-tinta-400 hover:text-rubro-600" onClick={() => baixar(x.id, 'cancelar')}>Cancelar</button>
                          </>}
                          {x.status === 'paga' && <button className="text-sm font-medium text-tinta-400 hover:text-rubro-600" onClick={() => baixar(x.id, 'estornar')}>Estornar</button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </TelaSuspensa>

    {acao && (
      <TelaSuspensa aberta titulo={acao === 'reativar' ? 'Reativar acesso' : acao === 'suspender' ? 'Suspender acesso' : 'Encerrar contrato'}
        subtitulo={c.nome_fantasia || c.razao_social} onFechar={() => setAcao(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setAcao(null)}>Cancelar</Botao>
          <Botao variante={acao === 'reativar' ? 'primario' : 'perigo'} onClick={mudarSituacao} carregando={enviando}>
            {acao === 'reativar' ? 'Reativar acesso' : acao === 'suspender' ? 'Suspender acesso' : 'Encerrar contrato'}
          </Botao>
        </>}>
        <p className="text-[0.95rem] text-tinta-600 dark:text-tinta-300">
          {acao === 'reativar' ? 'Os usuários da empresa voltam a entrar normalmente.'
            : acao === 'suspender' ? 'Os usuários deixam de entrar no sistema até a reativação. Vendas, notas e cadastros continuam guardados.'
            : 'O contrato é encerrado e o acesso bloqueado. Os dados continuam guardados e o contrato pode ser reativado depois. Não são geradas novas mensalidades.'}
        </p>
        {acao !== 'reativar' && <div className="mt-4"><Campo rotulo="Motivo" ajuda="Aparece para o cliente na tela de acesso bloqueado"><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus /></Campo></div>}
      </TelaSuspensa>
    )}

    {pagar && (
      <TelaSuspensa aberta titulo="Registrar pagamento" subtitulo={`Mensalidade de ${dinheiro(pagar.valor)}`} onFechar={() => setPagar(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setPagar(null)}>Cancelar</Botao>
          <Botao variante="sucesso" icone="ok" onClick={() => baixar(pagar.id, 'pagar', pagar)} carregando={enviando}>Registrar pagamento</Botao>
        </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Data do pagamento"><input type="date" className="campo" value={pagar.data} onChange={(e) => setPagar((x) => ({ ...x, data: e.target.value }))} /></Campo>
          <Campo rotulo="Forma"><Lista valor={pagar.forma} opcoes={FORMAS} onMudar={(v) => setPagar((x) => ({ ...x, forma: v }))} /></Campo>
          <div className="sm:col-span-2"><Campo rotulo="Observação (opcional)"><input className="campo" value={pagar.obs} onChange={(e) => setPagar((x) => ({ ...x, obs: e.target.value }))} /></Campo></div>
        </div>
      </TelaSuspensa>
    )}

    {convite && (
      <TelaSuspensa aberta titulo="Convidar usuário" subtitulo={c.nome_fantasia || c.razao_social} onFechar={() => setConvite(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setConvite(null)}>Cancelar</Botao>
          <Botao onClick={convidar} carregando={enviando}>Criar convite</Botao>
        </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome"><input className="campo" value={convite.nome} onChange={(e) => setConvite((x) => ({ ...x, nome: e.target.value }))} autoFocus /></Campo>
          <Campo rotulo="Papel"><Lista valor={convite.papel} opcoes={PAPEIS} onMudar={(v) => setConvite((x) => ({ ...x, papel: v }))} /></Campo>
          <div className="sm:col-span-2"><Campo rotulo="E-mail de acesso" ajuda="A pessoa cria a senha no primeiro acesso, com este e-mail"><input className="campo" inputMode="email" value={convite.email} onChange={(e) => setConvite((x) => ({ ...x, email: e.target.value }))} /></Campo></div>
        </div>
      </TelaSuspensa>
    )}
  </>)
}
