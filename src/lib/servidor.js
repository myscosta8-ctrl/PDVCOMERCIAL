import { supabase } from './supabase.js'

// Chama uma função do servidor (Edge Function). Retorna { dados } ou { erro }.
export async function chamarFuncao(nome, corpo) {
  const { data, error } = await supabase.functions.invoke(nome, { body: corpo })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).erro || msg } catch { /* sem corpo */ }
    return { erro: msg }
  }
  if (data?.erro) return { erro: data.erro }
  return { dados: data }
}
