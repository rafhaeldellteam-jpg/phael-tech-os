import { parseEnv } from './env'

describe('parseEnv', () => {
  it('aceita configuração válida', () => {
    const r = parseEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'x'.repeat(40) })
    expect(r.ok).toBe(true)
  })
  it('lista os problemas quando faltam variáveis', () => {
    const r = parseEnv({})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.length).toBe(2)
  })
  it('rejeita URL inválida', () => {
    const r = parseEnv({ VITE_SUPABASE_URL: 'nao-e-url', VITE_SUPABASE_ANON_KEY: 'x'.repeat(40) })
    expect(r.ok).toBe(false)
  })
})
