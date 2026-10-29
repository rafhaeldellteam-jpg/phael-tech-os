import type { WarrantyClaimStatus } from '@/lib/database.types'

export const claimStatusLabels: Record<WarrantyClaimStatus, string> = {
  open: 'Em análise',
  accepted: 'Aceita',
  denied: 'Negada',
  resolved: 'Resolvida',
}

export const claimStatusTone: Record<WarrantyClaimStatus, 'neutral' | 'ok' | 'attn' | 'danger'> = {
  open: 'attn',
  accepted: 'neutral',
  denied: 'danger',
  resolved: 'ok',
}

export type WarrantyFilter = 'active' | 'expiring' | 'expired' | ''

/** Texto curto para o prazo restante (dias calculados no banco, no fuso de São Paulo). */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    const ago = -daysLeft
    return ago === 1 ? 'venceu ontem' : `venceu há ${ago} dias`
  }
  if (daysLeft === 0) return 'vence hoje'
  if (daysLeft === 1) return 'vence amanhã'
  return `${daysLeft} dias restantes`
}

export function daysLeftTone(daysLeft: number): 'ok' | 'attn' | 'danger' {
  if (daysLeft < 0) return 'danger'
  if (daysLeft <= 15) return 'attn'
  return 'ok'
}

/** Próximas decisões possíveis a partir da situação atual (espelha decide_warranty_claim). */
export function nextClaimStatuses(status: WarrantyClaimStatus): WarrantyClaimStatus[] {
  if (status === 'open') return ['accepted', 'denied']
  if (status === 'accepted') return ['resolved']
  return []
}
