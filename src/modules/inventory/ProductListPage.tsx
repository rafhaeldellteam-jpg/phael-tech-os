import { Boxes, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { Spinner } from '@/components/ui/Spinner'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { formatBRL } from '@/lib/money'
import { ProductDialog } from './ProductDialog'
import { PRODUCT_PAGE_SIZE, useLowStock, useProductList, type ProductFilters } from './queries'

export function ProductListPage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filters: ProductFilters = {
    q: params.get('q') ?? '',
    low: params.get('repor') === '1',
    inactive: params.get('inativos') === '1',
    page: Math.max(0, Number(params.get('pagina') ?? '1') - 1) || 0,
  }
  const setFilters = (patch: Partial<ProductFilters>) => {
    const n = { ...filters, page: 0, ...patch }
    const p = new URLSearchParams()
    if (n.q) p.set('q', n.q)
    if (n.low) p.set('repor', '1')
    if (n.inactive) p.set('inativos', '1')
    if (n.page > 0) p.set('pagina', String(n.page + 1))
    setParams(p, { replace: true })
  }
  const [draft, setDraft] = useState(filters.q)
  const [creating, setCreating] = useState(false)
  const list = useProductList(company.id, filters)
  const low = useLowStock(company.id, filters.low)
  const showCost = can(['inventory.write']) || can(['finance.read'])

  useEffect(() => {
    if (draft === filters.q) return
    const t = setTimeout(() => setFilters({ q: draft }), 300)
    return () => clearTimeout(t)
  })

  const source = filters.low ? low : list
  const rows = filters.low ? (low.data ?? []) : (list.data?.rows ?? [])

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Estoque e peças"
        actions={
          can(['inventory.write']) && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> Novo produto
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="relative min-w-60 flex-1">
          <span className="sr-only">Buscar produtos</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={filters.low}
            placeholder="SKU, nome, fabricante ou categoria"
            className="h-10 w-full rounded-md border border-line bg-[var(--surface)] pr-3 pl-9 text-sm disabled:opacity-60"
          />
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={filters.low} onChange={(e) => setFilters({ low: e.target.checked })} className="size-4" />
          Só o que precisa repor
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={filters.inactive} disabled={filters.low} onChange={(e) => setFilters({ inactive: e.target.checked })} className="size-4" />
          Incluir inativos
        </label>
      </div>

      {source.isPending ? (
        <Spinner label="Carregando estoque" />
      ) : source.isError ? (
        <ErrorState error={source.error} onRetry={source.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Boxes} title={filters.low ? 'Nada para repor' : filters.q ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado'}>
          {filters.low
            ? 'Todos os produtos com estoque mínimo estão acima dele.'
            : filters.q
              ? 'Revise a busca.'
              : 'Cadastre as peças que você mantém em estoque e dê entrada por uma compra.'}
        </EmptyState>
      ) : (
        <>
          <div className="surface overflow-x-auto rounded-lg">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Produto</th>
                  <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                  <th className="px-4 py-2.5 text-right font-medium">Mínimo</th>
                  {showCost && <th className="px-4 py-2.5 text-right font-medium">Custo médio</th>}
                  <th className="px-4 py-2.5 text-right font-medium">Preço</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const needs = p.min_qty > 0 && p.qty_on_hand <= p.min_qty
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0 hover:bg-[var(--surface-muted)]">
                      <td className="px-4 py-3">
                        <Link to={`/estoque/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        <p className="flex flex-wrap gap-1.5 text-[13px] text-muted">
                          <span className="tabular-nums">{p.sku}</span>
                          {p.category && <span>{p.category}</span>}
                          {!p.active && <Badge tone="attn">Inativo</Badge>}
                        </p>
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${needs ? 'font-semibold text-danger-600' : ''}`}>
                        {p.qty_on_hand} {p.unit}
                        {needs && <span className="block text-[12px] font-normal">repor</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-muted tabular-nums">{p.min_qty || '—'}</td>
                      {showCost && <td className="px-4 py-3 text-right tabular-nums">{formatBRL(p.cost_cents)}</td>}
                      <td className="px-4 py-3 text-right tabular-nums">{formatBRL(p.price_cents)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!filters.low && list.data && (
            <Pagination page={filters.page} pageSize={PRODUCT_PAGE_SIZE} total={list.data.count} onPage={(page) => setFilters({ page })} />
          )}
        </>
      )}

      {creating && (
        <ProductDialog companyId={company.id} product={null} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/estoque/${id}`)} />
      )}
    </div>
  )
}
