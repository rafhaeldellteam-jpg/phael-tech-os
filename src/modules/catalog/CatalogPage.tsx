import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Sparkles, Tags } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField, TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { TextAreaField } from '@/components/ui/TextArea'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import type { Database } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { centsToInput, formatBRL } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { moneyField, moneyToCents } from '@/lib/zod-money'
import { catalogKeys, useCatalog, useServiceCategories } from './queries'

type Service = Database['public']['Tables']['service_catalog']['Row']

const optionalInt = (label: string, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= max), `${label}: número inteiro até ${max}`)

const schema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  category: z.string().min(1),
  description: z.string().trim().max(2000),
  price: moneyField('Preço'),
  cost: moneyField('Custo'),
  duration: optionalInt('Duração', 10080),
  warranty: optionalInt('Garantia', 3650),
  conditions: z.string().trim().max(2000),
  active: z.boolean(),
})
type Values = z.infer<typeof schema>

export function CatalogPage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const canWrite = can(['catalog.write'])
  const queryClient = useQueryClient()
  const catalog = useCatalog(company.id)
  const categories = useServiceCategories()
  const [editing, setEditing] = useState<Service | 'new' | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const seed = useMutation({
    mutationFn: async () => {
      const { data, error } = await requireSupabase().rpc('seed_service_catalog', { p_company_id: company.id })
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.all(company.id) }),
  })

  const rows = (catalog.data ?? []).filter((s) => showInactive || s.active)
  const withoutPrice = rows.filter((s) => s.active && s.price_cents === 0).length
  const grouped = (categories.data ?? [])
    .map((c) => ({ ...c, items: rows.filter((s) => s.category === c.key) }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Catálogo de serviços"
        description="Preços e prazos usados ao lançar serviços na OS. Alterar o preço aqui não muda OS já lançadas."
        actions={
          canWrite && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Novo serviço
            </Button>
          )
        }
      />

      {seed.isSuccess && <Alert tone="success">{seed.data} serviço(s) sugerido(s) adicionado(s). Defina os preços de cada um.</Alert>}
      {seed.isError && <Alert tone="error">{toUserMessage(seed.error)}</Alert>}
      {withoutPrice > 0 && (
        <Alert tone="warning">
          {withoutPrice} serviço(s) ativo(s) ainda sem preço. Eles entram na OS com valor zero até você definir.
        </Alert>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4" />
        Mostrar serviços desativados
      </label>

      {catalog.isPending ? (
        <Spinner label="Carregando catálogo" />
      ) : catalog.isError ? (
        <ErrorState error={catalog.error} onRetry={catalog.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="Catálogo vazio"
          action={
            canWrite && (
              <Button variant="secondary" loading={seed.isPending} onClick={() => seed.mutate()}>
                <Sparkles className="size-4" aria-hidden /> Adicionar serviços sugeridos
              </Button>
            )
          }
        >
          Comece pelos serviços mais comuns de assistência (formatação, limpeza, upgrades, sites) e ajuste os preços.
        </EmptyState>
      ) : (
        <div className="grid gap-5">
          {grouped.map((g) => (
            <section key={g.key} aria-labelledby={`cat-${g.key}`} className="grid gap-2">
              <h2 id={`cat-${g.key}`} className="text-sm font-semibold text-muted">
                {g.label}
              </h2>
              <ul className="surface divide-y divide-[var(--border)] rounded-lg text-sm">
                {g.items.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {s.name} {!s.active && <Badge tone="attn">Desativado</Badge>}
                      </p>
                      <p className="text-[13px] text-muted">
                        {[s.duration_minutes && `${s.duration_minutes} min`, s.warranty_days != null && `garantia ${s.warranty_days} dias`]
                          .filter(Boolean)
                          .join(', ') || 'Sem prazo nem garantia definidos'}
                      </p>
                    </div>
                    <span className={`tabular-nums ${s.price_cents === 0 ? 'text-attn-600' : 'font-semibold'}`}>
                      {s.price_cents === 0 ? 'Sem preço' : formatBRL(s.price_cents)}
                    </span>
                    {canWrite && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                        Editar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {canWrite && (
            <Button variant="ghost" size="sm" className="justify-self-start" loading={seed.isPending} onClick={() => seed.mutate()}>
              <Sparkles className="size-4" aria-hidden /> Adicionar sugeridos que faltam
            </Button>
          )}
        </div>
      )}

      {editing && (
        <ServiceDialog
          companyId={company.id}
          service={editing === 'new' ? null : editing}
          categories={categories.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ServiceDialog({
  companyId,
  service,
  categories,
  onClose,
}: {
  companyId: string
  service: Service | null
  categories: { key: string; label: string }[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: service?.name ?? '',
      category: service?.category ?? 'other',
      description: service?.description ?? '',
      price: service ? centsToInput(service.price_cents) : '',
      cost: service ? centsToInput(service.cost_cents) : '',
      duration: service?.duration_minutes?.toString() ?? '',
      warranty: service?.warranty_days?.toString() ?? '',
      conditions: service?.conditions ?? '',
      active: service?.active ?? true,
    },
  })
  const e = formState.errors

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const row = {
        name: v.name,
        category: v.category,
        description: v.description || null,
        price_cents: moneyToCents(v.price),
        cost_cents: moneyToCents(v.cost),
        duration_minutes: v.duration ? Number(v.duration) : null,
        warranty_days: v.warranty ? Number(v.warranty) : null,
        conditions: v.conditions || null,
        active: v.active,
      }
      const sb = requireSupabase()
      const { error } = service
        ? await sb.from('service_catalog').update(row).eq('id', service.id)
        : await sb.from('service_catalog').insert({ ...row, company_id: companyId })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all(companyId) })
      onClose()
    },
  })

  return (
    <FormDialog title={service ? `Editar ${service.name}` : 'Novo serviço'} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-4" noValidate>
        {save.isError && <Alert tone="error">{toUserMessage(save.error)}</Alert>}
        <TextField label="Nome" error={e.name?.message} {...register('name')} />
        <SelectField label="Categoria" {...register('category')}>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Preço ao cliente (R$)" inputMode="decimal" placeholder="150,00" error={e.price?.message} {...register('price')} />
          <TextField
            label="Custo de referência (R$)"
            inputMode="decimal"
            hint="Uso interno, para a margem."
            error={e.cost?.message}
            {...register('cost')}
          />
          <TextField label="Duração estimada (min)" inputMode="numeric" error={e.duration?.message} {...register('duration')} />
          <TextField label="Garantia (dias)" inputMode="numeric" error={e.warranty?.message} {...register('warranty')} />
        </div>
        <TextAreaField label="Descrição" rows={2} error={e.description?.message} {...register('description')} />
        <TextAreaField
          label="Condições de execução"
          rows={2}
          placeholder="Ex.: inclui backup de até 100 GB; não inclui licença do Windows"
          error={e.conditions?.message}
          {...register('conditions')}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register('active')} className="size-4" /> Ativo (aparece ao lançar na OS)
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {service ? 'Salvar alterações' : 'Cadastrar serviço'}
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}
