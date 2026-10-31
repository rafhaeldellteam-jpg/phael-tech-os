import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BellRing, Info } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router'
import { formatBRL } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { formatIsoDate } from '../finance/period'

interface AlertItem {
  label: string
  sub?: string
  date?: string
  cents?: number
  id?: string
}

export const automationKeys = {
  alerts: (companyId: string) => ['automations', companyId, 'alerts'] as const,
  runs: (companyId: string) => ['automations', companyId, 'runs'] as const,
}

/**
 * Dispara as automações diárias uma vez por sessão do navegador (o banco garante
 * no máximo uma execução por dia) e atualiza os dados que elas podem mudar.
 */
export function useDailyAutomations(companyId: string) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const key = `phael:auto:${companyId}:${new Date().toDateString()}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      /* armazenamento indisponível: roda mesmo assim, o banco evita repetição */
    }
    void requireSupabase()
      .rpc('run_automations', { p_company_id: companyId })
      .then(({ data, error }) => {
        if (error || !Array.isArray(data)) return
        const created = data.some((r) => typeof r === 'object' && r !== null && 'created' in r && Number((r as { created: unknown }).created) > 0)
        if (created) {
          void queryClient.invalidateQueries({ queryKey: ['finance', companyId] })
          void queryClient.invalidateQueries({ queryKey: ['digital', companyId] })
        }
        void queryClient.invalidateQueries({ queryKey: ['automations', companyId] })
      })
  }, [companyId, queryClient])
}

const icon = { danger: AlertTriangle, attn: BellRing, info: Info } as const
const tone = {
  danger: 'border-danger-600/50 bg-danger-600/5',
  attn: 'border-attn-500/50 bg-attn-100 dark:bg-attn-600/15',
  info: 'border-line bg-[var(--surface)]',
} as const

/** Avisos que pedem ação, calculados na hora pelo banco conforme as permissões de quem vê. */
export function AlertsPanel({ companyId }: { companyId: string }) {
  const alerts = useQuery({
    queryKey: automationKeys.alerts(companyId),
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('automation_alerts', { p_company_id: companyId })
      if (error) throw error
      return data ?? []
    },
  })
  if (!alerts.isSuccess || alerts.data.length === 0) return null

  return (
    <section aria-labelledby="avisos-h" className="grid gap-3">
      <h2 id="avisos-h" className="text-lg font-semibold">
        Avisos
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {alerts.data.map((a) => {
          const Icon = icon[a.severity] ?? Info
          const items = (Array.isArray(a.items) ? a.items : []) as unknown as AlertItem[]
          return (
            <li key={a.kind} className={`grid content-start gap-2 rounded-lg border p-4 text-sm ${tone[a.severity] ?? tone.info}`}>
              <div className="flex items-start gap-2">
                <Icon className={`mt-0.5 size-4 shrink-0 ${a.severity === 'danger' ? 'text-danger-600' : 'text-attn-600'}`} aria-hidden />
                <p className="flex-1 font-medium">
                  {a.title}: <span className="tabular-nums">{a.total}</span>
                  {a.amount_cents != null && <span className="tabular-nums"> · {formatBRL(a.amount_cents)}</span>}
                </p>
              </div>
              <ul className="grid gap-1 text-[13px]">
                {items.map((it, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-3">
                    <span>
                      {it.id && a.kind !== 'warranties_expiring' ? (
                        <Link to={`/ordens/${it.id}`} className="underline underline-offset-4">
                          {it.label}
                        </Link>
                      ) : (
                        it.label
                      )}
                      {it.sub && <span className="text-muted"> · {it.sub}</span>}
                    </span>
                    <span className="text-muted tabular-nums">
                      {it.cents != null && `${formatBRL(it.cents)} · `}
                      {it.date && formatIsoDate(it.date.slice(0, 10))}
                    </span>
                  </li>
                ))}
              </ul>
              {a.total > items.length && <p className="text-[12px] text-muted">e mais {a.total - items.length}</p>}
              <Link to={a.link} className="justify-self-start text-[13px] font-medium underline underline-offset-4">
                Ver tudo
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
