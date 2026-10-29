import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { StockMovementKind } from '@/lib/database.types'
import { requireSupabase } from '@/lib/supabase'
import { searchTerm } from '../clients/queries'

export const PRODUCT_PAGE_SIZE = 25

export interface ProductFilters {
  q: string
  low: boolean
  inactive: boolean
  page: number
}

export const inventoryKeys = {
  all: (companyId: string) => ['inventory', companyId] as const,
  list: (companyId: string, f: ProductFilters) => ['inventory', companyId, 'list', f] as const,
  detail: (companyId: string, id: string) => ['inventory', companyId, 'detail', id] as const,
  movements: (companyId: string, id: string) => ['inventory', companyId, 'movements', id] as const,
  lowCount: (companyId: string) => ['inventory', companyId, 'low'] as const,
  picker: (companyId: string, q: string) => ['inventory', companyId, 'picker', q] as const,
}

export const movementLabels: Record<StockMovementKind, string> = {
  purchase_in: 'Entrada por compra',
  adjustment_in: 'Ajuste: entrada',
  adjustment_out: 'Ajuste: saída',
  supplier_return: 'Devolução ao fornecedor',
  order_consume: 'Usada em OS',
  order_return: 'Devolvida de OS',
}

export function useProductList(companyId: string, f: ProductFilters) {
  return useQuery({
    queryKey: inventoryKeys.list(companyId, f),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = requireSupabase()
        .from('products')
        .select('id, sku, name, category, manufacturer, unit, cost_cents, price_cents, min_qty, qty_on_hand, active', { count: 'exact' })
        .eq('company_id', companyId)
        .order('name')
        .range(f.page * PRODUCT_PAGE_SIZE, f.page * PRODUCT_PAGE_SIZE + PRODUCT_PAGE_SIZE - 1)
      if (!f.inactive) q = q.eq('active', true)
      const term = searchTerm(f.q)
      if (term) q = q.ilike('search_text', `%${term}%`)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data ?? [], count: count ?? 0 }
    },
  })
}

/** Produtos no mínimo ou abaixo (compara duas colunas, por isso filtra após carregar até 500 ativos). */
export function useLowStock(companyId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...inventoryKeys.all(companyId), 'low-list'],
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('products')
        .select('id, sku, name, unit, min_qty, qty_on_hand, cost_cents, price_cents, category, manufacturer, active')
        .eq('company_id', companyId)
        .eq('active', true)
        .gt('min_qty', 0)
        .order('name')
        .limit(500)
      if (error) throw error
      return (data ?? []).filter((p) => p.qty_on_hand <= p.min_qty)
    },
  })
}

export function useLowStockCount(companyId: string, enabled: boolean) {
  return useQuery({
    queryKey: inventoryKeys.lowCount(companyId),
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('low_stock_count', { p_company_id: companyId })
      if (error) throw error
      return Number(data ?? 0)
    },
  })
}

export function useProduct(companyId: string, id: string) {
  return useQuery({
    queryKey: inventoryKeys.detail(companyId, id),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('products')
        .select('*, supplier:suppliers(id, name)')
        .eq('company_id', companyId)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useMovements(companyId: string, productId: string) {
  return useQuery({
    queryKey: inventoryKeys.movements(companyId, productId),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('stock_movements')
        .select('id, kind, qty, direction, unit_cost_cents, balance_after, serial_number, reason, order_id, purchase_id, actor_id, created_at')
        .eq('product_id', productId)
        .order('id', { ascending: false })
        .limit(200)
      if (error) throw error
      return data ?? []
    },
  })
}

/** Busca de produtos ativos para lançar em OS ou compra. */
export function useProductSearch(companyId: string, q: string, enabled: boolean) {
  const term = searchTerm(q)
  return useQuery({
    queryKey: inventoryKeys.picker(companyId, term ?? ''),
    enabled: enabled,
    queryFn: async () => {
      let query = requireSupabase()
        .from('products')
        .select('id, sku, name, unit, price_cents, cost_cents, qty_on_hand, tracks_serial, warranty_days')
        .eq('company_id', companyId)
        .eq('active', true)
        .order('name')
        .limit(15)
      if (term) query = query.ilike('search_text', `%${term}%`)
      const { data, error } = await query
      if (error) throw error
      return data ?? []
    },
  })
}
