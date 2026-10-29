import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { TextField } from '@/components/ui/Field'
import { TextAreaField } from '@/components/ui/TextArea'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { toUserMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { formatTaxId, isValidTaxId, onlyDigits } from '@/lib/tax-id'
import { settingsKeys, useCompanyDetails } from './queries'

const optional = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres`)

const schema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120, 'Máximo de 120 caracteres'),
  legalName: optional(200),
  taxId: z
    .string()
    .trim()
    .refine((v) => v === '' || isValidTaxId(v), 'CPF ou CNPJ inválido'),
  email: z.union([z.literal(''), z.email({ message: 'E-mail inválido' })]),
  phone: optional(30),
  intakeTerms: optional(4000),
  deliveryTerms: optional(4000),
})
type Values = z.infer<typeof schema>

export function CompanySettingsPage() {
  const { company } = useActiveCompany()
  const { can, refresh } = useCompany()
  const canEdit = can(['company.update'])
  const queryClient = useQueryClient()
  const details = useCompanyDetails(company.id)
  const [saved, setSaved] = useState(false)

  const form = useForm<Values>({ resolver: zodResolver(schema) })
  const { register, handleSubmit, formState, reset } = form

  useEffect(() => {
    if (!details.data) return
    reset({
      name: details.data.name,
      legalName: details.data.legal_name ?? '',
      taxId: details.data.tax_id ? formatTaxId(details.data.tax_id) : '',
      email: details.data.email ?? '',
      phone: details.data.phone ?? '',
      intakeTerms: details.data.intake_terms ?? '',
      deliveryTerms: details.data.delivery_terms ?? '',
    })
  }, [details.data, reset])

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const { error } = await requireSupabase()
        .from('companies')
        .update({
          name: v.name,
          legal_name: v.legalName || null,
          tax_id: v.taxId ? onlyDigits(v.taxId) : null,
          email: v.email || null,
          phone: v.phone || null,
          intake_terms: v.intakeTerms || null,
          delivery_terms: v.deliveryTerms || null,
        })
        .eq('id', company.id)
      if (error) throw error
    },
    onSuccess: async () => {
      setSaved(true)
      await queryClient.invalidateQueries({ queryKey: settingsKeys.company(company.id) })
      await refresh()
    },
  })

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Dados da empresa"
        description="Usados em documentos, orçamentos e no portal do cliente."
      />
      {details.isPending ? (
        <Spinner label="Carregando dados" />
      ) : details.isError ? (
        <ErrorState error={details.error} onRetry={details.refetch} />
      ) : (
        <form
          onSubmit={handleSubmit((v) => {
            setSaved(false)
            save.mutate(v)
          })}
          className="surface grid max-w-2xl gap-4 rounded-lg p-5"
          noValidate
        >
          {!canEdit && <Alert tone="info">Somente leitura: seu papel não permite alterar estes dados.</Alert>}
          {save.isError && <Alert tone="error">{toUserMessage(save.error)}</Alert>}
          {saved && !formState.isDirty && <Alert tone="success">Dados da empresa salvos.</Alert>}
          <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
            <TextField label="Nome fantasia" error={formState.errors.name?.message} {...register('name')} />
            <TextField label="Razão social" error={formState.errors.legalName?.message} {...register('legalName')} />
            <TextField
              label="CPF ou CNPJ"
              inputMode="numeric"
              hint="Fica oculto na auditoria."
              error={formState.errors.taxId?.message}
              {...register('taxId')}
            />
            <TextField label="Telefone" type="tel" autoComplete="tel" error={formState.errors.phone?.message} {...register('phone')} />
            <TextField label="E-mail" type="email" className="sm:col-span-2" error={formState.errors.email?.message} {...register('email')} />
            <div className="sm:col-span-2">
              <TextAreaField
                label="Termo do comprovante de entrada"
                rows={5}
                hint="Sai no comprovante que o cliente assina ao deixar o equipamento. Revise com cuidado: termos não podem limitar direitos previstos no Código de Defesa do Consumidor."
                error={formState.errors.intakeTerms?.message}
                {...register('intakeTerms')}
              />
            </div>
            <div className="sm:col-span-2">
              <TextAreaField
                label="Termo do comprovante de entrega"
                rows={4}
                error={formState.errors.deliveryTerms?.message}
                {...register('deliveryTerms')}
              />
            </div>
          </fieldset>
          {canEdit && (
            <Button type="submit" loading={save.isPending} disabled={!formState.isDirty} className="justify-self-start">
              Salvar alterações
            </Button>
          )}
        </form>
      )}
    </div>
  )
}
