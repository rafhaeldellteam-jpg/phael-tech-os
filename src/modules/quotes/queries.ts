import { useQuery } from '@tanstack/react-query'
import type { QuoteStatus } from '@/lib/database.types'
import { requireSupabase } from '@/lib/supabase'
import { orderKeys } from '../orders/queries'

export interface QuoteItem {
  kind: 'service' | 'part'
  description: string
  qty: number
  unit_price_cents: number
  discount_cents: number
  warranty_days: number | null
  product_id?: string | null
  catalog_id?: string | null
}

export interface QuoteRow {
  id: string
  version: number
  status: QuoteStatus
  items: unknown
  total_cents: number
  valid_until: string | null
  delivery_days: number | null
  notes: string | null
  created_at: string
  sent_at: string | null
  decided_at: string | null
  decided_via: 'staff' | 'portal' | null
  decided_by_name: string | null
  decision_note: string | null
  applied_at: string | null
}

export const quoteStatusLabels: Record<QuoteStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviado, aguardando cliente',
  approved: 'Aprovado',
  refused: 'Recusado',
  superseded: 'Substituído por versão nova',
  canceled: 'Cancelado',
}

export const quoteStatusTone: Record<QuoteStatus, 'neutral' | 'ok' | 'attn' | 'danger'> = {
  draft: 'neutral',
  sent: 'attn',
  approved: 'ok',
  refused: 'danger',
  superseded: 'neutral',
  canceled: 'neutral',
}

export const quoteKeys = {
  order: (companyId: string, orderId: string) => [...orderKeys.all(companyId), 'quotes', orderId] as const,
  list: (companyId: string, status: string) => ['quotes', companyId, 'list', status] as const,
}

const columns =
  'id, version, status, items, total_cents, valid_until, delivery_days, notes, created_at, sent_at, decided_at, decided_via, decided_by_name, decision_note, applied_at'

export function useOrderQuotes(companyId: string, orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: quoteKeys.order(companyId, orderId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('quotes').select(columns).eq('order_id', orderId).order('version', { ascending: false })
      if (error) throw error
      return (data ?? []) as QuoteRow[]
    },
  })
}

/** Soma do orçamento (mesma fórmula do banco): qtd × preço − desconto. */
export function quoteTotal(items: QuoteItem[]): number {
  return items.reduce((a, i) => a + i.qty * i.unit_price_cents - i.discount_cents, 0)
}
