import { useQuery } from '@tanstack/react-query'
import { requireSupabase } from '@/lib/supabase'

export const catalogKeys = {
  all: (companyId: string) => ['catalog', companyId] as const,
  categories: ['service-categories'] as const,
}

export function useServiceCategories() {
  return useQuery({
    queryKey: catalogKeys.categories,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('service_categories').select('key, label').order('sort')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useCatalog(companyId: string, enabled = true) {
  return useQuery({
    queryKey: catalogKeys.all(companyId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('service_catalog')
        .select('*')
        .eq('company_id', companyId)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
}
