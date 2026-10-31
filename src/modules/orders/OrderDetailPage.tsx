import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, FileDown, Pencil, UserRound, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { TextAreaField } from '@/components/ui/TextArea'
import { useAuth } from '@/core/auth/useAuth'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { toUserMessage } from '@/lib/errors'
import { formatCode, formatDateTime, formatPhone } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { equipmentTitle, useEquipmentTypes } from '../equipment/queries'
import { useCompanyDetails } from '../settings/queries'
import { isOverdue, modeLabels, nextStatuses, priorityLabels, stageTone, type NextStatus } from './meta'
import { OrderBilling } from '../finance/OrderBilling'
import { OrderWarranty } from '../warranties/OrderWarranty'
import { useOrderWarranties } from '../warranties/queries'
import { OrderItems } from './OrderItems'
import { downloadOrderPdf } from './orderPdfDownload'
import { OrderSignatures } from './OrderSignatures'
import { OrderPhotos } from './OrderPhotos'
import { OrderDiagnostics } from '../diagnostics/OrderDiagnostics'
import { OrderQuotes } from '../quotes/OrderQuotes'
import { OrderShare } from '../portal/OrderShare'
import { orderKeys, useAssignable, useOrder, useOrderEvents, useWorkflow } from './queries'

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="break-words">{children || <span className="text-muted">Não informado</span>}</dd>
    </div>
  )
}

