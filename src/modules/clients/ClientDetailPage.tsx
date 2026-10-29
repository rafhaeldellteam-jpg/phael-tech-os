import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, ClipboardList, Laptop, Lock, MessageCircle, Pencil, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Tabs } from '@/components/ui/Tabs'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { toUserMessage } from '@/lib/errors'
import { formatCode, formatDate, formatDateTime, formatPhone, formatZip, whatsappLink } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { formatTaxId } from '@/lib/tax-id'
import { equipmentKeys, equipmentTitle, useClientEquipment, useEquipmentTypes } from '../equipment/queries'
import { stageTone } from '../orders/meta'
import { useClientOrders, useWorkflow } from '../orders/queries'
import { useMembers } from '../settings/queries'
import { actionLabels, summarizeChanges } from '../settings/audit-format'
import { clientKeys, useClient, useClientHistory, useClientSensitive } from './queries'

type TabKey = 'resumo' | 'equipamentos' | 'ordens' | 'orcamentos' | 'financeiro' | 'historico'

const channelLabels = { whatsapp: 'WhatsApp', phone: 'Ligação', email: 'E-mail' } as const

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="break-words">{children || <span className="text-muted">Não informado</span>}</dd>
    </div>
  )
}

export function ClientDetailPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const queryClient = useQueryClient()
  const canSensitive = can(['clients.read_sensitive'])
  const canWrite = can(['clients.write'])
  const canEquipment = can(['equipment.read'])
  const canAudit = can(['audit.read'])
  const canOrders = can(['orders.read_all'])
  const [confirmArchive, setConfirmArchive] = useState(false)

  const tabParam = params.get('aba') as TabKey | null
  const tab: TabKey = tabParam ?? 'resumo'
  const client = useClient(company.id, id)
  const sensitive = useClientSensitive(company.id, id, canSensitive)
  const equipment = useClientEquipment(company.id, id, canEquipment)
  const types = useEquipmentTypes()
  const orders = useClientOrders(company.id, id, canOrders && tab === 'ordens')
  const workflow = useWorkflow()
  const history = useClientHistory(company.id, id, canAudit && tab === 'historico')
  const members = useMembers(company.id, canAudit && tab === 'historico' && can(['members.read']))

  const archive = useMutation({
    mutationFn: async (archived: boolean) => {
      const { error } = await requireSupabase().rpc('set_client_archived', { p_client_id: id, p_archived: archived })
      if (error) throw error
    },
    onSuccess: async () => {
      setConfirmArchive(false)
      await queryClient.invalidateQueries({ queryKey: clientKeys.all(company.id) })
      await queryClient.invalidateQueries({ queryKey: equipmentKeys.all(company.id) })
    },
  })

  if (client.isPending) return <Spinner label="Carregando cliente" />
  if (client.isError) return <ErrorState error={client.error} onRetry={client.refetch} />
  const c = client.data
  if (!c) {
    return (
      <Alert tone="warning" title="Cliente não encontrado">
        Ele pode pertencer a outra empresa. <Link to="/clientes" className="underline">Voltar para clientes</Link>
      </Alert>
    )
  }

  const typeLabel = (key: string) => types.data?.find((t) => t.key === key)?.label ?? key
  const address = [
    [c.street, c.street_number].filter(Boolean).join(', '),
    c.complement,
    c.district,
    [c.city, c.state].filter(Boolean).join('/'),
    formatZip(c.zip_code),
  ]
    .filter(Boolean)
    .join(', ')
  const actorName = (actorId: string | null) =>
    actorId ? (members.data?.find((m) => m.user_id === actorId)?.full_name ?? 'Membro da equipe') : 'Sistema'

  const tabs = [
    { key: 'resumo' as const, label: 'Resumo' },
    ...(canEquipment
      ? [{ key: 'equipamentos' as const, label: 'Equipamentos', badge: equipment.data ? <Badge>{equipment.data.length}</Badge> : undefined }]
      : []),
    ...(canOrders ? [{ key: 'ordens' as const, label: 'Ordens de serviço' }] : []),
    { key: 'orcamentos' as const, label: 'Orçamentos' },
    { key: 'financeiro' as const, label: 'Financeiro' },
    ...(canAudit ? [{ key: 'historico' as const, label: 'Histórico' }] : []),
  ]

  return (
    <div className="grid gap-5">
      <nav aria-label="Trilha" className="text-sm text-muted">
        <Link to="/clientes" className="hover:underline">
          Clientes
        </Link>{' '}
        / {formatCode('CL', c.code)}
      </nav>
      <PageHeader
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{c.kind === 'person' ? 'Pessoa física' : 'Pessoa jurídica'}</Badge>
            {c.trade_name && <span>{c.trade_name}</span>}
            {c.archived_at && <Badge tone="attn">Arquivado em {formatDate(c.archived_at)}</Badge>}
          </span>
        }
        actions={
          <>
            {c.whatsapp && (
              <a href={whatsappLink(c.whatsapp)} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-md border border-line px-3 text-sm hover:bg-[var(--surface-muted)]">
                <MessageCircle className="size-4" aria-hidden /> WhatsApp
              </a>
            )}
            {canWrite && (
              <ButtonLink to={`/clientes/${c.id}/editar`} variant="secondary">
                <Pencil className="size-4" aria-hidden /> Editar
              </ButtonLink>
            )}
          </>
        }
      />

      {(location.state as { saved?: boolean } | null)?.saved && <Alert tone="success">Cliente salvo.</Alert>}
      {archive.isError && <Alert tone="error">{toUserMessage(archive.error)}</Alert>}

      <Tabs
        label="Seções do cliente"
        items={tabs}
        value={tabs.some((t) => t.key === tab) ? tab : 'resumo'}
        onChange={(k) => setParams(k === 'resumo' ? {} : { aba: k }, { replace: true })}
      />

      {tab === 'resumo' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="surface grid content-start gap-4 rounded-lg p-5" aria-labelledby="contato-h">
            <h2 id="contato-h" className="font-semibold">
              Contato e endereço
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item label="WhatsApp">{formatPhone(c.whatsapp)}</Item>
              <Item label="Telefone">{formatPhone(c.phone)}</Item>
              <Item label="E-mail">{c.email && <a href={`mailto:${c.email}`} className="underline underline-offset-4">{c.email}</a>}</Item>
              <Item label="Canal preferido">{c.preferred_channel ? channelLabels[c.preferred_channel] : ''}</Item>
              <div className="sm:col-span-2">
                <Item label="Endereço">{address}</Item>
              </div>
              <Item label="Aceita avisos e novidades">
                {c.marketing_consent
                  ? `Sim${c.consent_updated_at ? `, desde ${formatDate(c.consent_updated_at)}` : ''}`
                  : 'Não'}
              </Item>
              <Item label="Cliente desde">{formatDate(c.created_at)}</Item>
            </dl>
          </section>

          <section className="surface grid content-start gap-4 rounded-lg p-5" aria-labelledby="sensivel-h">
            <h2 id="sensivel-h" className="flex items-center gap-2 font-semibold">
              <Lock className="size-4 text-muted" aria-hidden /> Dados restritos
            </h2>
            {canSensitive ? (
              sensitive.isPending ? (
                <Spinner label="Carregando" />
              ) : sensitive.isError ? (
                <ErrorState error={sensitive.error} />
              ) : (
                <dl className="grid gap-4">
                  <Item label={c.kind === 'company' ? 'CNPJ' : 'CPF'}>
                    {sensitive.data?.tax_id ? formatTaxId(sensitive.data.tax_id) : ''}
                  </Item>
                  <Item label="Observações internas">
                    {sensitive.data?.internal_notes && <span className="whitespace-pre-line">{sensitive.data.internal_notes}</span>}
                  </Item>
                </dl>
              )
            ) : (
              <p className="text-sm text-muted">
                {c.has_tax_id ? 'CPF/CNPJ cadastrado. ' : 'Sem CPF/CNPJ cadastrado. '}
                Documento e observações internas só aparecem para quem tem acesso a dados sensíveis.
              </p>
            )}
          </section>

          {canWrite && (
            <div className="lg:col-span-2">
              {c.archived_at ? (
                <Button variant="secondary" loading={archive.isPending} onClick={() => archive.mutate(false)}>
                  <ArchiveRestore className="size-4" aria-hidden /> Reativar cliente
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmArchive(true)}>
                  <Archive className="size-4" aria-hidden /> Arquivar cliente
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'equipamentos' && canEquipment && (
        <section className="grid gap-3">
          {can(['equipment.write']) && !c.archived_at && (
            <ButtonLink to={`/equipamentos/novo?cliente=${c.id}`} className="justify-self-start">
              <Plus className="size-4" aria-hidden /> Novo equipamento
            </ButtonLink>
          )}
          {equipment.isPending ? (
            <Spinner label="Carregando equipamentos" />
          ) : equipment.isError ? (
            <ErrorState error={equipment.error} onRetry={equipment.refetch} />
          ) : equipment.data.length === 0 ? (
            <EmptyState icon={Laptop} title="Nenhum equipamento deste cliente">
              Cadastre o equipamento na entrada para gerar a etiqueta e o histórico.
            </EmptyState>
          ) : (
            <ul className="surface divide-y divide-[var(--border)] rounded-lg text-sm">
              {equipment.data.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="w-20 text-muted tabular-nums">{formatCode('EQ', e.code)}</span>
                  <Link to={`/equipamentos/${e.id}`} className="flex-1 font-medium hover:underline">
                    {equipmentTitle(e, typeLabel(e.type))}
                  </Link>
                  <span className="text-muted">{typeLabel(e.type)}</span>
                  {e.serial_number && <span className="text-muted">S/N {e.serial_number}</span>}
                  {e.archived_at && <Badge tone="attn">Arquivado</Badge>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'ordens' && canOrders && (
        <section className="grid gap-3">
          {can(['orders.create']) && !c.archived_at && (
            <ButtonLink to={`/ordens/nova?cliente=${c.id}`} className="justify-self-start">
              <Plus className="size-4" aria-hidden /> Nova OS
            </ButtonLink>
          )}
          {orders.isPending ? (
            <Spinner label="Carregando OS" />
          ) : orders.isError ? (
            <ErrorState error={orders.error} onRetry={orders.refetch} />
          ) : orders.data.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Nenhuma OS deste cliente" />
          ) : (
            <ul className="surface divide-y divide-[var(--border)] rounded-lg text-sm">
              {orders.data.map((o) => {
                const st = workflow.data?.statuses.find((x) => x.key === o.status)
                return (
                  <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Link to={`/ordens/${o.id}`} className="w-20 font-semibold tabular-nums hover:underline">
                      {formatCode('OS', o.number)}
                    </Link>
                    <span className="min-w-0 flex-1 truncate">
                      {o.equipment ? `${equipmentTitle(o.equipment, typeLabel(o.equipment.type))}: ` : ''}
                      {o.reported_problem}
                    </span>
                    <Badge tone={st ? stageTone[st.stage] : 'neutral'}>{st?.label ?? o.status}</Badge>
                    <span className="text-muted tabular-nums">{formatDate(o.received_at)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {(tab === 'orcamentos' || tab === 'financeiro') && (
        <EmptyState icon={Lock} title="Ainda não disponível">
          {tab === 'orcamentos' && 'Os orçamentos aparecem aqui quando o módulo de orçamentos for entregue (Fase 2).'}
          {tab === 'financeiro' && 'Pagamentos e pendências aparecem aqui quando o módulo financeiro for entregue (Fase 3).'}
        </EmptyState>
      )}

      {tab === 'historico' && canAudit && (
        <section>
          {history.isPending ? (
            <Spinner label="Carregando histórico" />
          ) : history.isError ? (
            <ErrorState error={history.error} onRetry={history.refetch} />
          ) : (
            <ol className="surface divide-y divide-[var(--border)] rounded-lg text-sm">
              {history.data.map((h) => {
                const lines = summarizeChanges(h.action, h.changes)
                return (
                  <li key={h.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[150px_1fr]">
                    <time className="text-muted tabular-nums" dateTime={h.created_at}>
                      {formatDateTime(h.created_at)}
                    </time>
                    <div>
                      <p>
                        <span className="font-medium">{actorName(h.actor_id)}</span>{' '}
                        {(actionLabels[h.action] ?? h.action).toLowerCase()}{' '}
                        {h.entity === 'client_sensitive' ? 'dados restritos' : 'o cadastro'}
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
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Arquivar ${c.name}?`}
        description="O cliente sai das listas e da pesquisa, mas o histórico, os equipamentos e as futuras OS continuam guardados. Você pode reativar quando quiser."
        confirmLabel="Arquivar cliente"
        tone="primary"
        loading={archive.isPending}
        onConfirm={() => archive.mutate(true)}
      />
    </div>
  )
}
