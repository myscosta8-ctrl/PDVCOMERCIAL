import { createContext, useContext, useEffect, useRef, useState } from 'react'

// =====================================================================
// Padrão visual único do sistema. Toda tela usa estes componentes:
//  - Botao: mesmas cores e ordem (Cancelar à esquerda, ação principal à direita)
//  - TelaSuspensa: toda inclusão/edição/confirmação abre aqui
//  - Lista: lista de escolha própria (nunca o <select> nativo do navegador)
//  - Cabecalho, Indicador, Etiqueta, Vazio: estrutura das páginas
// =====================================================================

const estilos = {
  primario: 'bg-caixa-600 text-white hover:bg-caixa-700',
  secundario: 'border border-papel-300 bg-white text-tinta hover:bg-papel dark:border-noite-600 dark:bg-noite-700 dark:text-papel dark:hover:bg-noite-600',
  perigo: 'bg-rubro-600 text-white hover:brightness-110',
  sucesso: 'bg-caixa-600 text-white hover:bg-caixa-700',
  discreto: 'text-tinta-600 hover:bg-papel-200 dark:text-tinta-300 dark:hover:bg-noite-700',
}

export function Botao({ variante = 'primario', className = '', carregando, icone, children, ...p }) {
  return (
    <button
      {...p}
      disabled={p.disabled || carregando}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[0.95rem] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${estilos[variante]} ${className}`}
    >
      {icone && !carregando && <Icone nome={icone} className="h-4 w-4" />}
      {carregando ? 'Aguarde…' : children}
    </button>
  )
}

export function TelaSuspensa({ aberta, titulo, subtitulo, onFechar, children, rodape, largura = 'max-w-lg' }) {
  useEffect(() => {
    if (!aberta) return
    const tecla = (e) => e.key === 'Escape' && onFechar?.()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aberta, onFechar])
  if (!aberta) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-tinta/60 p-4 backdrop-blur-[2px]" onMouseDown={onFechar}>
      <div role="dialog" aria-modal="true" className={`w-full ${largura} max-h-[90vh] overflow-auto rounded-2xl bg-white shadow-cupom dark:bg-noite-800`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-papel-200 px-6 py-4 dark:border-noite-700">
          <div>
            <h2 className="text-lg font-semibold">{titulo}</h2>
            {subtitulo && <p className="text-sm text-tinta-400">{subtitulo}</p>}
          </div>
          <button onClick={onFechar} className="rounded-lg p-1.5 text-tinta-400 hover:bg-papel-200 dark:hover:bg-noite-700" aria-label="Fechar">
            <Icone nome="fechar" className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {rodape && <div className="flex justify-end gap-2 border-t border-papel-200 bg-papel/60 px-6 py-3 dark:border-noite-700 dark:bg-noite/40">{rodape}</div>}
      </div>
    </div>
  )
}

export function Confirmacao({ aberta, titulo, mensagem, textoConfirmar = 'Confirmar', variante = 'primario', onConfirmar, onCancelar, carregando }) {
  return (
    <TelaSuspensa
      aberta={aberta}
      titulo={titulo}
      onFechar={onCancelar}
      rodape={<>
        <Botao variante="secundario" onClick={onCancelar}>Cancelar</Botao>
        <Botao variante={variante} onClick={onConfirmar} carregando={carregando}>{textoConfirmar}</Botao>
      </>}
    >
      <p className="text-[0.95rem] text-tinta-600 dark:text-tinta-300">{mensagem}</p>
    </TelaSuspensa>
  )
}

export function Campo({ rotulo, ajuda, children }) {
  return (
    <label className="block">
      <span className="rotulo">{rotulo}</span>
      {children}
      {ajuda && <span className="mt-1 block text-xs text-tinta-400">{ajuda}</span>}
    </label>
  )
}

// Lista de escolha própria: opcoes = [{ valor, texto }]
export function Lista({ valor, opcoes, onMudar, placeholder = 'Selecione…' }) {
  const [aberta, setAberta] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const fora = (e) => ref.current && !ref.current.contains(e.target) && setAberta(false)
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])
  const atual = opcoes.find((o) => o.valor === valor)
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="campo flex items-center justify-between text-left" onClick={() => setAberta((a) => !a)} aria-expanded={aberta}>
        <span className={atual ? '' : 'text-tinta-300'}>{atual?.texto ?? placeholder}</span>
        <Icone nome="seta-baixo" className="h-4 w-4 text-tinta-400" />
      </button>
      {aberta && (
        <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-papel-200 bg-white py-1 shadow-cupom dark:border-noite-600 dark:bg-noite-700">
          {opcoes.map((o) => (
            <li key={String(o.valor)}>
              <button
                type="button"
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-[0.95rem] hover:bg-caixa-50 dark:hover:bg-noite-600 ${o.valor === valor ? 'font-semibold text-caixa-600 dark:text-caixa-300' : ''}`}
                onClick={() => { onMudar(o.valor); setAberta(false) }}
              >
                {o.texto}
                {o.valor === valor && <Icone nome="ok" className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Cabeçalho de página: título, descrição e ações
export function Cabecalho({ titulo, descricao, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descricao && <p className="mt-0.5 text-[0.95rem] text-tinta-400 dark:text-tinta-300">{descricao}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}

// Indicador numérico com contexto (variação, observação)
export function Indicador({ titulo, valor, detalhe, tom = 'neutro', icone }) {
  const tons = {
    neutro: 'text-tinta dark:text-papel',
    positivo: 'text-caixa-600 dark:text-caixa-300',
    alerta: 'text-ambar-600 dark:text-ambar-300',
    critico: 'text-rubro-600 dark:text-rubro-300',
  }
  return (
    <div className="cartao p-4">
      <div className="flex items-center gap-2 text-[0.85rem] text-tinta-400 dark:text-tinta-300">
        {icone && <Icone nome={icone} className="h-4 w-4" />}
        {titulo}
      </div>
      <div className={`num mt-1 text-[1.9rem] font-semibold leading-tight ${tons[tom]}`}>{valor}</div>
      {detalhe && <div className="mt-0.5 text-[0.85rem] text-tinta-400 dark:text-tinta-300">{detalhe}</div>}
    </div>
  )
}

export function Etiqueta({ tom = 'neutro', children }) {
  const tons = {
    neutro: 'bg-papel-200 text-tinta-600 dark:bg-noite-700 dark:text-tinta-300',
    positivo: 'bg-caixa-50 text-caixa-700 dark:bg-caixa-700/30 dark:text-caixa-300',
    alerta: 'bg-ambar-50 text-ambar-600 dark:bg-ambar-600/20 dark:text-ambar-300',
    critico: 'bg-rubro-50 text-rubro-600 dark:bg-rubro-600/20 dark:text-rubro-300',
  }
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[0.8rem] font-medium ${tons[tom]}`}>{children}</span>
}

export function Vazio({ icone = 'caixa-vazia', titulo, texto, children }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-papel-200 p-3 text-tinta-400 dark:bg-noite-700"><Icone nome={icone} className="h-6 w-6" /></div>
      <p className="font-semibold">{titulo}</p>
      {texto && <p className="mt-1 max-w-sm text-sm text-tinta-400">{texto}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}

// Barra horizontal de proporção
export function Barra({ parte, total, tom = 'caixa' }) {
  const p = total > 0 ? Math.max(2, Math.round((parte / total) * 100)) : 0
  const cor = { caixa: 'bg-caixa-500', ambar: 'bg-ambar-600', tinta: 'bg-tinta-400' }[tom]
  return <div className="h-2 w-full rounded-full bg-papel-200 dark:bg-noite-700"><div className={`h-2 rounded-full ${cor}`} style={{ width: `${p}%` }} /></div>
}

// Ícones em traço (24x24)
const ICONES = {
  inicio: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  pdv: 'M4 5h16v10H4zM8 19h8M12 15v4M7 9h4',
  caixa: 'M3 8h18v12H3zM3 8l2-4h14l2 4M9 12h6',
  produtos: 'M4 7l8-4 8 4-8 4-8-4zM4 7v10l8 4 8-4V7M12 11v10',
  vendas: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  configuracoes: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  sair: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  sol: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  lua: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  fechar: 'M6 6l12 12M18 6L6 18',
  'seta-baixo': 'M6 9l6 6 6-6',
  ok: 'M5 12l5 5 9-10',
  busca: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  mais: 'M12 5v14M5 12h14',
  alerta: 'M12 3l10 18H2L12 3zM12 10v4M12 17v.5',
  nota: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  dinheiro: 'M3 7h18v10H3zM12 10a2 2 0 100 4 2 2 0 000-4zM6 10v4M18 10v4',
  relogio: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  'caixa-vazia': 'M3 9l3-5h12l3 5M3 9v10h18V9M3 9h6l1 2h4l1-2h6',
  usuario: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  estoque: 'M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10',
  impressora: 'M7 8V3h10v5M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  lixo: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
}

export function Icone({ nome, className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONES[nome] ?? ''} />
    </svg>
  )
}

// Avisos rápidos
const AvisoCtx = createContext(() => {})
export const useAviso = () => useContext(AvisoCtx)

export function ProvedorAviso({ children }) {
  const [avisos, setAvisos] = useState([])
  const avisar = (texto, tipo = 'sucesso') => {
    const id = crypto.randomUUID()
    setAvisos((a) => [...a, { id, texto, tipo }])
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 5000)
  }
  return (
    <AvisoCtx.Provider value={avisar}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] w-80 space-y-2" role="status">
        {avisos.map((a) => (
          <div key={a.id} className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-cupom ${a.tipo === 'erro' ? 'bg-rubro-600' : 'bg-tinta'}`}>
            <Icone nome={a.tipo === 'erro' ? 'alerta' : 'ok'} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{a.texto}</span>
          </div>
        ))}
      </div>
    </AvisoCtx.Provider>
  )
}
