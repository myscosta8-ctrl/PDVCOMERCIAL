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
  { id: 'inicio', grupo: 'vender', nome: 'Início', icone: 'inicio', papeis: ['administrador', 'gerente'] },
  { id: 'pdv', grupo: 'vender', nome: 'Frente de caixa', icone: 'pdv', papeis: ['administrador', 'gerente', 'operador'] },
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
  { id: 'fiscal', grupo: 'gestao', nome: 'Fiscal', icone: 'nota', papeis: ['administrador', 'gerente'] },
  { id: 'vendas', grupo: 'gestao', nome: 'Vendas', icone: 'vendas', papeis: ['administrador', 'gerente'] },
  { id: 'configuracoes', grupo: 'sistema', nome: 'Configurações', icone: 'configuracoes', papeis: ['administrador'] },
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
        <main className="fundo-trabalho flex-1 p-4 md:p-8">
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
          {tela === 'vendas' && perfil.papel !== 'operador' && <Vendas irPara={ir} />}
          {tela === 'notas' && perfil.papel !== 'operador' && <NotasFiscais />}
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
            <h1 className="num text-[2rem] font-bold leading-none tracking-tight">Entrar</h1>
            <p className="mt-2 text-tinta-400">Use o e-mail e a senha cadastrados pelo administrador.</p>
          </div>
          <Campo rotulo="E-mail"><input className="campo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Campo>
          <Campo rotulo="Senha"><input className="campo" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></Campo>
          {erro && <p className="rounded-xl bg-rubro-50 px-3 py-2 text-sm text-rubro-600">{erro}</p>}
          <Botao type="submit" className="w-full py-3" carregando={carregando}>Entrar</Botao>
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
