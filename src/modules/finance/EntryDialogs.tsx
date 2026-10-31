import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { Spinner } from '@/components/ui/Spinner'
import { TextAreaField } from '@/components/ui/TextArea'
import type { FinanceDirection, Json, PaymentMethod } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { centsToInput, formatBRL, parseMoney } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { ChargeEmailDialog } from './ChargeEmail'
import { previewInstallments } from './installments'
import { formatIsoDate, isoDate } from './period'
import { financeKeys, methodLabels, useAccounts, useCategories, useEntryPayments } from './queries'

function useInvalidateFinance(companyId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: financeKeys.all(companyId) })
}

export function NewEntryDialog({
  companyId,
  direction,
  preset,
  onClose,
}: {
  companyId: string
  direction: FinanceDirection
  preset?: { description?: string; amountCents?: number; orderId?: string; purchaseId?: string }
  onClose: () => void
}) {
  const invalidate = useInvalidateFinance(companyId)
  const categories = useCategories(companyId)
  const [description, setDescription] = useState(preset?.description ?? '')
  const [amount, setAmount] = useState(preset?.amountCents ? centsToInput(preset.amountCents) : '')
  const [categoryId, setCategoryId] = useState('')
  const [issueDate, setIssueDate] = useState(isoDate(new Date()))
  const [firstDue, setFirstDue] = useState(isoDate(new Date()))
  const [installments, setInstallments] = useState('1')
  const [intervalDays, setIntervalDays] = useState('0')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)

  const cents = parseMoney(amount)
  const n = /^\d+$/.test(installments) ? Number(installments) : 0
  const parts = cents && cents > 0 && n >= 1 ? previewInstallments(cents, n) : []
  const errors = {
    description: description.trim().length < 2 ? 'Descreva o lançamento' : undefined,
    amount: !cents || cents <= 0 ? 'Informe um valor, por exemplo 150,00' : undefined,
    installments: n < 1 || n > 60 ? 'De 1 a 60' : cents && cents < n ? 'Valor pequeno demais' : undefined,
  }
  const valid = Object.values(errors).every((e) => !e)

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('create_finance_entry', {
        p_company_id: companyId,
        p_data: {
          direction,
          description,
          amount_cents: cents,
          category_id: categoryId,
          issue_date: issueDate,
          first_due_date: firstDue,
          installments: n,
          interval_days: Number(intervalDays),
          notes,
          order_id: preset?.orderId ?? '',
          purchase_id: preset?.purchaseId ?? '',
        } as Json,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })

  const label = direction === 'in' ? 'conta a receber' : 'conta a pagar'
  return (
    <FormDialog title={`Nova ${label}`} description={preset?.orderId ? 'Vinculada à OS: o cliente vem da OS.' : undefined} onClose={onClose}>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (valid) create.mutate()
        }}
      >
        {create.isError && <Alert tone="error">{toUserMessage(create.error)}</Alert>}
        <TextField label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} error={touched ? errors.description : undefined} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Valor total (R$)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={touched ? errors.amount : undefined} />
          <SelectField label="Categoria" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Sem categoria</option>
            {(categories.data ?? [])
              .filter((c) => c.direction === direction && c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </SelectField>
          <TextField label="Emissão (competência)" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          <TextField label="1º vencimento" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
          <TextField label="Parcelas" inputMode="numeric" value={installments} onChange={(e) => setInstallments(e.target.value)} error={touched || n > 60 ? errors.installments : undefined} />
          <SelectField label="Intervalo" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} disabled={n <= 1}>
            <option value="0">Mensal (mesmo dia)</option>
            <option value="7">A cada 7 dias</option>
            <option value="15">A cada 15 dias</option>
            <option value="30">A cada 30 dias</option>
          </SelectField>
        </div>
        {parts.length > 1 && (
          <p className="text-[13px] text-muted">
            {parts.length} parcelas: {parts.length > 1 && parts[0] !== parts[1] ? `1ª de ${formatBRL(parts[0])} e as demais de ${formatBRL(parts[1])}` : `de ${formatBRL(parts[0])}`}
          </p>
        )}
        <TextAreaField label="Observações" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Lançar
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}

export interface EntryRef {
  id: string
  number: number
  description: string
  direction: FinanceDirection
  amount_cents: number
  paid_cents: number
  due_date: string
  status: string
  cancel_reason: string | null
}

