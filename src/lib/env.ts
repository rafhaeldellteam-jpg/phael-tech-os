import { z } from 'zod'

const envSchema = z.object({
  VITE_SUPABASE_URL: z.url({ message: 'VITE_SUPABASE_URL deve ser uma URL válida' }),
  VITE_SUPABASE_ANON_KEY: z.string().min(20, 'VITE_SUPABASE_ANON_KEY ausente ou inválida'),
})

export type AppEnv = z.infer<typeof envSchema>

export type EnvResult = { ok: true; env: AppEnv } | { ok: false; problems: string[] }

/** Valida as variáveis públicas do frontend. Nunca inclui segredos de servidor. */
export function parseEnv(source: Record<string, unknown>): EnvResult {
  const result = envSchema.safeParse(source)
  if (result.success) return { ok: true, env: result.data }
  return { ok: false, problems: result.error.issues.map((i) => i.message) }
}

export const envResult = parseEnv(import.meta.env)
