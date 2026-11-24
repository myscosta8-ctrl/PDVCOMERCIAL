import { createClient } from '@supabase/supabase-js'

export const criarCliente = (url, chave) => createClient(url, chave)
