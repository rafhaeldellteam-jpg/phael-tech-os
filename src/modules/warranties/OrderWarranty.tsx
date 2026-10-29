import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Spinner } from '@/components/ui/Spinner'
import type { WarrantyClaimStatus } from '@/lib/database.types'
import { formatCode } from '@/lib/format'
import { formatIsoDate } from '../finance/period'
import { DecideClaimDialog, OpenClaimDialog } from './ClaimDialogs'
import { claimStatusLabels, claimStatusTone, daysLeftLabel, daysLeftTone, nextClaimStatuses } from './meta'
import { useOrderClaims, useOrderWarranties } from './queries'

/**
 * Painel de garantia na OS.
 * - OS original entregue: prazos por item e botão de acionamento.
 * - OS de retorno: vínculo com a original e decisão do acionamento.
 */
export function OrderWarranty({
  companyId,
  order,
  canCreate,
  canDecide,
}: {
  companyId: string
  order: { id: string; number: number; delivered_at: string | null; warranty_of: string | null }
  canCreate: boolean
  canDecide: boolean
}) {
  const isReturn = Boolean(order.warranty_of)
  const items = useOrderWarranties(companyId, order.id, Boolean(order.delivered_at) && !isReturn)
  const claims = useOrderClaims(companyId, order.id)
  const [opening, setOpening] = useState(false)
  const [deciding, setDeciding] = useState<{ claim: { id: string; number: number }; to: WarrantyClaimStatus } | null>(null)

  const hasItems = (items.data ?? []).length > 0
  if (!isReturn && !order.delivered_at && (claims.data ?? []).length === 0) return null
  if (!isReturn && items.isSuccess && !hasItems && claims.isSuccess && claims.data.length === 0) {
    return (
      <section className="surface grid gap-2 rounded-lg p-5" aria-labelledby="garantia-h">
        <h2 id="garantia-h" className="font-semibold">
          Garantia
        </h2>
        <p className="text-sm text-muted">Nenhum serviço ou peça desta OS tem prazo de garantia. Defina a garantia no catálogo, no produto ou ao lançar o item.</p>
      </section>
    )
  }

  return (
    <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="garantia-h">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="garantia-h" className="flex-1 font-semibold">
          Garantia
        </h2>
        {!isReturn && canCreate && hasItems && (
          <Button size="sm" variant="secondary" onClick={() => setOpening(true)}>
            <ShieldCheck className="size-4" aria-hidden /> Acionar garantia
          </Button>
        )}
      </div>

      {!isReturn &&
        (items.isPending ? (
          <Spinner label="Carregando prazos" />
        ) : items.isError ? (
          <ErrorState error={items.error} onRetry={items.refetch} />
        ) : (
          hasItems && (
            <ul className="divide-y divide-[var(--border)] text-sm">
              {items.data.map((i) => (
                <li key={i.item_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-0 flex-1">
                    {i.description}
                    <span className="block text-[13px] text-muted">
                      {i.warranty_days} dias, até {formatIsoDate(i.expires_on)}
                    </span>
                  </span>
                  <Badge tone={daysLeftTone(i.days_left)}>{daysLeftLabel(i.days_left)}</Badge>
                </li>
              ))}
            </ul>
          )
        ))}

      {claims.isError && <ErrorState error={claims.error} onRetry={claims.refetch} />}
      {(claims.data ?? []).length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-muted">{isReturn ? 'Acionamento' : 'Acionamentos'}</h3>
          <ul className="grid gap-3 text-sm">
            {(claims.data ?? []).map((c) => {
              const other = isReturn
                ? { id: c.original_order_id, number: c.original?.number, prefix: 'Garantia da' }
                : { id: c.return_order_id, number: c.returned?.number, prefix: 'Retorno na' }
              return (
                <li key={c.id} className="grid gap-1.5 rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{formatCode('GA', c.number)}</span>
                    <Badge tone={claimStatusTone[c.status]}>{claimStatusLabels[c.status]}</Badge>
                    {!c.covered && <Badge tone="attn">Cortesia</Badge>}
                    {other.number != null && (
                      <Link to={`/ordens/${other.id}`} className="ml-auto underline underline-offset-4">
                        {other.prefix} {formatCode('OS', other.number)}
                      </Link>
                    )}
                  </div>
                  {c.item && <p className="text-muted">Item: {c.item.description}</p>}
                  <p className="whitespace-pre-line">{c.reason}</p>
                  {c.courtesy_reason && <p className="text-muted">Cortesia: {c.courtesy_reason}</p>}
                  {c.resolution && <p className="text-muted">Parecer: {c.resolution}</p>}
                  {canDecide && nextClaimStatuses(c.status).length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {nextClaimStatuses(c.status).map((to) => (
                        <Button
                          key={to}
                          size="sm"
                          variant={to === 'denied' ? 'ghost' : 'secondary'}
                          onClick={() => setDeciding({ claim: { id: c.id, number: c.number }, to })}
                        >
                          {to === 'accepted' ? 'Aceitar' : to === 'denied' ? 'Negar' : 'Marcar resolvida'}
                        </Button>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {opening && (
        <OpenClaimDialog companyId={companyId} orderId={order.id} orderNumber={order.number} items={items.data ?? []} onClose={() => setOpening(false)} />
      )}
      {deciding && <DecideClaimDialog companyId={companyId} claim={deciding.claim} to={deciding.to} onClose={() => setDeciding(null)} />}
    </section>
  )
}
