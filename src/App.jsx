import { useEffect, useState } from 'react'
import { BotaoAlertas } from './components/Alertas.jsx'
import { NfcePendentes } from './components/NfcePendentes.jsx'
import { SessaoCtx, useSessao } from './lib/sessao.js'
import { supabase, configurado, mensagemErro } from './lib/supabase.js'
import { useCaixaAberto } from './lib/caixa.js'
import { dataHora } from './lib/formato.js'
import { Botao, Campo, Icone, ProvedorAviso } from './components/ui.jsx'
import Inicio from './pages/Inicio.jsx'
import PDV from './pages/PDV.jsx'
import Caixa from './pages/Caixa.jsx'
import Produtos from './pages/Produtos.jsx'
import NotasFiscais from './pages/NotasFiscais.jsx'
import Manifestos from './pages/Manifestos.jsx'
import Vendas from './pages/Vendas.jsx'
import Configuracoes from './pages/Configuracoes.jsx'
import Clientes from './pages/Clientes.jsx'
import Orcamentos from './pages/Orcamentos.jsx'
import Entradas from './pages/Entradas.jsx'
import Precos from './pages/Precos.jsx'
import Financeiro from './pages/Financeiro.jsx'
import Estoque from './pages/Estoque.jsx'
import Fiscal from './pages/Fiscal.jsx'
import Controlados from './pages/Controlados.jsx'
import Revenda from './pages/Revenda.jsx'
import Relatorios from './pages/Relatorios.jsx'
import Comandas from './pages/Comandas.jsx'
import Cozinha from './pages/Cozinha.jsx'

const TELAS = [
  { id: 'inicio', grupo: 'vender', nome: 'Início', icone: 'inicio', papeis: ['administrador', 'gerente'] },
  { id: 'pdv', grupo: 'vender', nome: 'Frente de caixa', icone: 'pdv', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'comandas', grupo: 'vender', nome: 'Mesas e comandas', icone: 'mesa', papeis: ['administrador', 'gerente', 'operador'], segmento: 'restaurante' },
  { id: 'cozinha', grupo: 'vender', nome: 'Cozinha', icone: 'relogio', papeis: ['administrador', 'gerente', 'operador'], segmento: 'restaurante' },
  { id: 'caixa', grupo: 'vender', nome: 'Caixa', icone: 'caixa', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'orcamentos', grupo: 'vender', nome: 'Orçamentos', icone: 'nota', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'clientes', grupo: 'vender', nome: 'Clientes', icone: 'usuario', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'produtos', grupo: 'estoque', nome: 'Produtos', icone: 'produtos', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'precos', grupo: 'estoque', nome: 'Preços e promoções', icone: 'dinheiro', papeis: ['administrador', 'gerente'] },
  { id: 'entradas', grupo: 'estoque', nome: 'Entrada de mercadorias', icone: 'estoque', papeis: ['administrador', 'gerente'] },
  { id: 'estoque', grupo: 'estoque', nome: 'Inventário', icone: 'produtos', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'financeiro', grupo: 'gestao', nome: 'Financeiro', icone: 'grafico', papeis: ['administrador', 'gerente'] },
  { id: 'controlados', grupo: 'gestao', nome: 'Controlados', icone: 'alerta', papeis: ['administrador', 'gerente'], segmento: 'farmacia' },
  { id: 'notas', grupo: 'gestao', nome: 'Notas fiscais (NF-e)', icone: 'nota', papeis: ['administrador', 'gerente'] },
  { id: 'mdfe', grupo: 'gestao', nome: 'Manifestos (MDF-e)', icone: 'estoque', papeis: ['administrador', 'gerente'] },
  { id: 'fiscal', grupo: 'gestao', nome: 'Fiscal', icone: 'nota', papeis: ['administrador', 'gerente'] },
  { id: 'vendas', grupo: 'gestao', nome: 'Vendas', icone: 'vendas', papeis: ['administrador', 'gerente'] },
  { id: 'relatorios', grupo: 'gestao', nome: 'Relatórios', icone: 'grafico', papeis: ['administrador', 'gerente'] },
  { id: 'configuracoes', grupo: 'sistema', nome: 'Configurações', icone: 'configuracoes', papeis: ['administrador'] },
  { id: 'revenda', grupo: 'sistema', nome: 'Revenda', icone: 'usuario', papeis: [], revendedor: true },
]
const GRUPOS = { vender: 'Vender', estoque: 'Estoque e compras', gestao: 'Gestão', sistema: 'Sistema' }
const PAPEIS = { administrador: 'Administrador', gerente: 'Gerente', operador: 'Operador de caixa' }

