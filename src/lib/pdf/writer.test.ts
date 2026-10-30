import { describe, expect, it } from 'vitest'
import { jpegSize, PdfDocument, textWidth, toWinAnsi, wrapText } from './writer'

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('')

describe('PDF', () => {
  it('codifica português em WinAnsi', () => {
    expect(toWinAnsi('ção')).toEqual([0xe7, 0xe3, 0x6f])
    expect(toWinAnsi('R$ 1,00 – “ok”')).toContain(0x96)
    expect(toWinAnsi('😀')).toEqual([63])
  })

  it('mede e quebra texto pela largura real da fonte', () => {
    expect(textWidth('W', 10)).toBeCloseTo(9.44, 2)
    expect(textWidth('W', 10, 'bold')).toBeCloseTo(9.44, 2)
    const lines = wrapText('um dois três quatro cinco seis sete oito nove dez', 80, 10)
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(textWidth(l, 10)).toBeLessThanOrEqual(80)
    expect(wrapText('linha 1\nlinha 2', 500, 10)).toEqual(['linha 1', 'linha 2'])
    expect(wrapText('x'.repeat(200), 50, 10).every((l) => textWidth(l, 10) <= 50)).toBe(true)
  })

  it('gera arquivo com xref coerente', () => {
    const doc = new PdfDocument()
    doc.text(40, 40, 'Olá (mundo) \\ teste')
    doc.addPage()
    doc.line(0, 0, 100, 100)
    const s = latin1(doc.output())
    expect(s.startsWith('%PDF-1.4')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(s).toContain('/Count 2')
    expect(s).toContain('(Ol\\341 \\(mundo\\) \\\\ teste) Tj')
    // Cada entrada do xref aponta para o início do objeto correspondente.
    const xrefAt = Number(/startxref\n(\d+)/.exec(s)?.[1])
    const entries = s.slice(xrefAt).split('\n').slice(3).filter((l) => / n $/.test(l))
    entries.forEach((e, i) => expect(s.slice(Number(e.slice(0, 10)), Number(e.slice(0, 10)) + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)))
  })

  it('lê o tamanho de um JPEG', () => {
    // SOI + APP0 curto + SOF0 com altura 2 e largura 3
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0, 0, 0, 0, 0])
    expect(jpegSize(bytes)).toEqual({ width: 3, height: 2 })
  })
})
