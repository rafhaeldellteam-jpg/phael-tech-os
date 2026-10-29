import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField, TextField } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { TextAreaField } from '@/components/ui/TextArea'
import { useActiveCompany } from '@/core/company/useCompany'
import type { Json } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatCode } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { ClientPicker, type PickedClient } from '../clients/ClientPicker'
import { useClient } from '../clients/queries'
import { equipmentKeys, useEquipment, useEquipmentTypes } from './queries'
import { COMPUTER_TYPES, equipmentSchema, toEquipmentPayload, type EquipmentFormValues } from './schema'

export function EquipmentFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const isEdit = Boolean(id)
  const { company } = useActiveCompany()
  const equipment = useEquipment(company.id, id ?? '', isEdit)
  const presetClientId = params.get('cliente') ?? ''
  const presetClient = useClient(company.id, presetClientId, !isEdit && Boolean(presetClientId))

  if (isEdit && equipment.isPending) return <Spinner label="Carregando equipamento" />
  if (isEdit && equipment.isError) return <ErrorState error={equipment.error} onRetry={equipment.refetch} />
  if (isEdit && !equipment.data) {
    return (
      <Alert tone="warning" title="Equipamento não encontrado">
        <Link to="/equipamentos" className="underline">Voltar para equipamentos</Link>
      </Alert>
    )
  }
  if (!isEdit && presetClientId && presetClient.isPending) return <Spinner label="Carregando cliente" />

  const e = equipment.data
  const client: PickedClient | null = e
    ? { id: e.client.id, name: e.client.name, code: e.client.code }
    : presetClient.data
      ? { id: presetClient.data.id, name: presetClient.data.name, code: presetClient.data.code }
      : null

  const initial: EquipmentFormValues = {
    clientId: client?.id ?? '',
    type: e?.type ?? 'notebook',
    manufacturer: e?.manufacturer ?? '',
    model: e?.model ?? '',
    serialNumber: e?.serial_number ?? '',
    assetTag: e?.asset_tag ?? '',
    processor: e?.processor ?? '',
    memory: e?.memory ?? '',
    storage: e?.storage ?? '',
    graphics: e?.graphics ?? '',
    operatingSystem: e?.operating_system ?? '',
    conditionNotes: e?.condition_notes ?? '',
    accessories: (e?.accessories ?? []).join(', '),
  }

  return (
    <EquipmentForm
      key={id ?? 'new'}
      companyId={company.id}
      equipmentId={id ?? null}
      code={e?.code ?? null}
      initial={initial}
      initialClient={client}
    />
  )
}

function EquipmentForm({
  companyId,
  equipmentId,
  code,
  initial,
  initialClient,
}: {
  companyId: string
  equipmentId: string | null
  code: number | null
  initial: EquipmentFormValues
  initialClient: PickedClient | null
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const types = useEquipmentTypes()
  const [client, setClient] = useState<PickedClient | null>(initialClient)
  const { register, handleSubmit, formState, watch, control } = useForm<EquipmentFormValues>({
    resolver: zodResolver(equipmentSchema),
    defaultValues: initial,
  })
  const errors = formState.errors
  const type = watch('type')
  const isComputer = COMPUTER_TYPES.has(type)

  const save = useMutation({
    mutationFn: async (values: EquipmentFormValues) => {
      const { data, error } = await requireSupabase().rpc('save_equipment', {
        p_company_id: companyId,
        p_equipment_id: equipmentId,
        p_data: toEquipmentPayload(values) as Json,
      })
      if (error) throw error
      return data
    },
    onSuccess: async (savedId) => {
      await queryClient.invalidateQueries({ queryKey: equipmentKeys.all(companyId) })
      navigate(`/equipamentos/${savedId}`, { replace: true, state: { saved: true } })
    },
  })

  return (
    <div className="grid gap-5">
      <PageHeader
        title={equipmentId ? 'Editar equipamento' : 'Novo equipamento'}
        description={code ? formatCode('EQ', code) : 'Registre o equipamento na entrada. Cliente e tipo são obrigatórios.'}
      />
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid max-w-3xl gap-6" noValidate>
        {save.isError && <Alert tone="error">{toUserMessage(save.error)}</Alert>}

        <fieldset className="surface grid gap-4 rounded-lg p-5 sm:grid-cols-2">
          <legend className="sr-only">Identificação</legend>
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
                  }}
                />
              )}
            />
          </div>
          <SelectField label="Tipo" error={errors.type?.message} {...register('type')}>
            {(types.data ?? []).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </SelectField>
          <TextField label="Fabricante" placeholder="Dell, Lenovo, HP…" error={errors.manufacturer?.message} {...register('manufacturer')} />
          <TextField label="Modelo" error={errors.model?.message} {...register('model')} />
          <TextField label="Número de série" autoComplete="off" error={errors.serialNumber?.message} {...register('serialNumber')} />
          <TextField label="Patrimônio" hint="Etiqueta do cliente, se houver." error={errors.assetTag?.message} {...register('assetTag')} />
        </fieldset>

        {isComputer && (
          <fieldset className="surface grid gap-4 rounded-lg p-5 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">Configuração</legend>
            <TextField label="Processador" error={errors.processor?.message} {...register('processor')} />
            <TextField label="Memória RAM" placeholder="8 GB DDR4" error={errors.memory?.message} {...register('memory')} />
            <TextField label="Armazenamento" placeholder="SSD 256 GB" error={errors.storage?.message} {...register('storage')} />
            <TextField label="Placa de vídeo" error={errors.graphics?.message} {...register('graphics')} />
            <TextField label="Sistema operacional" placeholder="Windows 11 Pro" error={errors.operatingSystem?.message} {...register('operatingSystem')} />
          </fieldset>
        )}

        <fieldset className="surface grid gap-4 rounded-lg p-5">
          <legend className="px-1 text-sm font-semibold">Entrada</legend>
          <TextAreaField
            label="Condições físicas"
            placeholder="Riscos na tampa, tecla F5 solta, dobradiça direita frouxa…"
            hint="Descreva o estado na entrada: protege a loja e o cliente."
            error={errors.conditionNotes?.message}
            {...register('conditionNotes')}
          />
          <TextField
            label="Acessórios recebidos"
            placeholder="Carregador, mochila, mouse"
            hint="Separe por vírgula."
            error={errors.accessories?.message}
            {...register('accessories')}
          />
          <p className="text-[13px] text-muted">Fotos de entrada chegam com o módulo de anexos, ainda nesta fase.</p>
        </fieldset>

        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending}>
            {equipmentId ? 'Salvar alterações' : 'Cadastrar equipamento'}
          </Button>
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  )
}