export default function App() {
  return (
    <ProvedorAviso>
      {configurado ? <Principal /> : <NaoConfigurado />}
    </ProvedorAviso>
  )
}

function Principal() {
  const [sessao, setSessao] = useState(undefined)
  const [perfil, setPerfil] = useState(null)
  const [erroPerfil, setErroPerfil] = useState('')
  const [suspensa, setSuspensa] = useState(null)
  const [novaSenha, setNovaSenha] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = supabase.auth.onAuthStateChange((e, s) => { setSessao(s); if (e === 'PASSWORD_RECOVERY') setNovaSenha(true) })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessao) { setPerfil(null); setSuspensa(null); return }
    Promise.all([
      supabase.from('usuarios')
        .select('id, nome, papel, empresa:empresas(id, razao_social, nome_fantasia, segmento, nfce_ambiente, certificado_titular)')
        .eq('id', sessao.user.id).maybeSingle(),
      supabase.rpc('situacao_acesso'),
    ]).then(([{ data, error }, { data: acesso }]) => {
      if (error) setErroPerfil(mensagemErro(error))
      else if (!data && (acesso?.suspensa || acesso?.encerrada)) setSuspensa(acesso)
      else if (!data) setErroPerfil('Seu usuário ainda não está vinculado a uma empresa. Procure o administrador.')
      else setPerfil({ ...data, revendedor: !!acesso?.revendedor, licenca: acesso ?? {} })
    })
  }, [sessao])

  if (sessao === undefined) return <Carregando />
  if (!sessao) return <Login />
  if (novaSenha) return <NovaSenha onPronto={() => setNovaSenha(false)} />
  if (erroPerfil) return <Centro><p className="text-sm">{erroPerfil}</p><Botao variante="secundario" onClick={() => supabase.auth.signOut()}>Sair</Botao></Centro>
  if (suspensa) return <AcessoSuspenso situacao={suspensa} />
  if (!perfil) return <Carregando />
  return (
    <SessaoCtx.Provider value={perfil}>
      <Painel />
    </SessaoCtx.Provider>
  )
}

