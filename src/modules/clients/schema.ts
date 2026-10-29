import { z } from 'zod'
import { isValidTaxId, onlyDigits } from '@/lib/tax-id'

const optionalText = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres`)

const phone = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{10,13}$/.test(onlyDigits(v)), 'Telefone com DDD, ex.: (11) 98765-4321')

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const

export const clientSchema = z
  .object({
    kind: z.enum(['person', 'company']),
    name: z.string().trim().min(2, 'Informe o nome').max(160, 'Máximo de 160 caracteres'),
    tradeName: optionalText(160),
    taxId: z.string().trim(),
    email: z.union([z.literal(''), z.email({ message: 'E-mail inválido' })]),
    phone,
    whatsapp: phone,
    preferredChannel: z.enum(['', 'whatsapp', 'phone', 'email']),
    zipCode: z
      .string()
      .trim()
      .refine((v) => v === '' || onlyDigits(v).length === 8, 'CEP com 8 dígitos'),
    street: optionalText(160),
    streetNumber: optionalText(20),
    complement: optionalText(80),
    district: optionalText(80),
    city: optionalText(80),
    state: z.union([z.literal(''), z.enum(UFS)]),
    marketingConsent: z.boolean(),
    internalNotes: optionalText(4000),
  })
  .superRefine((v, ctx) => {
    if (v.taxId === '') return
    const digits = onlyDigits(v.taxId)
    if (!isValidTaxId(digits)) {
      ctx.addIssue({ code: 'custom', path: ['taxId'], message: v.kind === 'person' ? 'CPF inválido' : 'CNPJ inválido' })
    } else if (v.kind === 'person' && digits.length !== 11) {
      ctx.addIssue({ code: 'custom', path: ['taxId'], message: 'Pessoa física usa CPF (11 dígitos)' })
    } else if (v.kind === 'company' && digits.length !== 14) {
      ctx.addIssue({ code: 'custom', path: ['taxId'], message: 'Pessoa jurídica usa CNPJ (14 dígitos)' })
    }
    if (v.preferredChannel === 'whatsapp' && !v.whatsapp)
      ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Informe o WhatsApp, que é o canal preferido' })
    if (v.preferredChannel === 'email' && !v.email)
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'Informe o e-mail, que é o canal preferido' })
    if (v.preferredChannel === 'phone' && !v.phone)
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Informe o telefone, que é o canal preferido' })
  })

export type ClientFormValues = z.infer<typeof clientSchema>

export const emptyClient: ClientFormValues = {
  kind: 'person',
  name: '',
  tradeName: '',
  taxId: '',
  email: '',
  phone: '',
  whatsapp: '',
  preferredChannel: '',
  zipCode: '',
  street: '',
  streetNumber: '',
  complement: '',
  district: '',
  city: '',
  state: '',
  marketingConsent: false,
  internalNotes: '',
}

/**
 * Monta o payload do RPC save_client.
 * - taxId só é enviado se foi digitado (ou alterado por quem vê dados sensíveis);
 * - internalNotes só é enviado por quem tem clients.read_sensitive.
 */
export function toSavePayload(
  v: ClientFormValues,
  opts: { canSensitive: boolean; taxIdTouched: boolean },
): { data: Record<string, unknown>; sensitive: Record<string, unknown> } {
  const data = {
    kind: v.kind,
    name: v.name,
    trade_name: v.kind === 'company' ? v.tradeName : '',
    email: v.email,
    phone: v.phone,
    whatsapp: v.whatsapp,
    preferred_channel: v.preferredChannel,
    zip_code: v.zipCode,
    street: v.street,
    street_number: v.streetNumber,
    complement: v.complement,
    district: v.district,
    city: v.city,
    state: v.state,
    marketing_consent: v.marketingConsent,
  }
  const sensitive: Record<string, unknown> = {}
  if (opts.taxIdTouched) sensitive.tax_id = onlyDigits(v.taxId)
  if (opts.canSensitive) sensitive.internal_notes = v.internalNotes
  return { data, sensitive }
}
