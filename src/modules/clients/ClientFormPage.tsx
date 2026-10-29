import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField, TextField } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { TextAreaField } from '@/components/ui/TextArea'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import type { Json } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatCode, formatPhone, formatZip } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { formatTaxId, onlyDigits } from '@/lib/tax-id'
import { clientKeys, useClient, useClientSensitive } from './queries'
import { clientSchema, emptyClient, toSavePayload, UFS, type ClientFormValues } from './schema'

interface Duplicate {
  id: string
  code: number
  name: string
  reason: string
}

type SaveResult = { kind: 'duplicates'; duplicates: Duplicate[] } | { kind: 'saved'; id: string }

export function ClientFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const canSensitive = can(['clients.read_sensitive'])
  const client = useClient(company.id, id ?? '', isEdit)
  const sensitive = useClientSensitive(company.id, id ?? '', isEdit && canSensitive)

  if (isEdit && (client.isPending || (canSensitive && sensitive.isPending))) return <Spinner label="Carregando cliente" />
  if (isEdit && client.isError) return <ErrorState error={client.error} onRetry={client.refetch} />
  if (isEdit && !client.data) {
    return (
      <Alert tone="warning" title="Cliente não encontrado">
        Ele pode ter sido removido ou pertencer a outra empresa. <Link to="/clientes" className="underline">Voltar para clientes</Link>
      </Alert>
    )
  }

  const c = client.data
  const initial: ClientFormValues = c
    ? {
        kind: c.kind,
        name: c.name,
        tradeName: c.trade_name ?? '',
        taxId: sensitive.data?.tax_id ? formatTaxId(sensitive.data.tax_id) : '',
        email: c.email ?? '',
        phone: formatPhone(c.phone),
        whatsapp: formatPhone(c.whatsapp),
        preferredChannel: c.preferred_channel ?? '',
        zipCode: formatZip(c.zip_code),
        street: c.street ?? '',
        streetNumber: c.street_number ?? '',
        complement: c.complement ?? '',
        district: c.district ?? '',
        city: c.city ?? '',
        state: (c.state ?? '') as ClientFormValues['state'],
        marketingConsent: c.marketing_consent,
        internalNotes: sensitive.data?.internal_notes ?? '',
      }
    : emptyClient

  return (
    <ClientForm
      key={id ?? 'new'}
      companyId={company.id}
      clientId={id ?? null}
      code={c?.code ?? null}
      initial={initial}
      canSensitive={canSensitive}
      taxIdLocked={Boolean(c?.has_tax_id) && !canSensitive}
    />
  )
}

