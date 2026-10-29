import { summarizeChanges } from './audit-format'

describe('summarizeChanges', () => {
  it('descreve alterações com valores antigos e novos', () => {
    expect(summarizeChanges('update', { name: { old: 'A', new: 'B' } })).toEqual(['nome: A → B'])
  })
  it('mantém valores ocultos como vieram do banco', () => {
    expect(summarizeChanges('update', { tax_id: { old: '[redacted]', new: '[redacted]' } })).toEqual([
      'CPF/CNPJ: [redacted] → [redacted]',
    ])
  })
  it('mostra vazio como travessão', () => {
    expect(summarizeChanges('update', { phone: { old: null, new: '11' } })).toEqual(['telefone: — → 11'])
  })
  it('não resume inserções', () => expect(summarizeChanges('insert', { name: 'A' })).toEqual([]))
})
