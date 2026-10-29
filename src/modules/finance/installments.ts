/** Divide em parcelas como o banco (diferença de centavos na 1ª) para pré-visualizar. */
export function previewInstallments(total: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || total < count) return []
  const base = Math.floor(total / count)
  return Array.from({ length: count }, (_, i) => (i === 0 ? total - base * (count - 1) : base))
}
