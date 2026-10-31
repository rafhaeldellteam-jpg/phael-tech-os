import { useQuery } from '@tanstack/react-query'
import { CircleCheck, CircleDashed } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/core/auth/useAuth'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { CURRENT_PHASE } from '@/core/permissions/navigation'
import { roleLabels } from '@/core/permissions/permissions'
import { formatBRL } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { actionLabels, entityLabels } from '../settings/audit-format'
import { presetRange } from '../finance/period'
import { useSummary } from '../finance/queries'
import { useLowStockCount } from '../inventory/queries'
import { useWarrantyStats } from '../warranties/queries'
import { useAppointmentsToday } from '../schedule/queries'
import { formatTime } from '../schedule/dates'
import { AlertsPanel, useDailyAutomations } from '../automations/AlertsPanel'
import { useOrderStats } from '../orders/queries'
import { useCompanyDetails, useMembers } from '../settings/queries'

const phases = [
  { n: 1, name: 'Fundação', scope: 'Acesso, empresas, equipe, permissões e auditoria' },
  { n: 2, name: 'Operação principal', scope: 'Clientes, equipamentos e ordens de serviço (checklist de diagnóstico e orçamento com aprovação: pendentes)' },
  { n: 3, name: 'Gestão', scope: 'Catálogo, estoque, fornecedores, financeiro, garantias e agenda' },
  { n: 4, name: 'Expansão', scope: 'Contratos, sites, relatórios, portal do cliente, automações e IA' },
  { n: 5, name: 'Preparação comercial', scope: 'Planos, assinatura, onboarding de outras assistências' },
]

const timeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

function Step({ done, children, action }: { done: boolean; children: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {done ? (
        <CircleCheck className="mt-0.5 size-5 shrink-0 text-ok-500" aria-label="Concluído" />
      ) : (
        <CircleDashed className="mt-0.5 size-5 shrink-0 text-attn-500" aria-label="Pendente" />
      )}
      <div className="grid flex-1 gap-0.5">{children}</div>
      {!done && action}
    </li>
  )
}

