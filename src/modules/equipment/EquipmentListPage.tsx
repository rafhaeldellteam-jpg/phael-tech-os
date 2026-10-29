import { Laptop, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { Spinner } from '@/components/ui/Spinner'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { formatCode, formatDate } from '@/lib/format'
import { EQUIPMENT_PAGE_SIZE, equipmentTitle, useEquipmentList, useEquipmentTypes, type EquipmentFilters } from './queries'

function useFilters(): [EquipmentFilters, (patch: Partial<EquipmentFilters>) => void] {
  const [params, setParams] = useSearchParams()
  const filters: EquipmentFilters = {
    q: params.get('q') ?? '',
    type: params.get('tipo') ?? '',
    archived: params.get('arquivados') === '1',
    page: Math.max(0, Number(params.get('pagina') ?? '1') - 1) || 0,
  }
  const update = (patch: Partial<EquipmentFilters>) => {
    const next = { ...filters, page: 0, ...patch }
    const p = new URLSearchParams()
    if (next.q) p.set('q', next.q)
    if (next.type) p.set('tipo', next.type)
    if (next.archived) p.set('arquivados', '1')
    if (next.page > 0) p.set('pagina', String(next.page + 1))
    setParams(p, { replace: true })
  }
  return [filters, update]
}

export function EquipmentListPage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const [filters, setFilters] = useFilters()
  const [draft, setDraft] = useState(filters.q)
  const types = useEquipmentTypes()
  const list = useEquipmentList(company.id, filters)
  const typeLabel = (key: string) => types.data?.find((t) => t.key === key)?.label ?? key

  useEffect(() => {
    if (draft === filters.q) return
    const t = setTimeout(() => setFilters({ q: draft }), 300)
    return () => clearTimeout(t)
  }, [draft, filters.q, setFilters])

  const hasFilters = Boolean(filters.q || filters.type)

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Equipamentos"
        actions={
          can(['equipment.write']) && (
            <ButtonLink to="/equipamentos/novo">
              <Plus className="size-4" aria-hidden /> Novo equipamento
            </ButtonLink>
          )
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="relative min-w-60 flex-1">
          <span className="sr-only">Buscar equipamentos</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Marca, modelo, número de série, patrimônio ou código"
            className="h-10 w-full rounded-md border border-line bg-[var(--surface)] pr-3 pl-9 text-sm"
          />
        </label>
        <select
          aria-label="Tipo de equipamento"
          value={filters.type}
          onChange={(e) => setFilters({ type: e.target.value })}
          className="h-10 rounded-md border border-line bg-[var(--surface)] px-2 text-sm"
        >
          <option value="">Todos os tipos</option>
          {(types.data ?? []).map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={filters.archived} onChange={(e) => setFilters({ archived: e.target.checked })} className="size-4" />
          Mostrar arquivados
        </label>
      </div>

      {list.isPending ? (
        <Spinner label="Carregando equipamentos" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.data.rows.length === 0 ? (
        <EmptyState icon={Laptop} title={hasFilters ? 'Nenhum equipamento encontrado' : 'Nenhum equipamento cadastrado'}>
          {hasFilters
            ? 'Revise a busca ou o filtro de tipo.'
            : 'Cadastre o equipamento na entrada, a partir da ficha do cliente ou pelo botão acima.'}
        </EmptyState>
      ) : (
        <>
          <div className="surface overflow-x-auto rounded-lg" aria-busy={list.isFetching}>
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Código</th>
                  <th className="px-4 py-2.5 font-medium">Equipamento</th>
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-4 py-2.5 font-medium">Série</th>
                  <th className="px-4 py-2.5 font-medium">Entrada</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0 hover:bg-[var(--surface-muted)]">
                    <td className="px-4 py-3 text-muted tabular-nums">{formatCode('EQ', e.code)}</td>
                    <td className="px-4 py-3">
                      <Link to={`/equipamentos/${e.id}`} className="font-medium hover:underline">
                        {equipmentTitle(e, typeLabel(e.type))}
                      </Link>
                      <div className="mt-0.5 flex gap-1.5">
                        <Badge>{typeLabel(e.type)}</Badge>
                        {e.archived_at && <Badge tone="attn">Arquivado</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/clientes/${e.client.id}`} className="hover:underline">
                        {e.client.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted">{e.serial_number ?? '—'}</td>
                    <td className="px-4 py-3 text-muted tabular-nums">{formatDate(e.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={filters.page} pageSize={EQUIPMENT_PAGE_SIZE} total={list.data.count} onPage={(page) => setFilters({ page })} />
        </>
      )}
    </div>
  )
}
