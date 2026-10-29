import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { OrderStage } from '@/lib/database.types'
import { requireSupabase } from '@/lib/supabase'
import { searchTerm } from '../clients/queries'
import type { StatusInfo, Transition } from './meta'

export const ORDER_PAGE_SIZE = 20

export interface OrderFilters {
  q: string
  stage: '' | 'active' | OrderStage
  status: string
  assigned: '' | 'me' | 'none' | string
  overdue: boolean
  page: number
}

export const orderKeys = {
  all: (companyId: string) => ['orders', companyId] as const,
  list: (companyId: string, f: OrderFilters) => ['orders', companyId, 'list', f] as const,
  detail: (companyId: string, id: string) => ['orders', companyId, 'detail', id] as const,
  events: (companyId: string, id: string) => ['orders', companyId, 'events', id] as const,
  byClient: (companyId: string, id: string) => ['orders', companyId, 'client', id] as const,
  byEquipment: (companyId: string, id: string) => ['orders', companyId, 'equipment', id] as const,
  stats: (companyId: string) => ['orders', companyId, 'stats'] as const,
  assignable: (companyId: string) => ['assignable', companyId] as const,
  workflow: ['order-workflow'] as const,
}

export function useWorkflow() {
  return useQuery({
    queryKey: orderKeys.workflow,
    staleTime: Infinity,
    queryFn: async () => {
      const sb = requireSupabase()
      const [s, t] = await Promise.all([
        sb.from('service_order_statuses').select('key, label, stage, sort, is_final').order('sort'),
        sb.from('service_order_transitions').select('from_status, to_status, requires_reason'),
      ])
      if (s.error) throw s.error
      if (t.error) throw t.error
      return { statuses: (s.data ?? []) as StatusInfo[], transitions: (t.data ?? []) as Transition[] }
    },
  })
}

export function useAssignable(companyId: string) {
  return useQuery({
    queryKey: orderKeys.assignable(companyId),
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('list_assignable_members', { p_company_id: companyId })
      if (error) throw error
      return data ?? []
    },
  })
}

const listColumns =
  'id, number, status, priority, mode, due_at, received_at, assigned_to, reported_problem, client:clients!inner(id, name), equipment:equipment(id, manufacturer, model, type)'

export function useOrderList(companyId: string, f: OrderFilters, userId: string, statuses: StatusInfo[] | undefined) {
  return useQuery({
    queryKey: orderKeys.list(companyId, f),
    enabled: Boolean(statuses),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = requireSupabase()
        .from('service_orders')
        .select(listColumns, { count: 'exact' })
        .eq('company_id', companyId)
        .order('received_at', { ascending: false })
        .range(f.page * ORDER_PAGE_SIZE, f.page * ORDER_PAGE_SIZE + ORDER_PAGE_SIZE - 1)

      const byStage = (pred: (s: StatusInfo) => boolean) => (statuses ?? []).filter(pred).map((s) => s.key)
      if (f.status) q = q.eq('status', f.status)
      else if (f.stage === 'active') q = q.in('status', byStage((s) => s.stage !== 'done' && s.stage !== 'stopped'))
      else if (f.stage) q = q.in('status', byStage((s) => s.stage === f.stage))

      if (f.assigned === 'me') q = q.eq('assigned_to', userId)
      else if (f.assigned === 'none') q = q.is('assigned_to', null)
      else if (f.assigned) q = q.eq('assigned_to', f.assigned)

      if (f.overdue) q = q.lt('due_at', new Date().toISOString())

      const raw = f.q.trim().replace(/^os\s*[#-]?\s*/i, '')
      if (/^\d+$/.test(raw)) q = q.eq('number', Number(raw))
      else {
        const term = searchTerm(f.q)
        if (term) q = q.ilike('client.search_text', `%${term}%`)
      }

      const { data, error, count } = await q
      if (error) throw error
      return { rows: data ?? [], count: count ?? 0 }
    },
  })
}

export function useOrder(companyId: string, id: string) {
  return useQuery({
    queryKey: orderKeys.detail(companyId, id),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('service_orders')
        .select(
          '*, client:clients!inner(id, code, name, whatsapp, phone, email), equipment:equipment(id, code, type, manufacturer, model, serial_number, accessories, condition_notes)',
        )
        .eq('company_id', companyId)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useOrderEvents(companyId: string, id: string) {
  return useQuery({
    queryKey: orderKeys.events(companyId, id),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('service_order_events')
        .select('id, kind, from_status, to_status, reason, note, assigned_to, actor_id, created_at')
        .eq('order_id', id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

const shortColumns = 'id, number, status, received_at, reported_problem, equipment:equipment(id, manufacturer, model, type)'

export function useClientOrders(companyId: string, clientId: string, enabled: boolean) {
  return useQuery({
    queryKey: orderKeys.byClient(companyId, clientId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('service_orders')
        .select(shortColumns)
        .eq('company_id', companyId)
        .eq('client_id', clientId)
        .order('received_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data ?? []
    },
  })
}

export function useEquipmentOrders(companyId: string, equipmentId: string, enabled: boolean) {
  return useQuery({
    queryKey: orderKeys.byEquipment(companyId, equipmentId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('service_orders')
        .select(shortColumns)
        .eq('company_id', companyId)
        .eq('equipment_id', equipmentId)
        .order('received_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data ?? []
    },
  })
}

export function useOrderStats(companyId: string, enabled: boolean) {
  return useQuery({
    queryKey: orderKeys.stats(companyId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('service_order_stats', { p_company_id: companyId })
      if (error) throw error
      return data ?? []
    },
  })
}
