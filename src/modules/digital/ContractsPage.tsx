import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
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
import type { ContractStatus, Json } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatCode } from '@/lib/format'
import { centsToInput, formatBRL, parseMoney } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { ClientPicker, type PickedClient } from '../clients/ClientPicker'
import { financeKeys, statusLabels as entryStatusLabels, useCategories } from '../finance/queries'
import { formatIsoDate, isoDate } from '../finance/period'
import {
  contractStatusLabels,
  contractStatusTone,
  digitalKeys,
  intervalLabels,
  useClientDigitalServices,
  useContractCharges,
  useContractOverview,
  useContracts,
  type ContractRow,
} from './queries'

export function ContractsPage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const canWrite = can(['finance.write'])
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<'' | ContractStatus>('active')
  const [editing, setEditing] = useState<ContractRow | 'new' | null>(null)
  const [open, setOpen] = useState<ContractRow | null>(null)
  const [until, setUntil] = useState(() => isoDate(new Date(Date.now() + 30 * 86_400_000)))
  const contracts = useContracts(company.id, status)
  const overview = useContractOverview(company.id)

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await requireSupabase().rpc('generate_contract_charges', { p_company_id: company.id, p_until: until })
      if (error) throw error
      return data ?? 0
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: digitalKeys.all(company.id) }),
        queryClient.invalidateQueries({ queryKey: financeKeys.all(company.id) }),
      ])
    },
  })

  const monthly = (contracts.data ?? [])
    .filter((c) => c.status === 'active')
    .reduce((a, c) => a + Math.round(c.amount_cents / c.interval_months), 0)

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Contratos recorrentes"
        description="Manutenção, hospedagem e suporte mensal. As cobranças viram contas a receber no financeiro, sem duplicar."
        actions={
          canWrite && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Novo contrato
            </Button>
          )
        }
      />

      {canWrite && (
        <section className="surface flex flex-wrap items-end gap-3 rounded-lg p-4" aria-labelledby="gerar-h">
          <div className="grid flex-1 gap-1">
            <h2 id="gerar-h" className="font-semibold">
              Gerar cobranças
            </h2>
            <p className="text-[13px] text-muted">Cria as contas a receber dos contratos ativos que vencem até a data escolhida. Pode rodar quantas vezes quiser.</p>
          </div>
          <TextField label="Vencimentos até" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          <Button loading={generate.isPending} onClick={() => generate.mutate()}>
            <RefreshCw className="size-4" aria-hidden /> Gerar agora
          </Button>
          {generate.isSuccess && (
            <p role="status" className="basis-full text-sm">
              {generate.data === 0 ? 'Tudo em dia: nenhuma cobrança nova.' : `${generate.data} cobrança(s) criada(s) no financeiro.`}
            </p>
          )}
          {generate.isError && (
            <div className="basis-full">
              <Alert tone="error">{toUserMessage(generate.error)}</Alert>
            </div>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1 text-[13px] text-muted">
          Situação
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]">
            <option value="active">Ativos</option>
            <option value="paused">Pausados</option>
            <option value="ended">Encerrados</option>
            <option value="">Todos</option>
          </select>
        </label>
        {status === 'active' && contracts.isSuccess && contracts.data.length > 0 && (
          <p className="text-sm">
            Receita recorrente (média mensal): <strong className="tabular-nums">{formatBRL(monthly)}</strong>
          </p>
        )}
      </div>

      {contracts.isPending ? (
        <Spinner label="Carregando contratos" />
      ) : contracts.isError ? (
        <ErrorState error={contracts.error} onRetry={contracts.refetch} />
      ) : contracts.data.length === 0 ? (
        <EmptyState icon={FileText} title="Nenhum contrato com esse filtro" />
      ) : (
        <div className="surface overflow-x-auto rounded-lg" aria-busy={contracts.isFetching}>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Contrato</th>
                <th className="px-4 py-2.5 font-medium">Cliente</th>
                <th className="px-4 py-2.5 text-right font-medium">Valor</th>
                <th className="px-4 py-2.5 font-medium">Próximo vencimento</th>
                <th className="px-4 py-2.5 text-right font-medium">Em aberto</th>
              </tr>
            </thead>
            <tbody>
              {contracts.data.map((c) => {
                const ov = overview.data?.get(c.id)
                return (
                  <tr key={c.id} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => setOpen(c)} className="text-left font-medium hover:underline">
                        {c.description}
                      </button>
                      <span className="block text-[13px] text-muted">
                        {formatCode('CT', c.number)}, {intervalLabels[c.interval_months]}, dia {c.billing_day}
                        {c.service && `, ${c.service.name}`}
                      </span>
                      {c.status !== 'active' && (
                        <span className="mt-1 block">
                          <Badge tone={contractStatusTone[c.status]}>{contractStatusLabels[c.status]}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.client && (
                        <Link to={`/clientes/${c.client.id}`} className="hover:underline">
                          {c.client.name}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatBRL(c.amount_cents)}</td>
                    <td className="px-4 py-3 tabular-nums">{c.status === 'active' && ov?.next_due ? formatIsoDate(ov.next_due) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {ov ? formatBRL(ov.open_cents) : '—'}
                      {ov && ov.overdue_cents > 0 && <span className="block text-[13px] text-danger-600">{formatBRL(ov.overdue_cents)} vencido</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ContractDialog companyId={company.id} contract={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {open && (
        <ContractDetail
          companyId={company.id}
          contract={open}
          canWrite={canWrite}
          onEdit={() => {
            setEditing(open)
            setOpen(null)
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

function ContractDialog({ companyId, contract, onClose }: { companyId: string; contract: ContractRow | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const categories = useCategories(companyId)
  const [client, setClient] = useState<PickedClient | null>(contract?.client ? { id: contract.client.id, name: contract.client.name, code: contract.client.code } : null)
  const services = useClientDigitalServices(companyId, client?.id ?? '')
  const [serviceId, setServiceId] = useState(contract?.digital_service_id ?? '')
  const [description, setDescription] = useState(contract?.description ?? '')
  const [amount, setAmount] = useState(contract ? centsToInput(contract.amount_cents) : '')
  const [interval, setIntervalMonths] = useState(String(contract?.interval_months ?? 1))
  const [day, setDay] = useState(String(contract?.billing_day ?? 10))
  const [start, setStart] = useState(contract?.start_date ?? isoDate(new Date()))
  const [end, setEnd] = useState(contract?.end_date ?? '')
  const [categoryId, setCategoryId] = useState(contract?.category_id ?? '')
  const [notes, setNotes] = useState(contract?.notes ?? '')
  const [touched, setTouched] = useState(false)
  const cents = parseMoney(amount)
  const errors = {
    client: client ? undefined : 'Escolha o cliente',
    description: description.trim().length < 3 ? 'Descreva o contrato' : undefined,
    amount: cents === null || cents <= 0 ? 'Informe o valor' : undefined,
    day: /^\d{1,2}$/.test(day) && Number(day) >= 1 && Number(day) <= 28 ? undefined : 'Dia de 1 a 28',
    start: start ? undefined : 'Informe o início',
    end: end && end < start ? 'Fim antes do início' : undefined,
  }
  const valid = Object.values(errors).every((e) => !e)

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('save_contract', {
        p_company_id: companyId,
        p_id: contract?.id ?? null,
        p_data: {
          client_id: client?.id,
          digital_service_id: serviceId || null,
          description: description.trim(),
          amount_cents: cents,
          interval_months: Number(interval),
          billing_day: Number(day),
          start_date: start,
          end_date: end || null,
          category_id: categoryId || null,
          notes: notes.trim() || null,
        } as Json,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: digitalKeys.all(companyId) })
      onClose()
    },
  })

  return (
    <FormDialog
      title={contract ? `Editar ${formatCode('CT', contract.number)}` : 'Novo contrato recorrente'}
      description="Depois da primeira cobrança, cliente, início, periodicidade e dia ficam fixos. Reajustes valem para as próximas cobranças."
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
        <div className="sm:col-span-2">
          <ClientPicker
            companyId={companyId}
            value={client}
            error={touched ? errors.client : undefined}
            onChange={(c) => {
              setClient(c)
              setServiceId('')
            }}
          />
        </div>
        <TextField label="Descrição" placeholder="Manutenção mensal do site" value={description} onChange={(e) => setDescription(e.target.value)} error={touched ? errors.description : undefined} />
        <SelectField label="Serviço digital (opcional)" value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={!client}>
          <option value="">Nenhum</option>
          {(services.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Valor por cobrança (R$)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={touched ? errors.amount : undefined} />
        <SelectField label="Periodicidade" value={interval} onChange={(e) => setIntervalMonths(e.target.value)}>
          {Object.entries(intervalLabels).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </SelectField>
        <TextField label="Dia do vencimento" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} error={touched ? errors.day : undefined} hint="De 1 a 28, para existir em todo mês." />
        <SelectField label="Categoria de receita" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Sem categoria</option>
          {(categories.data ?? [])
            .filter((c) => c.direction === 'in' && (c.active || c.id === categoryId))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </SelectField>
        <TextField label="Início" type="date" value={start} onChange={(e) => setStart(e.target.value)} error={touched ? errors.start : undefined} />
        <TextField label="Fim (opcional)" type="date" value={end} onChange={(e) => setEnd(e.target.value)} error={touched ? errors.end : undefined} />
        <div className="sm:col-span-2">
          <TextAreaField label="Observações" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {contract ? 'Salvar alterações' : 'Criar contrato'}
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}

function ContractDetail({
  companyId,
  contract: c,
  canWrite,
  onEdit,
  onClose,
}: {
  companyId: string
  contract: ContractRow
  canWrite: boolean
  onEdit: () => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const charges = useContractCharges(companyId, c.id)
  const [ending, setEnding] = useState(false)
  const [reason, setReason] = useState('')
  const change = useMutation({
    mutationFn: async (to: ContractStatus) => {
      const { error } = await requireSupabase().rpc('set_contract_status', { p_id: c.id, p_status: to, p_reason: reason.trim() || null })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: digitalKeys.all(companyId) })
      onClose()
    },
  })

  return (
    <FormDialog title={`${formatCode('CT', c.number)}, ${c.description}`} description={`${c.client?.name ?? ''}: ${formatBRL(c.amount_cents)} ${intervalLabels[c.interval_months]?.toLowerCase()}, dia ${c.billing_day}`} onClose={onClose} wide>
      <div className="grid gap-4 text-sm">
        {change.isError && <Alert tone="error">{toUserMessage(change.error)}</Alert>}
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={contractStatusTone[c.status]}>{contractStatusLabels[c.status]}</Badge>
          <span className="text-muted">
            Desde {formatIsoDate(c.start_date)}
            {c.end_date && ` até ${formatIsoDate(c.end_date)}`}
          </span>
          {c.status_reason && <span className="text-muted">({c.status_reason})</span>}
        </p>
        <section className="grid gap-2" aria-labelledby="cobr-h">
          <h3 id="cobr-h" className="font-semibold">
            Cobranças geradas
          </h3>
          {charges.isPending ? (
            <Spinner label="Carregando" />
          ) : charges.isError ? (
            <ErrorState error={charges.error} />
          ) : charges.data.length === 0 ? (
            <p className="text-muted">Nenhuma ainda. Use "Gerar agora" na página de contratos.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-md border border-line">
              {charges.data.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="tabular-nums">{formatIsoDate(e.due_date)}</span>
                  <span className="flex-1 truncate text-muted">{e.description}</span>
                  <span className="tabular-nums">{formatBRL(e.amount_cents)}</span>
                  <Badge tone={e.status === 'paid' ? 'ok' : e.status === 'canceled' ? 'danger' : 'neutral'}>{entryStatusLabels[e.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
          <Link to="/financeiro?aba=receber" className="text-[13px] underline">
            Registrar recebimentos no financeiro
          </Link>
        </section>

        {canWrite && c.status !== 'ended' && (
          <div className="grid gap-2 border-t border-line pt-3">
            {ending ? (
              <>
                <TextAreaField label="Motivo do encerramento" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEnding(false)}>
                    Voltar
                  </Button>
                  <Button size="sm" variant="danger" loading={change.isPending} disabled={reason.trim().length < 3} onClick={() => change.mutate('ended')}>
                    Encerrar contrato
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={change.isPending} onClick={() => change.mutate(c.status === 'active' ? 'paused' : 'active')}>
                  {c.status === 'active' ? 'Pausar' : 'Reativar'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEnding(true)}>
                  Encerrar
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={onEdit}>
                  Editar
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </FormDialog>
  )
}
