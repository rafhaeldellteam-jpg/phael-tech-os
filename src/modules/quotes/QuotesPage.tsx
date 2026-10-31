import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FileSignature } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { useActiveCompany } from '@/core/company/useCompany'
import type { QuoteStatus } from '@/lib/database.types'
import { formatCode, formatDate } from '@/lib/format'
import { formatBRL } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { formatIsoDate, isoDate } from '../finance/period'
import { quoteKeys, quoteStatusLabels, quoteStatusTone } from './queries'

/** Todos os orçamentos, com foco nos que aguardam o cliente. */
export function QuotesPage() {
  const { company } = useActiveCompany()
  const [status, setStatus] = useState<'' | QuoteStatus>('sent')
  const list = useQuery({
    queryKey: quoteKeys.list(company.id, status),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = requireSupabase()
        .from('quotes')
        .select('id, version, status, total_cents, valid_until, sent_at, decided_at, decided_by_name, order:service_orders!inner(id, number, client:clients!inner(name))')
        .eq('company_id', company.id)
        .order('created_at', { ascending: false })
        .limit(200)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as {
        id: string
        version: number
        status: QuoteStatus
        total_cents: number
        valid_until: string | null
        sent_at: string | null
        decided_at: string | null
        decided_by_name: string | null
        order: { id: string; number: number; client: { name: string } }
      }[]
    },
  })
  const today = isoDate(new Date())

  return (
    <div className="grid gap-5">
      <PageHeader title="Orçamentos" description="Crie e envie orçamentos dentro de cada OS. Aqui você acompanha todos." />
      <label className="grid max-w-xs gap-1 text-[13px] text-muted">
        Situação
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]">
          <option value="sent">Aguardando o cliente</option>
          <option value="draft">Rascunhos</option>
          <option value="approved">Aprovados</option>
          <option value="refused">Recusados</option>
          <option value="">Todos</option>
        </select>
      </label>
      {list.isPending ? (
        <Spinner label="Carregando" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={FileSignature} title="Nenhum orçamento com esse filtro" />
      ) : (
        <ul className="surface divide-y divide-[var(--border)] rounded-lg text-sm" aria-busy={list.isFetching}>
          {list.data.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Link to={`/ordens/${q.order.id}`} className="font-medium tabular-nums hover:underline">
                {formatCode('OS', q.order.number)} · v{q.version}
              </Link>
              <span className="min-w-32 flex-1 text-muted">{q.order.client.name}</span>
              <Badge tone={quoteStatusTone[q.status]}>{quoteStatusLabels[q.status]}</Badge>
              {q.status === 'sent' && q.valid_until && q.valid_until < today && <Badge tone="danger">Vencido</Badge>}
              <span className="text-[13px] text-muted">
                {q.status === 'sent' && q.valid_until && `válido até ${formatIsoDate(q.valid_until)}`}
                {q.decided_at && `${q.decided_by_name}, ${formatDate(q.decided_at)}`}
              </span>
              <span className="font-semibold tabular-nums">{formatBRL(q.total_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
