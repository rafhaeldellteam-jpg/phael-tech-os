import { onlyDigits } from './tax-id'

/** (11) 98765-4321 / (11) 3456-7890. Valores fora do padrão voltam como vieram. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return ''
  const d = onlyDigits(value)
  const local = d.length > 11 && d.startsWith('55') ? d.slice(2) : d
  if (local.length === 11) return local.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  if (local.length === 10) return local.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  return value
}

export function formatZip(value: string | null | undefined): string {
  if (!value) return ''
  const d = onlyDigits(value)
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : value
}

/** Link para conversa no WhatsApp (formato internacional, Brasil por padrão). */
export function whatsappLink(value: string): string {
  const d = onlyDigits(value)
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`
}

/** Código legível: CL-0001, EQ-0042. */
export function formatCode(prefix: string, code: number): string {
  return `${prefix}-${String(code).padStart(4, '0')}`
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
export const formatDate = (iso: string) => dateFmt.format(new Date(iso))
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso))
