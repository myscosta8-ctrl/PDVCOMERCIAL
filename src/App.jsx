import { useEffect, useState } from 'react'
import { SessaoCtx, useSessao } from './lib/sessao.js'
import { supabase, configurado, mensagemErro } from './lib/supabase.js'
import { Botao, Campo, ProvedorAviso } from './components/ui.jsx'
import PDV from './pages/PDV.jsx'
import Caixa from './pages/Caixa.jsx'
import Produtos from './pages/Produtos.jsx'
import Vendas from './pages/Vendas.jsx'

const TELAS = [
  { id: 'pdv', nome: 'Frente de caixa', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'caixa', nome: 'Caixa', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'produtos', nome: 'Produtos', papeis: ['administrador', 'gerente', 'operador'] },
  { id: 'vendas', nome: 'Vendas', papeis: ['administrador', 'gerente'] },
]

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
      .select('id, nome, papel, empresa:empresas(id, razao_social, nome_fantasia, segmento)')
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
  const telas = TELAS.filter((t) => t.papeis.includes(perfil.papel))
  const [tela, setTela] = useState(() => {
    try { return localStorage.getItem('tela') || 'pdv' } catch { return 'pdv' }
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
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <strong className="text-marca-600">PDV Comercial</strong>
        <nav className="flex gap-1 overflow-x-auto">
          {telas.map((t) => (
            <button
              key={t.id}
              onClick={() => ir(t.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${tela === t.id ? 'bg-marca-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            >
              {t.nome}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden text-slate-500 md:inline">{perfil.empresa.nome_fantasia || perfil.empresa.razao_social} · {perfil.nome}</span>
          <button onClick={alternarTema} className="rounded p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800" title="Alternar tema">{escuro ? '☀️' : '🌙'}</button>
          <Botao variante="secundario" onClick={() => supabase.auth.signOut()}>Sair</Botao>
        </div>
      </header>
      <main className="flex-1 p-4">
        {tela === 'pdv' && <PDV />}
        {tela === 'caixa' && <Caixa />}
        {tela === 'produtos' && <Produtos />}
        {tela === 'vendas' && perfil.papel !== 'operador' && <Vendas />}
      </main>
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
    <Centro>
      <form onSubmit={entrar} className="cartao w-full max-w-sm space-y-4 p-6">
        <h1 className="text-xl font-bold text-marca-600">PDV Comercial</h1>
        <Campo rotulo="E-mail"><input className="campo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Campo>
        <Campo rotulo="Senha"><input className="campo" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></Campo>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <Botao type="submit" className="w-full" carregando={carregando}>Entrar</Botao>
      </form>
    </Centro>
  )
}

const Centro = ({ children }) => <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">{children}</div>
const Carregando = () => <Centro><p className="text-sm text-slate-500">Carregando…</p></Centro>
const NaoConfigurado = () => (
  <Centro>
    <div className="cartao max-w-md p-6 text-sm">
      <h1 className="mb-2 text-lg font-bold">Sistema não configurado</h1>
      <p>Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para conectar ao banco de dados.</p>
    </div>
  </Centro>
)
