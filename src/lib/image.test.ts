import { describe, expect, it } from 'vitest'
import { fitWithin } from './image'

describe('fitWithin', () => {
  it('mantém imagens pequenas', () => expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 }))
  it('reduz pelo maior lado, mantendo a proporção', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
  })
})
