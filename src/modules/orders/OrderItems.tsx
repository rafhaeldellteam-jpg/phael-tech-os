import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Package, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { Spinner } from '@/components/ui/Spinner'
import { useCompany } from '@/core/company/useCompany'
import type { Json } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { centsToInput, formatBRL, marginPercent, parseMoney } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { useCatalog } from '../catalog/queries'
import { inventoryKeys } from '../inventory/queries'
import { ProductPicker, type PickedProduct } from '../inventory/ProductPicker'
import { orderKeys } from './queries'

const itemsKey = (companyId: string, orderId: string) => [...orderKeys.all(companyId), 'items', orderId] as const

/** Serviços e peças da OS, com totais. Custo e margem só para quem vê financeiro/estoque. */
export function OrderItems({ companyId, orderId, editable }: { companyId: string; orderId: string; editable: boolean }) {
  const { can } = useCompany()
  const canEdit = editable && can(['orders.update'])
  const [adding, setAdding] = useState<'service' | 'part' | null>(null)
  const [removing, setRemoving] = useState<{ id: string; description: string } | null>(null)

  const items = useQuery({
    queryKey: itemsKey(companyId, orderId),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('service_order_items')
        .select('id, kind, description, qty, unit_price_cents, unit_cost_cents, discount_cents, serial_number, warranty_days, returned_at, returned_reason')
        .eq('order_id', orderId)
        .order('created_at')
      if (error) throw error
      return data ?? []
    },
  })
  const totals = useQuery({
    queryKey: [...itemsKey(companyId, orderId), 'totals'],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('service_order_totals', { p_order_id: orderId })
      if (error) throw error
      return data?.[0] ?? null
    },
  })

  const active = (items.data ?? []).filter((i) => !i.returned_at)
  const removed = (items.data ?? []).filter((i) => i.returned_at)
  const t = totals.data

  return (
    <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="itens-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="itens-h" className="font-semibold">
          Serviços e peças
        </h2>
        {canEdit && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAdding('service')}>
              <Wrench className="size-4" aria-hidden /> Serviço
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAdding('part')}>
              <Package className="size-4" aria-hidden /> Peça
            </Button>
          </div>
        )}
      </div>

      {items.isPending ? (
        <Spinner label="Carregando itens" />
      ) : items.isError ? (
        <Alert tone="error">{toUserMessage(items.error)}</Alert>
      ) : active.length === 0 ? (
        <p className="text-sm text-muted">
          Nenhum serviço ou peça lançado. {canEdit ? 'Peças lançadas saem do estoque na hora.' : ''}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)] text-sm">
          {active.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start gap-3 py-2">
              {i.kind === 'part' ? <Package className="mt-0.5 size-4 text-muted" aria-label="Peça" /> : <Wrench className="mt-0.5 size-4 text-muted" aria-label="Serviço" />}
              <div className="min-w-0 flex-1">
                <p>
                  {i.description}
                  {i.qty > 1 && <span className="text-muted tabular-nums"> × {i.qty}</span>}
                </p>
                <p className="text-[13px] text-muted">
                  {[
                    i.serial_number && `S/N ${i.serial_number}`,
                    i.warranty_days != null && `garantia ${i.warranty_days} dias`,
                    i.discount_cents > 0 && `desconto ${formatBRL(i.discount_cents)}`,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              </div>
              <span className="tabular-nums">{formatBRL(i.qty * i.unit_price_cents - i.discount_cents)}</span>
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => setRemoving({ id: i.id, description: i.description })}>
                  Remover
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {t && active.length > 0 && (
        <dl className="grid gap-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Serviços</dt>
            <dd className="tabular-nums">{formatBRL(t.services_cents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Peças</dt>
            <dd className="tabular-nums">{formatBRL(t.parts_cents)}</dd>
          </div>
          {t.discount_cents > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">Descontos</dt>
              <dd className="tabular-nums">−{formatBRL(t.discount_cents)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatBRL(t.total_cents)}</dd>
          </div>
          {t.cost_cents != null && t.margin_cents != null && (
            <div className="flex justify-between text-[13px] text-muted">
              <dt>Custo real e margem (interno)</dt>
              <dd className="tabular-nums">
                {formatBRL(t.cost_cents)}, margem {formatBRL(t.margin_cents)}
                {marginPercent(t.total_cents, t.cost_cents) != null && ` (${marginPercent(t.total_cents, t.cost_cents)}%)`}
              </dd>
            </div>
          )}
        </dl>
      )}

      {removed.length > 0 && (
        <details className="text-[13px] text-muted">
          <summary className="cursor-pointer">{removed.length} item(ns) removido(s)</summary>
          <ul className="mt-1 grid gap-1">
            {removed.map((i) => (
              <li key={i.id}>
                {i.description} × {i.qty}: {i.returned_reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {adding && <AddItemDialog companyId={companyId} orderId={orderId} kind={adding} onClose={() => setAdding(null)} />}
      {removing && <RemoveItemDialog companyId={companyId} orderId={orderId} item={removing} onClose={() => setRemoving(null)} />}
    </section>
  )
}

function useInvalidateItems(companyId: string, orderId: string) {
  const queryClient = useQueryClient()
  return async () => {
    await queryClient.invalidateQueries({ queryKey: itemsKey(companyId, orderId) })
    await queryClient.invalidateQueries({ queryKey: orderKeys.events(companyId, orderId) })
    await queryClient.invalidateQueries({ queryKey: inventoryKeys.all(companyId) })
  }
}

function AddItemDialog({ companyId, orderId, kind, onClose }: { companyId: string; orderId: string; kind: 'service' | 'part'; onClose: () => void }) {
  const invalidate = useInvalidateItems(companyId, orderId)
  const catalog = useCatalog(companyId, kind === 'service')
  const [catalogId, setCatalogId] = useState('')
  const [product, setProduct] = useState<PickedProduct | null>(null)
  const [description, setDescription] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [discount, setDiscount] = useState('')
  const [serial, setSerial] = useState('')
  const [touched, setTouched] = useState(false)

  const services = (catalog.data ?? []).filter((s) => s.active)
  const qtyNum = /^\d+$/.test(qty) ? Number(qty) : 0
  const priceCents = price.trim() === '' ? null : parseMoney(price)
  const discountCents = discount.trim() === '' ? 0 : parseMoney(discount)

  const errors = {
    pick: kind === 'part' && !product ? 'Escolha a peça' : kind === 'service' && !catalogId && !description.trim() ? 'Escolha do catálogo ou descreva o serviço' : undefined,
    qty: qtyNum <= 0 ? 'Quantidade inteira' : kind === 'part' && product && qtyNum > product.qty_on_hand ? `Só há ${product.qty_on_hand} em estoque` : undefined,
    price: priceCents === null || priceCents < 0 ? 'Valor inválido' : undefined,
    discount: discountCents === null || discountCents < 0 ? 'Desconto inválido' : priceCents !== null && discountCents > qtyNum * priceCents ? 'Desconto maior que o valor' : undefined,
    serial: kind === 'part' && product?.tracks_serial && !serial.trim() ? 'Informe o número de série' : undefined,
  }
  const valid = Object.values(errors).every((e) => !e)

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('add_order_item', {
        p_order_id: orderId,
        p_data: {
          kind,
          catalog_id: kind === 'service' ? catalogId : undefined,
          product_id: kind === 'part' ? product?.id : undefined,
          description: description.trim() || undefined,
          qty: qtyNum,
          unit_price_cents: priceCents,
          discount_cents: discountCents ?? 0,
          serial_number: serial.trim() || undefined,
        } as Json,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })

  return (
    <FormDialog
      title={kind === 'service' ? 'Lançar serviço' : 'Lançar peça'}
      description={kind === 'part' ? 'A peça sai do estoque agora. Se for removida da OS, volta ao estoque.' : 'O preço vem do catálogo e pode ser ajustado para esta OS.'}
      onClose={onClose}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (valid) add.mutate()
        }}
      >
        {add.isError && <Alert tone="error">{toUserMessage(add.error)}</Alert>}
        {kind === 'service' ? (
          <>
            <SelectField
              label="Serviço do catálogo"
              value={catalogId}
              onChange={(e) => {
                setCatalogId(e.target.value)
                const s = services.find((x) => x.id === e.target.value)
                if (s) {
                  setPrice(centsToInput(s.price_cents))
                  setDescription('')
                }
              }}
              error={touched ? errors.pick : undefined}
            >
              <option value="">Serviço avulso (descrever abaixo)</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.price_cents ? formatBRL(s.price_cents) : 'sem preço'})
                </option>
              ))}
            </SelectField>
            <TextField
              label={catalogId ? 'Descrição (opcional, substitui o nome)' : 'Descrição'}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </>
        ) : (
          <>
            <ProductPicker
              companyId={companyId}
              label="Peça"
              value={product}
              error={touched ? errors.pick : undefined}
              onChange={(p) => {
                setProduct(p)
                if (p) setPrice(centsToInput(p.price_cents))
              }}
            />
            {product?.tracks_serial && (
              <TextField label="Número de série da peça" value={serial} onChange={(e) => setSerial(e.target.value)} error={touched ? errors.serial : undefined} />
            )}
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Quantidade" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} error={touched || errors.qty?.startsWith('Só') ? errors.qty : undefined} />
          <TextField label="Valor unitário (R$)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} error={touched ? errors.price : undefined} />
          <TextField label="Desconto (R$)" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} error={touched ? errors.discount : undefined} />
        </div>
        {priceCents !== null && priceCents >= 0 && qtyNum > 0 && (
          <p className="text-sm">
            Subtotal: <strong className="tabular-nums">{formatBRL(qtyNum * priceCents - (discountCents ?? 0))}</strong>
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={add.isPending}>
            {kind === 'part' ? 'Lançar e baixar do estoque' : 'Lançar serviço'}
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}

function RemoveItemDialog({
  companyId,
  orderId,
  item,
  onClose,
}: {
  companyId: string
  orderId: string
  item: { id: string; description: string }
  onClose: () => void
}) {
  const invalidate = useInvalidateItems(companyId, orderId)
  const [reason, setReason] = useState('')
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('remove_order_item', { p_item_id: item.id, p_reason: reason })
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })
  return (
    <FormDialog title={`Remover ${item.description}?`} description="Peças voltam ao estoque. O item continua registrado como removido, com o motivo." onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (reason.trim()) remove.mutate()
        }}
      >
        {remove.isError && <Alert tone="error">{toUserMessage(remove.error)}</Alert>}
        <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cliente não aprovou a troca" />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" loading={remove.isPending} disabled={!reason.trim()}>
            Remover item
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}
