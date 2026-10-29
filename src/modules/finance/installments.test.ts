import { previewInstallments } from './installments'

describe('previewInstallments (igual a private.split_installments)', () => {
  it('R$ 100 em 3x', () => expect(previewInstallments(10000, 3)).toEqual([3334, 3333, 3333]))
  it('soma sempre o total', () => {
    for (const [t, n] of [[99999, 7], [1, 1], [12345, 12], [500000, 60]] as const) {
      expect(previewInstallments(t, n).reduce((a, b) => a + b, 0)).toBe(t)
    }
  })
  it('valor menor que o número de parcelas', () => expect(previewInstallments(2, 3)).toEqual([]))
})
