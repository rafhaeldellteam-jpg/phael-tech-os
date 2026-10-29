import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { z } from 'zod'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField, TextField } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { TextAreaField } from '@/components/ui/TextArea'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import type { Json, OrderPriority, ServiceMode } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatCode } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { ClientPicker, type PickedClient } from '../clients/ClientPicker'
import { useClient } from '../clients/queries'
import { equipmentTitle, useClientEquipment, useEquipmentTypes } from '../equipment/queries'
import { parseAccessories } from '../equipment/schema'
import { isoToLocalInput, localInputToIso, modeLabels, priorityLabels } from './meta'
import { orderKeys, useAssignable, useOrder } from './queries'

const schema = z
  .object({
    clientId: z.string().min(1, 'Escolha o cliente'),
    mode: z.enum(['bench', 'remote', 'onsite']),
    equipmentId: z.string(),
    reportedProblem: z.string().trim().min(3, 'Descreva o problema relatado pelo cliente').max(4000),
    symptoms: z.string().trim().max(4000),
    intakeCondition: z.string().trim().max(2000),
    accessories: z.string().trim().max(600),
    passwordNote: z.string().trim().max(200),
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
    dueAt: z.string(),
    assignedTo: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'bench' && !v.equipmentId) {
      ctx.addIssue({ code: 'custom', path: ['equipmentId'], message: 'Atendimento de balcão precisa do equipamento' })
    }
  })
type Values = z.infer<typeof schema>

export function OrderFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { company } = useActiveCompany()
  const isEdit = Boolean(id)
  const order = useOrder(company.id, id ?? '')
  const presetClientId = params.get('cliente') ?? ''
  const presetClient = useClient(company.id, presetClientId, !isEdit && Boolean(presetClientId))

  if (isEdit && order.isPending) return <Spinner label="Carregando OS" />
  if (isEdit && order.isError) return <ErrorState error={order.error} onRetry={order.refetch} />
  if (isEdit && !order.data) {
    return (
      <Alert tone="warning" title="OS não encontrada">
        <Link to="/ordens" className="underline">Voltar para as OS</Link>
      </Alert>
    )
  }
  if (!isEdit && presetClientId && presetClient.isPending) return <Spinner label="Carregando cliente" />

  const o = order.data
  const client: PickedClient | null = o
    ? { id: o.client.id, name: o.client.name, code: o.client.code }
    : presetClient.data
      ? { id: presetClient.data.id, name: presetClient.data.name, code: presetClient.data.code }
      : null

  const initial: Values = {
    clientId: client?.id ?? '',
    mode: o?.mode ?? 'bench',
    equipmentId: o?.equipment_id ?? params.get('equipamento') ?? '',
    reportedProblem: o?.reported_problem ?? '',
    symptoms: o?.symptoms ?? '',
    intakeCondition: o?.intake_condition ?? '',
    accessories: (o?.intake_accessories ?? []).join(', '),
    passwordNote: o?.device_password_note ?? '',
    priority: o?.priority ?? 'normal',
    dueAt: isoToLocalInput(o?.due_at ?? null),
    assignedTo: o?.assigned_to ?? '',
  }

  return (
    <OrderForm
      key={id ?? 'new'}
      companyId={company.id}
      orderId={id ?? null}
      number={o?.number ?? null}
      initial={initial}
      initialClient={client}
    />
  )
}

