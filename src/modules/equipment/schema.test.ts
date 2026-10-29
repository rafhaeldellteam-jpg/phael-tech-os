import { equipmentSchema, parseAccessories, toEquipmentPayload } from './schema'

describe('parseAccessories', () => {
  it('separa por vírgula, ponto e vírgula e linha', () =>
    expect(parseAccessories('Carregador, mochila; mouse\nCabo')).toEqual(['Carregador', 'mochila', 'mouse', 'Cabo']))
  it('remove vazios e repetidos (sem diferenciar maiúsculas)', () =>
    expect(parseAccessories(' , carregador,Carregador ,, ')).toEqual(['carregador']))
})

describe('equipmentSchema', () => {
  const base = {
    clientId: 'c1', type: 'notebook', manufacturer: '', model: '', serialNumber: '', assetTag: '', processor: '',
    memory: '', storage: '', graphics: '', operatingSystem: '', conditionNotes: '', accessories: '',
  }
  it('exige cliente', () => expect(equipmentSchema.safeParse({ ...base, clientId: '' }).success).toBe(false))
  it('aceita só cliente e tipo', () => expect(equipmentSchema.safeParse(base).success).toBe(true))
  it('descarta configuração oculta quando não é computador', () =>
    expect(toEquipmentPayload({ ...base, type: 'printer', memory: '8 GB' }).memory).toBe(''))
  it('mantém configuração de computador', () =>
    expect(toEquipmentPayload({ ...base, memory: '8 GB' }).memory).toBe('8 GB'))
  it('payload converte acessórios em lista', () =>
    expect(toEquipmentPayload({ ...base, accessories: 'Fonte, Cabo' }).accessories).toEqual(['Fonte', 'Cabo']))
})
