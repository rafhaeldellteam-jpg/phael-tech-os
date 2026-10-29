import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PackageCheck, Plus, Trash2, Truck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import { z } from 'zod'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField, TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Tabs } from '@/components/ui/Tabs'
import { TextAreaField } from '@/components/ui/TextArea'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import type { Database, Json, PurchaseStatus } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatCode, formatDate, formatPhone } from '@/lib/format'
import { centsToInput, formatBRL, parseMoney } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { formatTaxId, isValidTaxId, onlyDigits } from '@/lib/tax-id'
import { moneyField, moneyToCents } from '@/lib/zod-money'
import { NewEntryDialog } from '../finance/EntryDialogs'
import { inventoryKeys } from '../inventory/queries'
import { ProductPicker, type PickedProduct } from '../inventory/ProductPicker'

type Supplier = Database['public']['Tables']['suppliers']['Row']

const statusLabels: Record<PurchaseStatus, string> = { draft: 'Rascunho', received: 'Recebida', canceled: 'Cancelada' }

function useSuppliers(companyId: string) {
  return useQuery({
    queryKey: ['suppliers', companyId],
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('suppliers').select('*').eq('company_id', companyId).order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

function usePurchases(companyId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['purchases', companyId],
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('purchases')
        .select(
          'id, number, status, invoice_number, ordered_at, received_at, freight_cents, notes, supplier_id, supplier:suppliers!inner(id, name), items:purchase_items(id, qty, unit_cost_cents, product:products!inner(id, sku, name, unit, price_cents, cost_cents, qty_on_hand, tracks_serial))',
        )
        .eq('company_id', companyId)
        .order('number', { ascending: false })
        .limit(100)
      if (error) throw error
      return data ?? []
    },
  })
}

export function SuppliersPage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const [params, setParams] = useSearchParams()
  const canBuy = can(['suppliers.write'])
  const tab = params.get('aba') === 'compras' ? 'compras' : 'fornecedores'
  return (
    <div className="grid gap-5">
      <PageHeader title="Fornecedores e compras" description="Receber uma compra dá entrada no estoque e atualiza o custo médio das peças." />
      <Tabs
        label="Seções"
        items={[
          { key: 'fornecedores', label: 'Fornecedores' },
          { key: 'compras', label: 'Compras' },
        ]}
        value={tab}
        onChange={(k) => setParams(k === 'fornecedores' ? {} : { aba: k }, { replace: true })}
      />
      {tab === 'fornecedores' ? <SupplierList companyId={company.id} canWrite={canBuy} /> : <PurchaseList companyId={company.id} canBuy={canBuy} canReceive={can(['inventory.write'])} />}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Fornecedores
// -----------------------------------------------------------------------------
const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(160),
  taxId: z
    .string()
    .trim()
    .refine((v) => v === '' || isValidTaxId(v), 'CNPJ ou CPF inválido'),
  contact: z.string().trim().max(120),
  email: z.union([z.literal(''), z.email({ message: 'E-mail inválido' })]),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{10,13}$/.test(onlyDigits(v)), 'Telefone com DDD'),
  website: z.string().trim().max(200),
  notes: z.string().trim().max(2000),
  active: z.boolean(),
})
type SupplierValues = z.infer<typeof supplierSchema>

