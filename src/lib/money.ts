/**
 * Dinheiro trafega e é calculado SEMPRE em centavos inteiros (number seguro até
 * 2^53, ~90 trilhões de reais). Conversões de texto só na borda da interface.
 */
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return brl.format(cents / 100)
}

/**
 * Converte o que a pessoa digitou em centavos.
 * Aceita "1.234,56", "1234,56", "1234.56", "R$ 10", "10,5". Retorna null se inválido.
 * Regra: o ÚLTIMO separador (vírgula ou ponto) seguido de 1–2 dígitos é o decimal;
 * os demais são separadores de milhar.
 */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[R$\s]/g, '')
  if (s === '') return null
  if (!/^-?[\d.,]+$/.test(s)) return null
  const negative = s.startsWith('-')
  const body = negative ? s.slice(1) : s
  const m = body.match(/^(.*?)[.,](\d{1,2})$/)
  const intPart = (m ? m[1] : body) ?? ''
  const decPart = m ? (m[2] ?? '') : ''
  if (/[.,]/.test(intPart) && !/^\d{1,3}([.,]\d{3})*$/.test(intPart)) return null
  const digits = intPart.replace(/[.,]/g, '')
  if (digits === '' && decPart === '') return null
  const cents = Number(digits || '0') * 100 + Number(decPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) return null
  return negative ? -cents : cents
}

/** Valor em centavos para o campo de texto do formulário ("1234,56"). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/** Soma em centavos sem erro de arredondamento. */
export function sumCents(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

/** Margem percentual com uma casa (null quando não há receita). */
export function marginPercent(revenueCents: number, costCents: number): number | null {
  if (revenueCents <= 0) return null
  return Math.round(((revenueCents - costCents) / revenueCents) * 1000) / 10
}
