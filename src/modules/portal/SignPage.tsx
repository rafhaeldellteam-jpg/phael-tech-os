import { CheckCircle2, Download, Send } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { SignaturePad, type SignaturePadHandle } from '@/components/ui/SignaturePad'
import { Spinner } from '@/components/ui/Spinner'
import type { ServiceMode, SignatureDocument } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatCode, formatDateTime, formatPhone } from '@/lib/format'
import { formatBRL } from '@/lib/money'
import { downloadBytes } from '@/lib/pdf/logo'
import { requireSupabase } from '@/lib/supabase'
import { formatIsoDate } from '../finance/period'
import { agreementText } from '../orders/OrderSignatures'
import { orderPdfFileName, renderOrderPdf, type OrderPdfInput } from '../orders/orderPdfDownload'

interface SignDoc {
  document: SignatureDocument
  expires_at: string
  company: {
    name: string
    legal_name: string | null
    tax_id: string | null
    phone: string | null
    email: string | null
    intake_terms: string | null
    delivery_terms: string | null
  }
  order: {
    number: number
    mode: ServiceMode
    status_label: string
    received_at: string
    delivered_at: string | null
    due_at: string | null
    reported_problem: string
    intake_condition: string | null
    intake_accessories: string[] | null
  }
  client: { name: string; whatsapp: string | null; phone: string | null; email: string | null }
  equipment: { title: string | null; serial: string | null } | null
  items: { kind: 'service' | 'part'; description: string; qty: number; unit_price_cents: number; discount_cents: number }[]
  totals: { services_cents: number; parts_cents: number; discount_cents: number; total_cents: number }
  warranties: { description: string; warranty_days: number; expires_on: string }[]
  signatures: { signer_role: 'client' | 'company'; signer_name: string; image_data: string; signed_at: string; channel: string }[]
}

const docTitle: Record<SignatureDocument, string> = { intake: 'Comprovante de entrada', delivery: 'Comprovante de entrega' }

/** Página pública: o cliente confere o comprovante e assina pelo link, sem login. */
export function SignPage() {
  const { token = '' } = useParams()
  // Estado local (sem cache global): página pública, independente de quem esteja logado.
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ok'; doc: SignDoc }>({ status: 'loading' })
  const load = useCallback(async () => {
    try {
      const { data, error } = await requireSupabase().rpc('signature_view', { p_token: token })
      if (error || !data) throw error ?? new Error('vazio')
      setState({ status: 'ok', doc: data as unknown as SignDoc })
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
          <span className="text-right text-sm text-white/80">Assinatura de documento</span>
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
          <SignContent token={token} doc={state.doc} onSigned={load} />
        )}
      </main>
    </div>
  )
}

function toPdfInput(doc: SignDoc): OrderPdfInput {
  return {
    kind: doc.document,
    company: doc.company,
    order: {
      id: '',
      number: doc.order.number,
      mode: doc.order.mode,
      received_at: doc.order.received_at,
      delivered_at: doc.order.delivered_at,
      due_at: doc.order.due_at,
      reported_problem: doc.order.reported_problem,
      intake_condition: doc.order.intake_condition,
      intake_accessories: doc.order.intake_accessories ?? [],
    },
    statusLabel: doc.order.status_label,
    client: doc.client,
    equipmentTitle: doc.equipment?.title ?? null,
    serial: doc.equipment?.serial ?? null,
    warranties: doc.warranties,
  }
}

