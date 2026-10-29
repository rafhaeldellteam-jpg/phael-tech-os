import type { OrderPriority, OrderStage, ServiceMode } from '@/lib/database.types'

export const modeLabels: Record<ServiceMode, string> = {
  bench: 'Balcão (bancada)',
  remote: 'Atendimento remoto',
  onsite: 'Atendimento externo',
}

export const priorityLabels: Record<OrderPriority, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}

export const stageLabels: Record<OrderStage, string> = {
  open: 'Entrada',
  working: 'Em bancada',
  waiting: 'Aguardando',
  ready: 'Prontas',
  done: 'Concluídas',
  stopped: 'Sem reparo / canceladas',
}

/** Cor do selo de status por etapa (verde = pronto, laranja = depende de alguém). */
export const stageTone: Record<OrderStage, 'neutral' | 'ok' | 'attn' | 'danger'> = {
  open: 'neutral',
  working: 'neutral',
  waiting: 'attn',
  ready: 'ok',
  done: 'neutral',
  stopped: 'danger',
}

export interface StatusInfo {
  key: string
  label: string
  stage: OrderStage
  sort: number
  is_final: boolean
}

export interface Transition {
  from_status: string
  to_status: string
  requires_reason: boolean
}

export interface NextStatus {
  key: string
  label: string
  requiresReason: boolean
  /** Entrega/devolução: atendente pode registrar com orders.deliver. */
  handover: boolean
}

const HANDOVER: Array<[string[], string]> = [
  [['ready'], 'delivered'],
  [['quote_refused', 'unrepairable'], 'returned_unrepaired'],
]

export function isHandover(from: string, to: string): boolean {
  return HANDOVER.some(([froms, t]) => t === to && froms.includes(from))
}

/**
 * Próximos status que o usuário pode escolher. Espelha a regra do banco
 * (change_service_order_status), que continua sendo a palavra final.
 */
export function nextStatuses(
  current: string,
  transitions: Transition[],
  statuses: StatusInfo[],
  perms: { update: boolean; deliver: boolean },
): NextStatus[] {
  return transitions
    .filter((t) => t.from_status === current)
    .map((t) => {
      const info = statuses.find((s) => s.key === t.to_status)
      return {
        key: t.to_status,
        label: info?.label ?? t.to_status,
        requiresReason: t.requires_reason,
        handover: isHandover(current, t.to_status),
        sort: info?.sort ?? 0,
      }
    })
    .filter((n) => perms.update || (perms.deliver && n.handover))
    .sort((a, b) => a.sort - b.sort)
    .map((n) => ({ key: n.key, label: n.label, requiresReason: n.requiresReason, handover: n.handover }))
}

export function isOverdue(o: { due_at: string | null }, stage: OrderStage | undefined, now = new Date()): boolean {
  if (!o.due_at || !stage || stage === 'done' || stage === 'stopped') return false
  return new Date(o.due_at).getTime() < now.getTime()
}

/** Converte "2026-10-30T14:00" (input datetime-local) para ISO com fuso do navegador. */
export function localInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** ISO → valor para input datetime-local, no fuso do navegador. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
