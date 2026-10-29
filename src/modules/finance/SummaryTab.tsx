import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ErrorState } from '@/components/ui/ErrorState'
import { Spinner } from '@/components/ui/Spinner'
import { formatCode, formatDate } from '@/lib/format'
import { formatBRL, marginPercent } from '@/lib/money'
import { daysBetween, formatIsoDate, presetRange } from './period'
import { PeriodPicker } from './PeriodPicker'
import { useCashFlow, useCategoryResults, useOrderMargins, useSummary } from './queries'

function Metric({ label, value, hint, tone }: { label: string; value: number; hint?: ReactNode; tone?: 'danger' | 'muted' }) {
  return (
    <div className="grid content-start gap-0.5 bg-[var(--surface)] p-4">
      <span className={`text-2xl font-semibold tabular-nums [font-stretch:85%] ${tone === 'danger' && value > 0 ? 'text-danger-600' : value < 0 ? 'text-danger-600' : ''}`}>
        {formatBRL(value)}
      </span>
      <span className="text-[13px]">{label}</span>
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </div>
  )
}

const brlShort = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })

export function SummaryTab({ companyId }: { companyId: string }) {
  const [range, setRange] = useState(() => presetRange('this_month'))
  const group = daysBetween(range.from, range.to) > 62 ? 'month' : 'day'
  const summary = useSummary(companyId, range.from, range.to)
  const flow = useCashFlow(companyId, range.from, range.to, group)
  const margins = useOrderMargins(companyId, range.from, range.to)
  const categories = useCategoryResults(companyId, range.from, range.to)
  const s = summary.data

  const chartData = (flow.data ?? []).map((r) => ({
    label: group === 'month' ? formatIsoDate(r.period).slice(3) : formatIsoDate(r.period).slice(0, 5),
    Entradas: r.in_cents / 100,
    Saídas: r.out_cents / 100,
  }))

  return (
    <div className="grid gap-6">
      <PeriodPicker from={range.from} to={range.to} onChange={setRange} />

      {summary.isPending ? (
        <Spinner label="Calculando" />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={summary.refetch} />
      ) : s ? (
        <>
          <section aria-labelledby="comp-h" className="grid gap-2">
            <h2 id="comp-h" className="text-sm font-semibold text-muted">
              Competência (pelo que foi lançado no período)
            </h2>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-[var(--border)] sm:grid-cols-3">
              <Metric label="Faturamento" value={s.billed_cents} hint="Contas a receber emitidas" />
              <Metric label="Despesas" value={s.expenses_cents} hint="Contas a pagar emitidas" />
              <Metric label="Resultado estimado" value={s.estimated_result_cents} hint="Faturamento − despesas" />
            </div>
          </section>
          <section aria-labelledby="caixa-h" className="grid gap-2">
            <h2 id="caixa-h" className="text-sm font-semibold text-muted">
              Caixa (pelo dinheiro que entrou e saiu)
            </h2>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-[var(--border)] sm:grid-cols-4">
              <Metric label="Recebimentos" value={s.received_cents} />
              <Metric label="Pagamentos" value={s.paid_cents} />
              <Metric label="Resultado de caixa" value={s.cash_result_cents} />
              <Metric label="Saldo financeiro hoje" value={s.balance_cents} hint="Todas as contas" />
            </div>
          </section>
          <section aria-labelledby="aberto-h" className="grid gap-2">
            <h2 id="aberto-h" className="text-sm font-semibold text-muted">
              Em aberto hoje
            </h2>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-[var(--border)] sm:grid-cols-4">
              <Metric label="A receber" value={s.receivable_open_cents} hint={<Link to="/financeiro?aba=receber" className="underline">Ver lista</Link>} />
              <Metric label="A receber vencido" value={s.receivable_overdue_cents} tone="danger" />
              <Metric label="A pagar" value={s.payable_open_cents} hint={<Link to="/financeiro?aba=pagar" className="underline">Ver lista</Link>} />
              <Metric label="A pagar vencido" value={s.payable_overdue_cents} tone="danger" />
            </div>
          </section>
        </>
      ) : null}

      <section aria-labelledby="fluxo-h" className="surface grid gap-3 rounded-lg p-5">
        <h2 id="fluxo-h" className="font-semibold">
          Fluxo de caixa {group === 'month' ? 'por mês' : 'por dia'}
        </h2>
        {flow.isPending ? (
          <Spinner label="Carregando" />
        ) : flow.isError ? (
          <ErrorState error={flow.error} onRetry={flow.refetch} />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted">Nenhum recebimento ou pagamento no período.</p>
        ) : (
          <>
            <div className="h-64 w-full" role="img" aria-label="Gráfico de barras com entradas e saídas do período. A tabela abaixo traz os mesmos valores.">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barGap={2} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                    tickFormatter={(v: number) => brlShort.format(v)}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--surface-muted)' }}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}
                    formatter={(v) => formatBRL(Math.round(Number(v) * 100))}
                  />
                  <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 13 }} />
                  <Bar dataKey="Entradas" fill="var(--chart-in)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="Saídas" fill="var(--chart-out)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <details>
              <summary className="cursor-pointer text-sm">Ver em tabela</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="py-1.5 font-medium">{group === 'month' ? 'Mês' : 'Dia'}</th>
                      <th className="py-1.5 text-right font-medium">Entradas</th>
                      <th className="py-1.5 text-right font-medium">Saídas</th>
                      <th className="py-1.5 text-right font-medium">Saldo acumulado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(flow.data ?? []).map((r) => (
                      <tr key={r.period} className="border-t border-line">
                        <td className="py-1.5 tabular-nums">{group === 'month' ? formatIsoDate(r.period).slice(3) : formatIsoDate(r.period)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatBRL(r.in_cents)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatBRL(r.out_cents)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${r.balance_cents < 0 ? 'text-danger-600' : ''}`}>{formatBRL(r.balance_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="cat-h" className="surface grid content-start gap-3 rounded-lg p-5">
          <h2 id="cat-h" className="font-semibold">
            Resultado por categoria de serviço
          </h2>
          <p className="text-[13px] text-muted">Serviços de OS entregues no período: receita − custo de referência.</p>
          {categories.isPending ? (
            <Spinner label="Carregando" />
          ) : categories.isError ? (
            <ErrorState error={categories.error} />
          ) : categories.data.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma OS entregue no período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1.5 font-medium">Categoria</th>
                  <th className="py-1.5 text-right font-medium">Receita</th>
                  <th className="py-1.5 text-right font-medium">Margem</th>
                </tr>
              </thead>
              <tbody>
                {categories.data.map((c) => (
                  <tr key={c.category} className="border-t border-line">
                    <td className="py-1.5">
                      {c.label} <span className="text-muted tabular-nums">({c.items})</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{formatBRL(c.revenue_cents)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatBRL(c.margin_cents)}
                      {marginPercent(c.revenue_cents, c.cost_cents) != null && <span className="text-muted"> ({marginPercent(c.revenue_cents, c.cost_cents)}%)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section aria-labelledby="os-h" className="surface grid content-start gap-3 rounded-lg p-5">
          <h2 id="os-h" className="font-semibold">
            Margem por OS entregue
          </h2>
          <p className="text-[13px] text-muted">Total cobrado − custo real das peças e serviços. "Recebido" vem do financeiro.</p>
          {margins.isPending ? (
            <Spinner label="Carregando" />
          ) : margins.isError ? (
            <ErrorState error={margins.error} />
          ) : margins.data.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma OS entregue no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-1.5 font-medium">OS</th>
                    <th className="py-1.5 text-right font-medium">Cobrado</th>
                    <th className="py-1.5 text-right font-medium">Margem</th>
                    <th className="py-1.5 text-right font-medium">Recebido</th>
                  </tr>
                </thead>
                <tbody>
                  {margins.data.map((m) => (
                    <tr key={m.order_id} className="border-t border-line">
                      <td className="py-1.5">
                        <Link to={`/ordens/${m.order_id}`} className="font-medium tabular-nums hover:underline">
                          {formatCode('OS', m.number)}
                        </Link>
                        <span className="block text-[12px] text-muted">
                          {m.client_name}, {formatDate(m.delivered_at)}
                        </span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatBRL(m.revenue_cents)}</td>
                      <td className={`py-1.5 text-right tabular-nums ${m.margin_cents < 0 ? 'text-danger-600' : ''}`}>{formatBRL(m.margin_cents)}</td>
                      <td className={`py-1.5 text-right tabular-nums ${m.received_cents < m.revenue_cents ? 'text-attn-600' : ''}`}>{formatBRL(m.received_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
