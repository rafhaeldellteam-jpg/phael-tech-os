import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { FinanceDirection, FinanceStatus, PaymentMethod } from '@/lib/database.types'
import { requireSupabase } from '@/lib/supabase'

export const financeKeys = {
  all: (companyId: string) => ['finance', companyId] as const,
  accounts: (companyId: string) => ['finance', companyId, 'accounts'] as const,
  categories: (companyId: string) => ['finance', companyId, 'categories'] as const,
  entries: (companyId: string, f: EntryFilters) => ['finance', companyId, 'entries', f] as const,
  entry: (companyId: string, id: string) => ['finance', companyId, 'entry', id] as const,
  summary: (companyId: string, from: string, to: string) => ['finance', companyId, 'summary', from, to] as const,
  flow: (companyId: string, from: string, to: string, g: string) => ['finance', companyId, 'flow', from, to, g] as const,
  margins: (companyId: string, from: string, to: string) => ['finance', companyId, 'margins', from, to] as const,
  categoriesResult: (companyId: string, from: string, to: string) => ['finance', companyId, 'cat-result', from, to] as const,
  order: (companyId: string, orderId: string) => ['finance', companyId, 'order', orderId] as const,
  statement: (companyId: string, accountId: string, show: string) => ['finance', companyId, 'statement', accountId, show] as const,
}

export const methodLabels: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  debit: 'Cartão de débito',
  credit: 'Cartão de crédito',
  transfer: 'Transferência',
  boleto: 'Boleto',
  other: 'Outro',
}

export const statusLabels: Record<FinanceStatus, string> = {
  open: 'Em aberto',
  partial: 'Parcial',
  paid: 'Quitado',
  canceled: 'Cancelado',
}

export function useAccounts(companyId: string, enabled = true) {
  return useQuery({
    queryKey: financeKeys.accounts(companyId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('finance_accounts').select('*').eq('company_id', companyId).order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useCategories(companyId: string, enabled = true) {
  return useQuery({
    queryKey: financeKeys.categories(companyId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('finance_categories')
        .select('*')
        .eq('company_id', companyId)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

export interface EntryFilters {
  direction: FinanceDirection
  status: '' | 'pending' | 'overdue' | FinanceStatus
  from: string
  to: string
  q: string
  page: number
}

export const ENTRY_PAGE_SIZE = 30

const entryColumns =
  'id, number, direction, description, amount_cents, paid_cents, issue_date, due_date, installment_no, installment_count, status, canceled_at, cancel_reason, order_id, purchase_id, notes, category:finance_categories(id, name), client:clients(id, name), supplier:suppliers(id, name)'

export function useEntries(companyId: string, f: EntryFilters) {
  return useQuery({
    queryKey: financeKeys.entries(companyId, f),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = requireSupabase()
        .from('finance_entries')
        .select(entryColumns, { count: 'exact' })
        .eq('company_id', companyId)
        .eq('direction', f.direction)
        .order('due_date')
        .order('number')
        .range(f.page * ENTRY_PAGE_SIZE, f.page * ENTRY_PAGE_SIZE + ENTRY_PAGE_SIZE - 1)
      const today = new Date().toISOString().slice(0, 10)
      if (f.status === 'pending') q = q.in('status', ['open', 'partial'])
      else if (f.status === 'overdue') q = q.in('status', ['open', 'partial']).lt('due_date', today)
      else if (f.status) q = q.eq('status', f.status)
      if (f.from) q = q.gte('due_date', f.from)
      if (f.to) q = q.lte('due_date', f.to)
      if (f.q.trim()) q = q.ilike('description', `%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data ?? [], count: count ?? 0 }
    },
  })
}

export function useEntryPayments(companyId: string, entryId: string) {
  return useQuery({
    queryKey: financeKeys.entry(companyId, entryId),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('finance_payments')
        .select('id, amount_cents, paid_at, method, reversal_of, notes, created_at, account:finance_accounts!inner(id, name)')
        .eq('entry_id', entryId)
        .order('created_at')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useOrderEntries(companyId: string, orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: financeKeys.order(companyId, orderId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('finance_entries')
        .select(entryColumns)
        .eq('company_id', companyId)
        .eq('order_id', orderId)
        .order('installment_no')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useSummary(companyId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: financeKeys.summary(companyId, from, to),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('finance_summary', { p_company_id: companyId, p_from: from, p_to: to })
      if (error) throw error
      return data?.[0] ?? null
    },
  })
}

export function useCashFlow(companyId: string, from: string, to: string, group: 'day' | 'month') {
  return useQuery({
    queryKey: financeKeys.flow(companyId, from, to, group),
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('cash_flow', { p_company_id: companyId, p_from: from, p_to: to, p_group: group })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useOrderMargins(companyId: string, from: string, to: string) {
  return useQuery({
    queryKey: financeKeys.margins(companyId, from, to),
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('order_margins', { p_company_id: companyId, p_from: from, p_to: to })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useCategoryResults(companyId: string, from: string, to: string) {
  return useQuery({
    queryKey: financeKeys.categoriesResult(companyId, from, to),
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('service_category_results', { p_company_id: companyId, p_from: from, p_to: to })
      if (error) throw error
      return data ?? []
    },
  })
}
