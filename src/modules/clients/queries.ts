import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { requireSupabase } from '@/lib/supabase'

export const PAGE_SIZE = 20

export const clientKeys = {
  all: (companyId: string) => ['clients', companyId] as const,
  list: (companyId: string, f: ClientFilters) => ['clients', companyId, 'list', f] as const,
  detail: (companyId: string, id: string) => ['clients', companyId, 'detail', id] as const,
  sensitive: (companyId: string, id: string) => ['clients', companyId, 'sensitive', id] as const,
  history: (companyId: string, id: string) => ['clients', companyId, 'history', id] as const,
}

export interface ClientFilters {
  q: string
  kind: '' | 'person' | 'company'
  archived: boolean
  page: number
}

/** Normaliza o termo como no banco (minúsculas, sem acentos) e escapa curingas. */
export function normalizeQuery(q: string): string {
  return q
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[%_\\]/g, (c) => `\\${c}`)
}

/**
 * Termo usado na busca: telefones/códigos digitados com máscara viram só dígitos
 * (o banco guarda telefone sem máscara); o resto é normalizado. null = sem filtro.
 */
export function searchTerm(raw: string): string | null {
  const compact = raw.replace(/[\s().\-/]/g, '')
  if (/^\d{3,}$/.test(compact)) return compact
  const term = normalizeQuery(raw)
  return term.length >= 2 ? term : null
}

export function useClientList(companyId: string, f: ClientFilters) {
  return useQuery({
    queryKey: clientKeys.list(companyId, f),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = requireSupabase()
        .from('clients')
        .select('id, code, kind, name, trade_name, email, phone, whatsapp, city, state, has_tax_id, archived_at', {
          count: 'exact',
        })
        .eq('company_id', companyId)
        .order('name')
        .range(f.page * PAGE_SIZE, f.page * PAGE_SIZE + PAGE_SIZE - 1)
      q = f.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null)
      if (f.kind) q = q.eq('kind', f.kind)
      const term = searchTerm(f.q)
      if (term) q = q.ilike('search_text', `%${term}%`)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data ?? [], count: count ?? 0 }
    },
  })
}

export function useClient(companyId: string, id: string, enabled = true) {
  return useQuery({
    queryKey: clientKeys.detail(companyId, id),
    enabled: enabled && Boolean(id),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('clients')
        .select('*')
        .eq('company_id', companyId)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useClientSensitive(companyId: string, id: string, enabled: boolean) {
  return useQuery({
    queryKey: clientKeys.sensitive(companyId, id),
    enabled: enabled && Boolean(id),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('client_sensitive')
        .select('tax_id, internal_notes')
        .eq('client_id', id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useClientHistory(companyId: string, id: string, enabled: boolean) {
  return useQuery({
    queryKey: clientKeys.history(companyId, id),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('audit_log')
        .select('id, actor_id, action, entity, changes, created_at')
        .eq('company_id', companyId)
        .in('entity', ['clients', 'client_sensitive'])
        .eq('entity_id', id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data ?? []
    },
  })
}
