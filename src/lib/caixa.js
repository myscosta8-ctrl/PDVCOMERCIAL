import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

export function terminalAtual() {
  try { return Number(localStorage.getItem('terminal')) || 1 } catch { return 1 }
}
export function definirTerminal(n) {
  try { localStorage.setItem('terminal', String(n)) } catch {}
}

// Caixa aberto do terminal deste computador
export function useCaixaAberto() {
  const [caixa, setCaixa] = useState(undefined)
  const recarregar = useCallback(async () => {
    const { data, error } = await supabase
      .from('caixas')
      .select('*')
      .eq('numero_terminal', terminalAtual())
      .eq('status', 'aberto')
      .maybeSingle()
    setCaixa(error ? null : data)
  }, [])
  useEffect(() => { recarregar() }, [recarregar])
  return { caixa, recarregar }
}