function ClientForm({
  companyId,
  clientId,
  code,
  initial,
  canSensitive,
  taxIdLocked,
}: {
  companyId: string
  clientId: string | null
  code: number | null
  initial: ClientFormValues
  canSensitive: boolean
  taxIdLocked: boolean
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null)
  const [cepState, setCepState] = useState<'idle' | 'loading' | 'error'>('idle')
  const form = useForm<ClientFormValues>({ resolver: zodResolver(clientSchema), defaultValues: initial })
  const { register, handleSubmit, formState, watch, setValue, getValues } = form
  const kind = watch('kind')
  const errors = formState.errors

  useEffect(() => setDuplicates(null), [kind])

  const save = useMutation({
    mutationFn: async ({ values, force }: { values: ClientFormValues; force: boolean }): Promise<SaveResult> => {
      const sb = requireSupabase()
      if (!force) {
        const { data: dups, error: dupError } = await sb.rpc('find_client_duplicates', {
          p_company_id: companyId,
          p_name: values.name,
          p_email: values.email || null,
          p_phone: onlyDigits(values.whatsapp || values.phone) || null,
          p_tax_id: formState.dirtyFields.taxId ? onlyDigits(values.taxId) || null : null,
          p_exclude_id: clientId,
        })
        if (dupError) throw dupError
        if (dups && dups.length > 0) return { kind: 'duplicates', duplicates: dups }
      }
      const { data, sensitive } = toSavePayload(values, {
        canSensitive,
        taxIdTouched: Boolean(formState.dirtyFields.taxId) && !taxIdLocked,
      })
      const { data: savedId, error } = await sb.rpc('save_client', {
        p_company_id: companyId,
        p_client_id: clientId,
        p_data: data as Json,
        p_sensitive: sensitive as Json,
      })
      if (error) throw error
      return { kind: 'saved', id: savedId }
    },
    onSuccess: async (result) => {
      if (result.kind === 'duplicates') {
        setDuplicates(result.duplicates)
        return
      }
      await queryClient.invalidateQueries({ queryKey: clientKeys.all(companyId) })
      navigate(`/clientes/${result.id}`, { replace: true, state: { saved: true } })
    },
  })

  const lookupCep = async () => {
    const cep = onlyDigits(getValues('zipCode'))
    if (cep.length !== 8) {
      setCepState('error')
      return
    }
    setCepState('loading')
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
      const j = (await r.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }
      if (!r.ok || j.erro) throw new Error('CEP não encontrado')
      const opts = { shouldDirty: true, shouldValidate: true }
      if (j.logradouro) setValue('street', j.logradouro, opts)
      if (j.bairro) setValue('district', j.bairro, opts)
      if (j.localidade) setValue('city', j.localidade, opts)
      if (j.uf && (UFS as readonly string[]).includes(j.uf)) setValue('state', j.uf as ClientFormValues['state'], opts)
      setCepState('idle')
    } catch {
      setCepState('error')
    }
  }

  const submit = (force: boolean) => handleSubmit((values) => save.mutate({ values, force }))

  return (
    <div className="grid gap-5">
      <PageHeader
        title={clientId ? `Editar ${initial.name}` : 'Novo cliente'}
        description={code ? formatCode('CL', code) : 'Só o nome é obrigatório. Complete o resto quando tiver os dados.'}
      />

      <form onSubmit={submit(false)} className="grid max-w-3xl gap-6" noValidate>
        {save.isError && <Alert tone="error">{toUserMessage(save.error)}</Alert>}

        <fieldset className="surface grid gap-4 rounded-lg p-5 sm:grid-cols-2">
          <legend className="sr-only">Identificação</legend>
          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium" id="kind-label">
              Tipo
            </span>
            <div className="flex gap-4 text-sm" role="radiogroup" aria-labelledby="kind-label">
              <label className="flex items-center gap-2">
                <input type="radio" value="person" {...register('kind')} className="size-4" /> Pessoa física
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" value="company" {...register('kind')} className="size-4" /> Pessoa jurídica
              </label>
            </div>
          </div>
          <TextField
            label={kind === 'company' ? 'Razão social' : 'Nome completo'}
            autoComplete="off"
            error={errors.name?.message}
            {...register('name')}
          />
          {kind === 'company' ? (
            <TextField label="Nome fantasia" error={errors.tradeName?.message} {...register('tradeName')} />
          ) : (
            <span className="hidden sm:block" />
          )}
          {taxIdLocked ? (
            <TextField
              label={kind === 'company' ? 'CNPJ' : 'CPF'}
              value="Cadastrado (oculto para o seu papel)"
              disabled
              readOnly
              hint="Só quem vê dados sensíveis pode alterar."
            />
          ) : (
            <TextField
              label={kind === 'company' ? 'CNPJ (opcional)' : 'CPF (opcional)'}
              inputMode="numeric"
              hint={canSensitive ? 'Visível só para quem tem acesso a dados sensíveis.' : 'Depois de salvo, fica oculto para o seu papel.'}
              error={errors.taxId?.message}
              {...register('taxId')}
            />
          )}
        </fieldset>

        <fieldset className="surface grid gap-4 rounded-lg p-5 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Contato</legend>
          <TextField label="WhatsApp" type="tel" inputMode="tel" error={errors.whatsapp?.message} {...register('whatsapp')} />
          <TextField label="Telefone" type="tel" inputMode="tel" error={errors.phone?.message} {...register('phone')} />
          <TextField label="E-mail" type="email" error={errors.email?.message} {...register('email')} />
          <SelectField label="Canal preferido" {...register('preferredChannel')}>
            <option value="">Sem preferência</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="phone">Ligação</option>
            <option value="email">E-mail</option>
          </SelectField>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" {...register('marketingConsent')} className="mt-0.5 size-4" />
            <span>
              Aceita receber avisos e novidades
              <span className="block text-muted">
                Registre só com autorização do cliente. Avisos do próprio atendimento (orçamento, retirada) não dependem disso.
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset className="surface grid gap-4 rounded-lg p-5 sm:grid-cols-6">
          <legend className="px-1 text-sm font-semibold">Endereço</legend>
          <div className="grid gap-1.5 sm:col-span-2">
            <TextField label="CEP" inputMode="numeric" error={errors.zipCode?.message} {...register('zipCode')} />
            <button
              type="button"
              onClick={() => void lookupCep()}
              className="justify-self-start text-[13px] underline underline-offset-4"
              disabled={cepState === 'loading'}
            >
              {cepState === 'loading' ? 'Buscando endereço…' : 'Preencher pelo CEP'}
            </button>
            {cepState === 'error' && (
              <p className="text-[13px] text-danger-600" role="alert">
                CEP não encontrado. Confira os 8 dígitos ou preencha à mão.
              </p>
            )}
          </div>
          <div className="sm:col-span-4">
            <TextField label="Rua" error={errors.street?.message} {...register('street')} />
          </div>
          <div className="sm:col-span-2">
            <TextField label="Número" error={errors.streetNumber?.message} {...register('streetNumber')} />
          </div>
          <div className="sm:col-span-4">
            <TextField label="Complemento" error={errors.complement?.message} {...register('complement')} />
          </div>
          <div className="sm:col-span-2">
            <TextField label="Bairro" error={errors.district?.message} {...register('district')} />
          </div>
          <div className="sm:col-span-3">
            <TextField label="Cidade" error={errors.city?.message} {...register('city')} />
          </div>
          <div className="sm:col-span-1">
            <SelectField label="UF" error={errors.state?.message} {...register('state')}>
              <option value=""></option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </SelectField>
          </div>
        </fieldset>

        {canSensitive && (
          <fieldset className="surface grid gap-4 rounded-lg p-5">
            <legend className="px-1 text-sm font-semibold">Uso interno</legend>
            <TextAreaField
              label="Observações internas"
              hint="Não aparecem para técnicos e atendentes, nem em documentos do cliente."
              error={errors.internalNotes?.message}
              {...register('internalNotes')}
            />
          </fieldset>
        )}

        {duplicates && (
          <Alert tone="warning" title="Já existem clientes parecidos">
            <ul className="my-2 grid gap-1">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <Link to={`/clientes/${d.id}`} className="underline underline-offset-4">
                    {formatCode('CL', d.code)} {d.name}
                  </Link>{' '}
                  <span className="text-muted">({d.reason.toLowerCase()})</span>
                </li>
              ))}
            </ul>
            <p>Se for a mesma pessoa, abra o cadastro existente. Se não, salve mesmo assim.</p>
            <Button variant="secondary" size="sm" className="mt-2" loading={save.isPending} onClick={submit(true)}>
              Salvar mesmo assim
            </Button>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending && !duplicates}>
            {clientId ? 'Salvar alterações' : 'Cadastrar cliente'}
          </Button>
          <Button variant="ghost" onClick={() => navigate(clientId ? `/clientes/${clientId}` : '/clientes')}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  )
}