function Painel() {
  const perfil = useSessao()
  const telas = TELAS.filter((t) => (t.revendedor ? perfil.revendedor : t.papeis.includes(perfil.papel)) && (!t.segmento || t.segmento === perfil.empresa.segmento))
  const [tela, setTela] = useState(() => {
    let salva
    try { salva = localStorage.getItem('tela') } catch {}
    return telas.some((t) => t.id === salva) ? salva : telas[0].id
  })
  const ir = (t) => { setTela(t); try { localStorage.setItem('tela', t) } catch {} }
  const [escuro, setEscuro] = useState(() => document.documentElement.classList.contains('dark'))
  const alternarTema = () => {
    const novo = !escuro
    document.documentElement.classList.toggle('dark', novo)
    try { localStorage.setItem('tema', novo ? 'escuro' : 'claro') } catch {}
    setEscuro(novo)
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 bg-tinta-900 text-papel md:block">
        <div className="sticky top-0 flex h-screen flex-col bg-[radial-gradient(120%_60%_at_0%_0%,rgba(20,145,125,.18),transparent_60%)]">
        <div className="px-5 pb-4 pt-5">
          <div className="flex items-center gap-3">
            <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-caixa-400 to-caixa-700 text-white shadow-[0_6px_16px_-4px_rgba(20,145,125,.6)]">
              <Icone nome="pdv" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="num text-[1.25rem] font-bold leading-none tracking-tight">PDV Comercial</p>
              <p className="mt-1 truncate text-[0.8rem] text-tinta-300">{perfil.empresa.nome_fantasia || perfil.empresa.razao_social}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
          {Object.entries(GRUPOS).map(([g, nomeGrupo]) => {
            const doGrupo = telas.filter((t) => t.grupo === g)
            if (!doGrupo.length) return null
            return (
              <div key={g}>
                <p className="mb-1 px-3 text-[0.75rem] font-semibold text-tinta-400">{nomeGrupo}</p>
                <div className="space-y-0.5">
                  {doGrupo.map((t) => {
                    const ativa = tela === t.id
                    return (
                      <button key={t.id} onClick={() => ir(t.id)} aria-current={ativa ? 'page' : undefined}
                        className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-[0.4rem] text-left text-[0.95rem] transition ${ativa ? 'bg-white/[.08] font-semibold text-white' : 'text-tinta-300 hover:bg-white/[.04] hover:text-white'}`}>
                        {ativa && <span aria-hidden="true" className="absolute inset-y-2 -left-3 w-1 rounded-r-full bg-caixa-400 shadow-[0_0_12px_rgba(47,170,148,.8)]" />}
                        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition ${ativa ? 'bg-caixa-500 text-white shadow-[0_4px_12px_-2px_rgba(20,145,125,.7)]' : 'bg-white/[.04] text-tinta-300 group-hover:text-white'}`}>
                          <Icone nome={t.icone} className="h-4 w-4" />
                        </span>
                        {t.nome}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>
        <div className="border-t border-white/[.07] p-3">
          <div className="flex items-center gap-2.5 rounded-xl bg-white/[.04] py-2 pl-2.5 pr-1">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-tinta-500 to-tinta-700 text-sm font-semibold ring-2 ring-white/10">{perfil.nome.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">{perfil.nome}</p>
              <p className="text-xs text-tinta-300">{PAPEIS[perfil.papel]}</p>
            </div>
            <button onClick={alternarTema} className="rounded-lg p-2 text-tinta-300 hover:bg-white/5 hover:text-white" title={escuro ? 'Tema claro' : 'Tema escuro'} aria-label={escuro ? 'Usar tema claro' : 'Usar tema escuro'}>
              <Icone nome={escuro ? 'sol' : 'lua'} className="h-4 w-4" />
            </button>
            <button onClick={() => supabase.auth.signOut()} className="rounded-lg p-2 text-tinta-300 hover:bg-white/5 hover:text-white" title="Sair" aria-label="Sair">
              <Icone nome="sair" className="h-4 w-4" />
            </button>
          </div>
        </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Em telas pequenas o menu lateral vira uma faixa superior */}
        <div className="flex items-center gap-1 overflow-x-auto bg-tinta-900 px-3 py-2 md:hidden">
          {telas.map((t) => (
            <button key={t.id} onClick={() => ir(t.id)} className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${tela === t.id ? 'bg-white/10 font-semibold text-white' : 'text-tinta-300'}`}>
              <Icone nome={t.icone} className="h-4 w-4" />{t.nome}
            </button>
          ))}
          <button onClick={() => supabase.auth.signOut()} className="ml-auto rounded-lg px-2 py-1.5 text-tinta-300" aria-label="Sair"><Icone nome="sair" className="h-4 w-4" /></button>
        </div>
        <BarraSituacao irPara={ir} />
        {perfil.papel === 'administrador' && perfil.licenca?.mensalidades_vencidas > 0 && (
          <div className="flex items-center gap-2 border-b border-ambar-100 bg-ambar-50 px-4 py-2 text-sm text-ambar-700 md:px-8 dark:border-ambar-700/40 dark:bg-ambar-600/10 dark:text-ambar-300">
            <Icone nome="alerta" className="h-4 w-4 shrink-0" />
            {perfil.licenca.mensalidades_vencidas === 1 ? 'Há 1 mensalidade do sistema vencida' : `Há ${perfil.licenca.mensalidades_vencidas} mensalidades do sistema vencidas`} ({dinheiroBR(perfil.licenca.valor_vencido)}). Regularize para evitar a suspensão do acesso.
          </div>
        )}
        <main className="fundo-trabalho flex-1 p-4 md:p-8">
          {tela === 'inicio' && <Inicio irPara={ir} />}
          {tela === 'pdv' && <PDV />}
          {tela === 'caixa' && <Caixa />}
          {tela === 'comandas' && <Comandas />}
          {tela === 'cozinha' && <Cozinha />}
          {tela === 'orcamentos' && <Orcamentos irPara={ir} />}
          {tela === 'clientes' && <Clientes />}
          {tela === 'produtos' && <Produtos />}
          {tela === 'entradas' && perfil.papel !== 'operador' && <Entradas />}
          {tela === 'precos' && perfil.papel !== 'operador' && <Precos />}
          {tela === 'estoque' && <Estoque />}
          {tela === 'financeiro' && perfil.papel !== 'operador' && <Financeiro />}
          {tela === 'controlados' && perfil.papel !== 'operador' && <Controlados />}
          {tela === 'fiscal' && perfil.papel !== 'operador' && <Fiscal />}
          {tela === 'vendas' && perfil.papel !== 'operador' && <Vendas irPara={ir} />}
          {tela === 'relatorios' && perfil.papel !== 'operador' && <Relatorios />}
          {tela === 'notas' && perfil.papel !== 'operador' && <NotasFiscais />}
          {tela === 'mdfe' && perfil.papel !== 'operador' && <Manifestos />}
          {tela === 'configuracoes' && perfil.papel === 'administrador' && <Configuracoes />}
          {tela === 'revenda' && perfil.revendedor && <Revenda />}
        </main>
      </div>
    </div>
  )
}

// Faixa com a situação do caixa, da NFC-e e da conexão
function BarraSituacao({ irPara }) {
  const perfil = useSessao()
  const { caixa } = useCaixaAberto()
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  const homolog = Number(perfil.empresa.nfce_ambiente) === 2
  const nfceAtiva = Boolean(perfil.empresa.certificado_titular)
  return (
    <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-papel-200/80 bg-white/80 px-4 py-2.5 text-sm backdrop-blur-md md:px-8 dark:border-noite-700 dark:bg-noite-800/80">
      <button onClick={() => irPara('caixa')} className={`flex items-center gap-2 rounded-full px-3 py-1 font-medium ring-1 ring-inset transition ${caixa ? 'bg-caixa-50 text-caixa-700 ring-caixa-200 hover:bg-caixa-100 dark:bg-caixa-900/30 dark:text-caixa-300 dark:ring-caixa-800' : 'bg-papel-100 text-tinta-600 ring-papel-300 hover:bg-papel-200 dark:bg-noite-700 dark:text-tinta-300 dark:ring-noite-600'}`}>
        <span className={`relative h-2 w-2 rounded-full ${caixa ? 'bg-caixa-500' : 'bg-tinta-300'}`}>{caixa && <span className="absolute inset-0 animate-ping rounded-full bg-caixa-400 opacity-60" />}</span>
        {caixa === undefined ? 'Verificando caixa…' : caixa ? `Caixa aberto no terminal ${caixa.numero_terminal} desde ${dataHora(caixa.aberto_em)}` : 'Caixa fechado'}
      </button>
      <span className={`flex items-center gap-2 rounded-full px-3 py-1 font-medium ring-1 ring-inset ${!nfceAtiva ? 'bg-ambar-50 text-ambar-700 ring-ambar-100 dark:bg-ambar-600/15 dark:text-ambar-300 dark:ring-ambar-700/50' : homolog ? 'bg-papel-100 text-tinta-600 ring-papel-300 dark:bg-noite-700 dark:text-tinta-300 dark:ring-noite-600' : 'bg-caixa-50 text-caixa-700 ring-caixa-200 dark:bg-caixa-900/30 dark:text-caixa-300 dark:ring-caixa-800'}`}>
        <Icone nome="nota" className="h-3.5 w-3.5" />
        {!nfceAtiva ? 'NFC-e não configurada' : homolog ? 'NFC-e em homologação, sem valor fiscal' : 'NFC-e em produção'}
      </span>
      <NfcePendentes ativa={nfceAtiva} irPara={irPara} podeAbrir={perfil.papel !== 'operador'} />
      <span className="ml-auto"><BotaoAlertas irPara={irPara} /></span>
      <span className={`flex items-center gap-2 rounded-full px-3 py-1 ${online ? 'text-tinta-400' : 'bg-rubro-50 font-semibold text-rubro-600 ring-1 ring-inset ring-rubro-100 dark:bg-rubro-600/15 dark:text-rubro-300'}`}>
        <span className={`h-2 w-2 rounded-full ${online ? 'bg-caixa-500' : 'bg-rubro-600'}`} />
        {online ? 'Conectado' : 'Sem internet'}
      </span>
    </div>
  )
}

const dinheiroBR = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function NovaSenha({ onPronto }) {
  const [senha, setSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const salvar = async (e) => {
    e.preventDefault()
    if (senha.length < 8) { setErro('A senha precisa ter pelo menos 8 caracteres.'); return }
    if (senha !== confirmar) { setErro('As senhas não conferem.'); return }
    setCarregando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setCarregando(false)
    if (error) setErro(mensagemErro(error)); else onPronto()
  }
  return (
    <div className="fundo-trabalho flex min-h-screen items-center justify-center p-6">
      <form onSubmit={salvar} className="cartao w-full max-w-sm space-y-5 p-8">
        <div><h1 className="num text-[2rem] font-bold leading-none tracking-tight">Nova senha</h1><p className="mt-2 text-tinta-400">Crie a nova senha de acesso.</p></div>
        <Campo rotulo="Nova senha" ajuda="Pelo menos 8 caracteres"><input className="campo" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoFocus autoComplete="new-password" /></Campo>
        <Campo rotulo="Repita a senha"><input className="campo" type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required autoComplete="new-password" /></Campo>
        {erro && <p className="rounded-xl bg-rubro-50 px-3 py-2 text-sm text-rubro-600">{erro}</p>}
        <Botao type="submit" className="w-full py-3" carregando={carregando}>Salvar nova senha</Botao>
      </form>
    </div>
  )
}

// Empresa suspensa ou encerrada pelo revendedor: os dados ficam preservados, mas o acesso é bloqueado
function AcessoSuspenso({ situacao }) {
  return (
    <Centro>
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ambar-50 text-ambar-600 dark:bg-ambar-600/15 dark:text-ambar-300"><Icone nome="alerta" className="h-7 w-7" /></span>
      <h1 className="text-xl font-semibold">{situacao.encerrada ? 'Contrato encerrado' : 'Acesso suspenso'}</h1>
      <p className="max-w-sm text-center text-[0.95rem] text-tinta-500 dark:text-tinta-300">
        O acesso de {situacao.empresa || situacao.razao_social} ao sistema está {situacao.encerrada ? 'encerrado' : 'suspenso'}.
        {situacao.motivo ? ` Motivo: ${situacao.motivo}.` : ''} Os dados continuam guardados. Fale com o fornecedor do sistema para regularizar.
      </p>
      {situacao.valor_vencido > 0 && <p className="text-sm font-semibold text-ambar-700 dark:text-ambar-300">Valor em aberto: {dinheiroBR(situacao.valor_vencido)}</p>}
      <Botao variante="secundario" onClick={() => supabase.auth.signOut()}>Sair</Botao>
    </Centro>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [modo, setModo] = useState('entrar')   // entrar | primeiro | esqueci
  const [confirmar, setConfirmar] = useState('')
  const volta = window.location.origin + window.location.pathname
  const trocar = (m) => { setModo(m); setErro(''); setAviso('') }
  const entrar = async (e) => {
    e.preventDefault()
    setCarregando(true); setErro(''); setAviso('')
    if (modo === 'entrar') {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
      if (error) setErro(mensagemErro(error))
    } else if (modo === 'primeiro') {
      if (senha.length < 8) setErro('A senha precisa ter pelo menos 8 caracteres.')
      else if (senha !== confirmar) setErro('As senhas não conferem.')
      else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password: senha, options: { emailRedirectTo: volta } })
        if (error) setErro(mensagemErro(error))
        else if (!data.session) setAviso('Enviamos um link de confirmação para o seu e-mail. Abra o link e depois entre com a senha criada.')
      }
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: volta })
      if (error) setErro(mensagemErro(error))
      else setAviso('Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.')
    }
    setCarregando(false)
  }
  const TITULOS = { entrar: ['Entrar', 'Use o e-mail e a senha do seu acesso.', 'Entrar'], primeiro: ['Primeiro acesso', 'Use o e-mail em que você foi convidado e crie a sua senha.', 'Criar senha'], esqueci: ['Esqueci a senha', 'Informe o e-mail de acesso para receber o link de nova senha.', 'Enviar link'] }
  return (
    <div className="grid min-h-screen md:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-tinta-900 p-12 text-papel md:flex">
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(80%_60%_at_10%_0%,rgba(20,145,125,.35),transparent_60%),radial-gradient(60%_50%_at_100%_100%,rgba(20,145,125,.12),transparent_70%)]" />
        {/* Cupom: a bobina que dá nome ao sistema */}
        <div aria-hidden="true" className="absolute right-12 top-24 w-64 rotate-[5deg] rounded-b-xl bg-papel-50 px-6 pb-8 pt-6 font-mono text-[0.8rem] text-tinta shadow-[0_30px_80px_-20px_rgba(0,0,0,.6)]">
          <div className="serrilha absolute inset-x-0 -top-2 h-2 rotate-180" />
          <p className="text-center font-bold">CUPOM</p>
          <div className="my-3 border-t border-dashed border-tinta-300" />
          {[['Dipirona 500 mg', '13,80'], ['Protetor FPS 50', '59,90'], ['Vitamina C 1 g', '16,90']].map(([d, v]) => (
            <p key={d} className="flex justify-between gap-4"><span>{d}</span><span>{v}</span></p>
          ))}
          <div className="my-3 border-t border-dashed border-tinta-300" />
          <p className="flex justify-between text-base font-bold"><span>TOTAL</span><span>R$ 90,60</span></p>
          <p className="mt-2 flex justify-between"><span>PIX</span><span>90,60</span></p>
          <div className="mx-auto mt-5 grid h-16 w-16 grid-cols-4 gap-0.5">{Array.from({ length: 16 }, (_, i) => <span key={i} className={[0, 3, 5, 6, 9, 10, 12, 15, 2, 13].includes(i) ? 'bg-tinta' : ''} />)}</div>
        </div>
        <div className="relative flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-caixa-400 to-caixa-700 text-white shadow-[0_6px_16px_-4px_rgba(20,145,125,.6)]"><Icone nome="pdv" className="h-5 w-5" /></span>
          <span className="num text-2xl font-bold tracking-tight">PDV Comercial</span>
        </div>
        <div className="relative max-w-sm">
          <p className="num text-[3rem] font-bold leading-[1.02] tracking-tight">Venda, caixa, estoque e nota fiscal no mesmo lugar.</p>
          <p className="mt-5 max-w-sm text-[1.05rem] text-tinta-300">Funciona no computador do balcão, no notebook ou no tablet, para qualquer tipo de comércio.</p>
        </div>
        <p className="relative text-sm text-tinta-400">Acesso exclusivo para usuários cadastrados.</p>
      </div>
      <div className="fundo-trabalho flex items-center justify-center p-6">
        <form onSubmit={entrar} className="cartao w-full max-w-sm space-y-5 p-8">
          <div>
            <h1 className="num text-[2rem] font-bold leading-none tracking-tight">{TITULOS[modo][0]}</h1>
            <p className="mt-2 text-tinta-400">{TITULOS[modo][1]}</p>
          </div>
          <Campo rotulo="E-mail"><input className="campo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Campo>
          {modo !== 'esqueci' && <Campo rotulo={modo === 'primeiro' ? 'Crie uma senha' : 'Senha'} ajuda={modo === 'primeiro' ? 'Pelo menos 8 caracteres' : undefined}><input className="campo" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete={modo === 'primeiro' ? 'new-password' : 'current-password'} /></Campo>}
          {modo === 'primeiro' && <Campo rotulo="Repita a senha"><input className="campo" type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required autoComplete="new-password" /></Campo>}
          {erro && <p className="rounded-xl bg-rubro-50 px-3 py-2 text-sm text-rubro-600">{erro}</p>}
          {aviso && <p className="rounded-xl bg-caixa-50 px-3 py-2 text-sm text-caixa-700 dark:bg-caixa-900/30 dark:text-caixa-300">{aviso}</p>}
          <Botao type="submit" className="w-full py-3" carregando={carregando}>{TITULOS[modo][2]}</Botao>
          <div className="flex justify-between text-sm">
            {modo === 'entrar' ? <>
              <button type="button" className="font-medium text-caixa-600 hover:underline dark:text-caixa-300" onClick={() => trocar('primeiro')}>Primeiro acesso</button>
              <button type="button" className="font-medium text-tinta-400 hover:underline" onClick={() => trocar('esqueci')}>Esqueci a senha</button>
            </> : <button type="button" className="font-medium text-caixa-600 hover:underline dark:text-caixa-300" onClick={() => trocar('entrar')}>Voltar para entrar</button>}
          </div>
        </form>
      </div>
    </div>
  )
}

const Centro = ({ children }) => <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">{children}</div>
const Carregando = () => <Centro><p className="text-sm text-tinta-400">Carregando…</p></Centro>
const NaoConfigurado = () => (
  <Centro>
    <div className="cartao max-w-md p-6 text-sm">
      <h1 className="mb-2 text-lg font-semibold">Sistema não configurado</h1>
      <p>Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para conectar ao banco de dados.</p>
    </div>
  </Centro>
)
