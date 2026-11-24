import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { chamarNfce } from '../lib/nfce.js'
import { Icone, useAviso } from './ui.jsx'

const INTERVALO = 5 * 60 * 1000

// Mostra as NFC-e em contingência ou sem resposta e transmite sozinho quando há conexão.
export function NfcePendentes({ ativa, irPara, podeAbrir }) {
  const avisar = useAviso()
  const [qtd, setQtd] = useState(0)
  const [enviando, setEnviando] = useState(false)
  const ocupado = useRef(false)

  useEffect(() => {
    if (!ativa) return
    let vivo = true
    const contar = async () => {
      const { count } = await supabase.from('nfce_documentos').select('id', { count: 'exact', head: true }).in('status', ['contingencia', 'pendente'])
      if (vivo) setQtd(count ?? 0)
      return count ?? 0
    }
    const ciclo = async () => {
      if (ocupado.current) return
      const n = await contar()
      if (!n || !navigator.onLine) return
      ocupado.current = true; setEnviando(true)
      const r = await chamarNfce({ acao: 'transmitir' })
      ocupado.current = false
      if (!vivo) return
      setEnviando(false)
      if (!r.erro && r.dados.autorizadas > 0) avisar(`${r.dados.autorizadas} NFC-e em contingência autorizada(s) pela SEFAZ.`)
      for (const m of r.dados?.mensagens ?? []) avisar(m, 'erro')
      contar()
    }
    ciclo()
    const t = setInterval(ciclo, INTERVALO)
    window.addEventListener('online', ciclo)
    window.addEventListener('nfce:atualizar', ciclo)
    return () => { vivo = false; clearInterval(t); window.removeEventListener('online', ciclo); window.removeEventListener('nfce:atualizar', ciclo) }
  }, [ativa]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!qtd) return null
  return (
    <button onClick={() => podeAbrir && irPara('fiscal')} disabled={!podeAbrir}
      className="flex items-center gap-2 rounded-lg px-2 py-1 font-medium text-ambar-600 hover:bg-papel-100 disabled:hover:bg-transparent dark:text-ambar-300 dark:hover:bg-noite-700"
      title="NFC-e emitidas sem a SEFAZ. São transmitidas sozinhas quando a conexão volta (prazo de 24 horas).">
      <Icone nome="alerta" className="h-4 w-4" />
      {enviando ? 'Transmitindo NFC-e…' : `${qtd} NFC-e aguardando a SEFAZ`}
    </button>
  )
}
