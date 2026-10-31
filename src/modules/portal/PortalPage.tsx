import { CheckCircle2, Circle, MessageCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { TextAreaField } from '@/components/ui/TextArea'
import { toUserMessage } from '@/lib/errors'
import { formatCode, formatDate, formatDateTime, formatPhone, whatsappLink } from '@/lib/format'
import { formatBRL } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { formatIsoDate } from '../finance/period'

interface PortalDoc {
  company: { name: string; phone: string | null; email: string | null; delivery_terms: string | null }
  order: {
    number: number
    status: string
    status_label: string
    stage: 'open' | 'waiting' | 'working' | 'ready' | 'done' | 'stopped'
    reported_problem: string
    received_at: string
    due_at: string | null
    ready_at: string | null
    delivered_at: string | null
    can_decide: boolean
  }
  client_name: string | null
  equipment: string | null
  items: { kind: 'service' | 'part'; description: string; qty: number; unit_price_cents: number; discount_cents: number; total_cents: number; warranty_days: number | null }[]
  quote: {
    version: number
    status: 'sent' | 'approved' | 'refused'
    items: { kind: 'service' | 'part'; description: string; qty: number; unit_price_cents: number; discount_cents: number; warranty_days: number | null }[]
    total_cents: number
    valid_until: string | null
    delivery_days: number | null
    notes: string | null
    decided_at: string | null
    decided_by_name: string | null
  } | null
  diagnosis: { summary: string; finalized_at: string; fails: string[] } | null
  total_cents: number
  timeline: { at: string; label: string }[]
  warranties: { description: string; until: string }[]
  link_expires_at: string
}

const steps: { stage: PortalDoc['order']['stage'][]; label: string }[] = [
  { stage: ['open'], label: 'Recebido' },
  { stage: ['working', 'waiting'], label: 'Em andamento' },
  { stage: ['ready'], label: 'Pronto para retirada' },
  { stage: ['done'], label: 'Entregue' },
]

/** Página pública: o cliente acompanha a OS pelo link, sem login. */
export function PortalPage() {
  const { token = '' } = useParams()
  // Estado local (sem o cache global de consultas): o portal é público e não pode
  // depender da sessão de quem eventualmente esteja logado no mesmo navegador.
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ok'; doc: PortalDoc }>({ status: 'loading' })
  const load = useCallback(async () => {
    try {
      const { data, error } = await requireSupabase().rpc('portal_order', { p_token: token })
      if (error || !data) throw error ?? new Error('vazio')
      setState({ status: 'ok', doc: data as unknown as PortalDoc })
    } catch {
      setState({ status: 'error' })
    }
  }, [token])
  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="min-h-dvh">
      <header className="bg-navy-900 px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="flex h-12 shrink-0 items-center">
            <BrandLogo variant="full" className="max-h-full w-auto" />
          </div>
          <span className="text-right text-sm text-white/80">Acompanhamento do seu atendimento</span>
        </div>
      </header>
      <main className="mx-auto grid max-w-2xl gap-5 px-4 py-6">
        {state.status === 'loading' ? (
          <Spinner label="Carregando" />
        ) : state.status === 'error' ? (
          <Alert tone="warning" title="Link inválido ou expirado">
            Peça um novo link para quem fez o seu atendimento.
          </Alert>
        ) : (
          <PortalContent token={token} doc={state.doc} onChanged={() => void load()} />
        )}
      </main>
    </div>
  )
}

