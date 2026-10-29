import { parseStatementCsv } from './statement'

describe('parseStatementCsv', () => {
  it('lê CSV brasileiro com ; e valores com vírgula', () => {
    const r = parseStatementCsv('Data;Histórico;Valor\n05/01/2026;TED ALUGUEL;-1.200,00\n06/01/2026;PIX RECEBIDO;150,50')
    expect(r.errors).toEqual([])
    expect(r.lines).toEqual([
      { date: '2026-01-05', description: 'TED ALUGUEL', amount_cents: -120000 },
      { date: '2026-01-06', description: 'PIX RECEBIDO', amount_cents: 15050 },
    ])
  })
  it('lê CSV com vírgula e aspas', () => {
    const r = parseStatementCsv('date,description,amount\n2026-01-05,"Loja, Centro",-10.50')
    expect(r.lines[0]).toEqual({ date: '2026-01-05', description: 'Loja, Centro', amount_cents: -1050 })
  })
  it('ignora linhas incompletas e avisa', () => {
    const r = parseStatementCsv('Data;Descrição;Valor\n05/01/2026;;10,00\n05/01/2026;OK;0')
    expect(r.lines).toEqual([])
    expect(r.errors).toHaveLength(2)
  })
  it('exige as colunas', () => expect(parseStatementCsv('a;b\n1;2').errors[0]).toMatch(/colunas/))
})
