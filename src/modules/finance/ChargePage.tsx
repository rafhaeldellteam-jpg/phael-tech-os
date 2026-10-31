import { CheckCircle2, Copy, MessageCircle } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { formatDate, formatPhone, whatsappLink } from '@/lib/format'
import { formatBRL } from '@/lib/money'
import { buildPixPayload } from '@/lib/pix'
import { requireSupabase } from '@/lib/supabase'
import { formatIsoDate } from './period'

interface ChargeDoc {
  company: { name: string; phone: string | null; email: string | null }
  pix: { key: string; key_type: string; name: string; city: string } | null
  entry: { number: number; description: string; due_date: string; amount_cents: number; paid_cents: number; open_cents: number; status: string }
  client_name: string | null
  link_expires_at: string
}

/** Página pública da cobrança: QR Code Pix e copia e cola, sem login. */
export function ChargePage() {
  const { token = '' } = useParams()
  const [state, setState] = useState<{ s: 'loading' } | { s: 'error' } | { s: 'ok'; doc: ChargeDoc; pix: string | null; qr: string | null }>({ s: 'loading' })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { data, error } = await requireSupabase().rpc('charge_view', { p_token: token })
        if (error || !data) throw error ?? new Error('vazio')
        const doc = data as unknown as ChargeDoc
        const open = doc.entry.open_cents > 0 && doc.entry.status !== 'canceled'
        const pix =
          open && doc.pix
            ? buildPixPayload({ key: doc.pix.key, name: doc.pix.name, city: doc.pix.city, amountCents: doc.entry.open_cents, txid: `LANC${String(doc.entry.number).padStart(6, '0')}` })
            : null
        const qr = pix ? await QRCode.toDataURL(pix, { margin: 1, width: 280, errorCorrectionLevel: 'M' }) : null
        if (alive) setState({ s: 'ok', doc, pix, qr })
      } catch {
        if (alive) setState({ s: 'error' })
      }
    })()
    return () => {
      alive = false
    }
  }, [token])

  return (
    <div className="min-h-dvh">
      <header className="bg-navy-900 px-4 py-4">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="flex h-12 shrink-0 items-center">
            <BrandLogo variant="full" className="max-h-full w-auto" />
          </div>
          <span className="text-right text-sm text-white/80">Cobrança</span>
        </div>
      </header>
      <main className="mx-auto grid max-w-md gap-5 px-4 py-6">
        {state.s === 'loading' ? (
          <Spinner label="Carregando" />
        ) : state.s === 'error' ? (
          <Alert tone="warning" title="Link inválido ou expirado">
            Peça uma nova cobrança para quem enviou este link.
          </Alert>
        ) : (
          <>
            <section className="grid gap-1 text-center">
              <p className="text-sm text-muted">{state.doc.client_name ? `Olá, ${state.doc.client_name}.` : 'Olá.'}</p>
              <h1 className="text-lg font-semibold">{state.doc.entry.description}</h1>
              {state.doc.entry.status === 'paid' ? (
                <p className="mt-2 inline-flex items-center justify-center gap-2 text-lg font-semibold text-ok-600 dark:text-ok-500">
                  <CheckCircle2 className="size-6" aria-hidden /> Pago. Obrigado!
                </p>
              ) : state.doc.entry.status === 'canceled' ? (
                <p className="mt-2 text-muted">Esta cobrança foi cancelada.</p>
              ) : (
                <>
                  <p className="text-3xl font-semibold tabular-nums">{formatBRL(state.doc.entry.open_cents)}</p>
                  <p className="text-sm">Vencimento: {formatIsoDate(state.doc.entry.due_date)}</p>
                  {state.doc.entry.paid_cents > 0 && <p className="text-[13px] text-muted">Já recebido: {formatBRL(state.doc.entry.paid_cents)}</p>}
                </>
              )}
            </section>

            {state.qr && state.pix && (
              <section className="surface grid justify-items-center gap-3 rounded-lg p-5 text-center">
                <h2 className="font-semibold">Pague com Pix</h2>
                <img src={state.qr} alt="QR Code Pix para pagamento" className="size-64 rounded bg-white p-2" />
                <p className="text-[13px] text-muted">Abra o app do seu banco, escolha Pix, "Ler QR Code" e confira o nome {state.doc.pix?.name}.</p>
                <div className="grid w-full gap-2">
                  <p className="text-sm font-medium">Ou Pix copia e cola</p>
                  <textarea readOnly value={state.pix} rows={4} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border border-line bg-[var(--surface)] p-2 text-[12px] break-all" aria-label="Código Pix copia e cola" />
                  <Button
                    onClick={() => {
                      void navigator.clipboard?.writeText(state.pix ?? '').then(() => setCopied(true))
                    }}
                  >
                    <Copy className="size-4" aria-hidden /> {copied ? 'Código copiado' : 'Copiar código Pix'}
                  </Button>
                </div>
              </section>
            )}

            <section className="grid gap-2 text-center text-sm">
              <p className="font-medium">{state.doc.company.name}</p>
              {state.doc.company.phone && (
                <a
                  href={`${whatsappLink(state.doc.company.phone)}?text=${encodeURIComponent(`Olá! Sobre a cobrança: ${state.doc.entry.description}`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mx-auto inline-flex items-center gap-2 rounded-md bg-ok-600 px-4 py-2 font-medium text-white hover:brightness-110"
                >
                  <MessageCircle className="size-4" aria-hidden /> Enviar comprovante no WhatsApp {formatPhone(state.doc.company.phone)}
                </a>
              )}
              <p className="text-[12px] text-muted">Este link vale até {formatDate(state.doc.link_expires_at)}.</p>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
