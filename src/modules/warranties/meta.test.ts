import { describe, expect, it } from 'vitest'
import { daysLeftLabel, daysLeftTone, nextClaimStatuses } from './meta'

describe('prazo de garantia', () => {
  it('descreve dias restantes e vencidos', () => {
    expect(daysLeftLabel(30)).toBe('30 dias restantes')
    expect(daysLeftLabel(1)).toBe('vence amanhã')
    expect(daysLeftLabel(0)).toBe('vence hoje')
    expect(daysLeftLabel(-1)).toBe('venceu ontem')
    expect(daysLeftLabel(-12)).toBe('venceu há 12 dias')
  })

  it('destaca o que vence em até 15 dias', () => {
    expect(daysLeftTone(16)).toBe('ok')
    expect(daysLeftTone(15)).toBe('attn')
    expect(daysLeftTone(0)).toBe('attn')
    expect(daysLeftTone(-1)).toBe('danger')
  })
})

describe('decisão de acionamento', () => {
  it('segue aberto -> aceito/negado -> resolvido', () => {
    expect(nextClaimStatuses('open')).toEqual(['accepted', 'denied'])
    expect(nextClaimStatuses('accepted')).toEqual(['resolved'])
    expect(nextClaimStatuses('denied')).toEqual([])
    expect(nextClaimStatuses('resolved')).toEqual([])
  })
})
