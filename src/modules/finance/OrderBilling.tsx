import { useQuery } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useCompany } from '@/core/company/useCompany'
import { formatCode } from '@/lib/format'
import { formatBRL } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { EntryDialog, NewEntryDialog, type EntryRef } from './EntryDialogs'
import { formatIsoDate } from './period'
import { statusLabels, useOrderEntries } from './queries'

/** Cobrança da OS: contas a receber vinculadas, com geração a partir do total. */
export function OrderBilling({ companyId, orderId, orderNumber }: { companyId: string; orderId: string; orderNumber: number }) {
  const { can } = useCompany()
  const canRead = can(['finance.read'])
  const canWrite = can(['finance.write'])
  const entries = useOrderEntries(companyId, orderId, canRead)
  const totals = useQuery({
    queryKey: ['orders', companyId, 'items', orderId, 'totals'],
    enabled: canRead,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('service_order_totals', { p_order_id: orderId })
      if (error) throw error
      return data?.[0] ?? null
    },
  })
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<EntryRef | null>(null)
  if (!canRead) return null

  const active = (entries.data ?? []).filter((e) => e.status !== 'canceled')
  const billed = active.reduce((a, e) => a + e.amount_cents, 0)
  const received = active.reduce((a, e) => a + e.paid_cents, 0)
  const total = totals.data?.total_cents ?? 0
  const toBill = Math.max(total - billed, 0)

  return (
    <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="cobranca-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cobranca-h" className="font-semibold">
          Cobrança
        </h2>
        {canWrite && toBill > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            <Receipt className="size-4" aria-hidden /> Gerar cobrança
          </Button>
        )}
      </div>
      {entries.isPending ? (
        <Spinner label="Carregando" />
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-[13px] text-muted">Total da OS</dt>
              <dd className="tabular-nums">{formatBRL(total)}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted">Cobrado</dt>
              <dd className="tabular-nums">{formatBRL(billed)}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted">Recebido</dt>
              <dd className={`tabular-nums ${received < billed ? 'text-attn-600' : ''}`}>{formatBRL(received)}</dd>
            </div>
          </dl>
          {billed > total && <p className="text-[13px] text-attn-600">O valor cobrado passou do total atual da OS. Confira se algum item foi removido.</p>}
          {(entries.data ?? []).length > 0 && (
            <ul className="grid gap-1 text-sm">
              {(entries.data ?? []).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2">
                  <button type="button" className="flex-1 text-left hover:underline" onClick={() => setOpen(e)}>
                    {e.installment_count > 1 ? `Parcela ${e.installment_no}/${e.installment_count}` : 'À vista'}, vence {formatIsoDate(e.due_date)}
                  </button>
                  <Badge tone={e.status === 'paid' ? 'ok' : e.status === 'canceled' ? 'danger' : e.status === 'partial' ? 'attn' : 'neutral'}>{statusLabels[e.status]}</Badge>
                  <span className="tabular-nums">{formatBRL(e.amount_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {creating && (
        <NewEntryDialog
          companyId={companyId}
          direction="in"
          preset={{ description: `${formatCode('OS', orderNumber)}`, amountCents: toBill, orderId }}
          onClose={() => setCreating(false)}
        />
      )}
      {open && <EntryDialog companyId={companyId} entry={open} canWrite={canWrite} onClose={() => setOpen(null)} />}
    </section>
  )
}