export function OrderDetailPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const { user } = useAuth()
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const queryClient = useQueryClient()
  const order = useOrder(company.id, id)
  const events = useOrderEvents(company.id, id)
  const workflow = useWorkflow()
  const assignable = useAssignable(company.id)
  const types = useEquipmentTypes()
  const companyDetails = useCompanyDetails(company.id)
  const delivered = Boolean(order.data?.delivered_at) && !order.data?.warranty_of
  const warranties = useOrderWarranties(company.id, id, delivered)
  const [statusOpen, setStatusOpen] = useState(false)
  const [pdfKind, setPdfKind] = useState<'intake' | 'delivery' | null>(null)
  const [pdfError, setPdfError] = useState<unknown>(null)
  const [note, setNote] = useState('')

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: orderKeys.all(company.id) })
  }

  const assign = useMutation({
    mutationFn: async (userId: string | null) => {
      const { error } = await requireSupabase().rpc('assign_service_order', { p_order_id: id, p_user_id: userId })
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const addNote = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('add_service_order_note', { p_order_id: id, p_note: note })
      if (error) throw error
    },
    onSuccess: async () => {
      setNote('')
      await invalidate()
    },
  })

  if (order.isPending || workflow.isPending) return <Spinner label="Carregando OS" />
  if (order.isError) return <ErrorState error={order.error} onRetry={order.refetch} />
  if (workflow.isError) return <ErrorState error={workflow.error} onRetry={workflow.refetch} />
  const o = order.data
  if (!o) {
    return (
      <Alert tone="warning" title="OS não encontrada">
        Ela pode estar atribuída a outro técnico ou não existir. <Link to="/ordens" className="underline">Voltar para as OS</Link>
      </Alert>
    )
  }

  const { statuses, transitions } = workflow.data
  const status = statuses.find((s) => s.key === o.status)
  const label = (key: string | null) => statuses.find((s) => s.key === key)?.label ?? key ?? ''
  const options = nextStatuses(o.status, transitions, statuses, {
    update: can(['orders.update']),
    deliver: can(['orders.deliver']),
  })
  const late = isOverdue(o, status?.stage)
  const finished = status?.stage === 'done' || status?.stage === 'stopped'
  const code = formatCode('OS', o.number)
  const typeLabel = (key: string) => types.data?.find((t) => t.key === key)?.label ?? key
  const equipmentName = o.equipment ? equipmentTitle(o.equipment, typeLabel(o.equipment.type)) : null
  const memberName = (uid: string | null) => {
    if (!uid) return null
    if (uid === user?.id) return 'Você'
    const m = assignable.data?.find((a) => a.user_id === uid)
    return m ? (m.full_name ?? m.email) : 'Membro da equipe'
  }
  const canReassign = can(['orders.update']) && can(['orders.read_all'])
  const canTakeOver = can(['orders.update']) && !o.assigned_to
  const makePdf = async (kind: 'intake' | 'delivery') => {
    if (!companyDetails.data) return
    setPdfKind(kind)
    setPdfError(null)
    try {
      await downloadOrderPdf({
        kind,
        company: companyDetails.data,
        order: o,
        statusLabel: status?.label ?? o.status,
        client: o.client,
        equipmentTitle: equipmentName,
        serial: o.equipment?.serial_number ?? null,
        warranties: warranties.data ?? [],
      })
    } catch (e) {
      setPdfError(e)
    } finally {
      setPdfKind(null)
    }
  }
  const saved = (location.state as { saved?: 'created' | 'updated' | 'warranty' } | null)?.saved

  return (
    <div className="grid gap-5">
      <nav aria-label="Trilha" className="text-sm text-muted">
        <Link to="/ordens" className="hover:underline">
          Ordens de serviço
        </Link>{' '}
        / {code}
      </nav>

      <PageHeader
        title={`${code}, ${o.client.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status ? stageTone[status.stage] : 'neutral'}>{status?.label ?? o.status}</Badge>
            <span>{modeLabels[o.mode]}</span>
            {o.priority !== 'normal' && <Badge tone={o.priority === 'low' ? 'neutral' : 'attn'}>Prioridade {priorityLabels[o.priority].toLowerCase()}</Badge>}
            {late && <Badge tone="danger">Atrasada</Badge>}
            {o.warranty_of && <Badge tone="attn">Retorno em garantia</Badge>}
          </span>
        }
        actions={
          <>
            {options.length > 0 && (
              <Button onClick={() => setStatusOpen(true)}>
                <ArrowRightLeft className="size-4" aria-hidden /> Mudar status
              </Button>
            )}
            <Button variant="secondary" loading={pdfKind === 'intake'} disabled={!companyDetails.data} onClick={() => void makePdf('intake')}>
              <FileDown className="size-4" aria-hidden /> PDF de entrada
            </Button>
            {o.delivered_at && (
              <Button variant="secondary" loading={pdfKind === 'delivery'} disabled={!companyDetails.data} onClick={() => void makePdf('delivery')}>
                <FileDown className="size-4" aria-hidden /> PDF de entrega
              </Button>
            )}
            {can(['orders.update']) && !finished && (
              <ButtonLink to={`/ordens/${o.id}/editar`} variant="ghost">
                <Pencil className="size-4" aria-hidden /> Editar
              </ButtonLink>
            )}
          </>
        }
      />

      {saved === 'created' && <Alert tone="success">OS aberta. Baixe o PDF de entrada para o cliente assinar.</Alert>}
      {saved === 'updated' && <Alert tone="success">OS atualizada.</Alert>}
      {saved === 'warranty' && <Alert tone="success">OS de retorno em garantia aberta. Aceite ou negue a garantia depois de avaliar o equipamento.</Alert>}
      {pdfError != null && <Alert tone="error">Não foi possível gerar o PDF: {toUserMessage(pdfError)}</Alert>}
      {assign.isError && <Alert tone="error">{toUserMessage(assign.error)}</Alert>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-5">
          <section className="surface grid gap-4 rounded-lg p-5" aria-labelledby="cliente-h">
            <h2 id="cliente-h" className="font-semibold">
              Cliente e equipamento
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item label="Cliente">
                <Link to={`/clientes/${o.client.id}`} className="underline underline-offset-4">
                  {o.client.name}
                </Link>
              </Item>
              <Item label="Contato">{formatPhone(o.client.whatsapp ?? o.client.phone) || o.client.email}</Item>
              <Item label="Equipamento">
                {o.equipment && (
                  <Link to={`/equipamentos/${o.equipment.id}`} className="underline underline-offset-4">
                    {formatCode('EQ', o.equipment.code)} {equipmentName}
                  </Link>
                )}
              </Item>
              <Item label="Número de série">{o.equipment?.serial_number}</Item>
            </dl>
          </section>

          <section className="surface grid gap-4 rounded-lg p-5" aria-labelledby="problema-h">
            <h2 id="problema-h" className="font-semibold">
              Problema e entrada
            </h2>
            <dl className="grid gap-4">
              <Item label="Problema relatado">
                <span className="whitespace-pre-line">{o.reported_problem}</span>
              </Item>
              <Item label="Sintomas observados">{o.symptoms && <span className="whitespace-pre-line">{o.symptoms}</span>}</Item>
              <Item label="Condições na entrada">{o.intake_condition && <span className="whitespace-pre-line">{o.intake_condition}</span>}</Item>
              <Item label="Acessórios recebidos">
                {o.intake_accessories.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {o.intake_accessories.map((a) => (
                      <li key={a}>
                        <Badge>{a}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Item>
              {o.device_password_note && <Item label="Acesso ao sistema">{o.device_password_note}</Item>}
            </dl>
          </section>

          <OrderPhotos companyId={company.id} orderId={o.id} canUpload={can(['orders.update', 'orders.create', 'diagnostics.write'])} canDelete={can(['orders.update'])} />
          <OrderDiagnostics
            companyId={company.id}
            orderId={o.id}
            equipmentType={o.equipment?.type ?? null}
            canWrite={can(['diagnostics.write'])}
            editable={!finished}
          />
          <OrderQuotes
            companyId={company.id}
            orderId={o.id}
            canRead={can(['quotes.read'])}
            canWrite={can(['quotes.write'])}
            canDecide={can(['quotes.record_decision'])}
            canApply={can(['orders.update'])}
            editable={!finished}
            clientName={o.client.name}
          />
          <OrderItems companyId={company.id} orderId={o.id} editable={!finished} />
          <OrderBilling companyId={company.id} orderId={o.id} orderNumber={o.number} />
          <OrderWarranty companyId={company.id} order={o} canCreate={can(['orders.create'])} canDecide={can(['orders.update'])} />
          <OrderShare
            companyId={company.id}
            orderId={o.id}
            orderNumber={o.number}
            clientName={o.client.name}
            clientPhone={o.client.whatsapp ?? o.client.phone}
            canShare={can(['orders.update', 'orders.create', 'orders.deliver'])}
          />
          <OrderSignatures
            companyId={company.id}
            orderId={o.id}
            delivered={Boolean(o.delivered_at)}
            clientName={o.client.name}
            companyName={companyDetails.data?.name ?? company.name}
            userId={user?.id}
            userName={(user?.user_metadata?.full_name as string | undefined) ?? ''}
            canSign={can(['orders.update', 'orders.deliver'])}
          />

        </div>

        <aside className="grid content-start gap-5">
          <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="resp-h">
            <h2 id="resp-h" className="font-semibold">
              Responsável e prazos
            </h2>
            {canReassign ? (
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted">Técnico responsável</span>
                <select
                  value={o.assigned_to ?? ''}
                  disabled={assign.isPending}
                  onChange={(e) => assign.mutate(e.target.value || null)}
                  className="h-10 rounded-md border border-line bg-[var(--surface)] px-2"
                >
                  <option value="">Sem responsável</option>
                  {(assignable.data ?? []).map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name ?? m.email}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="flex items-center gap-2 text-sm">
                <UserRound className="size-4 text-muted" aria-hidden />
                {memberName(o.assigned_to) ?? 'Sem responsável'}
                {canTakeOver && user && (
                  <Button size="sm" variant="secondary" loading={assign.isPending} onClick={() => assign.mutate(user.id)}>
                    Assumir OS
                  </Button>
                )}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Item label="Entrada">{formatDateTime(o.received_at)}</Item>
              <Item label="Prazo">{o.due_at && <span className={late ? 'font-medium text-danger-600' : ''}>{formatDateTime(o.due_at)}</span>}</Item>
              {o.ready_at && <Item label="Pronta em">{formatDateTime(o.ready_at)}</Item>}
              {o.delivered_at && <Item label="Entregue em">{formatDateTime(o.delivered_at)}</Item>}
              {o.closed_at && <Item label="Encerrada em">{formatDateTime(o.closed_at)}</Item>}
            </dl>
          </section>

          <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="timeline-h">
            <h2 id="timeline-h" className="font-semibold">
              Linha do tempo
            </h2>
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (note.trim()) addNote.mutate()
              }}
            >
              <TextAreaField label="Nova observação" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              {addNote.isError && <p className="text-[13px] text-danger-600">{toUserMessage(addNote.error)}</p>}
              <Button type="submit" size="sm" variant="secondary" loading={addNote.isPending} disabled={!note.trim()} className="justify-self-start">
                Registrar observação
              </Button>
            </form>
            {events.isPending ? (
              <Spinner label="Carregando" />
            ) : events.isError ? (
              <ErrorState error={events.error} onRetry={events.refetch} />
            ) : (
              <ol className="grid gap-3 border-l border-line pl-4 text-sm">
                {events.data.map((ev) => (
                  <li key={ev.id} className="relative">
                    <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-navy-300" aria-hidden />
                    <p>
                      <span className="font-medium">{memberName(ev.actor_id) ?? 'Sistema'}</span>{' '}
                      {ev.kind === 'created' && 'abriu a OS'}
                      {ev.kind === 'status' && (
                        <>
                          mudou de <strong>{label(ev.from_status)}</strong> para <strong>{label(ev.to_status)}</strong>
                        </>
                      )}
                      {ev.kind === 'assigned' && (ev.assigned_to ? <>atribuiu a <strong>{memberName(ev.assigned_to)}</strong></> : 'removeu o responsável')}
                      {ev.kind === 'note' && 'registrou uma observação'}
                      {ev.kind === 'updated' && 'editou os dados da OS'}
                    </p>
                    {ev.reason && <p className="text-muted">Motivo: {ev.reason}</p>}
                    {ev.note && <p className="whitespace-pre-line">{ev.note}</p>}
                    <time className="text-[13px] text-muted tabular-nums" dateTime={ev.created_at}>
                      {formatDateTime(ev.created_at)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>

      {statusOpen && (
        <StatusDialog
          orderId={o.id}
          currentLabel={status?.label ?? o.status}
          options={options}
          onClose={() => setStatusOpen(false)}
          onDone={async () => {
            setStatusOpen(false)
            await invalidate()
          }}
        />
      )}

    </div>
  )
}

function StatusDialog({
  orderId,
  currentLabel,
  options,
  onClose,
  onDone,
}: {
  orderId: string
  currentLabel: string
  options: NextStatus[]
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [to, setTo] = useState(options[0]?.key ?? '')
  const [reason, setReason] = useState('')
  const chosen = options.find((x) => x.key === to)
  const change = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('change_service_order_status', {
        p_order_id: orderId,
        p_to: to,
        p_reason: reason.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  const missingReason = Boolean(chosen?.requiresReason) && !reason.trim()

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy-950/50" />
        <Dialog.Content className="surface fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg p-5 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="grid flex-1 gap-1">
              <Dialog.Title className="text-lg font-semibold">Mudar status</Dialog.Title>
              <Dialog.Description className="text-sm text-muted">Agora: {currentLabel}</Dialog.Description>
            </div>
            <Dialog.Close className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Fechar">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!missingReason) change.mutate()
            }}
          >
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Novo status</legend>
              {options.map((opt) => (
                <label key={opt.key} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm has-[:checked]:border-brand-600 dark:has-[:checked]:border-ok-500">
                  <input type="radio" name="to" value={opt.key} checked={to === opt.key} onChange={() => setTo(opt.key)} className="size-4" />
                  <span className="flex-1">{opt.label}</span>
                  {opt.requiresReason && <span className="text-[13px] text-muted">pede motivo</span>}
                </label>
              ))}
            </fieldset>
            <TextAreaField
              label={chosen?.requiresReason ? 'Motivo' : 'Motivo (opcional)'}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              error={change.isError ? toUserMessage(change.error) : undefined}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" loading={change.isPending} disabled={!to || missingReason}>
                Confirmar mudança
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
