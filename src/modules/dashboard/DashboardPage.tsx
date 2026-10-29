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
import { requireSupabase } from '@/lib/supabase'
import { actionLabels, entityLabels } from '../settings/audit-format'
import { useCompanyDetails, useMembers } from '../settings/queries'

const phases = [
  { n: 1, name: 'Fundação', scope: 'Acesso, empresas, equipe, permissões e auditoria' },
  { n: 2, name: 'Operação principal', scope: 'Clientes, equipamentos, ordens de serviço, diagnósticos e orçamentos' },
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

  const firstName = ((user?.user_metadata?.full_name as string | undefined) ?? '').split(' ')[0]
  const profileComplete = Boolean(details.data?.tax_id && (details.data.email || details.data.phone))
  const teamInvited = (members.data?.length ?? 0) > 1

  return (
    <div className="grid gap-8">
      <PageHeader
        title={firstName ? `Olá, ${firstName}` : 'Painel'}
        description={`${roleLabels[active.role]} em ${active.company.name}`}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="primeiros-passos" className="grid content-start gap-2">
          <h2 id="primeiros-passos" className="text-lg font-semibold">
            Primeiros passos
          </h2>
          <p className="text-sm text-muted">
            Os indicadores de OS, financeiro e estoque aparecem aqui quando esses módulos entrarem em operação, sempre
            calculados a partir dos dados reais da empresa.
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
