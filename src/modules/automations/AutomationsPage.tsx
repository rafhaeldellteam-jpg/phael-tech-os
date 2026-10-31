import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { TextField } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { useCompanyDetails } from '../settings/queries'
import { automationKeys } from './AlertsPanel'

const triggerLabels = { schedule: 'Agendada', dashboard: 'Ao abrir o painel', manual: 'Manual' } as const

export function AutomationsPage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const queryClient = useQueryClient()
  const details = useCompanyDetails(company.id)
  const canEdit = can(['company.update'])
  const canRun = can(['finance.write'])
  const [enabled, setEnabled] = useState(true)
  const [days, setDays] = useState('10')
  const [stall, setStall] = useState('7')

  useEffect(() => {
    if (!details.data) return
    setEnabled(details.data.auto_billing_enabled)
    setDays(String(details.data.auto_billing_days_ahead))
    setStall(String(details.data.stalled_order_days))
  }, [details.data])

  const runs = useQuery({
    queryKey: automationKeys.runs(company.id),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('automation_runs')
        .select('id, job, trigger, started_at, ok, created_count, detail')
        .eq('company_id', company.id)
        .order('started_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data ?? []
    },
  })

  const daysOk = /^\d{1,2}$/.test(days) && Number(days) <= 60
  const stallOk = /^\d{1,2}$/.test(stall) && Number(stall) >= 1 && Number(stall) <= 90
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase()
        .from('companies')
        .update({ auto_billing_enabled: enabled, auto_billing_days_ahead: Number(days), stalled_order_days: Number(stall) })
        .eq('id', company.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries()
    },
  })
  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await requireSupabase().rpc('run_contract_billing_now', { p_company_id: company.id })
      if (error) throw error
      return data as { created?: number; error?: string } | null
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['automations', company.id] }),
        queryClient.invalidateQueries({ queryKey: ['finance', company.id] }),
        queryClient.invalidateQueries({ queryKey: ['digital', company.id] }),
      ])
    },
  })

  if (details.isPending) return <Spinner label="Carregando" />
  if (details.isError) return <ErrorState error={details.error} onRetry={details.refetch} />

  return (
    <div className="grid gap-6">
      <PageHeader title="Automações" description="Tarefas que o sistema faz sozinho todos os dias. Cada execução fica registrada abaixo." />

      <section className="surface grid gap-4 rounded-lg p-5" aria-labelledby="cfg-h">
        <h2 id="cfg-h" className="font-semibold">
          Configuração
        </h2>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (daysOk && stallOk) save.mutate()
          }}
        >
          {save.isError && <Alert tone="error">{toUserMessage(save.error)}</Alert>}
          {save.isSuccess && <Alert tone="success">Configuração salva.</Alert>}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!canEdit} className="mt-0.5 size-4" />
            <span>
              <span className="font-medium">Cobrança automática dos contratos</span>
              <span className="block text-muted">
                Todo dia, cria no financeiro as contas a receber dos contratos ativos que vencem nos próximos dias. Nunca duplica e não recria
                cobrança cancelada.
              </span>
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Antecedência da cobrança (dias)"
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              disabled={!canEdit}
              error={daysOk ? undefined : 'De 0 a 60'}
              hint="Ex.: 10 = cria a cobrança 10 dias antes do vencimento."
            />
            <TextField
              label="Avisar OS parada há mais de (dias)"
              inputMode="numeric"
              value={stall}
              onChange={(e) => setStall(e.target.value)}
              disabled={!canEdit}
              error={stallOk ? undefined : 'De 1 a 90'}
              hint="OS sem mudança de status nesse prazo aparece nos avisos do painel."
            />
          </div>
          {canEdit && (
            <Button type="submit" className="justify-self-start" loading={save.isPending}>
              Salvar
            </Button>
          )}
        </form>
        <p className="text-[13px] text-muted">
          Horário: todo dia às 06:17 (Brasília) pelo agendador do banco e, como garantia, na primeira abertura do painel no dia. As duas formas juntas rodam no
          máximo uma vez por dia.
        </p>
      </section>

      <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="hist-h">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="hist-h" className="font-semibold">
            Histórico de execuções
          </h2>
          {canRun && (
            <Button size="sm" variant="secondary" loading={run.isPending} onClick={() => run.mutate()}>
              <Play className="size-4" aria-hidden /> Rodar cobrança agora
            </Button>
          )}
        </div>
        {run.isError && <Alert tone="error">{toUserMessage(run.error)}</Alert>}
        {run.isSuccess && run.data && (
          <Alert tone={run.data.error ? 'error' : 'success'}>
            {run.data.error ? `Falhou: ${run.data.error}` : `${run.data.created ?? 0} cobrança(s) criada(s).`}
          </Alert>
        )}
        {runs.isPending ? (
          <Spinner label="Carregando" />
        ) : runs.isError ? (
          <ErrorState error={runs.error} onRetry={runs.refetch} />
        ) : runs.data.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma execução ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1.5 font-medium">Quando</th>
                  <th className="py-1.5 font-medium">Tarefa</th>
                  <th className="py-1.5 font-medium">Origem</th>
                  <th className="py-1.5 font-medium">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="py-1.5 tabular-nums">{formatDateTime(r.started_at)}</td>
                    <td className="py-1.5">{r.job === 'contract_billing' ? 'Cobrança dos contratos' : r.job}</td>
                    <td className="py-1.5">{triggerLabels[r.trigger]}</td>
                    <td className="py-1.5">
                      {r.ok ? <Badge tone="ok">{r.created_count} criada(s)</Badge> : <Badge tone="danger">Falhou</Badge>}
                      {r.detail && <span className="block text-[12px] text-muted">{r.detail}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
