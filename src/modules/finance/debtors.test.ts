import { describe, expect, it } from 'vitest'
import { groupByClient, planLabel, type Debt } from './debtors'

const debt = (p: Partial<Debt>): Debt => ({
  group_id: 'g',
  client_id: 'c1',
  client_name: 'Ana',
  client_phone: null,
  order_id: null,
  order_number: null,
  description: 'Serviço',
  payment_method: 'pix',
  installment_count: 1,
  total_cents: 1000,
  paid_cents: 0,
  open_cents: 1000,
  overdue_cents: 0,
  paid_installments: 0,
  next_due: null,
  installments: [],
  ...p,
})

describe('clientes devendo', () => {
  it('agrupa por cliente somando o que está em aberto e vencido', () => {
    const g = groupByClient([
      debt({ group_id: 'a', client_id: 'c1', client_name: 'Ana', open_cents: 3000 }),
      debt({ group_id: 'b', client_id: 'c1', client_name: 'Ana', open_cents: 2000, overdue_cents: 500 }),
      debt({ group_id: 'c', client_id: 'c2', client_name: 'Bruno', open_cents: 9000 }),
      debt({ group_id: 'd', client_id: null, client_name: null, open_cents: 100 }),
    ])
    expect(g.map((x) => x.name)).toEqual(['Ana', 'Bruno', 'Sem cliente'])
    expect(g[0]).toMatchObject({ open: 5000, overdue: 500 })
    expect(g[0]?.debts).toHaveLength(2)
  })

  it('quem tem atraso vem antes de quem deve mais', () => {
    const g = groupByClient([debt({ client_id: 'x', client_name: 'Zé', open_cents: 100, overdue_cents: 100 }), debt({ client_id: 'y', client_name: 'Ana', open_cents: 99999 })])
    expect(g[0]?.name).toBe('Zé')
  })

  it('descreve o plano', () => {
    expect(planLabel({ installment_count: 1 })).toBe('À vista')
    expect(planLabel({ installment_count: 3 })).toBe('Parcelado em 3x')
  })
})
