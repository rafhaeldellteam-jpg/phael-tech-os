import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileDown, Plus, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { Spinner } from '@/components/ui/Spinner'
import { TextAreaField } from '@/components/ui/TextArea'
import type { Json } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { centsToInput, formatBRL, parseMoney } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { formatIsoDate, isoDate } from '../finance/period'
import { orderKeys } from '../orders/queries'
import { downloadQuotePdf } from './quotePdf'
import { quoteKeys, quoteStatusLabels, quoteStatusTone, quoteTotal, useOrderQuotes, type QuoteItem, type QuoteRow } from './queries'

interface DraftLine {
  kind: 'service' | 'part'
  description: string
  qty: string
  price: string
  discount: string
  warranty: string
}

const toLine = (i: QuoteItem): DraftLine => ({
  kind: i.kind,
  description: i.description,
  qty: String(i.qty),
  price: centsToInput(i.unit_price_cents),
  discount: i.discount_cents ? centsToInput(i.discount_cents) : '',
  warranty: i.warranty_days != null ? String(i.warranty_days) : '',
})

function parseLine(l: DraftLine): QuoteItem | null {
  const qty = /^\d{1,4}$/.test(l.qty.trim()) ? Number(l.qty) : 0
  const price = parseMoney(l.price)
  const discount = l.discount.trim() === '' ? 0 : parseMoney(l.discount)
  const warranty = l.warranty.trim() === '' ? null : /^\d{1,4}$/.test(l.warranty.trim()) ? Number(l.warranty) : -1
  if (l.description.trim().length < 2 || qty < 1 || price === null || price < 0 || discount === null || discount < 0 || discount > qty * price || warranty === -1)
    return null
  return { kind: l.kind, description: l.description.trim(), qty, unit_price_cents: price, discount_cents: discount, warranty_days: warranty }
}

