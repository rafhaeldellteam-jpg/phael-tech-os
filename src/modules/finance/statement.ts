import { parseMoney } from '@/lib/money'

export interface StatementLine {
  date: string
  description: string
  amount_cents: number
}

export interface ParseResult {
  lines: StatementLine[]
  errors: string[]
}

/** Divide uma linha CSV respeitando aspas. */
function splitCsv(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (ch === sep && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

function toIso(raw: string): string | null {
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (br) return `${br[3]}-${br[2]?.padStart(2, '0')}-${br[1]?.padStart(2, '0')}`
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return null
}

/**
 * Lê o extrato em CSV exportado pelo banco. Detecta separador (; ou ,) e as
 * colunas de data, descrição e valor pelo cabeçalho. Valores negativos = saídas.
 */
export function parseStatementCsv(text: string): ParseResult {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (rows.length < 2) return { lines: [], errors: ['O arquivo precisa de cabeçalho e ao menos uma linha.'] }
  const header = rows[0] ?? ''
  const sep = (header.match(/;/g)?.length ?? 0) >= (header.match(/,/g)?.length ?? 0) ? ';' : ','
  const cols = splitCsv(header, sep).map((c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
  const find = (...names: string[]) => cols.findIndex((c) => names.some((n) => c.includes(n)))
  const iDate = find('data', 'date')
  const iDesc = find('descri', 'histor', 'lancamento', 'memo')
  const iAmount = find('valor', 'amount', 'quantia')
  if (iDate < 0 || iDesc < 0 || iAmount < 0) {
    return { lines: [], errors: ['Não encontrei as colunas de data, descrição e valor no cabeçalho.'] }
  }
  const lines: StatementLine[] = []
  const errors: string[] = []
  rows.slice(1).forEach((row, n) => {
    const c = splitCsv(row, sep)
    const date = toIso(c[iDate] ?? '')
    const cents = parseMoney(c[iAmount] ?? '')
    const description = (c[iDesc] ?? '').slice(0, 300)
    if (!date || cents === null || cents === 0 || !description) {
      errors.push(`Linha ${n + 2} ignorada: dados incompletos`)
      return
    }
    lines.push({ date, description, amount_cents: cents })
  })
  return { lines, errors }
}
