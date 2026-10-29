/** Remove tudo que não for dígito. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}

function checkDigitsCpf(d: number[]): boolean {
  const calc = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += (d[i] ?? 0) * (len + 1 - i)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(9) === d[9] && calc(10) === d[10]
}

function checkDigitsCnpj(d: number[]): boolean {
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const w2 = [6, ...w1]
  const calc = (weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + w * (d[i] ?? 0), 0)
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(w1) === d[12] && calc(w2) === d[13]
}

/**
 * Valida CPF (11 dígitos) ou CNPJ (14 dígitos).
 * Mesma regra de private.is_valid_tax_id no banco (que é a validação definitiva).
 */
export function isValidTaxId(value: string): boolean {
  const digits = onlyDigits(value)
  if (digits.length !== 11 && digits.length !== 14) return false
  if (/^(\d)\1+$/.test(digits)) return false
  const d = [...digits].map(Number)
  return digits.length === 11 ? checkDigitsCpf(d) : checkDigitsCnpj(d)
}

export function formatTaxId(value: string): string {
  const d = onlyDigits(value)
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return value
}
