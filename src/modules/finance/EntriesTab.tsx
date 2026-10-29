import { Plus, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Pagination } from '@/components/ui/Pagination'
import { Spinner } from '@/components/ui/Spinner'
import type { FinanceDirection, FinanceStatus } from '@/lib/database.types'
import { formatBRL } from '@/lib/money'
import { EntryDialog, NewEntryDialog, type EntryRef } from './EntryDialogs'
import { formatIsoDate, isoDate } from './period'
import { ENTRY_PAGE_SIZE, statusLabels, useAccounts, useEntries, type EntryFilters } from './queries'

const statusTone: Record<FinanceStatus, 'neutral' | 'ok' | 'attn' | 'danger'> = {
  open: 'neutral',
  partial: 'attn',
  paid: 'ok',
  canceled: 'danger',
}

export function EntriesTab({ companyId, direction, canWrite }: { companyId: string; direction: FinanceDirection; canWrite: boolean }) {
  const [filters, setFilters] = useState<EntryFilters>({ direction, status: 'pending', from: '', to: '', q: '', page: 0 })
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<EntryRef | null>(null)
  const entries = useEntries(companyId, filters)
  const accounts = useAccounts(companyId)
  const today = isoDate(new Date())
  const set = (patch: Partial<EntryFilters>) => setFilters((f) => ({ ...f, page: 0, ...patch }))

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === draft ? f : { ...f, q: draft, page: 0 })), 300)
    return () => clearTimeout(t)
  }, [draft])

  const word = direction === 'in' ? 'receber' : 'pagar'
  const pageTotal = (entries.data?.rows ?? []).reduce((a, e) => a + (e.status === 'canceled' ? 0 : e.amount_cents - e.paid_cents), 0)

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {canWrite && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> Nova conta a {word}
          </Button>
        )}
        <label className="grid min-w-48 flex-1 gap-1 text-[13px] text-muted">
          Buscar
          <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Descrição" className="h-9 rounded-md border border-line bg-[var(--surface)] px-3 text-sm text-[var(--text)]" />
        </label>
        <label className="grid gap-1 text-[13px] text-muted">
          Situação
          <select value={filters.status} onChange={(e) => set({ status: e.target.value as EntryFilters['status'] })} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]">
            <option value="pending">Em aberto (inclui parciais)</option>
            <option value="overdue">Vencidos</option>
            <option value="paid">Quitados</option>
            <option value="canceled">Cancelados</option>
            <option value="">Todos</option>
          </select>
        </label>
        <label className="grid gap-1 text-[13px] text-muted">
          Vencimento de
          <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]" />
        </label>
        <label className="grid gap-1 text-[13px] text-muted">
          até
          <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]" />
        </label>
      </div>

      {canWrite && accounts.isSuccess && accounts.data.length === 0 && (
        <p className="text-sm text-attn-600">
          Para registrar pagamentos, crie suas contas e categorias em{' '}
          <Link to="/financeiro?aba=configuracoes" className="underline">
            Contas e categorias
          </Link>
          .
        </p>
      )}

      {entries.isPending ? (
        <Spinner label="Carregando" />
      ) : entries.isError ? (
        <ErrorState error={entries.error} onRetry={entries.refetch} />
      ) : entries.data.rows.length === 0 ? (
        <EmptyState icon={Wallet} title={`Nada a ${word} com esses filtros`} />
      ) : (
        <>
          <div className="surface overflow-x-auto rounded-lg" aria-busy={entries.isFetching}>
            <table className="w-full min-w-[700px] text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Vencimento</th>
                  <th className="px-4 py-2.5 font-medium">Descrição</th>
                  <th className="px-4 py-2.5 font-medium">Situação</th>
                  <th className="px-4 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-4 py-2.5 text-right font-medium">Em aberto</th>
                </tr>
              </thead>
              <tbody>
                {entries.data.rows.map((e) => {
                  const late = (e.status === 'open' || e.status === 'partial') && e.due_date < today
                  return (
                    <tr key={e.id} className="border-b border-line align-top last:border-0 hover:bg-[var(--surface-muted)]">
                      <td className={`px-4 py-3 tabular-nums ${late ? 'font-medium text-danger-600' : ''}`}>
                        {formatIsoDate(e.due_date)}
                        {late && <span className="block text-[12px] font-normal">vencido</span>}
                      </td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => setOpen(e)} className="text-left font-medium hover:underline">
                          {e.description}
                        </button>
                        <p className="text-[13px] text-muted">
                          {[e.client?.name, e.supplier?.name, e.category?.name].filter(Boolean).join(', ')}
                          {e.order_id && (
                            <>
                              {' '}
                              <Link to={`/ordens/${e.order_id}`} className="underline">
                                ver OS
                              </Link>
                            </>
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={statusTone[e.status]}>{statusLabels[e.status]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatBRL(e.amount_cents)}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {e.status === 'canceled' ? '—' : formatBRL(e.amount_cents - e.paid_cents)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              Em aberto nesta página: <strong className="tabular-nums">{formatBRL(pageTotal)}</strong>
            </p>
            <Pagination page={filters.page} pageSize={ENTRY_PAGE_SIZE} total={entries.data.count} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
          </div>
        </>
      )}

      {creating && <NewEntryDialog companyId={companyId} direction={direction} onClose={() => setCreating(false)} />}
      {open && <EntryDialog companyId={companyId} entry={open} canWrite={canWrite} onClose={() => setOpen(null)} />}
    </section>
  )
}
