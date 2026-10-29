import { formatTaxId, isValidTaxId, onlyDigits } from './tax-id'

describe('isValidTaxId', () => {
  it.each(['529.982.247-25', '52998224725', '111.444.777-35'])('aceita CPF válido %s', (v) => {
    expect(isValidTaxId(v)).toBe(true)
  })
  it.each(['11.222.333/0001-81', '11222333000181'])('aceita CNPJ válido %s', (v) => {
    expect(isValidTaxId(v)).toBe(true)
  })
  it.each([
    ['52998224724', 'dígito verificador errado'],
    ['11111111111', 'dígitos repetidos'],
    ['11222333000182', 'CNPJ com dígito errado'],
    ['123', 'tamanho errado'],
    ['', 'vazio'],
  ])('rejeita %s (%s)', (v) => {
    expect(isValidTaxId(v)).toBe(false)
  })
})

describe('formatação', () => {
  it('remove não dígitos', () => expect(onlyDigits('a1.2-3')).toBe('123'))
  it('formata CPF', () => expect(formatTaxId('52998224725')).toBe('529.982.247-25'))
  it('formata CNPJ', () => expect(formatTaxId('11222333000181')).toBe('11.222.333/0001-81'))
  it('mantém valor parcial', () => expect(formatTaxId('123')).toBe('123'))
})
