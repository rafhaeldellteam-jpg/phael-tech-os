import { normalizeQuery, searchTerm } from './queries'

describe('normalizeQuery', () => {
  it('remove acentos e caixa', () => expect(normalizeQuery('  João ÁVILA ')).toBe('joao avila'))
  it('escapa curingas do LIKE', () => expect(normalizeQuery('50%_off')).toBe('50\\%\\_off'))
})

describe('searchTerm', () => {
  it('telefone com máscara vira dígitos', () => expect(searchTerm('(11) 98765-4321')).toBe('11987654321'))
  it('texto é normalizado', () => expect(searchTerm('Conceição')).toBe('conceicao'))
  it('termo curto não filtra', () => expect(searchTerm('a')).toBeNull())
  it('dois dígitos não filtram como número', () => expect(searchTerm('12')).toBe('12'))
})
