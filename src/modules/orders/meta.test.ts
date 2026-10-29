import { isOverdue, isoToLocalInput, localInputToIso, nextStatuses, type StatusInfo, type Transition } from './meta'

const statuses: StatusInfo[] = [
  { key: 'in_repair', label: 'Em reparo', stage: 'working', sort: 60, is_final: false },
  { key: 'testing', label: 'Em testes', stage: 'working', sort: 70, is_final: false },
  { key: 'ready', label: 'Pronto para retirada', stage: 'ready', sort: 80, is_final: false },
  { key: 'delivered', label: 'Entregue', stage: 'done', sort: 90, is_final: false },
  { key: 'unrepairable', label: 'Reparo inviável', stage: 'stopped', sort: 120, is_final: false },
]
const transitions: Transition[] = [
  { from_status: 'in_repair', to_status: 'unrepairable', requires_reason: true },
  { from_status: 'in_repair', to_status: 'ready', requires_reason: false },
  { from_status: 'in_repair', to_status: 'testing', requires_reason: false },
  { from_status: 'ready', to_status: 'delivered', requires_reason: false },
  { from_status: 'ready', to_status: 'in_repair', requires_reason: true },
]

describe('nextStatuses', () => {
  it('lista as opções na ordem do fluxo', () => {
    expect(nextStatuses('in_repair', transitions, statuses, { update: true, deliver: false }).map((n) => n.key)).toEqual([
      'testing',
      'ready',
      'unrepairable',
    ])
  })
  it('marca quando exige motivo', () => {
    const n = nextStatuses('in_repair', transitions, statuses, { update: true, deliver: false })
    expect(n.find((x) => x.key === 'unrepairable')?.requiresReason).toBe(true)
  })
  it('atendente só vê a entrega', () => {
    expect(nextStatuses('ready', transitions, statuses, { update: false, deliver: true }).map((n) => n.key)).toEqual(['delivered'])
  })
  it('sem permissão, nenhuma opção', () => {
    expect(nextStatuses('ready', transitions, statuses, { update: false, deliver: false })).toEqual([])
  })
})

describe('isOverdue', () => {
  const now = new Date('2026-10-29T12:00:00Z')
  it('prazo vencido em OS aberta', () => expect(isOverdue({ due_at: '2026-10-28T12:00:00Z' }, 'working', now)).toBe(true))
  it('sem prazo não atrasa', () => expect(isOverdue({ due_at: null }, 'working', now)).toBe(false))
  it('OS concluída não atrasa', () => expect(isOverdue({ due_at: '2026-10-28T12:00:00Z' }, 'done', now)).toBe(false))
  it('prazo futuro', () => expect(isOverdue({ due_at: '2026-10-30T12:00:00Z' }, 'open', now)).toBe(false))
})

describe('datas do formulário', () => {
  it('ida e volta preserva o horário local', () => {
    const iso = localInputToIso('2026-10-30T14:30')
    expect(iso).not.toBeNull()
    expect(isoToLocalInput(iso)).toBe('2026-10-30T14:30')
  })
  it('vazio vira null', () => expect(localInputToIso('')).toBeNull())
})
