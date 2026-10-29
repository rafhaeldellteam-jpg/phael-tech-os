import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp, Landmark } from 'lucide-react'
import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import type { Json } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatBRL } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { formatIsoDate } from './period'
import { financeKeys, useAccounts } from './queries'
import { parseStatementCsv } from './statement'

type Show = 'pending' | 'matched' | 'ignored'

export function ReconcileTab({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const queryClient = useQueryClient()
  const accounts = useAccounts(companyId)
  const [accountId, setAccountId] = useState('')
  const [show, setShow] = useState<Show>('pending')
  const [importMsg, setImportMsg] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const account = accountId || accounts.data?.find((a) => a.kind !== 'cash' && a.active)?.id || accounts.data?.[0]?.id || ''

  const lines = useQuery({
    queryKey: financeKeys.statement(companyId, account, show),
    enabled: Boolean(account),
    queryFn: async () => {
      let q = requireSupabase()
        .from('bank_statement_lines')
        .select('id, line_date, description, amount_cents, matched_payment_id, ignored')
        .eq('account_id', account)
        .order('line_date', { ascending: false })
        .limit(300)
      if (show === 'pending') q = q.is('matched_payment_id', null).eq('ignored', false)
      else if (show === 'matched') q = q.not('matched_payment_id', 'is', null)
      else q = q.eq('ignored', true)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const importFile = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 2_000_000) throw new Error('Arquivo maior que 2 MB')
      const parsed = parseStatementCsv(await file.text())
      if (parsed.lines.length === 0) throw new Error(parsed.errors[0] ?? 'Nenhuma linha válida no arquivo')
      const { data, error } = await requireSupabase().rpc('import_statement', { p_account_id: account, p_lines: parsed.lines as unknown as Json })
      if (error) throw error
      return { result: data?.[0], ignoredLines: parsed.errors.length }
    },
    onSuccess: async ({ result, ignoredLines }) => {
      setImportMsg({
        tone: ignoredLines ? 'warning' : 'success',
        text: `${result?.imported ?? 0} linha(s) importada(s), ${result?.skipped ?? 0} já existia(m)${ignoredLines ? `, ${ignoredLines} ignorada(s) por dados incompletos` : ''}.`,
      })
      await queryClient.invalidateQueries({ queryKey: financeKeys.all(companyId) })
    },
    onError: (e) => setImportMsg({ tone: 'error', text: e instanceof Error && !('code' in e) ? e.message : toUserMessage(e) }),
  })

  if (accounts.isPending) return <Spinner label="Carregando contas" />
  if ((accounts.data ?? []).length === 0) {
    return (
      <EmptyState icon={Landmark} title="Nenhuma conta cadastrada">
        Crie a conta bancária em Contas e categorias para importar o extrato.
      </EmptyState>
    )
  }

  return (
    <section className="grid gap-4">
      <p className="max-w-prose text-sm text-muted">
        Exporte o extrato do banco em CSV (colunas de data, descrição e valor; saídas negativas) e importe aqui. O sistema sugere o
        pagamento correspondente pelo valor e pela data. Importar o mesmo arquivo de novo não duplica linhas.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <SelectField label="Conta" value={account} onChange={(e) => setAccountId(e.target.value)}>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </SelectField>
        {canWrite && (
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-line px-4 text-sm font-medium hover:bg-[var(--surface-muted)] focus-within:outline-2 focus-within:outline-brand-600">
            <FileUp className="size-4" aria-hidden />
            {importFile.isPending ? 'Importando…' : 'Importar extrato (CSV)'}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={importFile.isPending}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) importFile.mutate(f)
              }}
            />
          </label>
        )}
        <SelectField label="Mostrar" value={show} onChange={(e) => setShow(e.target.value as Show)}>
          <option value="pending">A conciliar</option>
          <option value="matched">Conciliadas</option>
          <option value="ignored">Ignoradas</option>
        </SelectField>
      </div>
      {importMsg && <Alert tone={importMsg.tone}>{importMsg.text}</Alert>}

      {lines.isPending ? (
        <Spinner label="Carregando extrato" />
      ) : lines.isError ? (
        <ErrorState error={lines.error} onRetry={lines.refetch} />
      ) : lines.data.length === 0 ? (
        <p className="text-sm text-muted">{show === 'pending' ? 'Nada a conciliar nesta conta.' : 'Nenhuma linha.'}</p>
      ) : (
        <ul className="surface divide-y divide-[var(--border)] rounded-lg text-sm">
          {lines.data.map((l) => (
            <StatementRow key={l.id} companyId={companyId} line={l} canWrite={canWrite} />
          ))}
        </ul>
      )}
    </section>
  )
}

function StatementRow({
  companyId,
  line,
  canWrite,
}: {
  companyId: string
  line: { id: string; line_date: string; description: string; amount_cents: number; matched_payment_id: string | null; ignored: boolean }
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const pending = !line.matched_payment_id && !line.ignored
  const suggestions = useQuery({
    queryKey: [...financeKeys.all(companyId), 'suggest', line.id],
    enabled: pending,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('statement_suggestions', { p_line_id: line.id })
      if (error) throw error
      return data ?? []
    },
  })
  const act = useMutation({
    mutationFn: async (a: { kind: 'match'; paymentId: string | null } | { kind: 'ignore'; value: boolean }) => {
      const sb = requireSupabase()
      const { error } =
        a.kind === 'match'
          ? await sb.rpc('match_statement_line', { p_line_id: line.id, p_payment_id: a.paymentId })
          : await sb.rpc('set_statement_line_ignored', { p_line_id: line.id, p_ignored: a.value })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: financeKeys.all(companyId) }),
  })

  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="tabular-nums text-muted">{formatIsoDate(line.line_date)}</span>
        <span className="min-w-0 flex-1 truncate">{line.description}</span>
        <span className={`font-medium tabular-nums ${line.amount_cents < 0 ? '' : 'text-ok-600 dark:text-ok-500'}`}>{formatBRL(line.amount_cents)}</span>
        {line.matched_payment_id && <Badge tone="ok">Conciliada</Badge>}
        {line.ignored && <Badge>Ignorada</Badge>}
      </div>
      {act.isError && <p className="text-[13px] text-danger-600">{toUserMessage(act.error)}</p>}
      {canWrite && pending && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {suggestions.isPending ? (
            <span className="text-muted">Procurando pagamento correspondente…</span>
          ) : (suggestions.data ?? []).length === 0 ? (
            <span className="text-muted">Nenhum pagamento com este valor nesta conta (±5 dias). Lance o pagamento e volte aqui, ou ignore.</span>
          ) : (
            (suggestions.data ?? []).map((s) => (
              <Button key={s.payment_id} size="sm" variant="secondary" loading={act.isPending} onClick={() => act.mutate({ kind: 'match', paymentId: s.payment_id })}>
                Conciliar com: {s.entry_description} ({formatIsoDate(s.paid_at)})
              </Button>
            ))
          )}
          <Button size="sm" variant="ghost" onClick={() => act.mutate({ kind: 'ignore', value: true })}>
            Ignorar
          </Button>
        </div>
      )}
      {canWrite && !pending && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => act.mutate(line.ignored ? { kind: 'ignore', value: false } : { kind: 'match', paymentId: null })}
          >
            {line.ignored ? 'Voltar para conciliar' : 'Desfazer conciliação'}
          </Button>
        </div>
      )}
    </li>
  )
}
