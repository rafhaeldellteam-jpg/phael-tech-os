import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { envResult } from './env'

export type TypedSupabaseClient = SupabaseClient<Database>

/**
 * Cliente único do Supabase. Usa apenas a chave pública (anon/publishable):
 * toda a autorização é feita pelo banco (RLS + RPCs).
 * Fica null quando o ambiente não está configurado — a UI mostra instruções.
 */
export const supabase: TypedSupabaseClient | null = envResult.ok
  ? createClient<Database>(envResult.env.VITE_SUPABASE_URL, envResult.env.VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

export function requireSupabase(): TypedSupabaseClient {
  if (!supabase) throw new Error('Supabase não configurado. Veja o arquivo .env.example.')
  return supabase
}
