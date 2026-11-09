import type { FinanceStatus, PaymentMethod } from '@/lib/database.types'

export interface Installment {
  id: string
  number: number
  no: number
  amount_cents: number
  paid_cents: number
  due_date: string
  status: FinanceStatus
  last_paid_at: string | null
  last_method: PaymentMethod | null
}

export interface Debt {
  group_id: string
  client_id: string | null
  client_name: string | null
  client_phone: string | null
  order_id: string | null
  order_number: number | null
  description: string
  payment_method: PaymentMethod | null
  installment_count: number
  total_cents: number
  paid_cents: number
  open_cents: number
  overdue_cents: number
  paid_installments: number
  next_due: string | null
  installments: Installment[]
}

export interface ClientGroup {
  key: string
  name: string
  phone: string | null
  open: number
  overdue: number
  debts: Debt[]
}

/** Agrupa as cobranças por cliente (quem tem atraso primeiro, depois quem deve mais). */
export function groupByClient(debts: Debt[]): ClientGroup[] {
  const map = new Map<string, ClientGroup>()
  for (const d of debts) {
    const key = d.client_id ?? 'sem-cliente'
    const g = map.get(key) ?? { key, name: d.client_name ?? 'Sem cliente', phone: d.client_phone, open: 0, overdue: 0, debts: [] }
    g.open += d.open_cents
    g.overdue += d.overdue_cents
    g.debts.push(d)
    map.set(key, g)
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name, 'pt-BR'))
}

export function planLabel(d: Pick<Debt, 'installment_count'>): string {
  return d.installment_count > 1 ? `Parcelado em ${d.installment_count}x` : 'À vista'
}

