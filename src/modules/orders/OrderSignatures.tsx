import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PenLine } from 'lucide-react'
import { useRef, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { SignaturePad, type SignaturePadHandle } from '@/components/ui/SignaturePad'
import { Spinner } from '@/components/ui/Spinner'
import type { SignatureDocument, SignatureRole } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { orderKeys } from './queries'

export interface SignatureRow {
  id: string
  document: SignatureDocument
  signer_role: SignatureRole
  signer_name: string
  image_data: string
  signed_at: string
}

export const signaturesKey = (companyId: string, orderId: string) => [...orderKeys.all(companyId), 'signatures', orderId] as const

export function useOrderSignatures(companyId: string, orderId: string) {
  return useQuery({
    queryKey: signaturesKey(companyId, orderId),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('order_signatures')
        .select('id, document, signer_role, signer_name, image_data, signed_at')
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

/** Assinaturas eletrônicas do cliente e da empresa nos comprovantes de entrada e entrega. */
export function OrderSignatures({
  companyId,
  orderId,
  delivered,
  clientName,
  companyName,
  userId,
  userName,
  canSign,
}: {
  companyId: string
  orderId: string
  delivered: boolean
  clientName: string
  companyName: string
  userId: string | undefined
  userName: string
  canSign: boolean
}) {
  const signatures = useOrderSignatures(companyId, orderId)
  const [signing, setSigning] = useState<{ document: SignatureDocument; role: SignatureRole } | null>(null)
  const docs: SignatureDocument[] = delivered ? ['intake', 'delivery'] : ['intake']

  return (
    <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="assin-h">
      <div className="grid gap-1">
        <h2 id="assin-h" className="font-semibold">
          Assinaturas
        </h2>
        <p className="text-[13px] text-muted">Assinatura eletrônica na tela. Entra no PDF do comprovante e não pode ser alterada depois.</p>
      </div>
      {signatures.isPending ? (
        <Spinner label="Carregando assinaturas" />
      ) : signatures.isError ? (
        <Alert tone="error">{toUserMessage(signatures.error)}</Alert>
      ) : (
        <div className="grid gap-4">
          {docs.map((doc) => (
            <div key={doc} className="grid gap-2">
              <h3 className="text-sm font-semibold text-muted">{docLabel[doc]}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['client', 'company'] as const).map((role) => {
                  const sig = signatures.data.find((s) => s.document === doc && s.signer_role === role)
                  return (
                    <div key={role} className="grid content-start gap-1.5 rounded-md border border-line p-3 text-sm">
                      <span className="text-[13px] text-muted">{role === 'client' ? 'Cliente' : companyName}</span>
                      {sig ? (
                        <>
                          <img src={sig.image_data} alt={`Assinatura de ${sig.signer_name}`} className="h-16 w-full rounded bg-white object-contain" />
                          <span className="font-medium">{sig.signer_name}</span>
                          <span className="text-[12px] text-muted tabular-nums">Assinado em {formatDateTime(sig.signed_at)}</span>
                        </>
                      ) : canSign ? (
                        <Button size="sm" variant="secondary" className="justify-self-start" onClick={() => setSigning({ document: doc, role })}>
                          <PenLine className="size-4" aria-hidden /> {role === 'client' ? 'Colher assinatura do cliente' : 'Assinar pela empresa'}
                        </Button>
                      ) : (
                        <span className="text-muted">Pendente</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
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
    </section>
  )
}

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
  const [name, setName] = useState(defaultName)
  const [useSaved, setUseSaved] = useState(true)
  const [remember, setRemember] = useState(true)
  const [empty, setEmpty] = useState(true)
  const [agree, setAgree] = useState(role === 'company')
  const hasSaved = role === 'company' && Boolean(saved.data)
  const drawing = !(hasSaved && useSaved)

  const sign = useMutation({
    mutationFn: async () => {
      const image = drawing ? pad.current?.toDataUrl() : saved.data?.image_data
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
      if (role === 'company' && drawing && remember) {
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

  return (
    <FormDialog
      title={role === 'client' ? 'Assinatura do cliente' : 'Assinatura da empresa'}
      description={`Comprovante de ${document === 'intake' ? 'entrada' : 'entrega'}. Depois de confirmada, não pode ser alterada.`}
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
        <TextField label="Nome de quem assina" value={name} onChange={(e) => setName(e.target.value)} />
        {hasSaved && saved.data && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useSaved} onChange={(e) => setUseSaved(e.target.checked)} className="size-4" />
            Usar minha assinatura salva
            <img src={saved.data.image_data} alt="Assinatura salva" className="ml-2 h-10 rounded bg-white object-contain" />
          </label>
        )}
        {drawing && <SignaturePad ref={pad} label="Assinatura" onChange={setEmpty} />}
        {role === 'company' && drawing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4" />
            Salvar como minha assinatura para os próximos documentos
          </label>
        )}
        {role === 'client' && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4" />
            <span>
              {document === 'intake'
                ? 'Confirmo que entreguei o equipamento nas condições descritas e li os termos de entrada.'
                : 'Confirmo que recebi o equipamento e li os termos de entrega e garantia.'}
            </span>
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
