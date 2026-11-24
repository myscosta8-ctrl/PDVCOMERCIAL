import { useEffect, useState } from 'react'
import { BotaoAlertas } from './components/Alertas.jsx'
import { SessaoCtx, useSessao } from './lib/sessao.js'
import { supabase, configurado, mensagemErro } from './lib/supabase.js'
import { useCaixaAberto } from './lib/caixa.js'
import { dataHora } from './lib/formato.js'
import { Botao, Campo, Icone, ProvedorAviso } from './components/ui.jsx'
import Inicio from './pages/Inicio.jsx'
import PDV from './pages/PDV.jsx'
import Caixa from './pages/Caixa.jsx'
import Produtos from './pages/Produtos.jsx'
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

const TELAS = [
  { id: 'inicio', nome: 'Início', icone: 'inicio', papeis: ['administrador', 'gerente'] },
  { id: 'pdv', nome: 'Frente de caixa', icone: 'pdv', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'caixa', nome: 'Caixa', icone: 'caixa', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'orcamentos', nome: 'Orçamentos', icone: 'nota', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'clientes', nome: 'Clientes', icone: 'usuario', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'produtos', nome: 'Produtos', icone: 'produtos', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'precos', nome: 'Preços e promoções', icone: 'dinheiro', papeis: ['administrador', 'gerente'] },
  { id: 'entradas', nome: 'Entrada de mercadorias', icone: 'estoque', papeis: ['administrador', 'gerente'] },
  { id: 'estoque', nome: 'Inventário', icone: 'produtos', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'financeiro', nome: 'Financeiro', icone: 'grafico', papeis: ['administrador', 'gerente'] },
  { id: 'controlados', nome: 'Controlados', icone: 'alerta', papeis: ['administrador', 'gerente'], segmento: 'farmacia' },
  { id: 'fiscal', nome: 'Fiscal', icone: 'nota', papeis: ['administrador', 'gerente'] },
  { id: 'vendas', nome: 'Vendas', icone: 'vendas', papeis: ['administrador', 'gerente'] },
  { id: 'configuracoes', nome: 'Configurações', icone: 'configuracoes', papeis: ['administrador'] },
]
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessao) { setPerfil(null); return }
    supabase
      .from('usuarios')
      .select('id, nome, papel, empresa:empresas(id, razao_social, nome_fantasia, segmento, nfce_ambiente, certificado_titular)')
      .eq('id', sessao.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setErroPerfil(mensagemErro(error))
        else if (!data) setErroPerfil('Seu usuário ainda não está vinculado a uma empresa. Procure o administrador.')
        else setPerfil(data)
      })
  }, [sessao])

  if (sessao === undefined) return <Carregando />
  if (!sessao) return <Login />
  if (erroPerfil) return <Centro><p className="text-sm">{erroPerfil}</p><Botao variante="secundario" onClick={() => supabase.auth.signOut()}>Sair</Botao></Centro>
  if (!perfil) return <Carregando />
  return (
    <SessaoCtx.Provider value={perfil}>
      <Painel />
    </SessaoCtx.Provider>
  )
}

