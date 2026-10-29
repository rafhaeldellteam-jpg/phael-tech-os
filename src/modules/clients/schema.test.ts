import { clientSchema, emptyClient, toSavePayload } from './schema'

const valid = { ...emptyClient, name: 'Maria Souza' }

describe('clientSchema', () => {
  it('aceita o mínimo (só nome)', () => expect(clientSchema.safeParse(valid).success).toBe(true))
  it('valida CPF para pessoa física', () => {
    expect(clientSchema.safeParse({ ...valid, taxId: '529.982.247-25' }).success).toBe(true)
    expect(clientSchema.safeParse({ ...valid, taxId: '529.982.247-24' }).success).toBe(false)
  })
  it('pessoa física não aceita CNPJ', () => {
    const r = clientSchema.safeParse({ ...valid, taxId: '11.222.333/0001-81' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/CPF/)
  })
  it('pessoa jurídica exige CNPJ', () => {
    expect(clientSchema.safeParse({ ...valid, kind: 'company', taxId: '11222333000181' }).success).toBe(true)
    expect(clientSchema.safeParse({ ...valid, kind: 'company', taxId: '52998224725' }).success).toBe(false)
  })
  it('telefone precisa de DDD', () => {
    expect(clientSchema.safeParse({ ...valid, phone: '98765-4321' }).success).toBe(false)
    expect(clientSchema.safeParse({ ...valid, phone: '(11) 98765-4321' }).success).toBe(true)
  })
  it('canal preferido é verificado mesmo com CPF preenchido', () => {
    const r = clientSchema.safeParse({ ...valid, taxId: '529.982.247-25', preferredChannel: 'email' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['email'])
  })
  it('canal preferido exige o contato correspondente', () => {
    const r = clientSchema.safeParse({ ...valid, preferredChannel: 'whatsapp' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['whatsapp'])
  })
  it('CEP com 8 dígitos', () => {
    expect(clientSchema.safeParse({ ...valid, zipCode: '01310-100' }).success).toBe(true)
    expect(clientSchema.safeParse({ ...valid, zipCode: '0131' }).success).toBe(false)
  })
})

describe('toSavePayload', () => {
  const v = { ...valid, taxId: '529.982.247-25', internalNotes: 'nota', tradeName: 'ignorado' }
  it('não envia dados sensíveis sem permissão e sem alteração', () => {
    expect(toSavePayload(v, { canSensitive: false, taxIdTouched: false }).sensitive).toEqual({})
  })
  it('atendente envia CPF digitado, nunca as notas', () => {
    expect(toSavePayload(v, { canSensitive: false, taxIdTouched: true }).sensitive).toEqual({ tax_id: '52998224725' })
  })
  it('quem vê dados sensíveis envia as notas', () => {
    expect(toSavePayload(v, { canSensitive: true, taxIdTouched: false }).sensitive).toEqual({ internal_notes: 'nota' })
  })
  it('nome fantasia só para pessoa jurídica', () => {
    expect(toSavePayload(v, { canSensitive: false, taxIdTouched: false }).data.trade_name).toBe('')
  })
})