/** Ficha do lançamento: pagamentos, estornos, novo pagamento e cancelamento. */
export function EntryDialog({ companyId, entry, canWrite, onClose }: { companyId: string; entry: EntryRef; canWrite: boolean; onClose: () => void }) {
  const invalidate = useInvalidateFinance(companyId)
  const payments = useEntryPayments(companyId, entry.id)
  const accounts = useAccounts(companyId)
  const remaining = entry.amount_cents - entry.paid_cents
  const [amount, setAmount] = useState(centsToInput(remaining))
  const [accountId, setAccountId] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('pix')
  const [paidAt, setPaidAt] = useState(isoDate(new Date()))
  const [mode, setMode] = useState<'view' | 'cancel' | { reverse: string }>('view')
  const [reason, setReason] = useState('')
  const activeAccounts = (accounts.data ?? []).filter((a) => a.active)
  const account = accountId || activeAccounts[0]?.id || ''
  const cents = parseMoney(amount)
  const open = entry.status === 'open' || entry.status === 'partial'

  const pay = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('register_payment', {
        p_entry_id: entry.id,
        p_data: { account_id: account, method, amount_cents: cents, paid_at: paidAt } as Json,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })
  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('cancel_finance_entry', { p_entry_id: entry.id, p_reason: reason })
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })
  const reverse = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await requireSupabase().rpc('reverse_payment', { p_payment_id: paymentId, p_reason: reason })
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })
  const reversed = new Set((payments.data ?? []).filter((p) => p.reversal_of).map((p) => p.reversal_of))
  const verb = entry.direction === 'in' ? 'Recebimento' : 'Pagamento'
  const [charging, setCharging] = useState(false)
  if (charging) return <ChargeEmailDialog companyId={companyId} entry={entry} onClose={() => setCharging(false)} />

  return (
    <FormDialog
      title={entry.description}
      description={`Nº ${entry.number}, vence em ${formatIsoDate(entry.due_date)}. Valor ${formatBRL(entry.amount_cents)}, ${entry.direction === 'in' ? 'recebido' : 'pago'} ${formatBRL(entry.paid_cents)}.`}
      onClose={onClose}
    >
      <div className="grid gap-4">
        {entry.cancel_reason && <Alert tone="warning" title="Cancelado">{entry.cancel_reason}</Alert>}
        {canWrite && open && entry.direction === 'in' && mode === 'view' && (
          <Button variant="secondary" className="justify-self-start" onClick={() => setCharging(true)}>
            Cobrar por e-mail com Pix
          </Button>
        )}
        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">{verb}s e estornos</h3>
          {payments.isPending ? (
            <Spinner label="Carregando" />
          ) : payments.data && payments.data.length > 0 ? (
            <ul className="divide-y divide-[var(--border)] rounded-md border border-line text-sm">
              {payments.data.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="tabular-nums">{formatIsoDate(p.paid_at)}</span>
                  <span className="flex-1 text-muted">
                    {p.reversal_of ? `Estorno: ${p.notes ?? ''}` : `${methodLabels[p.method]}, ${p.account.name}`}
                  </span>
                  <span className={`tabular-nums ${p.amount_cents < 0 ? 'text-danger-600' : ''}`}>{formatBRL(p.amount_cents)}</span>
                  {reversed.has(p.id) && <Badge tone="attn">Estornado</Badge>}
                  {canWrite && !p.reversal_of && !reversed.has(p.id) && mode === 'view' && (
                    <Button size="sm" variant="ghost" onClick={() => setMode({ reverse: p.id })}>
                      Estornar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nenhum ainda.</p>
          )}
        </section>

        {canWrite && typeof mode === 'object' && (
          <form
            className="grid gap-3 rounded-md border border-line p-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (reason.trim()) reverse.mutate(mode.reverse)
            }}
          >
            <p className="text-sm">O estorno lança o valor ao contrário, com a data de hoje. O pagamento original continua registrado.</p>
            {reverse.isError && <Alert tone="error">{toUserMessage(reverse.error)}</Alert>}
            <TextField label="Motivo do estorno" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setMode('view')}>
                Voltar
              </Button>
              <Button type="submit" variant="danger" loading={reverse.isPending} disabled={!reason.trim()}>
                Estornar
              </Button>
            </div>
          </form>
        )}

        {canWrite && open && mode === 'view' && (
          <form
            className="grid gap-3 rounded-md border border-line p-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (cents && cents > 0 && cents <= remaining && account) pay.mutate()
            }}
          >
            <h3 className="text-sm font-semibold">Registrar {verb.toLowerCase()}</h3>
            {pay.isError && <Alert tone="error">{toUserMessage(pay.error)}</Alert>}
            {activeAccounts.length === 0 ? (
              <Alert tone="warning">Cadastre uma conta (caixa ou banco) na aba Configurações.</Alert>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Valor (R$)"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  error={cents !== null && cents > remaining ? `Máximo ${formatBRL(remaining)}` : undefined}
                  hint={`Em aberto: ${formatBRL(remaining)}. Valor menor registra pagamento parcial.`}
                />
                <TextField label="Data" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
                <SelectField label="Conta" value={account} onChange={(e) => setAccountId(e.target.value)}>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </SelectField>
                <SelectField label="Forma" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {(Object.keys(methodLabels) as PaymentMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {methodLabels[m]}
                    </option>
                  ))}
                </SelectField>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-2">
              {entry.paid_cents === 0 ? (
                <Button variant="ghost" onClick={() => setMode('cancel')}>
                  Cancelar lançamento
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" loading={pay.isPending} disabled={!cents || cents <= 0 || cents > remaining || !account}>
                Registrar {verb.toLowerCase()}
              </Button>
            </div>
          </form>
        )}

        {canWrite && mode === 'cancel' && (
          <form
            className="grid gap-3 rounded-md border border-line p-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (reason.trim()) cancel.mutate()
            }}
          >
            {cancel.isError && <Alert tone="error">{toUserMessage(cancel.error)}</Alert>}
            <TextField label="Motivo do cancelamento" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setMode('view')}>
                Voltar
              </Button>
              <Button type="submit" variant="danger" loading={cancel.isPending} disabled={!reason.trim()}>
                Cancelar lançamento
              </Button>
            </div>
          </form>
        )}
      </div>
    </FormDialog>
  )
}
