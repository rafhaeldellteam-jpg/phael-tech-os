import { resetSchema, signUpSchema } from './schemas'

describe('signUpSchema', () => {
  const base = { fullName: 'Rafhael', email: 'r@exemplo.com', password: 'senhaForte123', confirm: 'senhaForte123' }
  it('aceita dados válidos', () => expect(signUpSchema.safeParse(base).success).toBe(true))
  it('exige senha com 10+ caracteres', () =>
    expect(signUpSchema.safeParse({ ...base, password: 'abc123', confirm: 'abc123' }).success).toBe(false))
  it('exige letras e números', () =>
    expect(signUpSchema.safeParse({ ...base, password: 'somenteletras', confirm: 'somenteletras' }).success).toBe(false))
  it('exige confirmação igual', () => {
    const r = signUpSchema.safeParse({ ...base, confirm: 'outraSenha123' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['confirm'])
  })
})

describe('resetSchema', () => {
  it('aceita nova senha válida', () =>
    expect(resetSchema.safeParse({ password: 'novaSenha2026', confirm: 'novaSenha2026' }).success).toBe(true))
})
