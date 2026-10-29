import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, MapPin, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { FormDialog } from '@/components/ui/FormDialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { TextAreaField } from '@/components/ui/TextArea'
import { useAuth } from '@/core/auth/useAuth'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import type { AppointmentStatus } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatCode, formatPhone, whatsappLink } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { orderKeys, useAssignable } from '../orders/queries'
import { AppointmentDialog } from './AppointmentDialog'
import { addDays, formatDayLong, formatDayShort, formatTime, sameDay, startOfWeek } from './dates'
import { kindLabels, nextAppointmentStatuses, scheduleKeys, statusLabels, statusTone, useAppointments, type AppointmentRow } from './queries'

const actionLabel: Record<AppointmentStatus, string> = {
  scheduled: 'Reagendar',
  confirmed: 'Confirmar',
  done: 'Realizado',
  no_show: 'Não compareceu',
  canceled: 'Cancelar',
}

export function SchedulePage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const { user } = useAuth()
  const canWrite = can(['schedule.write'])
  const assignable = useAssignable(company.id)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [who, setWho] = useState('')
  const [editing, setEditing] = useState<{ appointment: AppointmentRow | null; start?: Date } | null>(null)
  const [selected, setSelected] = useState<AppointmentRow | null>(null)
  const weekEnd = addDays(weekStart, 7)
  const list = useAppointments(company.id, weekStart, weekEnd, who)
  const today = new Date()
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const memberName = (uid: string | null) => {
    if (!uid) return null
    if (uid === user?.id) return 'Você'
    const m = assignable.data?.find((a) => a.user_id === uid)
    return m ? (m.full_name ?? m.email) : 'Membro da equipe'
  }
  const weekLabel = `${formatDayShort(weekStart)} a ${formatDayShort(addDays(weekStart, 6))}`

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Agenda"
        description="Visitas, atendimentos remotos e entregas de equipamento. Depois de atender, converta em OS."
        actions={
          canWrite && (
            <Button onClick={() => setEditing({ appointment: null })}>
              <Plus className="size-4" aria-hidden /> Novo agendamento
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label="Semana anterior" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            Hoje
          </Button>
          <Button variant="secondary" size="sm" aria-label="Próxima semana" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
        <p className="text-sm font-medium tabular-nums" aria-live="polite">
          Semana de {weekLabel}
        </p>
        <label className="ml-auto grid gap-1 text-[13px] text-muted">
          Responsável
          <select value={who} onChange={(e) => setWho(e.target.value)} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]">
            <option value="">Todos</option>
            {user && <option value={user.id}>Meus atendimentos</option>}
            <option value="none">Sem responsável</option>
            {(assignable.data ?? [])
              .filter((m) => m.user_id !== user?.id)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name ?? m.email}
                </option>
              ))}
          </select>
        </label>
      </div>

      {list.isPending ? (
        <Spinner label="Carregando agenda" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : (
        <ol className="grid gap-3 md:grid-cols-7" aria-busy={list.isFetching}>
          {days.map((d) => {
            const items = list.data.filter((a) => sameDay(new Date(a.starts_at), d))
            const isToday = sameDay(d, today)
            return (
              <li key={d.toISOString()} className={`surface grid content-start gap-2 rounded-lg p-2 ${isToday ? 'ring-2 ring-brand-600 dark:ring-ok-500' : ''}`}>
                <h2 className="flex items-center justify-between px-1 text-sm font-semibold capitalize">
                  <span>
                    {formatDayShort(d)}
                    {isToday && <span className="sr-only"> (hoje)</span>}
                  </span>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => {
                        const s = new Date(d)
                        s.setHours(9, 0, 0, 0)
                        setEditing({ appointment: null, start: s })
                      }}
                      className="rounded p-1 text-muted hover:bg-black/5 hover:text-[var(--text)] dark:hover:bg-white/10"
                      aria-label={`Agendar em ${formatDayLong(d)}`}
                    >
                      <Plus className="size-4" aria-hidden />
                    </button>
                  )}
                </h2>
                {items.length === 0 ? (
                  <p className="px-1 pb-1 text-[13px] text-muted">Livre</p>
                ) : (
                  <ul className="grid gap-1.5">
                    {items.map((a) => {
                      const inactive = a.status === 'canceled' || a.status === 'no_show'
                      return (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(a)}
                            className={`grid w-full gap-0.5 rounded-md border border-line px-2 py-1.5 text-left text-[13px] hover:bg-[var(--surface-muted)] ${inactive ? 'opacity-60' : ''}`}
                          >
                            <span className="font-medium tabular-nums">
                              {formatTime(a.starts_at)}–{formatTime(a.ends_at)}
                            </span>
                            <span className={`line-clamp-2 ${a.status === 'canceled' ? 'line-through' : ''}`}>{a.title}</span>
                            <span className="truncate text-muted">{a.client?.name}</span>
                            <span className="flex flex-wrap gap-1">
                              {a.status !== 'scheduled' && <Badge tone={statusTone[a.status]}>{statusLabels[a.status]}</Badge>}
                              {!a.assigned_to && <Badge tone="attn">Sem responsável</Badge>}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {list.isSuccess && list.data.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <CalendarDays className="size-4" aria-hidden /> Nenhum atendimento nesta semana.
        </p>
      )}

      {editing && <AppointmentDialog companyId={company.id} appointment={editing.appointment} initialStart={editing.start} onClose={() => setEditing(null)} />}
      {selected && (
        <AppointmentDetail
          companyId={company.id}
          appointment={selected}
          responsible={memberName(selected.assigned_to)}
          canWrite={canWrite}
          canCreateOrder={can(['orders.create'])}
          isMine={Boolean(user && selected.assigned_to === user.id)}
          onEdit={() => {
            setEditing({ appointment: selected })
            setSelected(null)
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function AppointmentDetail({
  companyId,
  appointment: a,
  responsible,
  canWrite,
  canCreateOrder,
  isMine,
  onEdit,
  onClose,
}: {
  companyId: string
  appointment: AppointmentRow
  responsible: string | null
  canWrite: boolean
  canCreateOrder: boolean
  isMine: boolean
  onEdit: () => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [reasonFor, setReasonFor] = useState<AppointmentStatus | null>(null)
  const [reason, setReason] = useState('')
  const [converting, setConverting] = useState(false)
  const [problem, setProblem] = useState(a.title + (a.notes ? `\n${a.notes}` : ''))

  const refresh = () => queryClient.invalidateQueries({ queryKey: scheduleKeys.all(companyId) })
  const setStatus = useMutation({
    mutationFn: async ({ to, why }: { to: AppointmentStatus; why: string | null }) => {
      const { error } = await requireSupabase().rpc('set_appointment_status', { p_id: a.id, p_status: to, p_reason: why })
      if (error) throw error
    },
    onSuccess: async () => {
      await refresh()
      onClose()
    },
  })
  const convert = useMutation({
    mutationFn: async () => {
      const { data, error } = await requireSupabase().rpc('convert_appointment_to_order', { p_id: a.id, p_reported_problem: problem.trim() || null })
      if (error) throw error
      return data
    },
    onSuccess: async (orderId) => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: orderKeys.all(companyId) })])
      onClose()
      navigate(`/ordens/${orderId}`, { state: { saved: 'created' } })
    },
  })

  const options = nextAppointmentStatuses(a.status).filter((s) => canWrite || (isMine && (s === 'done' || s === 'no_show')))
  const editable = canWrite && (a.status === 'scheduled' || a.status === 'confirmed')
  const phone = a.client?.whatsapp ?? a.client?.phone ?? null
  const error = setStatus.error ?? convert.error

  return (
    <FormDialog title={`${formatCode('AG', a.number)}, ${a.title}`} description={kindLabels[a.kind]} onClose={onClose}>
      <div className="grid gap-4 text-sm">
        {error && <Alert tone="error">{toUserMessage(error)}</Alert>}
        <dl className="grid grid-cols-2 gap-3">
          <div className="col-span-2 grid gap-0.5">
            <dt className="text-[13px] text-muted">Quando</dt>
            <dd className="capitalize">
              {formatDayLong(new Date(a.starts_at))}, {formatTime(a.starts_at)} às {formatTime(a.ends_at)}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-[13px] text-muted">Cliente</dt>
            <dd>
              {a.client && (
                <Link to={`/clientes/${a.client.id}`} className="underline underline-offset-4">
                  {a.client.name}
                </Link>
              )}
              {phone && (
                <a href={whatsappLink(phone)} target="_blank" rel="noreferrer" className="block text-muted underline">
                  {formatPhone(phone)}
                </a>
              )}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-[13px] text-muted">Responsável</dt>
            <dd>{responsible ?? <span className="text-attn-600">Sem responsável</span>}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-[13px] text-muted">Situação</dt>
            <dd>
              <Badge tone={statusTone[a.status]}>{statusLabels[a.status]}</Badge>
              {a.status_reason && <span className="block text-muted">{a.status_reason}</span>}
            </dd>
          </div>
          {a.equipment && (
            <div className="grid gap-0.5">
              <dt className="text-[13px] text-muted">Equipamento</dt>
              <dd>
                <Link to={`/equipamentos/${a.equipment.id}`} className="underline underline-offset-4">
                  {[a.equipment.manufacturer, a.equipment.model].filter(Boolean).join(' ') || 'Ver ficha'}
                </Link>
              </dd>
            </div>
          )}
          {a.location && (
            <div className="col-span-2 grid gap-0.5">
              <dt className="text-[13px] text-muted">Local</dt>
              <dd className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.location)}`} target="_blank" rel="noreferrer" className="underline">
                  {a.location}
                </a>
              </dd>
            </div>
          )}
          {a.notes && (
            <div className="col-span-2 grid gap-0.5">
              <dt className="text-[13px] text-muted">Observações</dt>
              <dd className="whitespace-pre-line">{a.notes}</dd>
            </div>
          )}
        </dl>

        {a.order ? (
          <p className="flex items-center gap-2">
            <ClipboardList className="size-4 text-muted" aria-hidden />
            Virou a{' '}
            <Link to={`/ordens/${a.order.id}`} className="font-medium underline underline-offset-4">
              {formatCode('OS', a.order.number)}
            </Link>
          </p>
        ) : (
          canWrite &&
          canCreateOrder &&
          a.status !== 'canceled' &&
          (converting ? (
            <form
              className="grid gap-2 rounded-md border border-line p-3"
              onSubmit={(e) => {
                e.preventDefault()
                convert.mutate()
              }}
            >
              <TextAreaField label="Problema relatado (vai para a OS)" rows={3} value={problem} onChange={(e) => setProblem(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setConverting(false)}>
                  Voltar
                </Button>
                <Button size="sm" type="submit" loading={convert.isPending} disabled={problem.trim().length < 3}>
                  Abrir OS
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" className="justify-self-start" onClick={() => setConverting(true)}>
              <ClipboardList className="size-4" aria-hidden /> Converter em OS
            </Button>
          ))
        )}

        {reasonFor ? (
          <form
            className="grid gap-2 rounded-md border border-line p-3"
            onSubmit={(e) => {
              e.preventDefault()
              setStatus.mutate({ to: reasonFor, why: reason.trim() || null })
            }}
          >
            <TextAreaField label={reasonFor === 'canceled' ? 'Motivo do cancelamento' : 'Observação (opcional)'} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setReasonFor(null)}>
                Voltar
              </Button>
              <Button
                size="sm"
                type="submit"
                variant={reasonFor === 'canceled' ? 'danger' : 'primary'}
                loading={setStatus.isPending}
                disabled={reasonFor === 'canceled' && reason.trim().length < 3}
              >
                {reasonFor === 'canceled' ? 'Cancelar agendamento' : `Marcar como ${statusLabels[reasonFor].toLowerCase()}`}
              </Button>
            </div>
          </form>
        ) : (
          (options.length > 0 || editable) && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {options.map((to) => (
                <Button
                  key={to}
                  size="sm"
                  variant={to === 'canceled' ? 'ghost' : 'secondary'}
                  loading={setStatus.isPending && setStatus.variables?.to === to}
                  onClick={() => (to === 'canceled' || to === 'no_show' ? setReasonFor(to) : setStatus.mutate({ to, why: null }))}
                >
                  {actionLabel[to]}
                </Button>
              ))}
              {editable && (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={onEdit}>
                  Editar
                </Button>
              )}
            </div>
          )
        )}
      </div>
    </FormDialog>
  )
}