function OrderForm({
  companyId,
  orderId,
  number,
  initial,
  initialClient,
}: {
  companyId: string
  orderId: string | null
  number: number | null
  initial: Values
  initialClient: PickedClient | null
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useCompany()
  const [client, setClient] = useState<PickedClient | null>(initialClient)
  const types = useEquipmentTypes()
  const assignable = useAssignable(companyId)
  const equipment = useClientEquipment(companyId, client?.id ?? '', Boolean(client))
  const { register, handleSubmit, formState, watch, control, setValue, getValues } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  })
  const errors = formState.errors
  const mode = watch('mode')
  const equipmentId = watch('equipmentId')
  const activeEquipment = (equipment.data ?? []).filter((e) => !e.archived_at)

  // Ao escolher o equipamento numa OS nova, traz acessórios e condições da ficha (editáveis).
  useEffect(() => {
    if (orderId || !equipmentId || !equipment.data) return
    const eq = equipment.data.find((e) => e.id === equipmentId)
    if (!eq) return
    void (async () => {
      const { data } = await requireSupabase()
        .from('equipment')
        .select('accessories, condition_notes')
        .eq('id', equipmentId)
        .maybeSingle()
      if (!data) return
      if (!getValues('accessories')) setValue('accessories', data.accessories.join(', '))
      if (!getValues('intakeCondition') && data.condition_notes) setValue('intakeCondition', data.condition_notes)
    })()
  }, [orderId, equipmentId, equipment.data, getValues, setValue])

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const sb = requireSupabase()
      const payload = {
        symptoms: v.symptoms,
        intake_condition: v.intakeCondition,
        intake_accessories: parseAccessories(v.accessories),
        device_password_note: v.passwordNote,
        priority: v.priority,
        due_at: localInputToIso(v.dueAt) ?? '',
        reported_problem: v.reportedProblem,
      }
      if (orderId) {
        const { error } = await sb.rpc('update_service_order', { p_order_id: orderId, p_data: payload as Json })
        if (error) throw error
        return orderId
      }
      const { data, error } = await sb.rpc('create_service_order', {
        p_company_id: companyId,
        p_data: {
          ...payload,
          client_id: v.clientId,
          equipment_id: v.mode === 'bench' || v.equipmentId ? v.equipmentId : '',
          mode: v.mode,
          assigned_to: v.assignedTo,
        } as Json,
      })
      if (error) throw error
      return data
    },
    onSuccess: async (savedId) => {
      await queryClient.invalidateQueries({ queryKey: orderKeys.all(companyId) })
      navigate(`/ordens/${savedId}`, { replace: true, state: { saved: orderId ? 'updated' : 'created' } })
    },
  })

  return (
    <div className="grid gap-5">
      <PageHeader
        title={orderId && number ? `Editar ${formatCode('OS', number)}` : 'Nova ordem de serviço'}
        description={orderId ? 'Status, responsável e observações são alterados na ficha da OS.' : 'O número é gerado ao salvar.'}
      />
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid max-w-3xl gap-6" noValidate>
        {save.isError && <Alert tone="error">{toUserMessage(save.error)}</Alert>}

        {orderId ? (
          // Cliente, tipo e equipamento não mudam depois da abertura (preserva o histórico).
          <section className="surface grid gap-1 rounded-lg p-5 text-sm">
            <p>
              <span className="text-muted">Cliente:</span> {client?.name}
            </p>
            <p>
              <span className="text-muted">Atendimento:</span> {modeLabels[initial.mode]}
            </p>
          </section>
        ) : (
          <fieldset className="surface grid gap-4 rounded-lg p-5 sm:grid-cols-2">
            <legend className="sr-only">Cliente e equipamento</legend>
            <div className="sm:col-span-2">
              <Controller
                control={control}
                name="clientId"
                render={({ field, fieldState }) => (
                  <ClientPicker
                    companyId={companyId}
                    value={client}
                    error={fieldState.error?.message}
                    onChange={(c) => {
                      setClient(c)
                      field.onChange(c?.id ?? '')
                      setValue('equipmentId', '')
                    }}
                  />
                )}
              />
            </div>
            <SelectField label="Tipo de atendimento" {...register('mode')}>
              {(Object.keys(modeLabels) as ServiceMode[]).map((m) => (
                <option key={m} value={m}>
                  {modeLabels[m]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={mode === 'bench' ? 'Equipamento' : 'Equipamento (opcional)'}
              error={errors.equipmentId?.message}
              hint={
                client && activeEquipment.length === 0 && equipment.isSuccess ? (
                  <>
                    Este cliente não tem equipamento cadastrado.{' '}
                    <Link to={`/equipamentos/novo?cliente=${client.id}`} className="underline">
                      Cadastrar equipamento
                    </Link>
                  </>
                ) : undefined
              }
              {...register('equipmentId')}
            >
              <option value="">{client ? 'Escolha o equipamento' : 'Escolha o cliente primeiro'}</option>
              {activeEquipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {formatCode('EQ', e.code)} {equipmentTitle(e, types.data?.find((t) => t.key === e.type)?.label ?? e.type)}
                  {e.serial_number ? `, S/N ${e.serial_number}` : ''}
                </option>
              ))}
            </SelectField>
          </fieldset>
        )}

        <fieldset className="surface grid gap-4 rounded-lg p-5">
          <legend className="px-1 text-sm font-semibold">Problema</legend>
          <TextAreaField
            label="Problema relatado pelo cliente"
            placeholder="Nas palavras do cliente: “não liga depois que caiu café”"
            error={errors.reportedProblem?.message}
            {...register('reportedProblem')}
          />
          <TextAreaField label="Sintomas observados no balcão" error={errors.symptoms?.message} {...register('symptoms')} />
        </fieldset>

        <fieldset className="surface grid gap-4 rounded-lg p-5 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Entrada</legend>
          <div className="sm:col-span-2">
            <TextAreaField
              label="Condições físicas na entrada"
              hint="Sai no comprovante que o cliente assina."
              error={errors.intakeCondition?.message}
              {...register('intakeCondition')}
            />
          </div>
          <TextField label="Acessórios recebidos" hint="Separe por vírgula." error={errors.accessories?.message} {...register('accessories')} />
          <TextField
            label="Acesso ao sistema"
            placeholder="Senha com o cliente"
            hint="Evite anotar a senha aqui. Fica oculto na auditoria."
            error={errors.passwordNote?.message}
            {...register('passwordNote')}
          />
        </fieldset>

        <fieldset className="surface grid gap-4 rounded-lg p-5 sm:grid-cols-3">
          <legend className="px-1 text-sm font-semibold">Andamento</legend>
          <SelectField label="Prioridade" {...register('priority')}>
            {(Object.keys(priorityLabels) as OrderPriority[]).map((p) => (
              <option key={p} value={p}>
                {priorityLabels[p]}
              </option>
            ))}
          </SelectField>
          <TextField label="Prazo estimado" type="datetime-local" error={errors.dueAt?.message} {...register('dueAt')} />
          {!orderId && can(['orders.create']) && (
            <SelectField label="Técnico responsável" {...register('assignedTo')}>
              <option value="">Definir depois</option>
              {(assignable.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name ?? m.email}
                </option>
              ))}
            </SelectField>
          )}
        </fieldset>

        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending}>
            {orderId ? 'Salvar alterações' : 'Abrir OS'}
          </Button>
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  )
}
