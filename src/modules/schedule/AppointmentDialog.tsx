import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { TextAreaField } from '@/components/ui/TextArea'
import type { AppointmentKind, Json } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatCode } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { ClientPicker, type PickedClient } from '../clients/ClientPicker'
import { equipmentTitle, useClientEquipment, useEquipmentTypes } from '../equipment/queries'
import { useAssignable } from '../orders/queries'
import { fromLocalInput, nextFullHour, toLocalInput } from './dates'
import { kindLabels, scheduleKeys, type AppointmentRow } from './queries'

const DURATIONS = [30, 60, 90, 120, 180, 240] as const

export function AppointmentDialog({
  companyId,
  appointment,
  initialStart,
  onClose,
}: {
  companyId: string
  appointment: AppointmentRow | null
  initialStart?: Date | undefined
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const assignable = useAssignable(companyId)
  const types = useEquipmentTypes()
  const start0 = appointment ? new Date(appointment.starts_at) : (initialStart ?? nextFullHour())
  const dur0 = appointment ? Math.round((new Date(appointment.ends_at).getTime() - start0.getTime()) / 60000) : 60

  const [kind, setKind] = useState<AppointmentKind>(appointment?.kind ?? 'onsite')
  const [title, setTitle] = useState(appointment?.title ?? '')
  const [client, setClient] = useState<PickedClient | null>(appointment?.client ? { id: appointment.client.id, name: appointment.client.name, code: appointment.client.code } : null)
  const [equipmentId, setEquipmentId] = useState(appointment?.equipment_id ?? '')
  const [assigned, setAssigned] = useState(appointment?.assigned_to ?? '')
  const [start, setStart] = useState(toLocalInput(start0))
  const [duration, setDuration] = useState(String(dur0))
  const [location, setLocation] = useState(appointment?.location ?? '')
  const [notes, setNotes] = useState(appointment?.notes ?? '')
  const [touched, setTouched] = useState(false)
  const equipment = useClientEquipment(companyId, client?.id ?? '', Boolean(client))
  const typeLabel = (key: string) => types.data?.find((t) => t.key === key)?.label ?? key

  const startDate = fromLocalInput(start)
  const minutes = Number(duration)
  const errors = {
    title: title.trim().length < 3 ? 'Descreva o atendimento (mínimo 3 caracteres)' : undefined,
    client: client ? undefined : 'Escolha o cliente',
    start: startDate ? undefined : 'Data e hora inválidas',
    equipment: kind === 'dropoff' && !equipmentId ? 'Escolha o equipamento que o cliente vai trazer' : undefined,
  }
  const valid = Object.values(errors).every((e) => !e)

  const save = useMutation({
    mutationFn: async () => {
      if (!startDate || !client) throw new Error('Dados incompletos')
      const ends = new Date(startDate.getTime() + minutes * 60000)
      const { error } = await requireSupabase().rpc('save_appointment', {
        p_company_id: companyId,
        p_id: appointment?.id ?? null,
        p_data: {
          kind,
          title: title.trim(),
          client_id: client.id,
          equipment_id: equipmentId || null,
          assigned_to: assigned || null,
          starts_at: startDate.toISOString(),
          ends_at: ends.toISOString(),
          location: location.trim() || null,
          notes: notes.trim() || null,
        } as Json,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scheduleKeys.all(companyId) })
      onClose()
    },
  })

  return (
    <FormDialog
      title={appointment ? `Editar agendamento ${formatCode('AG', appointment.number)}` : 'Novo agendamento'}
      description="O mesmo técnico não pode ter dois atendimentos no mesmo horário."
      onClose={onClose}
      wide
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (valid) save.mutate()
        }}
      >
        {save.isError && (
          <div className="sm:col-span-2">
            <Alert tone="error">{toUserMessage(save.error)}</Alert>
          </div>
        )}
        <SelectField label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as AppointmentKind)}>
          {(Object.keys(kindLabels) as AppointmentKind[]).map((k) => (
            <option key={k} value={k}>
              {kindLabels[k]}
            </option>
          ))}
        </SelectField>
        <TextField label="Assunto" placeholder="Visita: impressora não imprime" value={title} onChange={(e) => setTitle(e.target.value)} error={touched ? errors.title : undefined} />
        <div className="sm:col-span-2">
          <ClientPicker
            companyId={companyId}
            value={client}
            error={touched ? errors.client : undefined}
            onChange={(c) => {
              setClient(c)
              setEquipmentId('')
            }}
          />
        </div>
        <SelectField
          label={kind === 'dropoff' ? 'Equipamento' : 'Equipamento (opcional)'}
          value={equipmentId}
          onChange={(e) => setEquipmentId(e.target.value)}
          disabled={!client}
          error={touched ? errors.equipment : undefined}
        >
          <option value="">{client ? 'Nenhum' : 'Escolha o cliente primeiro'}</option>
          {(equipment.data ?? [])
            .filter((q) => !q.archived_at || q.id === equipmentId)
            .map((q) => (
              <option key={q.id} value={q.id}>
                {formatCode('EQ', q.code)} {equipmentTitle(q, typeLabel(q.type))}
              </option>
            ))}
        </SelectField>
        <SelectField label="Responsável" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
          <option value="">Sem responsável</option>
          {(assignable.data ?? []).map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name ?? m.email}
            </option>
          ))}
        </SelectField>
        <TextField label="Início" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} error={touched ? errors.start : undefined} />
        <SelectField label="Duração" value={duration} onChange={(e) => setDuration(e.target.value)}>
          {[...new Set<number>([...DURATIONS, dur0])]
            .sort((a, b) => a - b)
            .map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`}
              </option>
            ))}
        </SelectField>
        {(kind === 'onsite' || kind === 'pickup') && (
          <div className="sm:col-span-2">
            <TextField label="Local" placeholder="Endereço do atendimento" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
        )}
        <div className="sm:col-span-2">
          <TextAreaField label="Observações" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {appointment ? 'Salvar alterações' : 'Agendar'}
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}