function PortalContent({ token, doc, onChanged }: { token: string; doc: PortalDoc; onChanged: () => void }) {
  const o = doc.order
  const stopped = o.stage === 'stopped'
  const current = steps.findIndex((s) => s.stage.includes(o.stage))
  const phone = doc.company.phone

  return (
    <>
      <section className="grid gap-1">
        <p className="text-sm text-muted">{doc.client_name ? `Olá, ${doc.client_name}.` : 'Olá.'}</p>
        <h1 className="text-2xl font-semibold">
          {formatCode('OS', o.number)} {doc.equipment && <span className="font-normal text-muted">· {doc.equipment}</span>}
        </h1>
        <p className="text-lg">
          Situação: <strong>{o.status_label}</strong>
        </p>
      </section>

      {!stopped && (
        <ol className="grid grid-cols-4 gap-2" aria-label="Etapas">
          {steps.map((s, i) => {
            const done = i <= current
            return (
              <li key={s.label} className="grid justify-items-center gap-1 text-center text-[12px]" aria-current={i === current ? 'step' : undefined}>
                {done ? <CheckCircle2 className="size-6 text-ok-600 dark:text-ok-500" aria-hidden /> : <Circle className="size-6 text-muted" aria-hidden />}
                <span className={done ? 'font-medium' : 'text-muted'}>{s.label}</span>
              </li>
            )
          })}
        </ol>
      )}

      {o.can_decide && <Decision token={token} totalCents={doc.quote?.status === 'sent' ? doc.quote.total_cents : doc.total_cents} onDone={onChanged} />}

      {doc.diagnosis && (
        <section className="surface grid gap-1 rounded-lg p-4 text-sm">
          <h2 className="font-semibold">Diagnóstico</h2>
          <p className="whitespace-pre-line">{doc.diagnosis.summary}</p>
          {doc.diagnosis.fails.length > 0 && <p className="text-[13px] text-muted">Itens com defeito: {doc.diagnosis.fails.join(', ')}</p>}
        </section>
      )}

      {doc.quote && (
        <section className="surface grid gap-2 rounded-lg p-4 text-sm">
          <h2 className="font-semibold">
            Orçamento {doc.quote.version > 1 && `(versão ${doc.quote.version})`}
            {doc.quote.status === 'approved' && <span className="ml-2 text-ok-600 dark:text-ok-500">Aprovado</span>}
            {doc.quote.status === 'refused' && <span className="ml-2 text-danger-600">Recusado</span>}
          </h2>
          <ul className="divide-y divide-[var(--border)]">
            {doc.quote.items.map((i, n) => (
              <li key={n} className="flex items-start justify-between gap-3 py-2">
                <span>
                  {i.qty > 1 && `${i.qty} × `}
                  {i.description}
                  {i.warranty_days ? <span className="block text-[12px] text-muted">garantia de {i.warranty_days} dias</span> : null}
                </span>
                <span className="tabular-nums">{formatBRL(i.qty * i.unit_price_cents - i.discount_cents)}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between border-t border-line pt-2 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatBRL(doc.quote.total_cents)}</span>
          </p>
          <p className="text-[13px] text-muted">
            {doc.quote.valid_until && `Válido até ${formatIsoDate(doc.quote.valid_until)}. `}
            {doc.quote.delivery_days != null && `Prazo após aprovação: ${doc.quote.delivery_days} dia(s). `}
            {doc.quote.decided_by_name && doc.quote.decided_at && `Decisão de ${doc.quote.decided_by_name} em ${formatDateTime(doc.quote.decided_at)}.`}
          </p>
          {doc.quote.notes && <p className="text-[13px] whitespace-pre-line">{doc.quote.notes}</p>}
        </section>
      )}

      <section className="surface grid gap-2 rounded-lg p-4 text-sm">
        <h2 className="font-semibold">Seu pedido</h2>
        <p className="whitespace-pre-line">{o.reported_problem}</p>
        <dl className="grid grid-cols-2 gap-2 text-[13px]">
          <div>
            <dt className="text-muted">Recebido em</dt>
            <dd>{formatDateTime(o.received_at)}</dd>
          </div>
          {o.due_at && !o.delivered_at && (
            <div>
              <dt className="text-muted">Previsão</dt>
              <dd>{formatDateTime(o.due_at)}</dd>
            </div>
          )}
          {o.ready_at && (
            <div>
              <dt className="text-muted">Pronto em</dt>
              <dd>{formatDateTime(o.ready_at)}</dd>
            </div>
          )}
          {o.delivered_at && (
            <div>
              <dt className="text-muted">Entregue em</dt>
              <dd>{formatDateTime(o.delivered_at)}</dd>
            </div>
          )}
        </dl>
      </section>

      {doc.items.length > 0 && !(doc.quote && doc.quote.status !== 'approved') && (
        <section className="surface grid gap-2 rounded-lg p-4 text-sm">
          <h2 className="font-semibold">Serviços e peças</h2>
          <ul className="divide-y divide-[var(--border)]">
            {doc.items.map((i, n) => (
              <li key={n} className="flex items-start justify-between gap-3 py-2">
                <span>
                  {i.description}
                  <span className="block text-[12px] text-muted">
                    {i.qty > 1 && `${i.qty} × ${formatBRL(i.unit_price_cents)}`}
                    {i.discount_cents > 0 && ` · desconto de ${formatBRL(i.discount_cents)}`}
                    {i.warranty_days ? ` · garantia de ${i.warranty_days} dias` : ''}
                  </span>
                </span>
                <span className="tabular-nums">{formatBRL(i.total_cents)}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between border-t border-line pt-2 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatBRL(doc.total_cents)}</span>
          </p>
        </section>
      )}

      {doc.warranties.length > 0 && (
        <section className="surface grid gap-1 rounded-lg p-4 text-sm">
          <h2 className="font-semibold">Garantia</h2>
          {doc.warranties.map((w, n) => (
            <p key={n}>
              {w.description}: válida até <strong>{formatIsoDate(w.until)}</strong>
            </p>
          ))}
        </section>
      )}

      <section className="surface grid gap-2 rounded-lg p-4 text-sm">
        <h2 className="font-semibold">Histórico</h2>
        <ol className="grid gap-1.5">
          {doc.timeline.map((t, n) => (
            <li key={n} className="flex justify-between gap-3">
              <span>{t.label}</span>
              <time className="text-muted tabular-nums" dateTime={t.at}>
                {formatDateTime(t.at)}
              </time>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-2 text-center text-sm">
        <p className="font-medium">{doc.company.name}</p>
        {phone && (
          <a
            href={`${whatsappLink(phone)}?text=${encodeURIComponent(`Olá! Sobre a ${formatCode('OS', o.number)}:`)}`}
            target="_blank"
            rel="noreferrer"
            className="mx-auto inline-flex items-center gap-2 rounded-md bg-ok-600 px-4 py-2 font-medium text-white hover:brightness-110"
          >
            <MessageCircle className="size-4" aria-hidden /> Falar no WhatsApp {formatPhone(phone)}
          </a>
        )}
        {doc.company.email && <p className="text-muted">{doc.company.email}</p>}
        <p className="text-[12px] text-muted">Este link vale até {formatDate(doc.link_expires_at)}.</p>
      </section>
    </>
  )
}

function Decision({ token, totalCents, onDone }: { token: string; totalCents: number; onDone: () => void }) {
  const [choice, setChoice] = useState<'approve' | 'refuse' | null>(null)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const submit = async () => {
    setPending(true)
    setError(null)
    try {
      const { error: e } = await requireSupabase().rpc('portal_decide', {
        p_token: token,
        p_approve: choice === 'approve',
        p_name: name.trim(),
        p_note: note.trim() || null,
      })
      if (e) throw e
      onDone()
    } catch (e) {
      setError(e)
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="grid gap-3 rounded-lg border-2 border-attn-500 bg-attn-100 p-4 text-sm dark:bg-attn-600/15" aria-labelledby="dec-h">
      <h2 id="dec-h" className="text-base font-semibold">
        Seu orçamento está pronto: {formatBRL(totalCents)}
      </h2>
      <p>Confira os serviços abaixo e diga se podemos seguir com o reparo.</p>
      {error != null && <Alert tone="error">{toUserMessage(error)}</Alert>}
      {choice === null ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setChoice('approve')}>Aprovar orçamento</Button>
          <Button variant="secondary" onClick={() => setChoice('refuse')}>
            Recusar
          </Button>
        </div>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim().length >= 2) void submit()
          }}
        >
          <TextField label="Seu nome completo" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          <TextAreaField label={choice === 'refuse' ? 'Motivo (opcional)' : 'Observação (opcional)'} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={choice === 'refuse' ? 'danger' : 'primary'} loading={pending} disabled={name.trim().length < 2}>
              {choice === 'approve' ? 'Confirmar aprovação' : 'Confirmar recusa'}
            </Button>
            <Button variant="ghost" onClick={() => setChoice(null)}>
              Voltar
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