function SupplierList({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const suppliers = useSuppliers(companyId)
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  return (
    <section className="grid gap-3">
      {canWrite && (
        <Button className="justify-self-start" onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden /> Novo fornecedor
        </Button>
      )}
      {suppliers.isPending ? (
        <Spinner label="Carregando fornecedores" />
      ) : suppliers.isError ? (
        <ErrorState error={suppliers.error} onRetry={suppliers.refetch} />
      ) : suppliers.data.length === 0 ? (
        <EmptyState icon={Truck} title="Nenhum fornecedor cadastrado">
          Cadastre de quem você compra peças para registrar compras e custos.
        </EmptyState>
      ) : (
        <ul className="surface divide-y divide-[var(--border)] rounded-lg text-sm">
          {suppliers.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {s.name} {!s.active && <Badge tone="attn">Inativo</Badge>}
                </p>
                <p className="text-[13px] text-muted">
                  {[s.contact, formatPhone(s.phone), s.email, s.tax_id && formatTaxId(s.tax_id)].filter(Boolean).join(', ') || 'Sem contato'}
                </p>
              </div>
              {canWrite && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                  Editar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <SupplierDialog companyId={companyId} supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function SupplierDialog({ companyId, supplier, onClose }: { companyId: string; supplier: Supplier | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { register, handleSubmit, formState } = useForm<SupplierValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: supplier?.name ?? '',
      taxId: supplier?.tax_id ? formatTaxId(supplier.tax_id) : '',
      contact: supplier?.contact ?? '',
      email: supplier?.email ?? '',
      phone: formatPhone(supplier?.phone),
      website: supplier?.website ?? '',
      notes: supplier?.notes ?? '',
      active: supplier?.active ?? true,
    },
  })
  const e = formState.errors
  const save = useMutation({
    mutationFn: async (v: SupplierValues) => {
      const row = {
        name: v.name,
        tax_id: v.taxId ? onlyDigits(v.taxId) : null,
        contact: v.contact || null,
        email: v.email ? v.email.toLowerCase() : null,
        phone: v.phone ? onlyDigits(v.phone) : null,
        website: v.website || null,
        notes: v.notes || null,
        active: v.active,
      }
      const sb = requireSupabase()
      const { error } = supplier
        ? await sb.from('suppliers').update(row).eq('id', supplier.id)
        : await sb.from('suppliers').insert({ ...row, company_id: companyId })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers', companyId] })
      onClose()
    },
  })
  return (
    <FormDialog title={supplier ? `Editar ${supplier.name}` : 'Novo fornecedor'} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-4" noValidate>
        {save.isError && <Alert tone="error">{toUserMessage(save.error)}</Alert>}
        <TextField label="Nome" error={e.name?.message} {...register('name')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="CNPJ ou CPF" inputMode="numeric" error={e.taxId?.message} {...register('taxId')} />
          <TextField label="Contato" error={e.contact?.message} {...register('contact')} />
          <TextField label="Telefone" type="tel" error={e.phone?.message} {...register('phone')} />
          <TextField label="E-mail" type="email" error={e.email?.message} {...register('email')} />
        </div>
        <TextField label="Site ou loja" error={e.website?.message} {...register('website')} />
        <TextAreaField label="Observações" rows={2} error={e.notes?.message} {...register('notes')} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register('active')} className="size-4" /> Ativo
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {supplier ? 'Salvar alterações' : 'Cadastrar fornecedor'}
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}

// -----------------------------------------------------------------------------
// Compras
// -----------------------------------------------------------------------------
type PurchaseRow = NonNullable<ReturnType<typeof usePurchases>['data']>[number]

function PurchaseList({ companyId, canBuy, canReceive }: { companyId: string; canBuy: boolean; canReceive: boolean }) {
  const queryClient = useQueryClient()
  const { can } = useCompany()
  const canFinance = can(['finance.write'])
  const [payable, setPayable] = useState<PurchaseRow | null>(null)
  const purchases = usePurchases(companyId, true)
  const [editing, setEditing] = useState<PurchaseRow | 'new' | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'receive' | 'cancel'; row: PurchaseRow } | null>(null)

  const act = useMutation({
    mutationFn: async ({ kind, id }: { kind: 'receive' | 'cancel'; id: string }) => {
      const sb = requireSupabase()
      const { error } = kind === 'receive' ? await sb.rpc('receive_purchase', { p_purchase_id: id }) : await sb.rpc('cancel_purchase', { p_purchase_id: id })
      if (error) throw error
    },
    onSuccess: async () => {
      setConfirm(null)
      await queryClient.invalidateQueries({ queryKey: ['purchases', companyId] })
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.all(companyId) })
    },
  })

  return (
    <section className="grid gap-3">
      {canBuy && (
        <Button className="justify-self-start" onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden /> Nova compra
        </Button>
      )}
      {act.isError && <Alert tone="error">{toUserMessage(act.error)}</Alert>}
      {purchases.isPending ? (
        <Spinner label="Carregando compras" />
      ) : purchases.isError ? (
        <ErrorState error={purchases.error} onRetry={purchases.refetch} />
      ) : purchases.data.length === 0 ? (
        <EmptyState icon={PackageCheck} title="Nenhuma compra registrada">
          Registre a compra de peças e clique em Receber quando a mercadoria chegar: o estoque e o custo médio são atualizados.
        </EmptyState>
      ) : (
        <ul className="surface divide-y divide-[var(--border)] rounded-lg text-sm">
          {purchases.data.map((p) => {
            const total = p.items.reduce((a, i) => a + i.qty * i.unit_cost_cents, 0) + p.freight_cents
            return (
              <li key={p.id} className="grid gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold tabular-nums">{formatCode('CP', p.number)}</span>
                  <span className="min-w-0 flex-1 truncate">{p.supplier.name}</span>
                  <Badge tone={p.status === 'received' ? 'ok' : p.status === 'canceled' ? 'danger' : 'attn'}>{statusLabels[p.status]}</Badge>
                  <span className="font-semibold tabular-nums">{formatBRL(total)}</span>
                </div>
                <p className="text-[13px] text-muted">
                  {formatDate(p.ordered_at + 'T12:00:00')}
                  {p.invoice_number && `, NF ${p.invoice_number}`}
                  {p.received_at && `, recebida em ${formatDate(p.received_at)}`}
                  {': '}
                  {p.items.map((i) => `${i.qty}× ${i.product.name}`).join('; ')}
                </p>
                {p.status === 'received' && canFinance && (
                  <div>
                    <Button size="sm" variant="secondary" onClick={() => setPayable(p)}>
                      Lançar conta a pagar
                    </Button>
                  </div>
                )}
                {p.status === 'draft' && (canBuy || canReceive) && (
                  <div className="flex flex-wrap gap-2">
                    {canReceive && (
                      <Button size="sm" onClick={() => setConfirm({ kind: 'receive', row: p })}>
                        <PackageCheck className="size-4" aria-hidden /> Receber
                      </Button>
                    )}
                    {canBuy && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                          Editar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'cancel', row: p })}>
                          Cancelar compra
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {editing && <PurchaseDialog companyId={companyId} purchase={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {payable && (
        <NewEntryDialog
          companyId={companyId}
          direction="out"
          preset={{
            description: `Compra ${formatCode('CP', payable.number)}, ${payable.supplier.name}`,
            amountCents: payable.items.reduce((a, i) => a + i.qty * i.unit_cost_cents, 0) + payable.freight_cents,
            purchaseId: payable.id,
          }}
          onClose={() => setPayable(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === 'receive' ? `Receber ${confirm ? formatCode('CP', confirm.row.number) : ''}?` : 'Cancelar compra?'}
        description={
          confirm?.kind === 'receive'
            ? 'Todos os itens entram no estoque agora e o custo médio é recalculado. Depois de recebida, a compra não pode ser editada; devoluções são feitas pelo ajuste de estoque.'
            : 'A compra fica registrada como cancelada e nada entra no estoque.'
        }
        confirmLabel={confirm?.kind === 'receive' ? 'Receber e dar entrada' : 'Cancelar compra'}
        tone={confirm?.kind === 'receive' ? 'primary' : 'danger'}
        loading={act.isPending}
        onConfirm={() => confirm && act.mutate({ kind: confirm.kind, id: confirm.row.id })}
      />
    </section>
  )
}

interface ItemDraft {
  key: number
  product: PickedProduct | null
  qty: string
  cost: string
}

function PurchaseDialog({ companyId, purchase, onClose }: { companyId: string; purchase: PurchaseRow | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const suppliers = useSuppliers(companyId)
  const [supplierId, setSupplierId] = useState(purchase?.supplier_id ?? '')
  const [invoice, setInvoice] = useState(purchase?.invoice_number ?? '')
  const [orderedAt, setOrderedAt] = useState(purchase?.ordered_at ?? new Date().toISOString().slice(0, 10))
  const [freight, setFreight] = useState(purchase ? centsToInput(purchase.freight_cents) : '')
  const [notes, setNotes] = useState(purchase?.notes ?? '')
  const [items, setItems] = useState<ItemDraft[]>(
    purchase
      ? purchase.items.map((i, n) => ({ key: n, product: i.product, qty: String(i.qty), cost: centsToInput(i.unit_cost_cents) }))
      : [{ key: 0, product: null, qty: '1', cost: '' }],
  )
  const [touched, setTouched] = useState(false)

  const freightOk = moneyField('Frete').safeParse(freight).success
  const itemErrors = items.map((i) => ({
    product: i.product ? undefined : 'Escolha o produto',
    qty: /^\d+$/.test(i.qty) && Number(i.qty) > 0 ? undefined : 'Qtd. inteira',
    cost: i.cost.trim() !== '' && (parseMoney(i.cost) ?? -1) >= 0 ? undefined : 'Custo inválido',
  }))
  const valid = Boolean(supplierId) && freightOk && items.length > 0 && itemErrors.every((e) => !e.product && !e.qty && !e.cost)
  const total =
    items.reduce((a, i) => a + (/^\d+$/.test(i.qty) ? Number(i.qty) : 0) * Math.max(parseMoney(i.cost) ?? 0, 0), 0) + (freightOk ? moneyToCents(freight) : 0)

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('save_purchase', {
        p_company_id: companyId,
        p_purchase_id: purchase?.id ?? null,
        p_data: {
          supplier_id: supplierId,
          invoice_number: invoice,
          ordered_at: orderedAt,
          freight_cents: moneyToCents(freight),
          notes,
          items: items.map((i) => ({ product_id: i.product?.id, qty: Number(i.qty), unit_cost_cents: parseMoney(i.cost) })),
        } as Json,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchases', companyId] })
      onClose()
    },
  })

  const update = (key: number, patch: Partial<ItemDraft>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  return (
    <FormDialog title={purchase ? `Editar ${formatCode('CP', purchase.number)}` : 'Nova compra'} description="Fica como rascunho até você receber a mercadoria." onClose={onClose} wide>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (valid) save.mutate()
        }}
      >
        {save.isError && <Alert tone="error">{toUserMessage(save.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Fornecedor" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} error={touched && !supplierId ? 'Escolha o fornecedor' : undefined}>
            <option value="">Escolha</option>
            {(suppliers.data ?? [])
              .filter((s) => s.active || s.id === supplierId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </SelectField>
          <TextField label="Nota fiscal (opcional)" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          <TextField label="Data do pedido" type="date" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} />
          <TextField label="Frete (R$)" inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} error={touched && !freightOk ? 'Valor inválido' : undefined} />
        </div>

        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-semibold">Itens</legend>
          {items.map((i, n) => (
            <div key={i.key} className="grid items-start gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_90px_130px_auto]">
              <ProductPicker
                companyId={companyId}
                label={`Produto ${n + 1}`}
                value={i.product}
                error={touched ? itemErrors[n]?.product : undefined}
                onChange={(p) => update(i.key, { product: p, cost: i.cost || (p ? centsToInput(p.cost_cents) : '') })}
              />
              <TextField label="Qtd." inputMode="numeric" value={i.qty} onChange={(e) => update(i.key, { qty: e.target.value })} error={touched ? itemErrors[n]?.qty : undefined} />
              <TextField label="Custo un. (R$)" inputMode="decimal" value={i.cost} onChange={(e) => update(i.key, { cost: e.target.value })} error={touched ? itemErrors[n]?.cost : undefined} />
              <Button
                variant="ghost"
                size="sm"
                className="sm:mt-[26px]"
                aria-label={`Remover item ${n + 1}`}
                disabled={items.length === 1}
                onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            className="justify-self-start"
            onClick={() => setItems((list) => [...list, { key: Math.max(...list.map((x) => x.key)) + 1, product: null, qty: '1', cost: '' }])}
          >
            <Plus className="size-4" aria-hidden /> Adicionar item
          </Button>
        </fieldset>

        <TextAreaField label="Observações" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            Total da compra: <strong className="tabular-nums">{formatBRL(total)}</strong>
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.isPending}>
              Salvar rascunho
            </Button>
          </div>
        </div>
      </form>
    </FormDialog>
  )
}
