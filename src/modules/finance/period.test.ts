import { daysBetween, formatIsoDate, presetRange } from './period'

describe('presetRange', () => {
  const today = new Date(2026, 9, 29) // 29/10/2026
  it('este mês', () => expect(presetRange('this_month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' }))
  it('mês passado', () => expect(presetRange('last_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' }))
  it('mês passado em janeiro volta o ano', () =>
    expect(presetRange('last_month', new Date(2026, 0, 15))).toEqual({ from: '2025-12-01', to: '2025-12-31' }))
  it('últimos 90 dias inclui hoje', () => {
    const r = presetRange('last_90', today)
    expect(r.to).toBe('2026-10-29')
    expect(daysBetween(r.from, r.to)).toBe(90)
  })
  it('este ano', () => expect(presetRange('this_year', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' }))
})

it('formata data ISO', () => expect(formatIsoDate('2026-01-05')).toBe('05/01/2026'))
