import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { formatBRL, marginPercent } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { presetRange } from '../finance/period'
import { PeriodPicker } from '../finance/PeriodPicker'

const keys = {
  summary: (c: string, f: string, t: string) => ['reports', c, 'summary', f, t] as const,
  tech: (c: string, f: string, t: string) => ['reports', c, 'tech', f, t] as const,
  items: (c: string, f: string, t: string) => ['reports', c, 'items', f, t] as const,
  clients: (c: string, f: string, t: string) => ['reports', c, 'clients', f, t] as const,
  aging: (c: string) => ['reports', c, 'aging'] as const,
  monthly: (c: string) => ['reports', c, 'monthly'] as const,
}

function useRpc<T>(key: readonly unknown[], enabled: boolean, fn: () => PromiseLike<{ data: T | null; error: unknown }>) {
  return useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const { data, error } = await fn()
      if (error) throw error
      return data as T
    },
  })
}

const hours = (h: number | null | undefined) => {
  if (h == null) return '—'
  if (h < 48) return `${h.toLocaleString('pt-BR')} h`
  return `${(h / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`
}
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—')

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid content-start gap-0.5 bg-[var(--surface)] p-4">
      <span className="text-2xl font-semibold tabular-nums [font-stretch:85%]">{value}</span>
      <span className="text-[13px]">{label}</span>
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </div>
  )
}

function Panel({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="surface grid content-start gap-3 rounded-lg p-5">
      <div className="grid gap-0.5">
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        {note && <p className="text-[13px] text-muted">{note}</p>}
      </div>
      {children}
    </section>
  )
}

