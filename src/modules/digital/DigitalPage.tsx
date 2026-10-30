import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Globe, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import type { DigitalKind, DigitalStatus, Json } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatCode } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { ClientPicker, type PickedClient } from '../clients/ClientPicker'
import { formatIsoDate, isoDate } from '../finance/period'
import { digitalKeys, digitalKindLabels, digitalStatusLabels, digitalStatusTone, useDigitalServices, type DigitalRow } from './queries'

function daysUntil(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const today = new Date()
  const a = Date.UTC(y, m - 1, d)
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((a - b) / 86_400_000)
}

export function DigitalPage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const canWrite = can(['digital.write'])
  const [status, setStatus] = useState('live')
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<DigitalRow | 'new' | null>(null)
  const list = useDigitalServices(company.id, { q, status })

  useEffect(() => {
    const t = setTimeout(() => setQ(draft), 300)
    return () => clearTimeout(t)
  }, [draft])

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Sites e serviços digitais"
        description="Sites, lojas, hospedagens, domínios e e-mails de cada cliente. Para cobrança recorrente, crie um contrato."
        actions={
          canWrite && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Novo serviço digital
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-48 flex-1 gap-1 text-[13px] text-muted">
          Buscar
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Nome ou endereço"
            className="h-9 rounded-md border border-line bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
          />
        </label>
        <label className="grid gap-1 text-[13px] text-muted">
          Situação
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]">
            <option value="live">Todos menos cancelados</option>
            {(Object.keys(digitalStatusLabels) as DigitalStatus[]).map((s) => (
              <option key={s} value={s}>
                {digitalStatusLabels[s]}
              </option>
            ))}
            <option value="">Todos</option>
          </select>
        </label>
      </div>

      {list.isPending ? (
        <Spinner label="Carregando" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={Globe} title="Nenhum serviço digital">
          Cadastre os sites e lojas que você criou ou mantém para cada cliente.
        </EmptyState>
      ) : (
        <div className="surface overflow-x-auto rounded-lg" aria-busy={list.isFetching}>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Serviço</th>
                <th className="px-4 py-2.5 font-medium">Cliente</th>
                <th className="px-4 py-2.5 font-medium">Situação</th>
                <th className="px-4 py-2.5 font-medium">Domínio vence</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((d) => {
                const left = d.domain_expires_on ? daysUntil(d.domain_expires_on) : null
                return (
                  <tr key={d.id} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => setEditing(d)} className="text-left font-medium hover:underline" disabled={!canWrite}>
                        {d.name}
                      </button>
                      <span className="block text-[13px] text-muted">
                        {formatCode('SD', d.number)}, {digitalKindLabels[d.kind]}
                        {d.hosting_provider && `, ${d.hosting_provider}`}
                      </span>
                      {d.url && (
                        <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] underline">
                          {d.url.replace(/^https?:\/\//, '')} <ExternalLink className="size-3" aria-hidden />
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {d.client && (
                        <Link to={`/clientes/${d.client.id}`} className="hover:underline">
                          {d.client.name}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={digitalStatusTone[d.status]}>{digitalStatusLabels[d.status]}</Badge>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {d.domain_expires_on ? (
                        <>
                          {formatIsoDate(d.domain_expires_on)}
                          {left !== null && left <= 30 && (
                            <span className="mt-1 block">
                              <Badge tone={left < 0 ? 'danger' : 'attn'}>{left < 0 ? 'vencido' : left === 0 ? 'vence hoje' : `em ${left} dias`}</Badge>
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <DigitalDialog companyId={company.id} service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function DigitalDialog({ companyId, service, onClose }: { companyId: string; service: DigitalRow | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [client, setClient] = useState<PickedClient | null>(service?.client ? { id: service.client.id, name: service.client.name, code: service.client.code } : null)
  const [kind, setKind] = useState<DigitalKind>(service?.kind ?? 'website')
  const [name, setName] = useState(service?.name ?? '')
  const [url, setUrl] = useState(service?.url ?? '')
  const [status, setStatus] = useState<DigitalStatus>(service?.status ?? 'planning')
  const [repo, setRepo] = useState(service?.repository_url ?? '')
  const [hosting, setHosting] = useState(service?.hosting_provider ?? '')
  const [domainExp, setDomainExp] = useState(service?.domain_expires_on ?? '')
  const [launched, setLaunched] = useState(service?.launched_on ?? (status === 'active' ? isoDate(new Date()) : ''))
  const [notes, setNotes] = useState(service?.notes ?? '')
  const [touched, setTouched] = useState(false)
  const urlOk = (v: string) => v.trim() === '' || /^https?:\/\/\S+\.\S+/i.test(v.trim())
  const errors = {
    client: client ? undefined : 'Escolha o cliente',
    name: name.trim().length < 2 ? 'Informe o nome' : undefined,
    url: urlOk(url) ? undefined : 'Use o endereço completo, com https://',
    repo: urlOk(repo) ? undefined : 'Use o endereço completo, com https://',
  }
  const valid = Object.values(errors).every((e) => !e)

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('save_digital_service', {
        p_company_id: companyId,
        p_id: service?.id ?? null,
        p_data: {
          client_id: client?.id,
          kind,
          name: name.trim(),
          url: url.trim() || null,
          status,
          repository_url: repo.trim() || null,
          hosting_provider: hosting.trim() || null,
          domain_expires_on: domainExp || null,
          launched_on: launched || null,
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
    <FormDialog title={service ? `Editar ${service.name}` : 'Novo serviço digital'} onClose={onClose} wide>
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
          <ClientPicker companyId={companyId} value={client} onChange={setClient} error={touched ? errors.client : undefined} />
        </div>
        <SelectField label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as DigitalKind)}>
          {(Object.keys(digitalKindLabels) as DigitalKind[]).map((k) => (
            <option key={k} value={k}>
              {digitalKindLabels[k]}
            </option>
          ))}
        </SelectField>
        <TextField label="Nome" placeholder="Loja virtual da Nicoly" value={name} onChange={(e) => setName(e.target.value)} error={touched ? errors.name : undefined} />
        <TextField label="Endereço (URL)" placeholder="https://" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} error={touched ? errors.url : undefined} />
        <SelectField label="Situação" value={status} onChange={(e) => setStatus(e.target.value as DigitalStatus)}>
          {(Object.keys(digitalStatusLabels) as DigitalStatus[]).map((s) => (
            <option key={s} value={s}>
              {digitalStatusLabels[s]}
            </option>
          ))}
        </SelectField>
        <TextField label="Repositório" placeholder="https://github.com/…" inputMode="url" value={repo} onChange={(e) => setRepo(e.target.value)} error={touched ? errors.repo : undefined} />
        <TextField label="Hospedagem" placeholder="Vercel, Hostinger…" value={hosting} onChange={(e) => setHosting(e.target.value)} />
        <TextField label="Vencimento do domínio" type="date" value={domainExp} onChange={(e) => setDomainExp(e.target.value)} hint="Entra no alerta do painel 30 dias antes." />
        <TextField label="No ar desde" type="date" value={launched} onChange={(e) => setLaunched(e.target.value)} />
        <div className="sm:col-span-2">
          <TextAreaField label="Observações" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} hint="Não guarde senhas aqui." />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {service ? 'Salvar alterações' : 'Cadastrar'}
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}
