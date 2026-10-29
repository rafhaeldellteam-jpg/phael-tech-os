import { centsToInput, formatBRL, marginPercent, parseMoney, sumCents } from './money'

describe('parseMoney', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['1234.56', 123456],
    ['1,234.56', 123456],
    ['R$ 10', 1000],
    ['10,5', 1050],
    ['0,99', 99],
    ['1.000', 100000],
    ['350', 35000],
    ['-12,30', -1230],
  ])('%s → %i centavos', (input, cents) => expect(parseMoney(input)).toBe(cents))

  it.each(['', 'abc', '1,2,3,4', '12.34.5', '1.23456,00'])('rejeita %s', (input) => expect(parseMoney(input)).toBeNull())
})

describe('formatação', () => {
  it('formatBRL usa padrão brasileiro', () => expect(formatBRL(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56'))
  it('formatBRL de nulo', () => expect(formatBRL(null)).toBe('—'))
  it('centsToInput', () => {
    expect(centsToInput(123456)).toBe('1234,56')
    expect(centsToInput(5)).toBe('0,05')
    expect(centsToInput(-150)).toBe('-1,50')
  })
  it('ida e volta sem perda', () => {
    for (const c of [0, 1, 99, 100, 123456, 999999999]) expect(parseMoney(centsToInput(c))).toBe(c)
  })
})

describe('cálculos', () => {
  it('soma sem erro de ponto flutuante (0,1 + 0,2)', () => expect(sumCents([10, 20])).toBe(30))
  it('margem percentual', () => expect(marginPercent(53000, 9000)).toBe(83))
  it('margem sem receita', () => expect(marginPercent(0, 100)).toBeNull())
})
