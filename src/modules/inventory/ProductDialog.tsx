import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import type { Database } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { centsToInput } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { moneyField, moneyToCents } from '@/lib/zod-money'
import { inventoryKeys } from './queries'

type Product = Database['public']['Tables']['products']['Row']

const UNITS = [
  ['un', 'Unidade'],
  ['kit', 'Kit'],
  ['cx', 'Caixa'],
  ['m', 'Metro'],
  ['kg', 'Quilo'],
  ['l', 'Litro'],
] as const

const schema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, 'Informe o código (SKU)')
    .regex(/^[A-Za-z0-9._/-]{1,40}$/, 'Use letras, números e . _ / - (sem espaços)'),
  name: z.string().trim().min(2, 'Informe o nome').max(160),
  category: z.string().trim().max(60),
  manufacturer: z.string().trim().max(80),
  supplierId: z.string(),
  unit: z.enum(['un', 'kit', 'cx', 'm', 'kg', 'l']),
  price: moneyField('Preço'),
  initialCost: moneyField('Custo'),
  minQty: z.string().trim().regex(/^\d{0,6}$/, 'Quantidade inteira'),
  tracksSerial: z.boolean(),
  active: z.boolean(),
})
type Values = z.infer<typeof schema>

export function ProductDialog({
  companyId,
  product,
  onClose,
  onSaved,
}: {
  companyId: string
  product: Product | null
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const suppliers = useQuery({
    queryKey: ['suppliers', companyId, 'options'],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('suppliers')
        .select('id, name')
        .eq('company_id', companyId)
        .eq('active', true)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      sku: product?.sku ?? '',
      name: product?.name ?? '',
      category: product?.category ?? '',
      manufacturer: product?.manufacturer ?? '',
      supplierId: product?.supplier_id ?? '',
      unit: (product?.unit as Values['unit']) ?? 'un',
      price: product ? centsToInput(product.price_cents) : '',
      initialCost: '',
      minQty: product ? String(product.min_qty) : '0',
      tracksSerial: product?.tracks_serial ?? false,
      active: product?.active ?? true,
    },
  })
  const e = formState.errors

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const row = {
        sku: v.sku.toUpperCase(),
        name: v.name,
        category: v.category || null,
        manufacturer: v.manufacturer || null,
        supplier_id: v.supplierId || null,
        unit: v.unit,
        price_cents: moneyToCents(v.price),
        min_qty: Number(v.minQty || '0'),
        tracks_serial: v.tracksSerial,
        active: v.active,
      }
      const sb = requireSupabase()
      if (product) {
        const { error } = await sb.from('products').update(row).eq('id', product.id)
        if (error) throw error
        return product.id
      }
      const { data, error } = await sb
        .from('products')
        .insert({ ...row, company_id: companyId, cost_cents: moneyToCents(v.initialCost) })
        .select('id')
        .single()
      if (error) throw error
      return data.id
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.all(companyId) })
      onSaved?.(id)
      onClose()
    },
  })

  return (
    <FormDialog
      title={product ? `Editar ${product.name}` : 'Novo produto ou peça'}
      description={product ? 'Saldo e custo médio mudam só por compras, ajustes e OS.' : 'O saldo começa em zero: dê entrada por uma compra ou ajuste.'}
      onClose={onClose}
      wide
    >
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
        {save.isError && (
          <div className="sm:col-span-2">
            <Alert tone="error">{toUserMessage(save.error)}</Alert>
          </div>
        )}
        <TextField label="Código (SKU)" placeholder="SSD-240" autoComplete="off" error={e.sku?.message} {...register('sku')} />
        <TextField label="Nome" placeholder="SSD 240 GB SATA" error={e.name?.message} {...register('name')} />
        <TextField label="Categoria" placeholder="Armazenamento" error={e.category?.message} {...register('category')} />
        <TextField label="Fabricante" error={e.manufacturer?.message} {...register('manufacturer')} />
        <SelectField label="Fornecedor principal" {...register('supplierId')}>
          <option value="">Nenhum</option>
          {(suppliers.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Unidade" {...register('unit')}>
          {UNITS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </SelectField>
        <TextField label="Preço de venda (R$)" inputMode="decimal" error={e.price?.message} {...register('price')} />
        {!product && (
          <TextField
            label="Custo inicial (R$)"
            inputMode="decimal"
            hint="Opcional. Depois o custo médio vem das compras."
            error={e.initialCost?.message}
            {...register('initialCost')}
          />
        )}
        <TextField label="Estoque mínimo" inputMode="numeric" hint="Abaixo disso, entra no alerta de reposição." error={e.minQty?.message} {...register('minQty')} />
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" {...register('tracksSerial')} className="mt-0.5 size-4" />
          <span>
            Controlar número de série
            <span className="block text-muted">Ao usar na OS, o número de série da peça passa a ser obrigatório.</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" {...register('active')} className="size-4" /> Ativo
        </label>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {product ? 'Salvar alterações' : 'Cadastrar produto'}
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}
