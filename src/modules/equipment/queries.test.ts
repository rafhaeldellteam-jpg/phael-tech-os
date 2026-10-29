import { equipmentTitle } from './queries'

describe('equipmentTitle', () => {
  it('usa marca e modelo', () => expect(equipmentTitle({ manufacturer: 'Dell', model: 'Inspiron' }, 'Notebook')).toBe('Dell Inspiron'))
  it('usa só o que existir', () => expect(equipmentTitle({ manufacturer: null, model: 'G15' }, 'Notebook')).toBe('G15'))
  it('cai para o tipo', () => expect(equipmentTitle({ manufacturer: null, model: null }, 'Impressora')).toBe('Impressora'))
})
