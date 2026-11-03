import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Link2, Mail, MessageCircle, PenLine, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { SignaturePad, type SignaturePadHandle } from '@/components/ui/SignaturePad'
import { Spinner } from '@/components/ui/Spinner'
import type { SignatureDocument, SignatureRole } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatCode, formatDateTime, whatsappLink } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { gmailComposeUrl } from '../finance/ChargeEmail'
import { orderKeys } from './queries'

export interface SignatureRow {
  id: string
  document: SignatureDocument
  signer_role: SignatureRole
  signer_name: string
  image_data: string
  signed_at: string
  channel: 'in_person' | 'remote_link'
}

/** Assinatura oficial da Phael Tech Support (Rafhael Santos), em PNG transparente. */
export const OFFICIAL_SIGNATURE_URL = '/brand/assinatura-rafhael.png'
export const OFFICIAL_SIGNER_NAME = 'Rafhael Santos (Phael Tech Support)'

async function loadOfficialSignature(): Promise<string> {
  const blob = await fetch(OFFICIAL_SIGNATURE_URL).then((r) => {
    if (!r.ok) throw new Error('Não foi possível carregar a assinatura oficial')
    return r.blob()
  })
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('Não foi possível ler a assinatura oficial'))
    fr.readAsDataURL(blob)
  })
}

interface RequestRow {
  id: string
  document: SignatureDocument
  expires_at: string
  revoked_at: string | null
  signed_at: string | null
  view_count: number
  last_viewed_at: string | null
  created_at: string
}
const requestsKey = (companyId: string, orderId: string) => [...orderKeys.all(companyId), 'signature-requests', orderId] as const

export const signaturesKey = (companyId: string, orderId: string) => [...orderKeys.all(companyId), 'signatures', orderId] as const

export function useOrderSignatures(companyId: string, orderId: string, poll = false) {
  return useQuery({
    refetchInterval: poll ? 10_000 : false,
    queryKey: signaturesKey(companyId, orderId),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('order_signatures')
        .select('id, document, signer_role, signer_name, image_data, signed_at, channel')
        .eq('order_id', orderId)
        .order('signed_at')
      if (error) throw error
      return (data ?? []) as SignatureRow[]
    },
  })
}

