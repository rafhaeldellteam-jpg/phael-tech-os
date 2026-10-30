import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Link2, MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { toUserMessage } from '@/lib/errors'
import { formatCode, formatDate, formatDateTime, whatsappLink } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { orderKeys } from '../orders/queries'

const linksKey = (companyId: string, orderId: string) => [...orderKeys.all(companyId), 'portal', orderId] as const

/** Link de acompanhamento para o cliente (portal sem login). */
export function OrderShare({
  companyId,
  orderId,
  orderNumber,
  clientName,
  clientPhone,
  canShare,
}: {
  companyId: string
  orderId: string
  orderNumber: number
  clientName: string
  clientPhone: string | null
  canShare: boolean
}) {
  const queryClient = useQueryClient()
  const [days, setDays] = useState('30')
  const [fresh, setFresh] = useState<{ url: string; expires: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const links = useQuery({
    queryKey: linksKey(companyId, orderId),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('portal_links')
        .select('id, expires_at, revoked_at, created_at, last_viewed_at, view_count')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: linksKey(companyId, orderId) }),
      queryClient.invalidateQueries({ queryKey: orderKeys.events(companyId, orderId) }),
    ])

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await requireSupabase().rpc('create_portal_link', { p_order_id: orderId, p_days: Number(days) })
      if (error) throw error
      const row = data?.[0]
      if (!row) throw new Error('O link não foi gerado')
      return { url: `${window.location.origin}/acompanhar/${row.token}`, expires: row.expires_at }
    },
    onSuccess: async (r) => {
      setFresh(r)
      setCopied(false)
      await refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await requireSupabase().rpc('revoke_portal_link', { p_link_id: id })
      if (error) throw error
    },
    onSuccess: refresh,
  })

  const now = Date.now()
  const active = (links.data ?? []).filter((l) => !l.revoked_at && new Date(l.expires_at).getTime() > now)
  const message = fresh
    ? `Olá, ${clientName.split(' ')[0]}! Acompanhe a sua ${formatCode('OS', orderNumber)} na Phael Tech Support por este link: ${fresh.url}`
    : ''

  return (
    <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="portal-h">
      <div className="grid gap-1">
        <h2 id="portal-h" className="font-semibold">
          Link para o cliente
        </h2>
        <p className="text-[13px] text-muted">
          O cliente acompanha a OS sem login e aprova ou recusa o orçamento quando ela estiver em "Aguardando aprovação". Ele não vê custos, notas internas nem senhas.
        </p>
      </div>
      {(create.isError || revoke.isError) && <Alert tone="error">{toUserMessage(create.error ?? revoke.error)}</Alert>}

      {fresh && (
        <div className="grid gap-2 rounded-md border border-ok-500 p-3 text-sm">
          <p className="font-medium">Link gerado (válido até {formatDate(fresh.expires)}). Ele aparece só agora: copie ou envie.</p>
          <input readOnly value={fresh.url} onFocus={(e) => e.currentTarget.select()} className="h-9 w-full rounded-md border border-line bg-[var(--surface)] px-2 text-[13px]" aria-label="Link de acompanhamento" />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(fresh.url).then(() => setCopied(true))
              }}
            >
              <Copy className="size-4" aria-hidden /> {copied ? 'Copiado' : 'Copiar link'}
            </Button>
            {clientPhone && (
              <a
                href={`${whatsappLink(clientPhone)}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-2 rounded-md bg-ok-600 px-3 text-sm font-medium text-white hover:brightness-110"
              >
                <MessageCircle className="size-4" aria-hidden /> Enviar pelo WhatsApp
              </a>
            )}
          </div>
        </div>
      )}

      {canShare && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[13px] text-muted">
            Validade
            <select value={days} onChange={(e) => setDays(e.target.value)} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]">
              <option value="7">7 dias</option>
              <option value="30">30 dias</option>
              <option value="90">90 dias</option>
              <option value="180">180 dias</option>
            </select>
          </label>
          <Button variant="secondary" loading={create.isPending} onClick={() => create.mutate()}>
            <Link2 className="size-4" aria-hidden /> Gerar link
          </Button>
        </div>
      )}

      {(links.data ?? []).length > 0 && (
        <ul className="grid gap-1.5 text-[13px]">
          {(links.data ?? []).map((l) => {
            const isActive = active.some((a) => a.id === l.id)
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={isActive ? 'ok' : 'neutral'}>{l.revoked_at ? 'Revogado' : isActive ? 'Ativo' : 'Vencido'}</Badge>
                <span className="text-muted">
                  criado em {formatDateTime(l.created_at)}, vale até {formatDate(l.expires_at)}, {l.view_count} acesso(s)
                  {l.last_viewed_at && `, último em ${formatDateTime(l.last_viewed_at)}`}
                </span>
                {isActive && canShare && (
                  <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === l.id} onClick={() => revoke.mutate(l.id)}>
                    Revogar
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