function Painel() {
  const perfil = useSessao()
  const telas = TELAS.filter((t) => t.papeis.includes(perfil.papel) && (!t.segmento || t.segmento === perfil.empresa.segmento))
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
      <aside className="hidden w-60 shrink-0 bg-tinta text-papel md:block">
        <div className="sticky top-0 flex h-screen flex-col">
        <div className="px-5 pb-4 pt-5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-caixa-500 text-white"><Icone nome="pdv" className="h-5 w-5" /></span>
            <span className="text-lg font-semibold tracking-tight">PDV Comercial</span>
          </div>
          <p className="mt-3 truncate text-sm text-tinta-300">{perfil.empresa.nome_fantasia || perfil.empresa.razao_social}</p>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {telas.map((t) => (
            <button
              key={t.id}
              onClick={() => ir(t.id)}
              aria-current={tela === t.id ? 'page' : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[0.95rem] transition ${tela === t.id ? 'bg-white/10 font-semibold text-white shadow-[inset_3px_0_0_#14917D]' : 'text-tinta-300 hover:bg-white/5 hover:text-white'}`}
            >
              <Icone nome={t.icone} className="h-5 w-5" />
              {t.nome}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-sm font-semibold">{perfil.nome.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{perfil.nome}</p>
              <p className="text-xs text-tinta-300">{PAPEIS[perfil.papel]}</p>
            </div>
          </div>
          <div className="mt-1 flex gap-1">
            <button onClick={alternarTema} className="flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm text-tinta-300 hover:bg-white/5 hover:text-white">
              <Icone nome={escuro ? 'sol' : 'lua'} className="h-4 w-4" />{escuro ? 'Tema claro' : 'Tema escuro'}
            </button>
            <button onClick={() => supabase.auth.signOut()} className="rounded-lg px-3 py-2 text-tinta-300 hover:bg-white/5 hover:text-white" title="Sair" aria-label="Sair">
              <Icone nome="sair" className="h-4 w-4" />
            </button>
          </div>
        </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Em telas pequenas o menu lateral vira uma faixa superior */}
        <div className="flex items-center gap-1 overflow-x-auto bg-tinta px-3 py-2 md:hidden">
          {telas.map((t) => (
            <button key={t.id} onClick={() => ir(t.id)} className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${tela === t.id ? 'bg-white/10 font-semibold text-white' : 'text-tinta-300'}`}>
              <Icone nome={t.icone} className="h-4 w-4" />{t.nome}
            </button>
          ))}
          <button onClick={() => supabase.auth.signOut()} className="ml-auto rounded-lg px-2 py-1.5 text-tinta-300" aria-label="Sair"><Icone nome="sair" className="h-4 w-4" /></button>
        </div>
        <BarraSituacao irPara={ir} />
        <main className="flex-1 p-4 md:p-6">
          {tela === 'inicio' && <Inicio irPara={ir} />}
          {tela === 'pdv' && <PDV />}
          {tela === 'caixa' && <Caixa />}
          {tela === 'orcamentos' && <Orcamentos irPara={ir} />}
          {tela === 'clientes' && <Clientes />}
          {tela === 'produtos' && <Produtos />}
          {tela === 'entradas' && perfil.papel !== 'operador' && <Entradas />}
          {tela === 'precos' && perfil.papel !== 'operador' && <Precos />}
          {tela === 'estoque' && <Estoque />}
          {tela === 'financeiro' && perfil.papel !== 'operador' && <Financeiro />}
          {tela === 'controlados' && perfil.papel !== 'operador' && <Controlados />}
          {tela === 'fiscal' && perfil.papel !== 'operador' && <Fiscal />}
          {tela === 'vendas' && perfil.papel !== 'operador' && <Vendas />}
          {tela === 'configuracoes' && perfil.papel === 'administrador' && <Configuracoes />}
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
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-papel-200 bg-white px-4 py-2.5 text-sm md:px-6 dark:border-noite-700 dark:bg-noite-800">
      <button onClick={() => irPara('caixa')} className="flex items-center gap-2 hover:underline">
        <span className={`h-2.5 w-2.5 rounded-full ${caixa ? 'bg-caixa-500' : 'bg-tinta-300'}`} />
        {caixa === undefined ? 'Verificando caixa…' : caixa ? `Caixa aberto no terminal ${caixa.numero_terminal} desde ${dataHora(caixa.aberto_em)}` : 'Caixa fechado'}
      </button>
      <span className={`flex items-center gap-2 ${!nfceAtiva ? 'text-ambar-600 dark:text-ambar-300' : 'text-tinta-600 dark:text-tinta-300'}`}>
        <Icone nome="nota" className="h-4 w-4" />
        {!nfceAtiva ? 'NFC-e não configurada' : homolog ? 'NFC-e em homologação, sem valor fiscal' : 'NFC-e em produção'}
      </span>
      <span className="ml-auto"><BotaoAlertas irPara={irPara} /></span>
      <span className={`flex items-center gap-2 ${online ? 'text-tinta-400' : 'font-semibold text-rubro-600'}`}>
        <span className={`h-2 w-2 rounded-full ${online ? 'bg-caixa-500' : 'bg-rubro-600'}`} />
        {online ? 'Conectado' : 'Sem internet'}
      </span>
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const entrar = async (e) => {
    e.preventDefault()
    setCarregando(true); setErro('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) setErro(mensagemErro(error))
    setCarregando(false)
  }
  return (
    <div className="grid min-h-screen md:grid-cols-[1fr_1.1fr]">
      <div className="hidden flex-col justify-between bg-tinta p-10 text-papel md:flex">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-caixa-500 text-white"><Icone nome="pdv" className="h-5 w-5" /></span>
          <span className="text-xl font-semibold">PDV Comercial</span>
        </div>
        <div className="max-w-sm">
          <p className="num text-[2.6rem] font-semibold leading-[1.05]">Venda, caixa, estoque e nota fiscal no mesmo lugar.</p>
          <p className="mt-4 text-tinta-300">Funciona no computador do balcão, no notebook ou no tablet, para qualquer tipo de comércio.</p>
        </div>
        <p className="text-sm text-tinta-400">Acesso exclusivo para usuários cadastrados.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={entrar} className="w-full max-w-sm space-y-5">
          <div>
            <h1 className="text-2xl font-semibold">Entrar</h1>
            <p className="text-tinta-400">Use o e-mail e a senha cadastrados pelo administrador.</p>
          </div>
          <Campo rotulo="E-mail"><input className="campo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Campo>
          <Campo rotulo="Senha"><input className="campo" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></Campo>
          {erro && <p className="rounded-lg bg-rubro-50 px-3 py-2 text-sm text-rubro-600">{erro}</p>}
          <Botao type="submit" className="w-full py-2.5" carregando={carregando}>Entrar</Botao>
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
