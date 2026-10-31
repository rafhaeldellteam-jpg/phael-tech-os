import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink, Mail } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { TextAreaField } from '@/components/ui/TextArea'
import { toUserMessage } from '@/lib/errors'
import { formatDate, formatDateTime, formatPhone } from '@/lib/format'
import { formatBRL } from '@/lib/money'
import { buildPixPayload } from '@/lib/pix'
import { requireSupabase } from '@/lib/supabase'
import { formatIsoDate } from './period'

/** Link do Gmail com o e-mail já preenchido (o envio é feito pelo próprio usuário). */
export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body })
  return `https://mail.google.com/mail/?${q.toString()}`
}

export function chargeEmailText(p: {
  clientName: string | null
  description: string
  openCents: number
  dueDate: string
  pixCode: string
  url: string
  company: { name: string; phone: string | null; email: string | null }
}): { subject: string; body: string } {
  const hello = p.clientName ? `Olá, ${p.clientName.split(' ')[0]}!` : 'Olá!'
  const contact = [p.company.phone && `WhatsApp ${formatPhone(p.company.phone)}`, p.company.email].filter(Boolean).join(' | ')
  return {
    subject: `Cobrança ${p.company.name}: ${p.description} (${formatBRL(p.openCents)})`,
    body: [
      hello,
      '',
      `Segue a cobrança referente a: ${p.description}`,
      `Valor: ${formatBRL(p.openCents)}`,
      `Vencimento: ${formatIsoDate(p.dueDate)}`,
      '',
      'Para pagar com Pix, abra o link abaixo e leia o QR Code com o app do seu banco:',
      p.url,
      '',
      'Ou use o Pix copia e cola:',
      p.pixCode,
      '',
      'Se já pagou, desconsidere esta mensagem.',
      '',
      'Obrigado!',
      p.company.name,
      contact,
    ].join('\n'),
  }
}

