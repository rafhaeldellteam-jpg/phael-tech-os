import { isAvailable, navigation, visibleNavigation } from './navigation'
import { canAny } from './permissions'

const paths = (sections: ReturnType<typeof visibleNavigation>) => sections.flatMap((s) => s.items.map((i) => i.path))

describe('canAny', () => {
  it('requisito vazio é sempre permitido', () => expect(canAny(new Set(), [])).toBe(true))
  it('basta uma das permissões', () =>
    expect(canAny(new Set(['orders.read_assigned']), ['orders.read_all', 'orders.read_assigned'])).toBe(true))
  it('nega sem permissão', () => expect(canAny(new Set(['clients.read']), ['finance.read'])).toBe(false))
})

describe('visibleNavigation', () => {
  it('usuário sem permissões vê só o painel', () => {
    expect(paths(visibleNavigation(new Set()))).toEqual(['/'])
  })
  it('técnico não vê financeiro, auditoria nem equipe-gestão', () => {
    const tech = new Set(['company.read', 'members.read', 'orders.read_assigned', 'diagnostics.write', 'knowledge.read'])
    const visible = paths(visibleNavigation(tech))
    expect(visible).toContain('/ordens')
    expect(visible).toContain('/diagnosticos')
    expect(visible).not.toContain('/financeiro')
    expect(visible).not.toContain('/auditoria')
  })
  it('remove seções vazias', () => {
    const sections = visibleNavigation(new Set(['finance.read']))
    expect(sections.every((s) => s.items.length > 0)).toBe(true)
  })
})

describe('fases', () => {
  it('módulos prontos', () => {
    const available = navigation.flatMap((s) => s.items).filter(isAvailable).map((i) => i.path)
    expect(available.sort()).toEqual(['/', '/auditoria', '/clientes', '/empresa', '/equipamentos', '/equipe', '/estoque', '/financeiro', '/fornecedores', '/garantias', '/ordens', '/servicos'])
  })
  it('caminhos são únicos', () => {
    const all = navigation.flatMap((s) => s.items.map((i) => i.path))
    expect(new Set(all).size).toBe(all.length)
  })
})
