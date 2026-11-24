import { createContext, useContext, useEffect, useRef, useState } from 'react'

// =====================================================================
// Padrão visual único do sistema. Toda tela deve usar estes componentes:
//  - Botao: mesmas cores e ordem (Cancelar à esquerda, ação principal à direita)
//  - TelaSuspensa: toda inclusão/edição/confirmação abre aqui
//  - Lista: lista de escolha própria (nunca o <select> nativo do navegador)
// =====================================================================

const estilos = {
  primario: 'bg-marca-600 text-white hover:bg-marca-700',
  secundario: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
  perigo: 'bg-red-600 text-white hover:bg-red-700',
  sucesso: 'bg-emerald-600 text-white hover:bg-emerald-700',
}

export function Botao({ variante = 'primario', className = '', carregando, children, ...p }) {
  return (
    <button
      {...p}
      disabled={p.disabled || carregando}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${estilos[variante]} ${className}`}
    >
      {carregando ? 'Aguarde…' : children}
    </button>
  )
}

export function TelaSuspensa({ aberta, titulo, onFechar, children, rodape, largura = 'max-w-lg' }) {
  useEffect(() => {
    if (!aberta) return
    const tecla = (e) => e.key === 'Escape' && onFechar?.()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aberta, onFechar])
  if (!aberta) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onMouseDown={onFechar}>
      <div className={`cartao w-full ${largura} max-h-[90vh] overflow-auto`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="text-base font-bold">{titulo}</h2>
          <button onClick={onFechar} className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label="Fechar">✕</button>
        </div>
        <div className="p-5">{children}</div>
        {rodape && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">{rodape}</div>}
      </div>
    </div>
  )
}

// Confirmação padrão (substitui o confirm() do navegador)
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
      <p className="text-sm text-slate-600 dark:text-slate-300">{mensagem}</p>
    </TelaSuspensa>
  )
}

export function Campo({ rotulo, children }) {
  return (
    <label className="block">
      <span className="rotulo">{rotulo}</span>
      {children}
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
      <button type="button" className="campo flex items-center justify-between text-left" onClick={() => setAberta((a) => !a)}>
        <span className={atual ? '' : 'text-slate-400'}>{atual?.texto ?? placeholder}</span>
        <span className="text-slate-400">▾</span>
      </button>
      {aberta && (
        <ul className="cartao absolute z-50 mt-1 max-h-60 w-full overflow-auto py-1">
          {opcoes.map((o) => (
            <li key={o.valor}>
              <button
                type="button"
                className={`w-full px-3 py-2 text-left text-sm hover:bg-marca-50 dark:hover:bg-slate-800 ${o.valor === valor ? 'font-semibold text-marca-600' : ''}`}
                onClick={() => { onMudar(o.valor); setAberta(false) }}
              >
                {o.texto}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 4500)
  }
  return (
    <AvisoCtx.Provider value={avisar}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] space-y-2">
        {avisos.map((a) => (
          <div key={a.id} className={`rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${a.tipo === 'erro' ? 'bg-red-600' : 'bg-emerald-600'}`}>
            {a.texto}
          </div>
        ))}
      </div>
    </AvisoCtx.Provider>
  )
}