/** Orçamentos da OS: rascunho editável, envio, versões, decisão, PDF e lançamento dos itens aprovados. */
export function OrderQuotes({
  companyId,
  orderId,
  canRead,
  canWrite,
  canDecide,
  canApply,
  editable,
  clientName,
}: {
  companyId: string
  orderId: string
  canRead: boolean
  canWrite: boolean
  canDecide: boolean
  canApply: boolean
  editable: boolean
  clientName: string
}) {
  const queryClient = useQueryClient()
  const quotes = useOrderQuotes(companyId, orderId, canRead)
  const [editing, setEditing] = useState<QuoteRow | 'new' | null>(null)
  const [deciding, setDeciding] = useState<QuoteRow | null>(null)
  const [pdfError, setPdfError] = useState<unknown>(null)
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: quoteKeys.order(companyId, orderId) }),
      queryClient.invalidateQueries({ queryKey: orderKeys.all(companyId) }),
    ])
  const act = useMutation({
    mutationFn: async (a: { op: 'send' | 'version' | 'cancel' | 'apply'; id: string }) => {
      const sb = requireSupabase()
      const r =
        a.op === 'send'
          ? await sb.rpc('send_quote', { p_quote_id: a.id })
          : a.op === 'version'
            ? await sb.rpc('new_quote_version', { p_quote_id: a.id })
            : a.op === 'cancel'
              ? await sb.rpc('cancel_quote', { p_quote_id: a.id })
              : await sb.rpc('apply_quote_items', { p_quote_id: a.id })
      if (r.error) throw r.error
    },
    onSuccess: refresh,
  })

  if (!canRead) return null
  const list = quotes.data ?? []
  const hasDraft = list.some((q) => q.status === 'draft')

  return (
    <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="orc-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="orc-h" className="font-semibold">
          Orçamento
        </h2>
        {canWrite && editable && !hasDraft && (
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> {list.length ? 'Novo orçamento' : 'Criar orçamento'}
          </Button>
        )}
      </div>
      {act.isError && <Alert tone="error">{toUserMessage(act.error)}</Alert>}
      {pdfError != null && <Alert tone="error">Não foi possível gerar o PDF: {toUserMessage(pdfError)}</Alert>}
      {quotes.isPending ? (
        <Spinner label="Carregando" />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted">Nenhum orçamento. Ao enviar, a OS vai para "Aguardando aprovação" e o cliente pode aprovar pelo link de acompanhamento.</p>
      ) : (
        <ul className="grid gap-3">
          {list.map((q) => {
            const items = (q.items as QuoteItem[]) ?? []
            const expired = q.status === 'sent' && q.valid_until != null && q.valid_until < isoDate(new Date())
            return (
              <li key={q.id} className={`grid gap-2 rounded-md border border-line p-3 text-sm ${q.status === 'superseded' || q.status === 'canceled' ? 'opacity-70' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Versão {q.version}</span>
                  <Badge tone={quoteStatusTone[q.status]}>{quoteStatusLabels[q.status]}</Badge>
                  {expired && <Badge tone="danger">Vencido</Badge>}
                  <span className="ml-auto font-semibold tabular-nums">{formatBRL(q.total_cents)}</span>
                </div>
                <ul className="grid gap-0.5 text-[13px]">
                  {items.map((i, n) => (
                    <li key={n} className="flex justify-between gap-3">
                      <span>
                        {i.qty > 1 && `${i.qty} × `}
                        {i.description}
                        {i.warranty_days ? <span className="text-muted"> · garantia {i.warranty_days} dias</span> : null}
                      </span>
                      <span className="tabular-nums">{formatBRL(i.qty * i.unit_price_cents - i.discount_cents)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[12px] text-muted">
                  {q.valid_until && `Válido até ${formatIsoDate(q.valid_until)}. `}
                  {q.delivery_days != null && `Prazo: ${q.delivery_days} dia(s). `}
                  {q.sent_at && `Enviado em ${formatDateTime(q.sent_at)}. `}
                  {q.decided_at && `${q.status === 'approved' ? 'Aprovado' : 'Recusado'} por ${q.decided_by_name} em ${formatDateTime(q.decided_at)}${q.decided_via === 'portal' ? ' pelo portal' : ''}. `}
                  {q.applied_at && `Itens lançados na OS em ${formatDateTime(q.applied_at)}.`}
                </p>
                {q.notes && <p className="text-[13px] whitespace-pre-line text-muted">{q.notes}</p>}
                <div className="flex flex-wrap gap-2">
                  {q.status === 'draft' && canWrite && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(q)}>
                        Editar
                      </Button>
                      <Button size="sm" loading={act.isPending && act.variables?.id === q.id && act.variables.op === 'send'} onClick={() => act.mutate({ op: 'send', id: q.id })}>
                        <Send className="size-4" aria-hidden /> Enviar ao cliente
                      </Button>
                    </>
                  )}
                  {q.status === 'sent' && canDecide && (
                    <Button size="sm" variant="secondary" onClick={() => setDeciding(q)}>
                      Registrar decisão do cliente
                    </Button>
                  )}
                  {(q.status === 'sent' || q.status === 'refused' || q.status === 'approved') && canWrite && editable && !hasDraft && (
                    <Button size="sm" variant="ghost" onClick={() => act.mutate({ op: 'version', id: q.id })}>
                      Nova versão
                    </Button>
                  )}
                  {q.status === 'approved' && !q.applied_at && canApply && (
                    <Button size="sm" loading={act.isPending && act.variables?.op === 'apply'} onClick={() => act.mutate({ op: 'apply', id: q.id })}>
                      Lançar itens na OS
                    </Button>
                  )}
                  {q.status !== 'draft' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setPdfError(null)
                        downloadQuotePdf(orderId, q).catch(setPdfError)
                      }}
                    >
                      <FileDown className="size-4" aria-hidden /> PDF
                    </Button>
                  )}
                  {(q.status === 'draft' || q.status === 'sent') && canWrite && (
                    <Button size="sm" variant="ghost" onClick={() => act.mutate({ op: 'cancel', id: q.id })}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {editing && <QuoteEditor orderId={orderId} quote={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {deciding && <DecisionDialog quote={deciding} clientName={clientName} onClose={() => setDeciding(null)} onSaved={refresh} />}
    </section>
  )
}

function QuoteEditor({ orderId, quote, onClose, onSaved }: { orderId: string; quote: QuoteRow | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [lines, setLines] = useState<DraftLine[]>(() =>
    quote ? ((quote.items as QuoteItem[]) ?? []).map(toLine) : [{ kind: 'service', description: '', qty: '1', price: '', discount: '', warranty: '' }],
  )
  const [validUntil, setValidUntil] = useState(quote?.valid_until ?? isoDate(new Date(Date.now() + 7 * 86_400_000)))
  const [days, setDays] = useState(quote?.delivery_days != null ? String(quote.delivery_days) : '')
  const [notes, setNotes] = useState(quote?.notes ?? '')
  const [touched, setTouched] = useState(false)
  const parsed = lines.map(parseLine)
  const valid = parsed.length > 0 && parsed.every(Boolean) && (days === '' || /^\d{1,3}$/.test(days))
  const total = valid ? quoteTotal(parsed as QuoteItem[]) : null
  const set = (i: number, patch: Partial<DraftLine>) => setLines((l) => l.map((x, n) => (n === i ? { ...x, ...patch } : x)))

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('save_quote', {
        p_order_id: orderId,
        p_quote_id: quote?.id ?? null,
        p_data: { items: parsed, valid_until: validUntil || null, delivery_days: days === '' ? null : Number(days), notes: notes.trim() || null } as unknown as Json,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await onSaved()
      onClose()
    },
  })

  return (
    <FormDialog title={quote ? `Editar orçamento v${quote.version}` : 'Novo orçamento'} description="Rascunho: você pode alterar até enviar. Depois de enviado, mudanças viram nova versão." onClose={onClose} wide>
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
        <div className="grid gap-2">
          {lines.map((l, i) => {
            const bad = touched && !parsed[i]
            return (
              <fieldset key={i} className={`grid gap-2 rounded-md border p-2 sm:grid-cols-[110px_1fr_70px_110px_100px_90px_auto] sm:items-end ${bad ? 'border-danger-600' : 'border-line'}`}>
                <legend className="sr-only">Item {i + 1}</legend>
                <label className="grid gap-1 text-[12px] text-muted">
                  Tipo
                  <select value={l.kind} onChange={(e) => set(i, { kind: e.target.value as DraftLine['kind'] })} className="h-9 rounded-md border border-line bg-[var(--surface)] px-1 text-sm text-[var(--text)]">
                    <option value="service">Serviço</option>
                    <option value="part">Peça</option>
                  </select>
                </label>
                <label className="grid gap-1 text-[12px] text-muted">
                  Descrição
                  <input value={l.description} onChange={(e) => set(i, { description: e.target.value })} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]" />
                </label>
                <label className="grid gap-1 text-[12px] text-muted">
                  Qtd.
                  <input inputMode="numeric" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]" />
                </label>
                <label className="grid gap-1 text-[12px] text-muted">
                  Valor un. (R$)
                  <input inputMode="decimal" value={l.price} onChange={(e) => set(i, { price: e.target.value })} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]" />
                </label>
                <label className="grid gap-1 text-[12px] text-muted">
                  Desconto (R$)
                  <input inputMode="decimal" value={l.discount} onChange={(e) => set(i, { discount: e.target.value })} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]" />
                </label>
                <label className="grid gap-1 text-[12px] text-muted">
                  Garantia (dias)
                  <input inputMode="numeric" value={l.warranty} onChange={(e) => set(i, { warranty: e.target.value })} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]" />
                </label>
                <Button size="sm" variant="ghost" aria-label={`Remover item ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((x) => x.filter((_, n) => n !== i))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </fieldset>
            )
          })}
          <Button
            size="sm"
            variant="ghost"
            className="justify-self-start"
            onClick={() => setLines((x) => [...x, { kind: 'service', description: '', qty: '1', price: '', discount: '', warranty: '' }])}
          >
            <Plus className="size-4" aria-hidden /> Adicionar item
          </Button>
          {touched && !valid && <p className="text-[13px] text-danger-600">Confira os itens marcados: descrição, quantidade inteira, valor e desconto (não maior que o valor).</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Válido até" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          <TextField label="Prazo após aprovação (dias)" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <TextAreaField label="Observações para o cliente" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-base">
            Total: <strong className="tabular-nums">{total != null ? formatBRL(total) : '—'}</strong>
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

function DecisionDialog({ quote, clientName, onClose, onSaved }: { quote: QuoteRow; clientName: string; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [name, setName] = useState(clientName)
  const [note, setNote] = useState('')
  const decide = useMutation({
    mutationFn: async (approve: boolean) => {
      const { error } = await requireSupabase().rpc('decide_quote_staff', { p_quote_id: quote.id, p_approve: approve, p_name: name.trim(), p_note: note.trim() || null })
      if (error) throw error
    },
    onSuccess: async () => {
      await onSaved()
      onClose()
    },
  })
  return (
    <FormDialog title={`Decisão do cliente: orçamento v${quote.version}`} description={`${formatBRL(quote.total_cents)}. Use quando o cliente responder por telefone, WhatsApp ou pessoalmente.`} onClose={onClose}>
      <div className="grid gap-4">
        {decide.isError && <Alert tone="error">{toUserMessage(decide.error)}</Alert>}
        <TextField label="Quem decidiu" value={name} onChange={(e) => setName(e.target.value)} hint="Ex.: Maria (por WhatsApp)" />
        <TextAreaField label="Observação (opcional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="danger" loading={decide.isPending && decide.variables === false} disabled={name.trim().length < 2} onClick={() => decide.mutate(false)}>
            Recusado
          </Button>
          <Button loading={decide.isPending && decide.variables === true} disabled={name.trim().length < 2} onClick={() => decide.mutate(true)}>
            Aprovado
          </Button>
        </div>
      </div>
    </FormDialog>
  )
}
