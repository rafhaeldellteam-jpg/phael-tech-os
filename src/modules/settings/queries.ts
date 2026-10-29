import { useQuery } from '@tanstack/react-query'
import { requireSupabase } from '@/lib/supabase'

export const settingsKeys = {
  company: (id: string) => ['company', id] as const,
  members: (id: string) => ['members', id] as const,
  invitations: (id: string) => ['invitations', id] as const,
  overrides: (id: string) => ['overrides', id] as const,
  permissionCatalog: ['permission-catalog'] as const,
  audit: (id: string, page: number, entity: string) => ['audit', id, page, entity] as const,
}

export function useCompanyDetails(companyId: string) {
  return useQuery({
    queryKey: settingsKeys.company(companyId),
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('companies').select('*').eq('id', companyId).single()
      if (error) throw error
      return data
    },
  })
}

export function useMembers(companyId: string, enabled = true) {
  return useQuery({
    queryKey: settingsKeys.members(companyId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('list_company_members', { p_company_id: companyId })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useInvitations(companyId: string, enabled: boolean) {
  return useQuery({
    queryKey: settingsKeys.invitations(companyId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('company_invitations')
        .select('id, email, role, expires_at, accepted_at, revoked_at, created_at')
        .eq('company_id', companyId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: settingsKeys.permissionCatalog,
    staleTime: Infinity,
    queryFn: async () => {
      const sb = requireSupabase()
      const [perms, roles] = await Promise.all([
        sb.from('permissions').select('key, module, description').order('key'),
        sb.from('role_permissions').select('role, permission_key'),
      ])
      if (perms.error) throw perms.error
      if (roles.error) throw roles.error
      return { permissions: perms.data ?? [], rolePermissions: roles.data ?? [] }
    },
  })
}

export function useOverrides(companyId: string, enabled: boolean) {
  return useQuery({
    queryKey: settingsKeys.overrides(companyId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('member_permission_overrides')
        .select('member_id, permission_key, granted')
        .eq('company_id', companyId)
      if (error) throw error
      return data ?? []
    },
  })
}
