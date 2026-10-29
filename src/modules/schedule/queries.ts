import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { AppointmentKind, AppointmentStatus } from '@/lib/database.types'
import { requireSupabase } from '@/lib/supabase'

export const kindLabels: Record<AppointmentKind, string> = {
  onsite: 'Visita técnica',
  remote: 'Atendimento remoto',
  dropoff: 'Cliente traz equipamento',
  pickup: 'Retirada/entrega de equipamento',
  other: 'Outro',
}

export const statusLabels: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  done: 'Realizado',
  no_show: 'Não compareceu',
  canceled: 'Cancelado',
}

export const statusTone: Record<AppointmentStatus, 'neutral' | 'ok' | 'attn' | 'danger'> = {
  scheduled: 'neutral',
  confirmed: 'ok',
  done: 'ok',
  no_show: 'attn',
  canceled: 'danger',
}

/** Próximas situações possíveis (espelha set_appointment_status). */
export function nextAppointmentStatuses(s: AppointmentStatus): AppointmentStatus[] {
  if (s === 'scheduled') return ['confirmed', 'done', 'no_show', 'canceled']
  if (s === 'confirmed') return ['done', 'no_show', 'canceled']
  if (s === 'canceled' || s === 'no_show') return ['scheduled']
  return []
}

export const scheduleKeys = {
  all: (companyId: string) => ['schedule', companyId] as const,
  range: (companyId: string, from: string, to: string, who: string) => ['schedule', companyId, 'range', from, to, who] as const,
  today: (companyId: string) => ['schedule', companyId, 'today'] as const,
}

export interface AppointmentRow {
  id: string
  number: number
  kind: AppointmentKind
  title: string
  notes: string | null
  client_id: string
  equipment_id: string | null
  order_id: string | null
  assigned_to: string | null
  starts_at: string
  ends_at: string
  location: string | null
  status: AppointmentStatus
  status_reason: string | null
  client: { id: string; code: number; name: string; whatsapp: string | null; phone: string | null } | null
  equipment: { id: string; manufacturer: string | null; model: string | null; type: string } | null
  order: { id: string; number: number } | null
}

const columns =
  'id, number, kind, title, notes, client_id, equipment_id, order_id, assigned_to, starts_at, ends_at, location, status, status_reason, client:clients(id, code, name, whatsapp, phone), equipment:equipment(id, manufacturer, model, type), order:service_orders(id, number)'

/** Agendamentos que começam no intervalo [from, to). `who`: '' todos, 'none' sem responsável, ou id do membro. */
export function useAppointments(companyId: string, from: Date, to: Date, who: string) {
  const f = from.toISOString()
  const t = to.toISOString()
  return useQuery({
    queryKey: scheduleKeys.range(companyId, f, t, who),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = requireSupabase()
        .from('appointments')
        .select(columns)
        .eq('company_id', companyId)
        .gte('starts_at', f)
        .lt('starts_at', t)
        .order('starts_at')
        .limit(500)
      if (who === 'none') q = q.is('assigned_to', null)
      else if (who) q = q.eq('assigned_to', who)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as AppointmentRow[]
    },
  })
}

export function useAppointmentsToday(companyId: string, enabled: boolean) {
  return useQuery({
    queryKey: scheduleKeys.today(companyId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('appointments_today', { p_company_id: companyId })
      if (error) throw error
      return data?.[0] ?? { total: 0, mine: 0, next_starts_at: null }
    },
  })
}
