/** Datas da agenda no horário local do navegador. */

/** Segunda-feira 00:00 da semana que contém `d`. */
export function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (r.getDay() + 6) % 7 // 0 = segunda
  r.setDate(r.getDate() - dow)
  return r
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Valor para <input type="datetime-local"> (sem fuso). */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Lê o valor de <input type="datetime-local"> como horário local. Retorna null se inválido. */
export function fromLocalInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v)
  if (!m) return null
  const [, y, mo, da, h, mi] = m.map(Number) as [number, number, number, number, number, number]
  const d = new Date(y, mo - 1, da, h, mi)
  return d.getMonth() === mo - 1 && d.getDate() === da ? d : null
}

/** Próximo horário cheio a partir de agora (sugestão de início). */
export function nextFullHour(now = new Date()): Date {
  const d = new Date(now)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
const longDayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

export const formatTime = (iso: string | Date) => timeFmt.format(typeof iso === 'string' ? new Date(iso) : iso)
export const formatDayShort = (d: Date) => dayFmt.format(d)
export const formatDayLong = (d: Date) => longDayFmt.format(d)

/** Duração em minutos entre dois instantes. */
export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000)
}
