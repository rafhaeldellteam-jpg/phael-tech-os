import { z } from 'zod'
import { parseMoney } from './money'

/** Campo de valor em reais digitado como texto; valida e aceita vazio = 0. */
export const moneyField = (label = 'Valor') =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (parseMoney(v) ?? -1) >= 0, `${label} inválido. Use, por exemplo, 150,00`)

export const moneyToCents = (v: string): number => (v.trim() === '' ? 0 : (parseMoney(v) ?? 0))
