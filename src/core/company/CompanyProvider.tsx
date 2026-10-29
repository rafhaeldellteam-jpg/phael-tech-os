import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/core/auth/useAuth'
import { canAny, type AccessRequirement } from '@/core/permissions/permissions'
import type { MemberRole } from '@/lib/database.types'
import { requireSupabase } from '@/lib/supabase'

export interface Membership {
  memberId: string
  role: MemberRole
  company: { id: string; name: string }
}

export interface CompanyContextValue {
  memberships: Membership[]
  active: Membership | null
  permissions: ReadonlySet<string>
  loading: boolean
  error: unknown
  selectCompany: (companyId: string) => void
  can: (required: AccessRequirement) => boolean
  refresh: () => Promise<void>
}

export const CompanyContext = createContext<CompanyContextValue | null>(null)

const storageKey = (userId: string) => `pt-active-company:${userId}`

function readStored(userId: string): string | null {
  try {
    return localStorage.getItem(storageKey(userId))
  } catch {
    return null
  }
}

export const companyKeys = {
  memberships: (userId: string) => ['memberships', userId] as const,
  permissions: (companyId: string) => ['permissions', companyId] as const,
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userId = user?.id ?? null
  const [selectedId, setSelectedId] = useState<string | null>(() => (userId ? readStored(userId) : null))

  useEffect(() => {
    setSelectedId(userId ? readStored(userId) : null)
  }, [userId])

  const membershipsQuery = useQuery({
    queryKey: companyKeys.memberships(userId ?? 'anon'),
    enabled: Boolean(userId),
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await requireSupabase()
        .from('company_members')
        .select('id, role, company:companies!inner(id, name)')
        .eq('user_id', userId as string)
        .eq('status', 'active')
        .order('created_at')
      if (error) throw error
      return (data ?? []).map((m) => ({
        memberId: m.id,
        role: m.role,
        company: { id: m.company.id, name: m.company.name },
      }))
    },
  })

  const memberships = useMemo(() => membershipsQuery.data ?? [], [membershipsQuery.data])

  // A escolha local só é usada se o usuário ainda for membro ativo dela.
  // (O banco revalida a associação em toda consulta, de qualquer forma.)
  const active = useMemo(
    () => memberships.find((m) => m.company.id === selectedId) ?? memberships[0] ?? null,
    [memberships, selectedId],
  )

  const permissionsQuery = useQuery({
    queryKey: companyKeys.permissions(active?.company.id ?? 'none'),
    enabled: Boolean(active),
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await requireSupabase().rpc('my_permissions', {
        p_company_id: (active as Membership).company.id,
      })
      if (error) throw error
      return data ?? []
    },
  })

  const permissions = useMemo(() => new Set(permissionsQuery.data ?? []), [permissionsQuery.data])

  const selectCompany = useCallback(
    (companyId: string) => {
      setSelectedId(companyId)
      if (userId) {
        try {
          localStorage.setItem(storageKey(userId), companyId)
        } catch {
          /* armazenamento indisponível: a escolha vale só nesta aba */
        }
      }
      // Dados de outra empresa nunca devem aparecer em cache.
      queryClient.removeQueries({
        predicate: (q) => !['memberships', 'permissions'].includes(String(q.queryKey[0])),
      })
    },
    [userId, queryClient],
  )

  const can = useCallback((required: AccessRequirement) => canAny(permissions, required), [permissions])

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['memberships'] })
    await queryClient.invalidateQueries({ queryKey: ['permissions'] })
  }, [queryClient])

  const value = useMemo<CompanyContextValue>(
    () => ({
      memberships,
      active,
      permissions,
      loading: membershipsQuery.isPending || (Boolean(active) && permissionsQuery.isPending),
      error: membershipsQuery.error ?? permissionsQuery.error,
      selectCompany,
      can,
      refresh,
    }),
    [memberships, active, permissions, membershipsQuery.isPending, membershipsQuery.error, permissionsQuery.isPending, permissionsQuery.error, selectCompany, can, refresh],
  )

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
}
