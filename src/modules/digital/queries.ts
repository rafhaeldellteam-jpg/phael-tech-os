import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ContractStatus, DigitalKind, DigitalStatus } from '@/lib/database.types'
import { requireSupabase } from '@/lib/supabase'

export const digitalKindLabels: Record<DigitalKind, string> = {
  website: 'Site institucional',
  ecommerce: 'Loja virtual',
  landing: 'Landing page',
  hosting: 'Hospedagem',
  domain: 'Domínio',
  email: 'E-mail profissional',
  maintenance: 'Manutenção',
  other: 'Outro',
}

export const digitalStatusLabels: Record<DigitalStatus, string> = {
  planning: 'Planejamento',
  development: 'Em desenvolvimento',
  active: 'No ar',
  paused: 'Pausado',
  canceled: 'Cancelado',
}

export const digitalStatusTone: Record<DigitalStatus, 'neutral' | 'ok' | 'attn' | 'danger'> = {
  planning: 'neutral',
  development: 'attn',
  active: 'ok',
  paused: 'neutral',
  canceled: 'danger',
}

export const contractStatusLabels: Record<ContractStatus, string> = { active: 'Ativo', paused: 'Pausado', ended: 'Encerrado' }
export const contractStatusTone: Record<ContractStatus, 'neutral' | 'ok' | 'attn' | 'danger'> = { active: 'ok', paused: 'attn', ended: 'neutral' }

export const intervalLabels: Record<number, string> = { 1: 'Mensal', 2: 'Bimestral', 3: 'Trimestral', 6: 'Semestral', 12: 'Anual' }

export const digitalKeys = {
  all: (companyId: string) => ['digital', companyId] as const,
  list: (companyId: string, f: { q: string; status: string }) => ['digital', companyId, 'list', f] as const,
  domains: (companyId: string, days: number) => ['digital', companyId, 'domains', days] as const,
  contracts: (companyId: string, status: string) => ['digital', companyId, 'contracts', status] as const,
  overview: (companyId: string) => ['digital', companyId, 'overview'] as const,
  charges: (companyId: string, contractId: string) => ['digital', companyId, 'charges', contractId] as const,
}

export interface DigitalRow {
  id: string
  number: number
  client_id: string
  kind: DigitalKind
  name: string
  url: string | null
  status: DigitalStatus
  repository_url: string | null
  hosting_provider: string | null
  domain_expires_on: string | null
  launched_on: string | null
  notes: string | null
  client: { id: string; code: number; name: string } | null
}

export function useDigitalServices(companyId: string, f: { q: string; status: string }) {
  return useQuery({
    queryKey: digitalKeys.list(companyId, f),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = requireSupabase()
        .from('digital_services')
        .select('id, number, client_id, kind, name, url, status, repository_url, hosting_provider, domain_expires_on, launched_on, notes, client:clients(id, code, name)')
        .eq('company_id', companyId)
        .order('number', { ascending: false })
        .limit(300)
      if (f.status === 'live') q = q.in('status', ['planning', 'development', 'active', 'paused'])
      else if (f.status) q = q.eq('status', f.status as DigitalStatus)
      const term = f.q.trim().replace(/[%,()]/g, ' ')
      if (term) q = q.or(`name.ilike.%${term}%,url.ilike.%${term}%`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as DigitalRow[]
    },
  })
}

export function useClientDigitalServices(companyId: string, clientId: string) {
  return useQuery({
    queryKey: [...digitalKeys.all(companyId), 'client', clientId],
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('digital_services')
        .select('id, name, kind')
        .eq('company_id', companyId)
        .eq('client_id', clientId)
        .neq('status', 'canceled')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useExpiringDomains(companyId: string, days: number, enabled: boolean) {
  return useQuery({
    queryKey: digitalKeys.domains(companyId, days),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('expiring_domains', { p_company_id: companyId, p_days: days })
      if (error) throw error
      return data ?? []
    },
  })
}

export interface ContractRow {
  id: string
  number: number
  client_id: string
  digital_service_id: string | null
  description: string
  amount_cents: number
  interval_months: number
  billing_day: number
  start_date: string
  end_date: string | null
  category_id: string | null
  status: ContractStatus
  status_reason: string | null
  notes: string | null
  client: { id: string; code: number; name: string } | null
  service: { id: string; name: string } | null
}

export function useContracts(companyId: string, status: string) {
  return useQuery({
    queryKey: digitalKeys.contracts(companyId, status),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = requireSupabase()
        .from('contracts')
        .select(
          'id, number, client_id, digital_service_id, description, amount_cents, interval_months, billing_day, start_date, end_date, category_id, status, status_reason, notes, client:clients(id, code, name), service:digital_services(id, name)',
        )
        .eq('company_id', companyId)
        .order('number', { ascending: false })
        .limit(300)
      if (status) q = q.eq('status', status as ContractStatus)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as ContractRow[]
    },
  })
}

export function useContractOverview(companyId: string) {
  return useQuery({
    queryKey: digitalKeys.overview(companyId),
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('contract_overview', { p_company_id: companyId })
      if (error) throw error
      return new Map((data ?? []).map((r) => [r.contract_id, r]))
    },
  })
}

export function useContractCharges(companyId: string, contractId: string) {
  return useQuery({
    queryKey: digitalKeys.charges(companyId, contractId),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('finance_entries')
        .select('id, description, due_date, amount_cents, paid_cents, status')
        .eq('company_id', companyId)
        .eq('contract_id', contractId)
        .order('due_date', { ascending: false })
        .limit(60)
      if (error) throw error
      return data ?? []
    },
  })
}
