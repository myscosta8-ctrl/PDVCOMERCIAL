import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configurado = Boolean(url && chave)
export const supabase = configurado ? createClient(url, chave) : null

// Converte mensagens do banco em texto para o usuário
export function mensagemErro(erro) {
  if (!erro) return ''
  const m = erro.message || String(erro)
  if (m.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (m.includes('Failed to fetch')) return 'Sem conexão com o servidor. Verifique a internet.'
  return m
}