export function DashboardPage() {
  const { user } = useAuth()
  const active = useActiveCompany()
  const { can } = useCompany()
  const canMembers = can(['members.read'])
  const canAudit = can(['audit.read'])
  const details = useCompanyDetails(active.company.id)
  const members = useMembers(active.company.id, canMembers)

  const recent = useQuery({
    queryKey: ['audit-recent', active.company.id],
    enabled: canAudit,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('audit_log')
        .select('id, action, entity, created_at')
        .eq('company_id', active.company.id)
        .order('created_at', { ascending: false })
        .limit(6)
      if (error) throw error
      return data ?? []
    },
  })

  const canClients = can(['clients.read'])
  const canEquipment = can(['equipment.read'])
  const counts = useQuery({
    queryKey: ['dashboard-counts', active.company.id, canClients, canEquipment],
    queryFn: async () => {
      const sb = requireSupabase()
      const count = async (table: 'clients' | 'equipment', allowed: boolean) => {
        if (!allowed) return null
        const { count: n, error } = await sb
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('company_id', active.company.id)
          .is('archived_at', null)
        if (error) throw error
        return n ?? 0
      }
      const [clients, equipment] = await Promise.all([count('clients', canClients), count('equipment', canEquipment)])
      return { clients, equipment }
    },
  })

  const canOrders = can(['orders.read_all', 'orders.read_assigned'])
  const stats = useOrderStats(active.company.id, canOrders)
  const sum = (keys: string[]) => (stats.data ?? []).filter((r) => keys.includes(r.status)).reduce((a, r) => a + Number(r.total), 0)
  const indicators = [
    { label: 'Em andamento', value: (stats.data ?? []).reduce((a, r) => a + Number(r.total), 0), to: '/ordens' },
    { label: 'Em diagnóstico', value: sum(['diagnosis']), to: '/ordens?status=diagnosis' },
    { label: 'Aguardando aprovação', value: sum(['awaiting_approval']), to: '/ordens?status=awaiting_approval', attention: true },
    { label: 'Aguardando peça', value: sum(['awaiting_parts']), to: '/ordens?status=awaiting_parts', attention: true },
    { label: 'Em reparo', value: sum(['in_repair', 'testing']), to: '/ordens?etapa=working' },
    { label: 'Prontas para retirada', value: sum(['ready']), to: '/ordens?status=ready', ok: true },
    {
      label: 'Atrasadas',
      value: (stats.data ?? []).reduce((a, r) => a + Number(r.overdue), 0),
      to: '/ordens?atrasadas=1',
      danger: true,
    },
  ]

  const canFinance = can(['finance.read'])
  const month = presetRange('this_month')
  const finance = useSummary(active.company.id, month.from, month.to, canFinance)
  const canInventory = can(['inventory.read'])
  const lowStock = useLowStockCount(active.company.id, canInventory)
  const warranty = useWarrantyStats(active.company.id, canOrders)
  const canSchedule = can(['schedule.read'])
  const agenda = useAppointmentsToday(active.company.id, canSchedule)
  useDailyAutomations(active.company.id)

  const firstName = ((user?.user_metadata?.full_name as string | undefined) ?? '').split(' ')[0]
  const profileComplete = Boolean(details.data?.tax_id && (details.data.email || details.data.phone))
  const teamInvited = (members.data?.length ?? 0) > 1

  return (
    <div className="grid gap-8">
      <PageHeader
        title={firstName ? `Olá, ${firstName}` : 'Painel'}
        description={`${roleLabels[active.role]} em ${active.company.name}`}
      />

      {canInventory && (lowStock.data ?? 0) > 0 && (
        <Link
          to="/estoque?repor=1"
          className="flex items-center justify-between gap-3 rounded-lg border border-attn-500/50 bg-attn-100 px-4 py-3 text-sm hover:brightness-95 dark:bg-attn-600/15"
        >
          <span>
            <strong className="tabular-nums">{lowStock.data}</strong> produto(s) no estoque mínimo ou abaixo.
          </span>
          <span className="font-medium underline underline-offset-4">Ver o que repor</span>
        </Link>
      )}

      {canSchedule && agenda.isSuccess && (
        <Link
          to="/agenda"
          className="surface flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm hover:bg-[var(--surface-muted)]"
        >
          <span>
            {agenda.data.total === 0 ? (
              'Nenhum atendimento agendado para hoje.'
            ) : (
              <>
                <strong className="tabular-nums">{agenda.data.total}</strong> atendimento(s) hoje
                {agenda.data.mine > 0 && <>, {agenda.data.mine} com você</>}
                {agenda.data.next_starts_at && <>. Próximo às {formatTime(agenda.data.next_starts_at)}</>}.
              </>
            )}
          </span>
          <span className="font-medium underline underline-offset-4">Abrir agenda</span>
        </Link>
      )}

      <AlertsPanel companyId={active.company.id} />

      {canOrders && (warranty.data?.open_claims ?? 0) > 0 && (
        <Link
          to="/garantias?aba=acionamentos"
          className="flex items-center justify-between gap-3 rounded-lg border border-attn-500/50 bg-attn-100 px-4 py-3 text-sm hover:brightness-95 dark:bg-attn-600/15"
        >
          <span>
            <strong className="tabular-nums">{warranty.data?.open_claims}</strong> acionamento(s) de garantia em andamento.
          </span>
          <span className="font-medium underline underline-offset-4">Ver acionamentos</span>
        </Link>
      )}

      {canOrders && (
        <section aria-labelledby="os-h" className="grid gap-3">
          <div className="flex items-baseline justify-between">
            <h2 id="os-h" className="text-lg font-semibold">
              Ordens de serviço
            </h2>
            {can(['orders.create']) && (
              <Link to="/ordens/nova" className="text-sm font-medium underline underline-offset-4">
                Abrir OS
              </Link>
            )}
          </div>
          {stats.isPending ? (
            <Spinner label="Calculando indicadores" />
          ) : stats.isError ? (
            <p className="text-sm text-muted">Não foi possível carregar os indicadores.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-[var(--border)] sm:grid-cols-4 lg:grid-cols-7">
              {indicators.map((i) => (
                <li key={i.label} className="bg-[var(--surface)]">
                  <Link to={i.to} className="grid h-full gap-1 p-4 hover:bg-[var(--surface-muted)]">
                    <span
                      className={`text-3xl font-semibold tabular-nums [font-stretch:85%] ${
                        i.value > 0 && i.danger ? 'text-danger-600' : i.value > 0 && i.attention ? 'text-attn-600' : i.value > 0 && i.ok ? 'text-ok-600 dark:text-ok-500' : ''
                      }`}
                    >
                      {i.value}
                    </span>
                    <span className="text-[13px] text-muted">{i.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {canFinance && finance.data && (
        <section aria-labelledby="fin-h" className="grid gap-3">
          <div className="flex items-baseline justify-between">
            <h2 id="fin-h" className="text-lg font-semibold">
              Financeiro do mês
            </h2>
            <Link to="/financeiro" className="text-sm font-medium underline underline-offset-4">
              Abrir financeiro
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: 'Faturamento', value: finance.data.billed_cents, to: '/financeiro' },
              { label: 'Recebido', value: finance.data.received_cents, to: '/financeiro' },
              { label: 'Despesas', value: finance.data.expenses_cents, to: '/financeiro?aba=pagar' },
              { label: 'Resultado estimado', value: finance.data.estimated_result_cents, to: '/financeiro' },
              { label: 'A receber vencido', value: finance.data.receivable_overdue_cents, to: '/financeiro?aba=receber', danger: true },
              { label: 'A pagar vencido', value: finance.data.payable_overdue_cents, to: '/financeiro?aba=pagar', danger: true },
            ].map((i) => (
              <li key={i.label} className="bg-[var(--surface)]">
                <Link to={i.to} className="grid h-full gap-1 p-4 hover:bg-[var(--surface-muted)]">
                  <span className={`text-xl font-semibold tabular-nums [font-stretch:85%] ${(i.danger && i.value > 0) || i.value < 0 ? 'text-danger-600' : ''}`}>
                    {formatBRL(i.value)}
                  </span>
                  <span className="text-[13px] text-muted">{i.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="primeiros-passos" className="grid content-start gap-2">
          <h2 id="primeiros-passos" className="text-lg font-semibold">
            Primeiros passos
          </h2>
          <p className="text-sm text-muted">
            Garantias e agenda entram no painel nos próximos incrementos, sempre calculados a partir dos dados reais.
          </p>
          {details.isPending ? (
            <Spinner label="Verificando configuração" />
          ) : (
            <ul className="divide-y divide-[var(--border)] border-y border-line">
              <Step done>
                <p className="font-medium">Empresa criada</p>
                <p className="text-sm text-muted">{active.company.name}</p>
              </Step>
              <Step
                done={profileComplete}
                action={
                  can(['company.update']) && (
                    <Link to="/empresa" className="text-sm font-medium underline underline-offset-4">
                      Completar
                    </Link>
                  )
                }
              >
                <p className="font-medium">Dados da empresa completos</p>
                <p className="text-sm text-muted">CPF/CNPJ e um contato, usados em orçamentos e termos.</p>
              </Step>
              {canMembers && (
                <Step
                  done={teamInvited}
                  action={
                    can(['members.manage']) && (
                      <Link to="/equipe" className="text-sm font-medium underline underline-offset-4">
                        Convidar
                      </Link>
                    )
                  }
                >
                  <p className="font-medium">Equipe convidada</p>
                  <p className="text-sm text-muted">
                    {members.data ? `${members.data.length} pessoa(s) na empresa.` : 'Técnicos, financeiro e atendimento.'}
                  </p>
                </Step>
              )}
              {canClients && (
                <Step
                  done={(counts.data?.clients ?? 0) > 0}
                  action={
                    can(['clients.write']) && (
                      <Link to="/clientes/novo" className="text-sm font-medium underline underline-offset-4">
                        Cadastrar
                      </Link>
                    )
                  }
                >
                  <p className="font-medium">Clientes cadastrados</p>
                  <p className="text-sm text-muted">
                    {counts.data?.clients != null ? (
                      <Link to="/clientes" className="hover:underline">
                        {counts.data.clients} cliente(s) ativo(s)
                      </Link>
                    ) : (
                      'Base de clientes da assistência.'
                    )}
                  </p>
                </Step>
              )}
              {canEquipment && (
                <Step done={(counts.data?.equipment ?? 0) > 0}>
                  <p className="font-medium">Equipamentos registrados</p>
                  <p className="text-sm text-muted">
                    {counts.data?.equipment != null ? (
                      <Link to="/equipamentos" className="hover:underline">
                        {counts.data.equipment} equipamento(s) ativo(s)
                      </Link>
                    ) : (
                      'Fichas com etiqueta QR para cada aparelho.'
                    )}
                  </p>
                </Step>
              )}
            </ul>
          )}
        </section>

        {canAudit && (
          <section aria-labelledby="atividade" className="grid content-start gap-2">
            <div className="flex items-baseline justify-between">
              <h2 id="atividade" className="text-lg font-semibold">
                Atividade recente
              </h2>
              <Link to="/auditoria" className="text-sm underline underline-offset-4">
                Ver tudo
              </Link>
            </div>
            {recent.isPending ? (
              <Spinner label="Carregando atividade" />
            ) : recent.isError ? (
              <p className="text-sm text-muted">Não foi possível carregar a atividade.</p>
            ) : (
              <ol className="grid gap-2 text-sm">
                {recent.data.map((r) => (
                  <li key={r.id} className="flex gap-3">
                    <time className="w-28 shrink-0 text-muted tabular-nums" dateTime={r.created_at}>
                      {timeFmt.format(new Date(r.created_at))}
                    </time>
                    <span>
                      {actionLabels[r.action] ?? r.action} {(entityLabels[r.entity] ?? r.entity).toLowerCase()}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>

      <section aria-labelledby="roadmap" className="grid gap-3">
        <h2 id="roadmap" className="text-lg font-semibold">
          Etapas do sistema
        </h2>
        <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-[var(--border)] sm:grid-cols-5">
          {phases.map((p) => {
            const state = p.n < CURRENT_PHASE ? 'done' : p.n === CURRENT_PHASE ? 'current' : 'next'
            return (
              <li
                key={p.n}
                aria-current={state === 'current' ? 'step' : undefined}
                className={`grid content-start gap-1 bg-[var(--surface)] p-4 ${state === 'current' ? 'shadow-[inset_0_3px_0_var(--color-ok-500)]' : ''}`}
              >
                <p className="text-sm text-muted tabular-nums">Fase {p.n}</p>
                <p className="font-semibold">{p.name}</p>
                <p className="text-[13px] text-muted">{p.scope}</p>
                {state === 'current' && <p className="text-[13px] font-medium text-ok-600 dark:text-ok-500">Em uso agora</p>}
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
