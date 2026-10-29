/** Datas no formato YYYY-MM-DD no fuso local (sem conversão para UTC). */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export type PresetKey = 'this_month' | 'last_month' | 'last_90' | 'this_year'

export const presetLabels: Record<PresetKey, string> = {
  this_month: 'Este mês',
  last_month: 'Mês passado',
  last_90: 'Últimos 90 dias',
  this_year: 'Este ano',
}

export function presetRange(key: PresetKey, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear()
  const m = today.getMonth()
  switch (key) {
    case 'this_month':
      return { from: isoDate(new Date(y, m, 1)), to: isoDate(new Date(y, m + 1, 0)) }
    case 'last_month':
      return { from: isoDate(new Date(y, m - 1, 1)), to: isoDate(new Date(y, m, 0)) }
    case 'last_90':
      return { from: isoDate(new Date(y, m, today.getDate() - 89)), to: isoDate(today) }
    case 'this_year':
      return { from: isoDate(new Date(y, 0, 1)), to: isoDate(new Date(y, 11, 31)) }
  }
}

/** Dias entre duas datas ISO (inclusivo). */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`)
  const b = new Date(`${to}T12:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
}

export function formatIsoDate(d: string): string {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}