function useMySignature(companyId: string, userId: string | undefined) {
  return useQuery({
    queryKey: ['my-signature', companyId, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('member_signatures')
        .select('signer_name, image_data')
        .eq('company_id', companyId)
        .eq('user_id', userId ?? '')
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}


const docLabel: Record<SignatureDocument, string> = { intake: 'Entrada', delivery: 'Entrega' }
const docName: Record<SignatureDocument, string> = { intake: 'comprovante de entrada', delivery: 'comprovante de entrega' }

/** Assinaturas eletrônicas do cliente e da empresa nos comprovantes de entrada e entrega. */
export function OrderSignatures({
  companyId,
  orderId,
  orderNumber,
  delivered,
  clientName,
  clientPhone,
  clientEmail,
  companyName,
  userId,
  userName,
  canSign,
}: {
  companyId: string
  orderId: string
  orderNumber: number
  delivered: boolean
  clientName: string
  clientPhone: string | null
  clientEmail: string | null
  companyName: string
  userId: string | undefined
  userName: string
  canSign: boolean
}) {
  const queryClient = useQueryClient()
  const requests = useQuery({
    queryKey: requestsKey(companyId, orderId),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('signature_requests')
        .select('id, document, expires_at, revoked_at, signed_at, view_count, last_viewed_at, created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as RequestRow[]
    },
  })
  const now = Date.now()
  const pending = (requests.data ?? []).filter((r) => !r.revoked_at && !r.signed_at && new Date(r.expires_at).getTime() > now)
  const signatures = useOrderSignatures(companyId, orderId, pending.length > 0)
  const [signing, setSigning] = useState<{ document: SignatureDocument; role: SignatureRole } | null>(null)
  const [linkFor, setLinkFor] = useState<SignatureDocument | null>(null)
  const docs: SignatureDocument[] = delivered ? ['intake', 'delivery'] : ['intake']

  // Quando a assinatura do cliente chega pelo link, atualiza a lista de links e a linha do tempo.
  const clientSigned = (signatures.data ?? []).filter((s) => s.signer_role === 'client').length
  useEffect(() => {
    if (clientSigned === 0) return
    void queryClient.invalidateQueries({ queryKey: requestsKey(companyId, orderId) })
    void queryClient.invalidateQueries({ queryKey: orderKeys.events(companyId, orderId) })
  }, [clientSigned, companyId, orderId, queryClient])

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await requireSupabase().rpc('revoke_signature_request', { p_request_id: id })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: requestsKey(companyId, orderId) }),
  })

  return (
    <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="assin-h">
      <div className="grid gap-1">
        <h2 id="assin-h" className="font-semibold">
          Assinaturas
        </h2>
        <p className="text-[13px] text-muted">
          Assinatura eletrônica na tela ou por link enviado ao cliente. Entra no PDF do comprovante e não pode ser alterada depois.
        </p>
      </div>
      {revoke.isError && <Alert tone="error">{toUserMessage(revoke.error)}</Alert>}
      {signatures.isPending ? (
        <Spinner label="Carregando assinaturas" />
      ) : signatures.isError ? (
        <Alert tone="error">{toUserMessage(signatures.error)}</Alert>
      ) : (
        <div className="grid gap-4">
          {docs.map((doc) => {
            const waiting = pending.find((r) => r.document === doc)
            return (
              <div key={doc} className="grid gap-2">
                <h3 className="text-sm font-semibold text-muted">{docLabel[doc]}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['client', 'company'] as const).map((role) => {
                    const sig = signatures.data.find((s) => s.document === doc && s.signer_role === role)
                    return (
                      <div
                        key={role}
                        role="group"
                        aria-label={`${docLabel[doc]}: ${role === 'client' ? 'cliente' : 'empresa'}`}
                        className="grid content-start gap-1.5 rounded-md border border-line p-3 text-sm"
                      >
                        <span className="text-[13px] text-muted">{role === 'client' ? 'Cliente' : companyName}</span>
                        {sig ? (
                          <>
                            <img src={sig.image_data} alt={`Assinatura de ${sig.signer_name}`} className="h-16 w-full rounded bg-white object-contain" />
                            <span className="font-medium">{sig.signer_name}</span>
                            <span className="text-[12px] text-muted tabular-nums">
                              Assinado em {formatDateTime(sig.signed_at)}
                              {sig.channel === 'remote_link' && ' pelo link'}
                            </span>
                          </>
                        ) : !canSign ? (
                          <span className="text-muted">Pendente</span>
                        ) : role === 'company' ? (
                          <Button size="sm" className="justify-self-start" onClick={() => setSigning({ document: doc, role })}>
                            <ShieldCheck className="size-4" aria-hidden /> Assinar como {companyName}
                          </Button>
                        ) : (
                          <>
                            {waiting && (
                              <div className="grid gap-1 rounded-md bg-[var(--surface-muted)] p-2 text-[13px]">
                                <span className="font-medium">Aguardando a assinatura do cliente pelo link</span>
                                <span className="text-muted">
                                  Vale até {formatDateTime(waiting.expires_at)}
                                  {waiting.view_count > 0
                                    ? `, aberto ${waiting.view_count}x${waiting.last_viewed_at ? ` (último em ${formatDateTime(waiting.last_viewed_at)})` : ''}`
                                    : ', ainda não aberto'}
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="justify-self-start"
                                  loading={revoke.isPending && revoke.variables === waiting.id}
                                  onClick={() => revoke.mutate(waiting.id)}
                                >
                                  Cancelar link
                                </Button>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="secondary" onClick={() => setLinkFor(doc)}>
                                <Link2 className="size-4" aria-hidden /> {waiting ? 'Novo link para assinar' : 'Enviar link para o cliente assinar'}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setSigning({ document: doc, role })}>
                                <PenLine className="size-4" aria-hidden /> Colher aqui
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {signing && (
        <SignDialog
          companyId={companyId}
          orderId={orderId}
          document={signing.document}
          role={signing.role}
          defaultName={signing.role === 'client' ? clientName : userName || companyName}
          userId={userId}
          onClose={() => setSigning(null)}
        />
      )}
      {linkFor && (
        <SignLinkDialog
          companyId={companyId}
          orderId={orderId}
          orderNumber={orderNumber}
          document={linkFor}
          clientName={clientName}
          clientPhone={clientPhone}
          clientEmail={clientEmail}
          companyName={companyName}
          onClose={() => setLinkFor(null)}
        />
      )}
    </section>
  )
}

/** Gera o link para o cliente assinar sozinho e oferece WhatsApp, e-mail ou copiar. */
function SignLinkDialog({
  companyId,
  orderId,
  orderNumber,
  document,
  clientName,
  clientPhone,
  clientEmail,
  companyName,
  onClose,
}: {
  companyId: string
  orderId: string
  orderNumber: number
  document: SignatureDocument
  clientName: string
  clientPhone: string | null
  clientEmail: string | null
  companyName: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [days, setDays] = useState('7')
  const [copied, setCopied] = useState(false)
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await requireSupabase().rpc('create_signature_request', { p_order_id: orderId, p_document: document, p_days: Number(days) })
      if (error) throw error
      const row = data?.[0]
      if (!row) throw new Error('O link não foi gerado')
      return { url: `${window.location.origin}/assinar/${row.token}`, expires: row.expires_at }
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: requestsKey(companyId, orderId) }),
        queryClient.invalidateQueries({ queryKey: orderKeys.events(companyId, orderId) }),
      ]),
  })
  const link = create.data
  const code = formatCode('OS', orderNumber)
  const first = clientName.split(' ')[0]
  const message = link
    ? `Olá, ${first}! Segue o link para você conferir e assinar o ${docName[document]} da ${code} da ${companyName}: ${link.url}\n\nO link vale até ${formatDateTime(link.expires)}.`
    : ''

  return (
    <FormDialog
      title="Enviar link para o cliente assinar"
      description={`${code}, ${docName[document]}. O cliente abre o link sem login, confere o documento e assina uma única vez. A assinatura aparece aqui automaticamente.`}
      onClose={onClose}
    >
      <div className="grid gap-4">
        {create.isError && <Alert tone="error">{toUserMessage(create.error)}</Alert>}
        {!link ? (
          <>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Validade do link</span>
              <select value={days} onChange={(e) => setDays(e.target.value)} className="h-10 rounded-md border border-line bg-[var(--surface)] px-2">
                <option value="1">1 dia</option>
                <option value="3">3 dias</option>
                <option value="7">7 dias</option>
                <option value="15">15 dias</option>
                <option value="30">30 dias</option>
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancelar
              </Button>
              <Button loading={create.isPending} onClick={() => create.mutate()}>
                <Link2 className="size-4" aria-hidden /> Gerar link
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">Link gerado. Ele aparece só agora: envie ou copie.</p>
            <input
              readOnly
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Link de assinatura"
              className="h-10 w-full rounded-md border border-line bg-[var(--surface)] px-2 text-[13px]"
            />
            <div className="flex flex-wrap gap-2">
              {clientPhone && (
                <a
                  href={`${whatsappLink(clientPhone)}?text=${encodeURIComponent(message)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-ok-600 px-3 text-sm font-medium text-white hover:brightness-110"
                >
                  <MessageCircle className="size-4" aria-hidden /> Enviar pelo WhatsApp
                </a>
              )}
              {clientEmail && (
                <a
                  href={gmailComposeUrl(clientEmail, `Assinatura do ${docName[document]} da ${code}`, message)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm font-medium hover:bg-[var(--surface-muted)]"
                >
                  <Mail className="size-4" aria-hidden /> Enviar por e-mail
                </a>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(link.url).then(() => setCopied(true))
                }}
              >
                <Copy className="size-4" aria-hidden /> {copied ? 'Copiado' : 'Copiar link'}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={onClose}>Concluir</Button>
            </div>
          </>
        )}
      </div>
    </FormDialog>
  )
}

type CompanySource = 'official' | 'saved' | 'draw'

function SignDialog({
  companyId,
  orderId,
  document,
  role,
  defaultName,
  userId,
  onClose,
}: {
  companyId: string
  orderId: string
  document: SignatureDocument
  role: SignatureRole
  defaultName: string
  userId: string | undefined
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const pad = useRef<SignaturePadHandle>(null)
  const saved = useMySignature(companyId, role === 'company' ? userId : undefined)
  const isCompany = role === 'company'
  const [source, setSource] = useState<CompanySource>(isCompany ? 'official' : 'draw')
  const [name, setName] = useState(isCompany ? OFFICIAL_SIGNER_NAME : defaultName)
  const [remember, setRemember] = useState(false)
  const [empty, setEmpty] = useState(true)
  const [agree, setAgree] = useState(isCompany)
  const drawing = source === 'draw'

  const pick = (s: CompanySource) => {
    setSource(s)
    if (s === 'official') setName(OFFICIAL_SIGNER_NAME)
    else if (s === 'saved' && saved.data) setName(saved.data.signer_name)
    else if (name === OFFICIAL_SIGNER_NAME) setName(defaultName)
  }

  const sign = useMutation({
    mutationFn: async () => {
      const image =
        source === 'official' ? await loadOfficialSignature() : source === 'saved' ? saved.data?.image_data : pad.current?.toDataUrl()
      if (!image) throw new Error('Desenhe a assinatura no quadro')
      const sb = requireSupabase()
      const { error } = await sb.rpc('sign_order', {
        p_order_id: orderId,
        p_document: document,
        p_role: role,
        p_signer_name: name.trim(),
        p_image_data: image,
      })
      if (error) throw error
      if (isCompany && drawing && remember) {
        const r = await sb.rpc('save_my_signature', { p_company_id: companyId, p_signer_name: name.trim(), p_image_data: image })
        if (r.error) throw r.error
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: signaturesKey(companyId, orderId) }),
        queryClient.invalidateQueries({ queryKey: orderKeys.events(companyId, orderId) }),
        queryClient.invalidateQueries({ queryKey: ['my-signature', companyId] }),
      ])
      onClose()
    },
  })

  const ready = name.trim().length >= 2 && agree && (!drawing || !empty)
  const option = (value: CompanySource, label: string, img?: string) => (
    <label className="flex items-center gap-3 rounded-md border border-line p-2 text-sm has-[:checked]:border-brand-600">
      <input type="radio" name="sig-source" checked={source === value} onChange={() => pick(value)} className="size-4" />
      <span className="grow">{label}</span>
      {img && <img src={img} alt="" className="h-10 max-w-[45%] rounded bg-white object-contain" />}
    </label>
  )

  return (
    <FormDialog
      title={isCompany ? 'Assinatura da empresa' : 'Assinatura do cliente'}
      description={`${docName[document][0]?.toUpperCase()}${docName[document].slice(1)}. Depois de confirmada, não pode ser alterada.`}
      onClose={onClose}
      wide
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) sign.mutate()
        }}
      >
        {sign.isError && <Alert tone="error">{sign.error instanceof Error && !('code' in sign.error) ? sign.error.message : toUserMessage(sign.error)}</Alert>}
        {isCompany && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Assinatura</legend>
            {option('official', 'Assinatura oficial (Rafhael Santos)', OFFICIAL_SIGNATURE_URL)}
            {saved.data && option('saved', 'Minha assinatura salva', saved.data.image_data)}
            {option('draw', 'Desenhar agora')}
          </fieldset>
        )}
        <TextField label="Nome de quem assina" value={name} onChange={(e) => setName(e.target.value)} />
        {drawing && <SignaturePad ref={pad} label="Assinatura" onChange={setEmpty} />}
        {isCompany && drawing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4" />
            Salvar como minha assinatura para os próximos documentos
          </label>
        )}
        {!isCompany && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4" />
            <span>{agreementText(document)}</span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={sign.isPending} disabled={!ready}>
            Confirmar assinatura
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}

export function agreementText(document: SignatureDocument): string {
  return document === 'intake'
    ? 'Confirmo que entreguei o equipamento nas condições descritas e li os termos de entrada.'
    : 'Confirmo que recebi o equipamento e li os termos de entrega e garantia.'
}
