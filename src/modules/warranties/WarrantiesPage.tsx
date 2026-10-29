import { ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { Spinner } from '@/components/ui/Spinner'
import { Tabs } from '@/components/ui/Tabs'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import type { WarrantyClaimStatus } from '@/lib/database.types'
import { formatCode, formatDate } from '@/lib/format'
import { formatIsoDate } from '../finance/period'
import { OpenClaimDialog, type CoveredItem } from './ClaimDialogs'
import { claimStatusLabels, claimStatusTone, daysLeftLabel, daysLeftTone, type WarrantyFilter } from './meta'
import { useClaims, useWarranties, useWarrantyStats, WARRANTY_PAGE_SIZE } from './queries'

type TabKey = 'prazos' | 'acionamentos'

export function WarrantiesPage() {
  const { company } = useActiveCompany()
  const [params, setParams] = useSearchParams()
  const tab: TabKey = params.get('aba') === 'acionamentos' ? 'acionamentos' : 'prazos'
  const stats = useWarrantyStats(company.id, true)
  const pending = stats.data?.open_claims ?? 0

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Garantias"
        description="O prazo de cada serviço e peça conta a partir da entrega da OS. Acionar a garantia abre uma OS de retorno vinculada."
      />
      <Tabs
        label="Seções de garantia"
        value={tab}
        onChange={(k) => setParams(k === 'prazos' ? {} : { aba: k }, { replace: true })}
        items={[
          { key: 'prazos', label: 'Prazos' },
          { key: 'acionamentos', label: 'Acionamentos', badge: pending > 0 ? <Badge tone="attn">{pending}</Badge> : undefined },
        ]}
      />
      {tab === 'prazos' ? <TermsTab companyId={company.id} /> : <ClaimsTab companyId={company.id} />}
    </div>
  )
}

function TermsTab({ companyId }: { companyId: string }) {
  const { can } = useCompany()
  const [status, setStatus] = useState<WarrantyFilter>('active')
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [claiming, setClaiming] = useState<{ orderId: string; orderNumber: number; item: CoveredItem } | null>(null)
  const list = useWarranties(companyId, { status, q, page })

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(draft)
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [draft])

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-48 flex-1 gap-1 text-[13px] text-muted">
          Buscar
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Cliente, item, número de série ou nº da OS"
            className="h-9 rounded-md border border-line bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
          />
        </label>
        <label className="grid gap-1 text-[13px] text-muted">
          Situação
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as WarrantyFilter)
              setPage(0)
            }}
            className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]"
          >
            <option value="active">Vigentes</option>
            <option value="expiring">Vencem em até 15 dias</option>
            <option value="expired">Vencidas</option>
            <option value="">Todas</option>
          </select>
        </label>
      </div>

      {list.isPending ? (
        <Spinner label="Carregando garantias" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.data.rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nenhuma garantia com esses filtros">
          Garantias aparecem aqui quando uma OS com serviços ou peças com prazo de garantia é entregue.
        </EmptyState>
      ) : (
        <>
          <div className="surface overflow-x-auto rounded-lg" aria-busy={list.isFetching}>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Cliente e OS</th>
                  <th className="px-4 py-2.5 font-medium">Entregue</th>
                  <th className="px-4 py-2.5 font-medium">Vence</th>
                  <th className="px-4 py-2.5 font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((w) => (
                  <tr key={w.item_id} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium">{w.description}</span>
                      <span className="block text-[13px] text-muted">
                        {w.kind === 'part' ? 'Peça' : 'Serviço'}, {w.warranty_days} dias
                        {w.serial_number && `, série ${w.serial_number}`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/ordens/${w.order_id}`} className="font-medium tabular-nums hover:underline">
                        {formatCode('OS', w.order_number)}
                      </Link>
                      <span className="block text-[13px] text-muted">
                        {w.client_name}
                        {w.equipment_label && `, ${w.equipment_label}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{formatDate(w.delivered_at)}</td>
                    <td className="px-4 py-3">
                      <span className="tabular-nums">{formatIsoDate(w.expires_on)}</span>
                      <span className="mt-1 block">
                        <Badge tone={daysLeftTone(w.days_left)}>{daysLeftLabel(w.days_left)}</Badge>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {w.open_claims > 0 ? (
                        <Link to="/garantias?aba=acionamentos" className="text-[13px] underline">
                          Acionamento em andamento
                        </Link>
                      ) : (
                        can(['orders.create']) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setClaiming({ orderId: w.order_id, orderNumber: w.order_number, item: w })}
                          >
                            Acionar
                          </Button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={WARRANTY_PAGE_SIZE} total={list.data.count} onPage={setPage} />
        </>
      )}

      {claiming && (
        <OpenClaimDialog
          companyId={companyId}
          orderId={claiming.orderId}
          orderNumber={claiming.orderNumber}
          items={[claiming.item]}
          initialItemId={claiming.item.item_id}
          onClose={() => setClaiming(null)}
        />
      )}
    </section>
  )
}

function ClaimsTab({ companyId }: { companyId: string }) {
  const [status, setStatus] = useState<'' | 'pending' | WarrantyClaimStatus>('pending')
  const [page, setPage] = useState(0)
  const claims = useClaims(companyId, { status, page })

  return (
    <section className="grid gap-4">
      <label className="grid max-w-xs gap-1 text-[13px] text-muted">
        Situação
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status)
            setPage(0)
          }}
          className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]"
        >
          <option value="pending">Em andamento (em análise ou aceitas)</option>
          <option value="open">Em análise</option>
          <option value="accepted">Aceitas</option>
          <option value="resolved">Resolvidas</option>
          <option value="denied">Negadas</option>
          <option value="">Todas</option>
        </select>
      </label>

      {claims.isPending ? (
        <Spinner label="Carregando acionamentos" />
      ) : claims.isError ? (
        <ErrorState error={claims.error} onRetry={claims.refetch} />
      ) : claims.data.rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nenhum acionamento com esse filtro" />
      ) : (
        <>
          <ul className="surface divide-y divide-[var(--border)] rounded-lg text-sm" aria-busy={claims.isFetching}>
            {claims.data.rows.map((c) => (
              <li key={c.id} className="grid gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium tabular-nums">{formatCode('GA', c.number)}</span>
                  <Badge tone={claimStatusTone[c.status]}>{claimStatusLabels[c.status]}</Badge>
                  {!c.covered && <Badge tone="attn">Cortesia</Badge>}
                  <span className="text-muted">{c.original?.client?.name}</span>
                  <span className="ml-auto text-[13px] text-muted tabular-nums">{formatDate(c.created_at)}</span>
                </div>
                <p className="line-clamp-2">{c.reason}</p>
                <p className="flex flex-wrap gap-x-4 text-[13px]">
                  {c.original && (
                    <Link to={`/ordens/${c.original_order_id}`} className="underline underline-offset-4">
                      Original: {formatCode('OS', c.original.number)}
                    </Link>
                  )}
                  {c.returned && (
                    <Link to={`/ordens/${c.return_order_id}`} className="underline underline-offset-4">
                      Retorno: {formatCode('OS', c.returned.number)}
                    </Link>
                  )}
                  {c.item && <span className="text-muted">Item: {c.item.description}</span>}
                </p>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={WARRANTY_PAGE_SIZE} total={claims.data.count} onPage={setPage} />
        </>
      )}
    </section>
  )
}
