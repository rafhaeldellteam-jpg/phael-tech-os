import { ClipboardList, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/core/auth/useAuth'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { formatCode, formatDate, formatDateTime } from '@/lib/format'
import { equipmentTitle, useEquipmentTypes } from '../equipment/queries'
import { isOverdue, priorityLabels, stageLabels, stageTone } from './meta'
import { ORDER_PAGE_SIZE, useAssignable, useOrderList, useWorkflow, type OrderFilters } from './queries'

const STAGES = ['active', 'open', 'working', 'waiting', 'ready', 'done', 'stopped'] as const

function useFilters(): [OrderFilters, (patch: Partial<OrderFilters>) => void] {
  const [params, setParams] = useSearchParams()
  const stageParam = params.get('etapa')
  const filters: OrderFilters = {
    q: params.get('q') ?? '',
    stage: stageParam === 'todas' ? '' : ((STAGES as readonly string[]).includes(stageParam ?? '') ? stageParam : 'active') as OrderFilters['stage'],
    status: params.get('status') ?? '',
    assigned: params.get('responsavel') ?? '',
    overdue: params.get('atrasadas') === '1',
    page: Math.max(0, Number(params.get('pagina') ?? '1') - 1) || 0,
  }
  const update = (patch: Partial<OrderFilters>) => {
    const next = { ...filters, page: 0, ...patch }
    const p = new URLSearchParams()
    if (next.q) p.set('q', next.q)
    if (next.stage === '') p.set('etapa', 'todas')
    else if (next.stage !== 'active') p.set('etapa', next.stage)
    if (next.status) p.set('status', next.status)
    if (next.assigned) p.set('responsavel', next.assigned)
    if (next.overdue) p.set('atrasadas', '1')
    if (next.page > 0) p.set('pagina', String(next.page + 1))
    setParams(p, { replace: true })
  }
  return [filters, update]
}

export function OrderListPage() {
  const { user } = useAuth()
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const seesAll = can(['orders.read_all'])
  const [filters, setFilters] = useFilters()
  const [draft, setDraft] = useState(filters.q)
  const workflow = useWorkflow()
  const types = useEquipmentTypes()
  const assignable = useAssignable(company.id)
  const list = useOrderList(company.id, filters, user?.id ?? '', workflow.data?.statuses)

  useEffect(() => {
    if (draft === filters.q) return
    const t = setTimeout(() => setFilters({ q: draft }), 300)
    return () => clearTimeout(t)
  }, [draft, filters.q, setFilters])

  const statusInfo = (key: string) => workflow.data?.statuses.find((s) => s.key === key)
  const typeLabel = (key: string) => types.data?.find((t) => t.key === key)?.label ?? key
  const memberName = (id: string | null) => {
    if (!id) return null
    const m = assignable.data?.find((a) => a.user_id === id)
    return m ? (m.full_name ?? m.email) : 'Membro da equipe'
  }
  const hasFilters = Boolean(filters.q || filters.status || filters.assigned || filters.overdue || filters.stage !== 'active')

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Ordens de serviço"
        description={seesAll ? undefined : 'Você vê as OS atribuídas a você.'}
        actions={
          can(['orders.create']) && (
            <ButtonLink to="/ordens/nova">
              <Plus className="size-4" aria-hidden /> Nova OS
            </ButtonLink>
          )
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">Buscar OS</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Número da OS ou nome do cliente"
            className="h-10 w-full rounded-md border border-line bg-[var(--surface)] pr-3 pl-9 text-sm"
          />
        </label>
        <select
          aria-label="Etapa"
          value={filters.stage}
          onChange={(e) => setFilters({ stage: e.target.value as OrderFilters['stage'], status: '' })}
          className="h-10 rounded-md border border-line bg-[var(--surface)] px-2 text-sm"
        >
          <option value="active">Em andamento</option>
          {(['open', 'working', 'waiting', 'ready', 'done', 'stopped'] as const).map((s) => (
            <option key={s} value={s}>
              {stageLabels[s]}
            </option>
          ))}
          <option value="">Todas</option>
        </select>
        <select
          aria-label="Status"
          value={filters.status}
          onChange={(e) => setFilters({ status: e.target.value })}
          className="h-10 rounded-md border border-line bg-[var(--surface)] px-2 text-sm"
        >
          <option value="">Qualquer status</option>
          {(workflow.data?.statuses ?? []).map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {seesAll && (
          <select
            aria-label="Responsável"
            value={filters.assigned}
            onChange={(e) => setFilters({ assigned: e.target.value })}
            className="h-10 rounded-md border border-line bg-[var(--surface)] px-2 text-sm"
          >
            <option value="">Qualquer responsável</option>
            <option value="me">Atribuídas a mim</option>
            <option value="none">Sem responsável</option>
            {(assignable.data ?? []).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name ?? m.email}
              </option>
            ))}
          </select>
        )}
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={filters.overdue} onChange={(e) => setFilters({ overdue: e.target.checked })} className="size-4" />
          Só atrasadas
        </label>
      </div>

      {list.isPending || workflow.isPending ? (
        <Spinner label="Carregando ordens de serviço" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.data.rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title={hasFilters ? 'Nenhuma OS com esses filtros' : 'Nenhuma OS em andamento'}>
          {hasFilters ? (
            <button type="button" className="underline underline-offset-4" onClick={() => setFilters({ q: '', status: '', assigned: '', overdue: false, stage: 'active' })}>
              Limpar filtros
            </button>
          ) : can(['orders.create']) ? (
            'Abra uma OS quando o equipamento chegar ao balcão ou o atendimento começar.'
          ) : undefined}
        </EmptyState>
      ) : (
        <>
          <div className="surface overflow-x-auto rounded-lg" aria-busy={list.isFetching}>
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">OS</th>
                  <th className="px-4 py-2.5 font-medium">Cliente e equipamento</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Responsável</th>
                  <th className="px-4 py-2.5 font-medium">Prazo</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((o) => {
                  const info = statusInfo(o.status)
                  const late = isOverdue(o, info?.stage)
                  return (
                    <tr key={o.id} className="border-b border-line align-top last:border-0 hover:bg-[var(--surface-muted)]">
                      <td className="px-4 py-3">
                        <Link to={`/ordens/${o.id}`} className="font-semibold tabular-nums hover:underline">
                          {formatCode('OS', o.number)}
                        </Link>
                        <p className="text-[13px] text-muted tabular-nums">{formatDate(o.received_at)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{o.client.name}</p>
                        <p className="max-w-[36ch] truncate text-muted">
                          {o.equipment ? equipmentTitle(o.equipment, typeLabel(o.equipment.type)) : 'Sem equipamento'}: {o.reported_problem}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={info ? stageTone[info.stage] : 'neutral'}>{info?.label ?? o.status}</Badge>
                        {(o.priority === 'high' || o.priority === 'urgent') && (
                          <p className="mt-1 text-[13px] font-medium text-attn-600">Prioridade {priorityLabels[o.priority].toLowerCase()}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">{memberName(o.assigned_to) ?? <span className="text-muted">Sem responsável</span>}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {o.due_at ? (
                          <span className={late ? 'font-medium text-danger-600' : ''}>
                            {formatDateTime(o.due_at)}
                            {late && <span className="block text-[13px]">Atrasada</span>}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={filters.page} pageSize={ORDER_PAGE_SIZE} total={list.data.count} onPage={(page) => setFilters({ page })} />
        </>
      )}
    </div>
  )
}
