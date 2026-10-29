/**
 * Gera CSV compatível com Excel em português: separador ";", BOM UTF-8 e
 * aspas quando necessário. Protege contra injeção de fórmulas (=, +, -, @).
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>): string {
  const cell = (v: string | number | boolean | null | undefined): string => {
    if (v === null || v === undefined) return ''
    let s = typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers, ...rows].map((r) => r.map(cell).join(';'))
  return '\uFEFF' + lines.join('\r\n')
}

export function downloadText(filename: string, content: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
