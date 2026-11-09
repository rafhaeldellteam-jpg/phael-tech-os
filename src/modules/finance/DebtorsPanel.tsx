import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, HandCoins, MessageCircle, Plus, Search, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField, TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { Spinner } from '@/components/ui/Spinner'
import { useCompany } from '@/core/company/useCompany'
import type { Json, PaymentMethod } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatCode, whatsappLink } from '@/lib/format'
import { formatBRL } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { groupByClient, planLabel, type Debt, type Installment } from './debtors'
import { NewEntryDialog } from './EntryDialogs'
import { formatIsoDate, isoDate } from './period'
import { financeKeys, methodLabels } from './queries'

type PayTarget = { kind: 'one'; debt: Debt; inst: Installment } | { kind: 'all'; debt: Debt }

/** Clientes devendo: quanto, como foi combinado (à vista/parcelado, forma) e marcar parcelas como pagas. */
export function DebtorsPanel({ companyId }: { companyId: string }) {
  const { can } = useCompany()
  const canRead = can(['finance.read'])
  const canWrite = can(['finance.write'])
  const queryClient = useQueryClient()
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [paying, setPaying] = useState<PayTarget | null>(null)
  const [unpaying, setUnpaying] = useState<{ debt: Debt; inst: Installment } | null>(null)

  const list = useQuery({
    queryKey: [...financeKeys.all(companyId), 'receivables', onlyOpen],
    enabled: canRead,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('receivables_by_client', { p_company_id: companyId, p_only_open: onlyOpen })
      if (error) throw error
      return (data ?? []) as unknown as Debt[]
    },
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: financeKeys.all(companyId) })

  const setMethod = useMutation({
    mutationFn: async (v: { groupId: string; method: PaymentMethod }) => {
      const { error } = await requireSupabase().rpc('set_entry_group_method', { p_group_id: v.groupId, p_method: v.method })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const unpay = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await requireSupabase().rpc('unpay_installment', { p_entry_id: entryId })
      if (error) throw error
    },
    onSuccess: async () => {
      setUnpaying(null)
      await invalidate()
    },
  })

  const groups = useMemo(() => {
    const term = q.trim().toLocaleLowerCase('pt-BR')
    const all = groupByClient(list.data ?? [])
    return term ? all.filter((g) => g.name.toLocaleLowerCase('pt-BR').includes(term)) : all
  }, [list.data, q])
  const totals = useMemo(() => {
    const all = groupByClient(list.data ?? [])
    return {
      open: all.reduce((a, g) => a + g.open, 0),
      overdue: all.reduce((a, g) => a + g.overdue, 0),
      clients: all.filter((g) => g.open > 0).length,
    }
  }, [list.data])

  if (!canRead) return <Alert tone="warning">Você não tem acesso ao financeiro.</Alert>
  const today = isoDate(new Date())

  return (
    <div className="grid gap-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Tile label="A receber" value={formatBRL(totals.open)} />
        <Tile label="Vencido" value={formatBRL(totals.overdue)} danger={totals.overdue > 0} />
        <Tile label="Clientes devendo" value={String(totals.clients)} />
      </dl>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 grow">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar cliente"
            aria-label="Buscar cliente"
            className="h-10 w-full rounded-md border border-line bg-[var(--surface)] pr-3 pl-9 text-sm"
          />
        </div>
        <SelectField label="Mostrar" value={onlyOpen ? 'open' : 'all'} onChange={(e) => setOnlyOpen(e.target.value === 'open')}>
          <option value="open">Só quem está devendo</option>
          <option value="all">Todas as cobranças (inclui quitadas)</option>
        </SelectField>
        {canWrite && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> Nova cobrança
          </Button>
        )}
      </div>

      {(setMethod.isError || unpay.isError) && <Alert tone="error">{toUserMessage(setMethod.error ?? unpay.error)}</Alert>}

      {list.isPending ? (
        <Spinner label="Carregando cobranças" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState icon={HandCoins} title={q ? 'Nenhum cliente encontrado' : onlyOpen ? 'Ninguém devendo' : 'Nenhuma cobrança'}>
          {onlyOpen && !q ? 'Todas as cobranças a receber estão pagas.' : undefined}
        </EmptyState>
      ) : (
        <ul className="grid gap-4">
          {groups.map((g) => (
            <li key={g.key}>
              <section className="surface grid gap-3 rounded-lg p-4" aria-label={g.name}>
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid gap-0.5">
                    <h3 className="font-semibold">{g.name}</h3>
                    <p className="text-sm">
                      {g.open > 0 ? (
                        <>
                          Devendo <strong className="tabular-nums">{formatBRL(g.open)}</strong>
                        </>
                      ) : (
                        'Nada em aberto'
                      )}
                      {g.overdue > 0 && (
                        <>
                          {' '}
                          <Badge tone="danger">{formatBRL(g.overdue)} vencido</Badge>
                        </>
                      )}
                    </p>
                  </div>
                  {g.phone && g.open > 0 && (
                    <a
                      href={`${whatsappLink(g.phone)}?text=${encodeURIComponent(
                        `Olá, ${g.name.split(' ')[0]}! Passando para lembrar do valor em aberto de ${formatBRL(g.open)}${
                          g.overdue > 0 ? `, sendo ${formatBRL(g.overdue)} já vencido` : ''
                        }. Qualquer dúvida, estou à disposição.`,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm font-medium hover:bg-[var(--surface-muted)]"
                    >
                      <MessageCircle className="size-4" aria-hidden /> Lembrar no WhatsApp
                    </a>
                  )}
                </header>

                {g.debts.map((d) => (
                  <div key={d.group_id} role="group" aria-label={`Cobrança: ${d.description}`} className="grid gap-2 rounded-md border border-line p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="grid gap-0.5">
                        <p className="font-medium">
                          {d.description}
                          {d.order_id && d.order_number != null && (
                            <>
                              {' · '}
                              <Link to={`/ordens/${d.order_id}`} className="text-brand-700 underline-offset-2 hover:underline dark:text-brand-400">
                                {formatCode('OS', d.order_number)}
                              </Link>
                            </>
                          )}
                        </p>
                        <p className="text-[13px] text-muted">
                          <span className="font-medium text-[var(--text)]">{planLabel(d)}</span>
                          {' · '}
                          {d.installment_count > 1 ? `${d.paid_installments} de ${d.installment_count} pagas · ` : ''}
                          pago {formatBRL(d.paid_cents)} de {formatBRL(d.total_cents)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        {canWrite ? (
                          <label className="grid gap-1 text-[12px] text-muted">
                            Forma combinada
                            <select
                              value={d.payment_method ?? ''}
                              aria-label={`Forma de pagamento de ${d.description}`}
                              onChange={(e) => e.target.value && setMethod.mutate({ groupId: d.group_id, method: e.target.value as PaymentMethod })}
                              className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]"
                            >
                              {!d.payment_method && <option value="">Não definida</option>}
                              {(Object.keys(methodLabels) as PaymentMethod[]).map((m) => (
                                <option key={m} value={m}>
                                  {methodLabels[m]}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <Badge>{d.payment_method ? methodLabels[d.payment_method] : 'Forma não definida'}</Badge>
                        )}
                        {canWrite && d.open_cents > 0 && d.installment_count > 1 && (
                          <Button size="sm" variant="secondary" onClick={() => setPaying({ kind: 'all', debt: d })}>
                            <CheckCircle2 className="size-4" aria-hidden /> Marcar tudo como pago
                          </Button>
                        )}
                      </div>
                    </div>

                    <ul className="divide-y divide-[var(--border)] text-sm">
                      {d.installments.map((i) => {
                        const paid = i.status === 'paid'
                        const late = !paid && i.due_date < today
                        const label = d.installment_count > 1 ? `Parcela ${i.no}/${d.installment_count}` : 'À vista'
                        return (
                          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2" aria-label={`${d.description}: ${label}`}>
                            <div className="grid gap-0.5">
                              <span className="font-medium">
                                {label} · <span className="tabular-nums">{formatBRL(i.amount_cents)}</span>
                              </span>
                              <span className="text-[13px] text-muted">
                                vence {formatIsoDate(i.due_date)}
                                {paid && i.last_paid_at && ` · paga em ${formatIsoDate(i.last_paid_at)}${i.last_method ? ` (${methodLabels[i.last_method]})` : ''}`}
                                {i.status === 'partial' && ` · ${formatBRL(i.paid_cents)} já pago`}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {paid ? (
                                <Badge tone="ok">Paga</Badge>
                              ) : late ? (
                                <Badge tone="danger">Vencida</Badge>
                              ) : i.status === 'partial' ? (
                                <Badge tone="attn">Parcial</Badge>
                              ) : (
                                <Badge>Em aberto</Badge>
                              )}
                              {canWrite &&
                                (paid ? (
                                  <Button size="sm" variant="ghost" onClick={() => setUnpaying({ debt: d, inst: i })}>
                                    <Undo2 className="size-4" aria-hidden /> Desmarcar
                                  </Button>
                                ) : (
                                  <Button size="sm" variant="secondary" onClick={() => setPaying({ kind: 'one', debt: d, inst: i })}>
                                    <CheckCircle2 className="size-4" aria-hidden /> Marcar como paga
                                  </Button>
                                ))}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </section>
            </li>
          ))}
        </ul>
      )}

      {creating && <NewEntryDialog companyId={companyId} direction="in" onClose={() => setCreating(false)} />}
      {paying && <PayDialog target={paying} onClose={() => setPaying(null)} onDone={invalidate} />}
      <ConfirmDialog
        open={unpaying !== null}
        onOpenChange={(o) => !o && setUnpaying(null)}
        title="Desmarcar como paga?"
        description={
          unpaying
            ? `${unpaying.debt.description}, ${unpaying.debt.installment_count > 1 ? `parcela ${unpaying.inst.no}/${unpaying.debt.installment_count}` : 'à vista'}: volta a ficar em aberto. O pagamento vira um estorno registrado no financeiro.`
            : ''
        }
        confirmLabel="Desmarcar"
        loading={unpay.isPending}
        onConfirm={() => unpaying && unpay.mutate(unpaying.inst.id)}
      />
    </div>
  )
}

function Tile({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="surface grid gap-1 rounded-lg p-4">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className={`text-xl font-semibold tabular-nums ${danger ? 'text-danger-600' : ''}`}>{value}</dd>
    </div>
  )
}

function PayDialog({ target, onClose, onDone }: { target: PayTarget; onClose: () => void; onDone: () => Promise<unknown> }) {
  const d = target.debt
  const [method, setMethod] = useState<PaymentMethod>(d.payment_method ?? 'pix')
  const [paidAt, setPaidAt] = useState(isoDate(new Date()))
  const amount = target.kind === 'one' ? target.inst.amount_cents - target.inst.paid_cents : d.open_cents

  const pay = useMutation({
    mutationFn: async () => {
      const data = { method, paid_at: paidAt } as Json
      const sb = requireSupabase()
      const { error } =
        target.kind === 'one'
          ? await sb.rpc('pay_installment', { p_entry_id: target.inst.id, p_data: data })
          : await sb.rpc('pay_entry_group', { p_group_id: d.group_id, p_data: data })
      if (error) throw error
    },
    onSuccess: async () => {
      await onDone()
      onClose()
    },
  })

  const what =
    target.kind === 'all'
      ? `todas as parcelas em aberto de "${d.description}"`
      : d.installment_count > 1
        ? `a parcela ${target.inst.no}/${d.installment_count} de "${d.description}"`
        : `"${d.description}"`

  return (
    <FormDialog title={target.kind === 'all' ? 'Marcar tudo como pago' : 'Marcar como paga'} description={`Registra que ${what} foi pago: ${formatBRL(amount)}.`} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (paidAt) pay.mutate()
        }}
      >
        {pay.isError && <Alert tone="error">{toUserMessage(pay.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Como foi pago" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(methodLabels) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {methodLabels[m]}
              </option>
            ))}
          </SelectField>
          <TextField label="Data do pagamento" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={pay.isPending} disabled={!paidAt}>
            <CheckCircle2 className="size-4" aria-hidden /> Confirmar pagamento
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}
