import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { useActiveCompany } from '@/core/company/useCompany'
import { requireSupabase } from '@/lib/supabase'
import { actionLabels, entityLabels, summarizeChanges } from './audit-format'
import { settingsKeys, useMembers } from './queries'

const PAGE_SIZE = 25
const timeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function AuditPage() {
  const { company } = useActiveCompany()
  const [page, setPage] = useState(0)
  const [entity, setEntity] = useState('')
  const members = useMembers(company.id)

  const audit = useQuery({
    queryKey: settingsKeys.audit(company.id, page, entity),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = requireSupabase()
        .from('audit_log')
        .select('id, actor_id, action, entity, entity_id, changes, created_at', { count: 'exact' })
        .eq('company_id', company.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (entity) q = q.eq('entity', entity)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data ?? [], count: count ?? 0 }
    },
  })

  const actorName = useMemo(() => {
    const map = new Map((members.data ?? []).map((m) => [m.user_id, m.full_name ?? m.email]))
    return (id: string | null) => (id ? (map.get(id) ?? 'Usuário removido') : 'Sistema')
  }, [members.data])

  const totalPages = audit.data ? Math.max(1, Math.ceil(audit.data.count / PAGE_SIZE)) : 1

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Auditoria"
        description="Registro imutável de quem fez o quê. CPF/CNPJ e tokens aparecem ocultos."
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Tipo</span>
            <select
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value)
                setPage(0)
              }}
              className="h-9 rounded-md border border-line bg-[var(--surface)] px-2"
            >
              <option value="">Todos</option>
              {Object.entries(entityLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {audit.isPending ? (
        <Spinner label="Carregando registros" />
      ) : audit.isError ? (
        <ErrorState error={audit.error} onRetry={audit.refetch} />
      ) : audit.data.rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="Nenhum registro encontrado">
          {entity ? 'Tente outro tipo no filtro.' : 'As operações da equipe aparecerão aqui.'}
        </EmptyState>
      ) : (
        <>
          <ol className="surface divide-y divide-[var(--border)] rounded-lg text-sm" aria-busy={audit.isFetching}>
            {audit.data.rows.map((row) => {
              const lines = summarizeChanges(row.action, row.changes)
              return (
                <li key={row.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[150px_1fr]">
                  <time className="text-muted tabular-nums" dateTime={row.created_at}>
                    {timeFmt.format(new Date(row.created_at))}
                  </time>
                  <div className="grid gap-1">
                    <p>
                      <span className="font-medium">{actorName(row.actor_id)}</span>{' '}
                      {(actionLabels[row.action] ?? row.action).toLowerCase()}{' '}
                      {(entityLabels[row.entity] ?? row.entity).toLowerCase()}
                    </p>
                    {lines.length > 0 && (
                      <ul className="text-muted">
                        {lines.map((l) => (
                          <li key={l} className="break-words">
                            {l}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
          <nav className="flex items-center justify-between text-sm" aria-label="Paginação">
            <span className="text-muted tabular-nums">
              Página {page + 1} de {totalPages}, {audit.data.count} registros
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  )
}