export function ReportsPage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const op = can(['reports.operational'])
  const fin = can(['reports.financial'])
  const [range, setRange] = useState(() => presetRange('this_month'))
  const c = company.id
  const sb = requireSupabase()
  const args = { p_company_id: c, p_from: range.from, p_to: range.to }

  const summary = useRpc(keys.summary(c, range.from, range.to), op, () => sb.rpc('report_orders_summary', args))
  const tech = useRpc(keys.tech(c, range.from, range.to), op, () => sb.rpc('report_by_technician', args))
  const items = useRpc(keys.items(c, range.from, range.to), op, () => sb.rpc('report_top_items', { ...args, p_limit: 15 }))
  const clients = useRpc(keys.clients(c, range.from, range.to), fin, () => sb.rpc('report_top_clients', { ...args, p_limit: 15 }))
  const aging = useRpc(keys.aging(c), fin, () => sb.rpc('report_receivables_aging', { p_company_id: c }))
  const monthly = useRpc(keys.monthly(c), op || fin, () => sb.rpc('report_monthly', { p_company_id: c, p_months: 12 }))

  const s = summary.data?.[0]
  const agingMax = Math.max(1, ...(aging.data ?? []).map((a) => a.open_cents))
  const chart = (monthly.data ?? []).map((m) => {
    const [y, mo] = m.month.split('-')
    return {
      label: `${mo}/${y?.slice(2)}`,
      Faturado: (m.billed_cents ?? 0) / 100,
      Recebido: (m.received_cents ?? 0) / 100,
      'OS entregues': m.delivered,
    }
  })

  return (
    <div className="grid gap-6">
      <PageHeader title="Relatórios" description="Números calculados direto do banco, com as fórmulas descritas em cada quadro. Valores em reais, sem arredondamento." />
      <PeriodPicker from={range.from} to={range.to} onChange={setRange} />

      {op && (
        <>
          {summary.isPending ? (
            <Spinner label="Calculando" />
          ) : summary.isError ? (
            <ErrorState error={summary.error} onRetry={summary.refetch} />
          ) : (
            s && (
              <section aria-labelledby="op-h" className="grid gap-2">
                <h2 id="op-h" className="text-sm font-semibold text-muted">
                  Ordens de serviço no período
                </h2>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-6">
                  <Tile label="Abertas" value={s.opened} />
                  <Tile label="Entregues" value={s.delivered} hint="Sem contar retornos de garantia" />
                  <Tile label="Em andamento agora" value={s.open_now} />
                  <Tile label="Tempo médio de reparo" value={hours(s.avg_turnaround_hours)} hint={`Mediana: ${hours(s.median_turnaround_hours)}`} />
                  <Tile label="Entregues no prazo" value={pct(s.on_time, s.due_tracked)} hint={`${s.on_time} de ${s.due_tracked} com prazo`} />
                  <Tile label="Retornos em garantia" value={s.warranty_returns} hint={`${s.canceled} cancelada(s), ${s.unrepairable} sem reparo`} />
                </div>
              </section>
            )
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel id="tec-h" title="Por técnico" note="OS entregues no período. Tempo = entrega − entrada.">
              {tech.isPending ? (
                <Spinner label="Carregando" />
              ) : tech.isError ? (
                <ErrorState error={tech.error} />
              ) : tech.data.length === 0 ? (
                <p className="text-sm text-muted">Nenhuma OS entregue no período.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="py-1.5 font-medium">Técnico</th>
                      <th className="py-1.5 text-right font-medium">OS</th>
                      <th className="py-1.5 text-right font-medium">Tempo médio</th>
                      {fin && <th className="py-1.5 text-right font-medium">Receita</th>}
                      <th className="py-1.5 text-right font-medium">Garantias</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tech.data.map((t) => (
                      <tr key={t.user_id ?? 'none'} className="border-t border-line">
                        <td className="py-1.5">{t.name}</td>
                        <td className="py-1.5 text-right tabular-nums">{t.delivered}</td>
                        <td className="py-1.5 text-right tabular-nums">{hours(t.avg_turnaround_hours)}</td>
                        {fin && <td className="py-1.5 text-right tabular-nums">{formatBRL(t.revenue_cents)}</td>}
                        <td className="py-1.5 text-right tabular-nums">{t.warranty_returns}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel id="itens-h" title="Serviços e peças mais vendidos" note="Itens de OS entregues no período (removidos não contam). Receita = qtd × preço − desconto.">
              {items.isPending ? (
                <Spinner label="Carregando" />
              ) : items.isError ? (
                <ErrorState error={items.error} />
              ) : items.data.length === 0 ? (
                <p className="text-sm text-muted">Nada vendido no período.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="py-1.5 font-medium">Item</th>
                      <th className="py-1.5 text-right font-medium">Qtd.</th>
                      <th className="py-1.5 text-right font-medium">Receita</th>
                      {fin && <th className="py-1.5 text-right font-medium">Margem</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.data.map((i) => (
                      <tr key={`${i.kind}-${i.description}`} className="border-t border-line">
                        <td className="py-1.5">
                          {i.description} <span className="text-[12px] text-muted">({i.kind === 'part' ? 'peça' : 'serviço'})</span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{i.qty}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatBRL(i.revenue_cents)}</td>
                        {fin && (
                          <td className="py-1.5 text-right tabular-nums">
                            {i.cost_cents != null ? formatBRL(i.revenue_cents - i.cost_cents) : '—'}
                            {i.cost_cents != null && marginPercent(i.revenue_cents, i.cost_cents) != null && (
                              <span className="text-muted"> ({marginPercent(i.revenue_cents, i.cost_cents)}%)</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        </>
      )}

      {(op || fin) && (
        <Panel id="mensal-h" title="Últimos 12 meses" note={fin ? 'Faturado = contas a receber emitidas no mês. Recebido = pagamentos recebidos no mês (estornos descontados).' : 'OS entregues por mês.'}>
          {monthly.isPending ? (
            <Spinner label="Carregando" />
          ) : monthly.isError ? (
            <ErrorState error={monthly.error} />
          ) : (
            <>
              <div className="h-64 w-full" role="img" aria-label="Gráfico mensal. A tabela abaixo traz os mesmos valores.">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} barGap={2} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} width={56} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                    <Tooltip
                      cursor={{ fill: 'var(--surface-muted)' }}
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}
                      formatter={(v, n) => (n === 'OS entregues' ? String(v) : formatBRL(Math.round(Number(v) * 100)))}
                    />
                    <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 13 }} />
                    {fin ? (
                      <>
                        <Bar dataKey="Faturado" fill="var(--chart-in)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                        <Bar dataKey="Recebido" fill="var(--chart-out)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                      </>
                    ) : (
                      <Bar dataKey="OS entregues" fill="var(--chart-in)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <details>
                <summary className="cursor-pointer text-sm">Ver em tabela</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="text-left text-muted">
                      <tr>
                        <th className="py-1.5 font-medium">Mês</th>
                        <th className="py-1.5 text-right font-medium">OS abertas</th>
                        <th className="py-1.5 text-right font-medium">OS entregues</th>
                        {fin && <th className="py-1.5 text-right font-medium">Faturado</th>}
                        {fin && <th className="py-1.5 text-right font-medium">Recebido</th>}
                        {fin && <th className="py-1.5 text-right font-medium">Pago (despesas)</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(monthly.data ?? []).map((m, i) => (
                        <tr key={m.month} className="border-t border-line">
                          <td className="py-1.5 tabular-nums">{chart[i]?.label}</td>
                          <td className="py-1.5 text-right tabular-nums">{m.opened}</td>
                          <td className="py-1.5 text-right tabular-nums">{m.delivered}</td>
                          {fin && <td className="py-1.5 text-right tabular-nums">{formatBRL(m.billed_cents)}</td>}
                          {fin && <td className="py-1.5 text-right tabular-nums">{formatBRL(m.received_cents)}</td>}
                          {fin && <td className="py-1.5 text-right tabular-nums">{formatBRL(m.paid_cents)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </Panel>
      )}

      {fin && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel id="aging-h" title="Contas a receber por atraso" note="Em aberto hoje (valor − pago), por dias desde o vencimento.">
            {aging.isPending ? (
              <Spinner label="Carregando" />
            ) : aging.isError ? (
              <ErrorState error={aging.error} />
            ) : (
              <ul className="grid gap-2 text-sm">
                {aging.data.map((a) => (
                  <li key={a.bucket} className="grid grid-cols-[110px_1fr_auto] items-center gap-3">
                    <span>{a.bucket}</span>
                    <span className="h-2.5 rounded-full bg-[var(--surface-muted)]" aria-hidden>
                      <span
                        className={`block h-full rounded-full ${a.sort === 0 ? 'bg-[var(--chart-in)]' : 'bg-[var(--chart-out)]'}`}
                        style={{ width: `${(a.open_cents / agingMax) * 100}%` }}
                      />
                    </span>
                    <span className={`text-right tabular-nums ${a.sort >= 3 && a.open_cents > 0 ? 'font-medium text-danger-600' : ''}`}>
                      {formatBRL(a.open_cents)} <span className="text-[12px] text-muted">({a.entries})</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel id="cli-h" title="Clientes que mais faturaram" note="Contas a receber emitidas no período (canceladas não contam).">
            {clients.isPending ? (
              <Spinner label="Carregando" />
            ) : clients.isError ? (
              <ErrorState error={clients.error} />
            ) : clients.data.length === 0 ? (
              <p className="text-sm text-muted">Nada faturado no período.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-1.5 font-medium">Cliente</th>
                    <th className="py-1.5 text-right font-medium">Faturado</th>
                    <th className="py-1.5 text-right font-medium">Em aberto</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.data.map((cl) => (
                    <tr key={cl.client_id} className="border-t border-line">
                      <td className="py-1.5">
                        <Link to={`/clientes/${cl.client_id}`} className="hover:underline">
                          {cl.name}
                        </Link>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatBRL(cl.billed_cents)}</td>
                      <td className={`py-1.5 text-right tabular-nums ${cl.open_cents > 0 ? 'text-attn-600' : ''}`}>{formatBRL(cl.open_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}
