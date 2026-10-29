import { toCsv } from './csv'

describe('toCsv', () => {
  it('usa ; e BOM', () => {
    const csv = toCsv(['a', 'b'], [[1, 'x']])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv.slice(1)).toBe('a;b\r\n1;x')
  })
  it('escapa aspas, ; e quebras de linha', () => {
    expect(toCsv(['t'], [['Diz "oi"; tchau\nfim']]).slice(1)).toBe('t\r\n"Diz ""oi""; tchau\nfim"')
  })
  it('neutraliza fórmulas', () => {
    expect(toCsv(['t'], [['=HYPERLINK("x")']]).slice(1)).toBe('t\r\n"\'=HYPERLINK(""x"")"')
    expect(toCsv(['t'], [['-1+2']]).slice(1)).toBe("t\r\n'-1+2")
  })
  it('booleanos e vazios', () => {
    expect(toCsv(['a', 'b', 'c'], [[true, null, undefined]]).slice(1)).toBe('a;b;c\r\nSim;;')
  })
})
