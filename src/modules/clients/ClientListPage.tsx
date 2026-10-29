import { useMutation } from '@tanstack/react-query'
import { Download, Plus, Search, UsersRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { Spinner } from '@/components/ui/Spinner'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { downloadText, toCsv } from '@/lib/csv'
import { toUserMessage } from '@/lib/errors'
import { formatCode, formatPhone } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { formatTaxId } from '@/lib/tax-id'
import { PAGE_SIZE, useClientList, type ClientFilters } from './queries'

function useFilters(): [ClientFilters, (patch: Partial<ClientFilters>) => void] {
  const [params, setParams] = useSearchParams()
  const filters: ClientFilters = {
    q: params.get('q') ?? '',
    kind: (['person', 'company'].includes(params.get('tipo') ?? '') ? params.get('tipo') : '') as ClientFilters['kind'],
    archived: params.get('arquivados') === '1',
    page: Math.max(0, Number(params.get('pagina') ?? '1') - 1) || 0,
  }
  const update = (patch: Partial<ClientFilters>) => {
    const next = { ...filters, page: 0, ...patch }
    const p = new URLSearchParams()
    if (next.q) p.set('q', next.q)
    if (next.kind) p.set('tipo', next.kind)
    if (next.archived) p.set('arquivados', '1')
    if (next.page > 0) p.set('pagina', String(next.page + 1))
    setParams(p, { replace: true })
  }
  return [filters, update]
}

export function ClientListPage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const [filters, setFilters] = useFilters()
  const [draft, setDraft] = useState(filters.q)
  const list = useClientList(company.id, filters)

  // Busca enquanto digita, com pequena espera para não consultar a cada tecla.
  useEffect(() => {
    if (draft === filters.q) return
    const t = setTimeout(() => setFilters({ q: draft }), 300)
    return () => clearTimeout(t)
  }, [draft, filters.q, setFilters])

  const exportCsv = useMutation({
    mutationFn: async () => {
      const { data, error } = await requireSupabase().rpc('export_clients', {
        p_company_id: company.id,
        p_include_archived: filters.archived,
      })
      if (error) throw error
      const rows = data ?? []
      const withTax = rows.some((r) => r.tax_id)
      const headers = ['Código', 'Tipo', 'Nome', 'Nome fantasia', ...(withTax ? ['CPF/CNPJ'] : []), 'E-mail', 'Telefone',
        'WhatsApp', 'CEP', 'Endereço', 'Número', 'Complemento', 'Bairro', 'Cidade', 'UF', 'Aceita comunicações', 'Cadastro']
      const csv = toCsv(
        headers,
        rows.map((r) => [
          formatCode('CL', r.code), r.kind === 'person' ? 'Pessoa física' : 'Pessoa jurídica', r.name, r.trade_name,
          ...(withTax ? [r.tax_id ? formatTaxId(r.tax_id) : ''] : []),
          r.email, formatPhone(r.phone), formatPhone(r.whatsapp), r.zip_code, r.street, r.street_number, r.complement,
          r.district, r.city, r.state, r.marketing_consent, new Date(r.created_at).toLocaleDateString('pt-BR'),
        ]),
      )
      downloadText(`clientes-${new Date().toISOString().slice(0, 10)}.csv`, csv)
      return rows.length
    },
  })

  const hasFilters = Boolean(filters.q || filters.kind)

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Clientes"
        actions={
          <>
            {can(['clients.export']) && (
              <Button variant="secondary" onClick={() => exportCsv.mutate()} loading={exportCsv.isPending}>
                <Download className="size-4" aria-hidden /> Exportar CSV
              </Button>
            )}
            {can(['clients.write']) && (
              <ButtonLink to="/clientes/novo">
                <Plus className="size-4" aria-hidden /> Novo cliente
              </ButtonLink>
            )}
          </>
        }
      />

      {exportCsv.isError && <Alert tone="error">{toUserMessage(exportCsv.error)}</Alert>}
      {exportCsv.isSuccess && (
        <Alert tone="success">
          Exportação concluída com {exportCsv.data} cliente(s). O download foi registrado na auditoria.
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="relative min-w-60 flex-1">
          <span className="sr-only">Buscar clientes</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Nome, e-mail, telefone ou código"
            className="h-10 w-full rounded-md border border-line bg-[var(--surface)] pr-3 pl-9 text-sm"
          />
        </label>
        <select
          aria-label="Tipo de cliente"
          value={filters.kind}
          onChange={(e) => setFilters({ kind: e.target.value as ClientFilters['kind'] })}
          className="h-10 rounded-md border border-line bg-[var(--surface)] px-2 text-sm"
        >
          <option value="">Todos os tipos</option>
          <option value="person">Pessoa física</option>
          <option value="company">Pessoa jurídica</option>
        </select>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.archived}
            onChange={(e) => setFilters({ archived: e.target.checked })}
            className="size-4"
          />
          Mostrar arquivados
        </label>
      </div>

      {list.isPending ? (
        <Spinner label="Carregando clientes" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.data.rows.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title={hasFilters ? 'Nenhum cliente encontrado' : filters.archived ? 'Nenhum cliente arquivado' : 'Nenhum cliente cadastrado'}
          action={
            !hasFilters && !filters.archived && can(['clients.write']) ? (
              <Link to="/clientes/novo" className="text-sm font-medium underline underline-offset-4">
                Cadastrar o primeiro cliente
              </Link>
            ) : undefined
          }
        >
          {hasFilters ? 'Revise a busca ou o filtro de tipo.' : undefined}
        </EmptyState>
      ) : (
        <>
          <div className="surface overflow-x-auto rounded-lg" aria-busy={list.isFetching}>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-4 py-2.5 font-medium">Contato</th>
                  <th className="px-4 py-2.5 font-medium">Cidade</th>
                  <th className="px-4 py-2.5 font-medium">Código</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0 hover:bg-[var(--surface-muted)]">
                    <td className="px-4 py-3">
                      <Link to={`/clientes/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-1.5">
                        <Badge>{c.kind === 'person' ? 'PF' : 'PJ'}</Badge>
                        {c.trade_name && <span className="text-muted">{c.trade_name}</span>}
                        {c.archived_at && <Badge tone="attn">Arquivado</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p>{formatPhone(c.whatsapp ?? c.phone) || <span className="text-muted">Sem telefone</span>}</p>
                      {c.email && <p className="text-muted">{c.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-muted">{[c.city, c.state].filter(Boolean).join('/') || '—'}</td>
                    <td className="px-4 py-3 text-muted tabular-nums">{formatCode('CL', c.code)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={filters.page} pageSize={PAGE_SIZE} total={list.data.count} onPage={(page) => setFilters({ page })} />
        </>
      )}
    </div>
  )
}
