import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { requireSupabase } from '@/lib/supabase'
import { searchTerm } from '../clients/queries'

export const EQUIPMENT_PAGE_SIZE = 20

export interface EquipmentFilters {
  q: string
  type: string
  archived: boolean
  page: number
}

export const equipmentKeys = {
  all: (companyId: string) => ['equipment', companyId] as const,
  list: (companyId: string, f: EquipmentFilters) => ['equipment', companyId, 'list', f] as const,
  byClient: (companyId: string, clientId: string) => ['equipment', companyId, 'client', clientId] as const,
  detail: (companyId: string, id: string) => ['equipment', companyId, 'detail', id] as const,
  types: ['equipment-types'] as const,
}

const listColumns =
  'id, code, type, manufacturer, model, serial_number, asset_tag, archived_at, created_at, client:clients!inner(id, name)'

export function useEquipmentTypes() {
  return useQuery({
    queryKey: equipmentKeys.types,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('equipment_types').select('key, label').order('sort')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useEquipmentList(companyId: string, f: EquipmentFilters) {
  return useQuery({
    queryKey: equipmentKeys.list(companyId, f),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = requireSupabase()
        .from('equipment')
        .select(listColumns, { count: 'exact' })
        .eq('company_id', companyId)
        .order('code', { ascending: false })
        .range(f.page * EQUIPMENT_PAGE_SIZE, f.page * EQUIPMENT_PAGE_SIZE + EQUIPMENT_PAGE_SIZE - 1)
      q = f.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null)
      if (f.type) q = q.eq('type', f.type)
      const term = searchTerm(f.q)
      if (term) q = q.ilike('search_text', `%${term}%`)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data ?? [], count: count ?? 0 }
    },
  })
}

export function useClientEquipment(companyId: string, clientId: string, enabled: boolean) {
  return useQuery({
    queryKey: equipmentKeys.byClient(companyId, clientId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('equipment')
        .select(listColumns)
        .eq('company_id', companyId)
        .eq('client_id', clientId)
        .order('archived_at', { ascending: true, nullsFirst: true })
        .order('code', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useEquipment(companyId: string, id: string, enabled = true) {
  return useQuery({
    queryKey: equipmentKeys.detail(companyId, id),
    enabled: enabled && Boolean(id),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('equipment')
        .select('*, client:clients!inner(id, name, code)')
        .eq('company_id', companyId)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/** Rótulo curto: "Dell Inspiron 15" ou o tipo quando não há marca/modelo. */
export function equipmentTitle(e: { manufacturer: string | null; model: string | null }, typeLabel: string): string {
  return [e.manufacturer, e.model].filter(Boolean).join(' ') || typeLabel
}
