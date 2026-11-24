// Em modo de demonstração (npm run demo) este import é trocado por ./demo.js
import { criarCliente } from './cliente.js'

// Chave pública (pode ficar no navegador; a proteção dos dados é feita pelas regras do banco)
const url = import.meta.env.VITE_SUPABASE_URL || 'https://bqclntqioeoukapninmd.supabase.co'
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxY2xudHFpb2VvdWthcG5pbm1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1Mjc5MDIsImV4cCI6MjExMTEwMzkwMn0.KVZuMFK1yt61aKYjx2EJ-CUUpHKWpnfoth-4dbmbBwo'

export const configurado = Boolean(url && chave)
export const supabase = configurado ? criarCliente(url, chave) : null

// Converte mensagens do banco em texto para o usuário
export function mensagemErro(erro) {
  if (!erro) return ''
  const m = erro.message || String(erro)
  if (m.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (m.includes('Failed to fetch')) return 'Sem conexão com o servidor. Verifique a internet.'
  return m
}
