import { describe, expect, it } from 'vitest'
import { addDays, fromLocalInput, minutesBetween, nextFullHour, sameDay, startOfWeek, toLocalInput } from './dates'

describe('datas da agenda', () => {
  it('semana começa na segunda', () => {
    // 29/10/2026 é quinta-feira
    const monday = startOfWeek(new Date(2026, 9, 29, 15, 30))
    expect(monday.getDay()).toBe(1)
    expect(monday.getDate()).toBe(26)
    expect(monday.getHours()).toBe(0)
    // domingo pertence à semana que começou na segunda anterior
    expect(startOfWeek(new Date(2026, 10, 1)).getDate()).toBe(26)
    expect(startOfWeek(new Date(2026, 10, 2)).getDate()).toBe(2)
  })

  it('soma dias atravessando o mês', () => {
    const d = addDays(new Date(2026, 9, 30), 3)
    expect(d.getMonth()).toBe(10)
    expect(d.getDate()).toBe(2)
    expect(sameDay(d, new Date(2026, 10, 2, 23, 59))).toBe(true)
  })

  it('converte datetime-local nos dois sentidos, no horário local', () => {
    const d = new Date(2026, 10, 3, 9, 5)
    expect(toLocalInput(d)).toBe('2026-11-03T09:05')
    expect(fromLocalInput('2026-11-03T09:05')?.getTime()).toBe(d.getTime())
    expect(fromLocalInput('2026-02-30T10:00')).toBeNull()
    expect(fromLocalInput('')).toBeNull()
  })

  it('sugere o próximo horário cheio', () => {
    const d = nextFullHour(new Date(2026, 9, 29, 14, 20))
    expect(d.getHours()).toBe(15)
    expect(d.getMinutes()).toBe(0)
  })

  it('calcula duração em minutos', () => {
    expect(minutesBetween(new Date(2026, 0, 1, 9), new Date(2026, 0, 1, 10, 30))).toBe(90)
  })
})