function SignContent({ token, doc, onSigned }: { token: string; doc: SignDoc; onSigned: () => Promise<void> }) {
  const o = doc.order
  const code = formatCode('OS', o.number)
  const clientSig = doc.signatures.find((s) => s.signer_role === 'client')
  const companySig = doc.signatures.find((s) => s.signer_role === 'company')
  const terms = doc.document === 'intake' ? doc.company.intake_terms : doc.company.delivery_terms
  const [success, setSuccess] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  const downloadPdf = async () => {
    setPdfBusy(true)
    setPdfError(null)
    try {
      // Busca de novo: o PDF sai com as assinaturas do momento (inclusive a da empresa, se entrou depois).
      const { data, error } = await requireSupabase().rpc('signature_view', { p_token: token })
      if (error || !data) throw error ?? new Error('vazio')
      const fresh = data as unknown as SignDoc
      const input = toPdfInput(fresh)
      const bytes = await renderOrderPdf(input, { items: fresh.items, totals: fresh.totals, signatures: fresh.signatures })
      downloadBytes(bytes, orderPdfFileName(input))
    } catch {
      setPdfError('Não foi possível gerar o PDF. Tente novamente.')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <>
      <section className="grid gap-1">
        <p className="text-sm text-muted">Olá, {doc.client.name.split(' ')[0]}.</p>
        <h1 className="text-2xl font-semibold">
          {docTitle[doc.document]} · {code}
        </h1>
        <p className="text-sm text-muted">
          {doc.company.name}
          {doc.company.phone && ` · ${formatPhone(doc.company.phone)}`}
        </p>
      </section>

      {clientSig ? (
        <Alert tone="success" title="Documento assinado">
          Assinado por {clientSig.signer_name} em {formatDateTime(clientSig.signed_at)}. Este documento não pode ser assinado de novo.
        </Alert>
      ) : (
        <p className="text-sm">Confira os dados abaixo. No fim da página, assine e toque em “Enviar assinatura”.</p>
      )}

      <section className="surface grid gap-3 rounded-lg p-4 text-sm" aria-label="Documento">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Info label="Cliente" value={doc.client.name} />
          <Info label="Entrada" value={formatDateTime(o.received_at)} />
          {doc.equipment?.title && <Info label="Equipamento" value={doc.equipment.title} />}
          {doc.equipment?.serial && <Info label="Número de série" value={doc.equipment.serial} />}
          {doc.document === 'delivery' && o.delivered_at && <Info label="Entrega" value={formatDateTime(o.delivered_at)} />}
          {doc.document === 'intake' && o.due_at && <Info label="Previsão" value={formatDateTime(o.due_at)} />}
        </dl>
        <Info label="Problema relatado" value={o.reported_problem} />
        {o.intake_condition && <Info label="Condição na entrada" value={o.intake_condition} />}
        {(o.intake_accessories ?? []).length > 0 && <Info label="Acessórios" value={(o.intake_accessories ?? []).join(', ')} />}

        {doc.items.length > 0 && (
          <div className="grid gap-1">
            <h2 className="font-semibold">Serviços e peças</h2>
            <ul className="divide-y divide-[var(--border)]">
              {doc.items.map((i, n) => (
                <li key={n} className="flex items-start justify-between gap-3 py-1.5">
                  <span>
                    {i.qty > 1 && `${i.qty} × `}
                    {i.description}
                  </span>
                  <span className="tabular-nums">{formatBRL(i.qty * i.unit_price_cents - i.discount_cents)}</span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between border-t border-line pt-2 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatBRL(doc.totals.total_cents)}</span>
            </p>
          </div>
        )}

        {doc.warranties.length > 0 && (
          <div className="grid gap-1">
            <h2 className="font-semibold">Garantia</h2>
            <ul className="grid gap-0.5">
              {doc.warranties.map((w, n) => (
                <li key={n}>
                  {w.description}: {w.warranty_days} dias, até {formatIsoDate(w.expires_on)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {terms && (
          <div className="grid gap-1">
            <h2 className="font-semibold">Termos</h2>
            <p className="text-[13px] whitespace-pre-line text-muted">{terms}</p>
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2" aria-label="Assinaturas">
        <SignedBox label="Cliente" sig={clientSig} />
        <SignedBox label={doc.company.name} sig={companySig} />
      </section>

      {!clientSig && <SignForm token={token} doc={doc} onDone={async () => {
        await onSigned()
        setSuccess(true)
      }} />}

      {clientSig && (
        <div className="grid gap-2">
          <Button variant="secondary" className="justify-self-start" loading={pdfBusy} onClick={() => void downloadPdf()}>
            <Download className="size-4" aria-hidden /> Baixar documento assinado (PDF)
          </Button>
          {!companySig && <p className="text-[13px] text-muted">A assinatura da {doc.company.name} entra no documento assim que for registrada.</p>}
          {pdfError && <Alert tone="error">{pdfError}</Alert>}
        </div>
      )}

      <p className="text-[12px] text-muted">
        Assinatura eletrônica simples (Lei 14.063/2020). Registramos data, hora e o endereço de rede do envio. Link válido até{' '}
        {formatDateTime(doc.expires_at)}.
      </p>

      {success && (
        <FormDialog title="Assinatura enviada com sucesso" onClose={() => setSuccess(false)}>
          <div className="grid justify-items-center gap-4 py-2 text-center">
            <CheckCircle2 className="size-12 text-ok-600 dark:text-ok-500" aria-hidden />
            <p className="text-sm">Obrigado! A sua assinatura foi registrada no {docTitle[doc.document].toLowerCase()} da {code}.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" loading={pdfBusy} onClick={() => void downloadPdf()}>
                <Download className="size-4" aria-hidden /> Baixar PDF assinado
              </Button>
              <Button onClick={() => setSuccess(false)}>OK</Button>
            </div>
          </div>
        </FormDialog>
      )}
    </>
  )
}

function SignForm({ token, doc, onDone }: { token: string; doc: SignDoc; onDone: () => Promise<void> }) {
  const pad = useRef<SignaturePadHandle>(null)
  const [name, setName] = useState(doc.client.name)
  const [empty, setEmpty] = useState(true)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = name.trim().length >= 2 && agree && !empty

  const submit = async () => {
    const image = pad.current?.toDataUrl()
    if (!image) {
      setError('Desenhe a sua assinatura no quadro.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { error: e } = await requireSupabase().rpc('sign_by_link', { p_token: token, p_signer_name: name.trim(), p_image_data: image })
      if (e) throw e
      await onDone()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="surface grid gap-4 rounded-lg p-4"
      aria-label="Assinar"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !busy) void submit()
      }}
    >
      <h2 className="font-semibold">Sua assinatura</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label="Seu nome completo" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      <SignaturePad ref={pad} label="Assine no quadro com o dedo ou o mouse" onChange={setEmpty} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4" />
        <span>{agreementText(doc.document)}</span>
      </label>
      <Button type="submit" className="justify-self-start" loading={busy} disabled={!ready}>
        <Send className="size-4" aria-hidden /> Enviar assinatura
      </Button>
    </form>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="whitespace-pre-line">{value}</span>
    </div>
  )
}

function SignedBox({ label, sig }: { label: string; sig: SignDoc['signatures'][number] | undefined }) {
  return (
    <div className="surface grid content-start gap-1.5 rounded-lg p-3 text-sm">
      <span className="text-[13px] text-muted">{label}</span>
      {sig ? (
        <>
          <img src={sig.image_data} alt={`Assinatura de ${sig.signer_name}`} className="h-16 w-full rounded bg-white object-contain" />
          <span className="font-medium">{sig.signer_name}</span>
          <span className="text-[12px] text-muted tabular-nums">Assinado em {formatDateTime(sig.signed_at)}</span>
        </>
      ) : (
        <span className="text-muted">Aguardando assinatura</span>
      )}
    </div>
  )
}
