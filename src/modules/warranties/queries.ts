import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { WarrantyClaimStatus } from '@/lib/database.types'
import { requireSupabase } from '@/lib/supabase'
import type { WarrantyFilter } from './meta'

export const WARRANTY_PAGE_SIZE = 30

export const warrantyKeys = {
  all: (companyId: string) => ['warranties', companyId] as const,
  list: (companyId: string, f: { status: WarrantyFilter; q: string; page: number }) => ['warranties', companyId, 'list', f] as const,
  order: (companyId: string, orderId: string) => ['warranties', companyId, 'order', orderId] as const,
  claims: (companyId: string, f: { status: '' | 'pending' | WarrantyClaimStatus; page: number }) => ['warranties', companyId, 'claims', f] as const,
  orderClaims: (companyId: string, orderId: string) => ['warranties', companyId, 'order-claims', orderId] as const,
  stats: (companyId: string) => ['warranties', companyId, 'stats'] as const,
}

export function useWarranties(companyId: string, f: { status: WarrantyFilter; q: string; page: number }) {
  return useQuery({
    queryKey: warrantyKeys.list(companyId, f),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('list_warranties', {
        p_company_id: companyId,
        p_status: f.status,
        p_query: f.q.trim() || null,
        p_limit: WARRANTY_PAGE_SIZE,
        p_offset: f.page * WARRANTY_PAGE_SIZE,
      })
      if (error) throw error
      const rows = data ?? []
      return { rows, count: rows[0]?.total_count ?? 0 }
    },
  })
}

export function useOrderWarranties(companyId: string, orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: warrantyKeys.order(companyId, orderId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('list_warranties', {
        p_company_id: companyId,
        p_status: '',
        p_order_id: orderId,
        p_limit: 200,
      })
      if (error) throw error
      return data ?? []
    },
  })
}

const claimColumns =
  'id, number, status, reason, covered, expires_on, courtesy_reason, resolution, created_at, decided_at, original_order_id, return_order_id, ' +
  'original:service_orders!warranty_claims_company_id_original_order_id_fkey(number, client:clients(name)), ' +
  'returned:service_orders!warranty_claims_company_id_return_order_id_fkey(number, status), ' +
  'item:service_order_items(description)'

export interface ClaimRow {
  id: string
  number: number
  status: WarrantyClaimStatus
  reason: string
  covered: boolean
  expires_on: string | null
  courtesy_reason: string | null
  resolution: string | null
  created_at: string
  decided_at: string | null
  original_order_id: string
  return_order_id: string
  original: { number: number; client: { name: string } | null } | null
  returned: { number: number; status: string } | null
  item: { description: string } | null
}

export function useClaims(companyId: string, f: { status: '' | 'pending' | WarrantyClaimStatus; page: number }) {
  return useQuery({
    queryKey: warrantyKeys.claims(companyId, f),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = requireSupabase()
        .from('warranty_claims')
        .select(claimColumns, { count: 'exact' })
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .range(f.page * WARRANTY_PAGE_SIZE, f.page * WARRANTY_PAGE_SIZE + WARRANTY_PAGE_SIZE - 1)
      if (f.status === 'pending') q = q.in('status', ['open', 'accepted'])
      else if (f.status) q = q.eq('status', f.status)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: (data ?? []) as unknown as ClaimRow[], count: count ?? 0 }
    },
  })
}

/** Acionamentos em que a OS é a original ou o retorno. */
export function useOrderClaims(companyId: string, orderId: string) {
  return useQuery({
    queryKey: warrantyKeys.orderClaims(companyId, orderId),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('warranty_claims')
        .select(claimColumns)
        .eq('company_id', companyId)
        .or(`original_order_id.eq.${orderId},return_order_id.eq.${orderId}`)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ClaimRow[]
    },
  })
}

export function useWarrantyStats(companyId: string, enabled: boolean) {
  return useQuery({
    queryKey: warrantyKeys.stats(companyId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('warranty_stats', { p_company_id: companyId })
      if (error) throw error
      return data?.[0] ?? { active_items: 0, expiring_items: 0, open_claims: 0 }
    },
  })
}