export function ChargeEmailDialog({
  companyId,
  entry,
  onClose,
}: {
  companyId: string
  entry: { id: string; number: number; description: string; amount_cents: number; paid_cents: number; due_date: string }
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const info = useQuery({
    queryKey: ['finance', companyId, 'charge-info', entry.id],
    queryFn: async () => {
      const sb = requireSupabase()
      const [e, c, links] = await Promise.all([
        sb.from('finance_entries').select('client:clients(name, email)').eq('id', entry.id).single(),
        sb.from('companies').select('name, phone, email, pix_key, pix_merchant_name, pix_city').eq('id', companyId).single(),
        sb.from('charge_links').select('id, sent_to, sent_at, created_at, view_count, revoked_at, expires_at').eq('entry_id', entry.id).order('created_at', { ascending: false }),
      ])
      if (e.error) throw e.error
      if (c.error) throw c.error
      if (links.error) throw links.error
      const client = (e.data as unknown as { client: { name: string; email: string | null } | null }).client
      return { client, company: c.data, links: links.data ?? [] }
    },
  })
  const [to, setTo] = useState<string | null>(null)
  const [prepared, setPrepared] = useState<{ subject: string; body: string; url: string; pix: string; linkId: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const openCents = entry.amount_cents - entry.paid_cents
  const email = to ?? info.data?.client?.email ?? ''
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  const prepare = useMutation({
    mutationFn: async () => {
      const company = info.data?.company
      if (!company?.pix_key) throw new Error('Cadastre a chave Pix em Dados da empresa.')
      const { data, error } = await requireSupabase().rpc('create_charge_link', { p_entry_id: entry.id, p_days: 30 })
      if (error) throw error
      const row = data?.[0]
      if (!row) throw new Error('O link não foi gerado')
      const url = `${window.location.origin}/cobranca/${row.token}`
      const pix = buildPixPayload({
        key: company.pix_key,
        name: company.pix_merchant_name ?? company.name,
        city: company.pix_city ?? 'BRASIL',
        amountCents: openCents,
        txid: `LANC${String(entry.number).padStart(6, '0')}`,
      })
      const text = chargeEmailText({ clientName: info.data?.client?.name ?? null, description: entry.description, openCents, dueDate: entry.due_date, pixCode: pix, url, company })
      return { ...text, url, pix, linkId: row.link_id }
    },
    onSuccess: setPrepared,
  })
  const send = useMutation({
    mutationFn: async () => {
      if (!prepared) return
      const { error } = await requireSupabase().rpc('mark_charge_sent', { p_link_id: prepared.linkId, p_sent_to: email.trim() })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finance', companyId, 'charge-info', entry.id] }),
  })
  const err = info.error ?? prepare.error ?? send.error

  return (
    <FormDialog title="Cobrar por e-mail" description={`${entry.description}: ${formatBRL(openCents)} em aberto, vence em ${formatIsoDate(entry.due_date)}.`} onClose={onClose} wide>
      <div className="grid gap-4 text-sm">
        {err && <Alert tone="error">{err instanceof Error && !('code' in err) ? err.message : toUserMessage(err)}</Alert>}
        {info.isSuccess && !info.data.company.pix_key && (
          <Alert tone="warning" title="Falta a chave Pix">
            Cadastre em <Link to="/empresa" className="underline">Dados da empresa</Link>.
          </Alert>
        )}
        <TextField
          label="E-mail do cliente"
          type="email"
          value={email}
          onChange={(e) => setTo(e.target.value)}
          error={email && !emailOk ? 'E-mail inválido' : undefined}
          hint={info.data?.client && !info.data.client.email ? 'O cliente não tem e-mail no cadastro: digite aqui.' : undefined}
        />
        {!prepared ? (
          <Button className="justify-self-start" loading={prepare.isPending || info.isPending} disabled={!info.data?.company.pix_key} onClick={() => prepare.mutate()}>
            Preparar cobrança com Pix
          </Button>
        ) : (
          <>
            <TextAreaField label="Mensagem (vai assim para o Gmail; você pode ajustar lá antes de enviar)" rows={10} value={prepared.body} readOnly />
            <div className="flex flex-wrap gap-2">
              <Button
                loading={send.isPending}
                disabled={!emailOk}
                onClick={() => {
                  // Abre já no clique (bloqueadores de pop-up exigem o gesto do usuário).
                  window.open(gmailComposeUrl(email.trim(), prepared.subject, prepared.body), '_blank', 'noopener')
                  send.mutate()
                }}
              >
                <Mail className="size-4" aria-hidden /> Abrir no Gmail
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(prepared.pix).then(() => setCopied(true))
                }}
              >
                <Copy className="size-4" aria-hidden /> {copied ? 'Pix copiado' : 'Copiar Pix copia e cola'}
              </Button>
              <a href={prepared.url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-md px-3 hover:bg-black/5 dark:hover:bg-white/10">
                <ExternalLink className="size-4" aria-hidden /> Ver página da cobrança
              </a>
            </div>
            {send.isSuccess && <Alert tone="success">Gmail aberto com a cobrança pronta. Clique em Enviar por lá.</Alert>}
          </>
        )}
        {(info.data?.links ?? []).length > 0 && (
          <div className="grid gap-1 border-t border-line pt-3 text-[13px]">
            <p className="font-medium">Cobranças anteriores deste lançamento</p>
            {(info.data?.links ?? []).map((l) => (
              <p key={l.id} className="text-muted">
                {l.sent_at ? `Enviada para ${l.sent_to} em ${formatDateTime(l.sent_at)}` : `Gerada em ${formatDateTime(l.created_at)} (não enviada)`}, {l.view_count} visualização(ões)
                {l.revoked_at ? ', revogada' : `, vale até ${formatDate(l.expires_at)}`}
              </p>
            ))}
          </div>
        )}
      </div>
    </FormDialog>
  )
}
