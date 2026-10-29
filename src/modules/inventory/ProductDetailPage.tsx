import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDownUp, Pencil } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField, TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import type { StockMovementKind } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { formatBRL } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { ProductDialog } from './ProductDialog'
import { inventoryKeys, movementLabels, useMovements, useProduct } from './queries'

function Stat({ label, children, tone }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className="grid gap-0.5 bg-[var(--surface)] p-4">
      <span className={`text-2xl font-semibold tabular-nums [font-stretch:85%] ${tone ?? ''}`}>{children}</span>
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  )
}

export function ProductDetailPage() {
  const { id = '' } = useParams()
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const product = useProduct(company.id, id)
  const movements = useMovements(company.id, id)
  const [editing, setEditing] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const showCost = can(['inventory.write']) || can(['finance.read'])

  if (product.isPending) return <Spinner label="Carregando produto" />
  if (product.isError) return <ErrorState error={product.error} onRetry={product.refetch} />
  const p = product.data
  if (!p) {
    return (
      <Alert tone="warning" title="Produto não encontrado">
        <Link to="/estoque" className="underline">Voltar para o estoque</Link>
      </Alert>
    )
  }
  const needs = p.min_qty > 0 && p.qty_on_hand <= p.min_qty

  return (
    <div className="grid gap-5">
      <nav aria-label="Trilha" className="text-sm text-muted">
        <Link to="/estoque" className="hover:underline">
          Estoque
        </Link>{' '}
        / {p.sku}
      </nav>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">{p.sku}</span>
            {p.manufacturer && <span>{p.manufacturer}</span>}
            {p.supplier && <span>Fornecedor: {p.supplier.name}</span>}
            {p.tracks_serial && <Badge>Controla série</Badge>}
            {!p.active && <Badge tone="attn">Inativo</Badge>}
          </span>
        }
        actions={
          can(['inventory.write']) && (
            <>
              <Button onClick={() => setAdjusting(true)}>
                <ArrowDownUp className="size-4" aria-hidden /> Ajustar estoque
              </Button>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden /> Editar
              </Button>
            </>
          )
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-[var(--border)] sm:grid-cols-4">
        <Stat label={needs ? 'Saldo, abaixo do mínimo' : 'Saldo'} tone={needs ? 'text-danger-600' : undefined}>
          {p.qty_on_hand} {p.unit}
        </Stat>
        <Stat label="Estoque mínimo">{p.min_qty}</Stat>
        {showCost && <Stat label="Custo médio">{formatBRL(p.cost_cents)}</Stat>}
        <Stat label="Preço de venda">{formatBRL(p.price_cents)}</Stat>
      </div>

      <section className="grid gap-2" aria-labelledby="mov-h">
        <h2 id="mov-h" className="text-lg font-semibold">
          Movimentações
        </h2>
        {movements.isPending ? (
          <Spinner label="Carregando" />
        ) : movements.isError ? (
          <ErrorState error={movements.error} onRetry={movements.refetch} />
        ) : movements.data.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma movimentação ainda. Dê entrada por uma compra em Fornecedores e compras.</p>
        ) : (
          <div className="surface overflow-x-auto rounded-lg">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Data</th>
                  <th className="px-4 py-2.5 font-medium">Movimento</th>
                  <th className="px-4 py-2.5 text-right font-medium">Qtd.</th>
                  {showCost && <th className="px-4 py-2.5 text-right font-medium">Custo un.</th>}
                  <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {movements.data.map((m) => (
                  <tr key={m.id} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-2.5 text-muted tabular-nums">{formatDateTime(m.created_at)}</td>
                    <td className="px-4 py-2.5">
                      <p>{movementLabels[m.kind]}</p>
                      {(m.reason || m.serial_number) && (
                        <p className="text-[13px] text-muted">
                          {m.order_id ? (
                            <Link to={`/ordens/${m.order_id}`} className="underline underline-offset-2">
                              {m.reason}
                            </Link>
                          ) : (
                            m.reason
                          )}
                          {m.serial_number && ` (S/N ${m.serial_number})`}
                        </p>
                      )}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${m.direction > 0 ? 'text-ok-600 dark:text-ok-500' : ''}`}>
                      {m.direction > 0 ? '+' : '−'}
                      {m.qty}
                    </td>
                    {showCost && <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(m.unit_cost_cents)}</td>}
                    <td className="px-4 py-2.5 text-right tabular-nums">{m.balance_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && <ProductDialog companyId={company.id} product={p} onClose={() => setEditing(false)} />}
      {adjusting && (
        <AdjustDialog
          companyId={company.id}
          productId={p.id}
          name={p.name}
          balance={p.qty_on_hand}
          tracksSerial={p.tracks_serial}
          onClose={() => setAdjusting(false)}
        />
      )}
    </div>
  )
}

function AdjustDialog({
  companyId,
  productId,
  name,
  balance,
  tracksSerial,
  onClose,
}: {
  companyId: string
  productId: string
  name: string
  balance: number
  tracksSerial: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<StockMovementKind>('adjustment_out')
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [serial, setSerial] = useState('')
  const qtyNum = /^\d+$/.test(qty) ? Number(qty) : 0
  const leaving = kind !== 'adjustment_in'
  const after = balance + (leaving ? -qtyNum : qtyNum)

  const adjust = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('adjust_stock', {
        p_product_id: productId,
        p_kind: kind,
        p_qty: qtyNum,
        p_reason: reason,
        p_serial: serial || null,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.all(companyId) })
      onClose()
    },
  })

  const invalid = qtyNum <= 0 || !reason.trim() || after < 0 || (leaving && tracksSerial && !serial.trim())

  return (
    <FormDialog title={`Ajustar estoque de ${name}`} description="Entradas de mercadoria comprada são feitas pela compra, para registrar custo e fornecedor." onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!invalid) adjust.mutate()
        }}
      >
        {adjust.isError && <Alert tone="error">{toUserMessage(adjust.error)}</Alert>}
        <SelectField label="Tipo de ajuste" value={kind} onChange={(e) => setKind(e.target.value as StockMovementKind)}>
          <option value="adjustment_out">Saída: falta, perda ou defeito</option>
          <option value="supplier_return">Saída: devolução ao fornecedor</option>
          <option value="adjustment_in">Entrada: sobra na contagem</option>
        </SelectField>
        <TextField
          label="Quantidade"
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          error={after < 0 ? `Saldo atual é ${balance}` : undefined}
          hint={`Saldo passa de ${balance} para ${Math.max(after, 0)}.`}
        />
        {tracksSerial && (
          <TextField label={leaving ? 'Número de série' : 'Número de série (opcional)'} value={serial} onChange={(e) => setSerial(e.target.value)} />
        )}
        <TextField label="Motivo" placeholder="Contagem de 29/10: 1 unidade com defeito" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={adjust.isPending} disabled={invalid}>
            Registrar ajuste
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}
