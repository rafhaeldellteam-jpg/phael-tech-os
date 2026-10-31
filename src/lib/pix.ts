/**
 * Pix "copia e cola" estático (BR Code, padrão EMV do Banco Central).
 * Campos: 00 formato, 26 conta (GUI br.gov.bcb.pix + chave + descrição),
 * 52 categoria, 53 moeda (986 = BRL), 54 valor, 58 país, 59 nome, 60 cidade,
 * 62 txid, 63 CRC16-CCITT (polinômio 0x1021, início 0xFFFF).
 */

export type PixKeyType = 'phone' | 'email' | 'cpf' | 'cnpj' | 'random'

/** Remove acentos e caracteres fora do conjunto aceito pelos bancos. */
export function pixText(value: string, max: number): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,\-/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Normaliza a chave no formato que o Pix espera. Retorna null se inválida. */
export function normalizePixKey(type: PixKeyType, raw: string): string | null {
  const v = raw.trim()
  const digits = v.replace(/\D/g, '')
  switch (type) {
    case 'phone': {
      const d = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits
      return /^\d{10,11}$/.test(d) ? `+55${d}` : null
    }
    case 'email':
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 77 ? v.toLowerCase() : null
    case 'cpf':
      return digits.length === 11 ? digits : null
    case 'cnpj':
      return digits.length === 14 ? digits : null
    case 'random':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null
  }
}

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`

export function crc16(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export interface PixInput {
  key: string
  name: string
  city: string
  /** Valor em centavos; omitido = o pagador digita o valor. */
  amountCents?: number | null
  /** Identificador (até 25 letras/números). Padrão "***". */
  txid?: string | null
  description?: string | null
}

export function buildPixPayload(p: PixInput): string {
  const desc = p.description ? pixText(p.description, 40) : ''
  const account = field('00', 'br.gov.bcb.pix') + field('01', p.key) + (desc ? field('02', desc) : '')
  const txid = (p.txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'
  let s =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    (p.amountCents && p.amountCents > 0 ? field('54', (p.amountCents / 100).toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', pixText(p.name, 25) || 'RECEBEDOR') +
    field('60', pixText(p.city, 15) || 'BRASIL') +
    field('62', field('05', txid))
  s += '6304'
  return s + crc16(s)
}
