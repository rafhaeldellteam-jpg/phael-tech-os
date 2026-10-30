import { HELVETICA, HELVETICA_BOLD } from './metrics'

/**
 * Gerador de PDF mínimo, sem dependências: páginas A4, texto em Helvetica/Helvetica-Bold
 * (WinAnsi, cobre português), linhas, retângulos e imagens JPEG.
 * Coordenadas em pontos (1/72 pol.), com y medido a partir do TOPO da página.
 */

export type PdfFont = 'regular' | 'bold'
export type Rgb = [number, number, number]

export interface PdfJpeg {
  /** Bytes do arquivo JPEG (baseline, RGB). */
  data: Uint8Array
  width: number
  height: number
}

export const A4 = { width: 595.28, height: 841.89 }

// cp1252: códigos 0x80–0x9F que não são Latin-1.
const CP1252_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

/** Converte texto para bytes WinAnsi; caracteres sem representação viram "?". */
export function toWinAnsi(text: string): number[] {
  const out: number[] = []
  for (const ch of text.normalize('NFC')) {
    if (ch === '\t') {
      out.push(32)
      continue
    }
    const code = ch.codePointAt(0) ?? 63
    if (code >= 32 && code <= 126) out.push(code)
    else if (code >= 0xa0 && code <= 0xff) out.push(code)
    else if (CP1252_EXTRA[ch] !== undefined) out.push(CP1252_EXTRA[ch])
    else if (code === 0x2212) out.push(45) // sinal de menos
    else out.push(63)
  }
  return out
}

function widthUnits(bytes: number[], font: PdfFont): number {
  const table = font === 'bold' ? HELVETICA_BOLD : HELVETICA
  let w = 0
  for (const b of bytes) w += table[b - 32] || 556
  return w
}

export function textWidth(text: string, size: number, font: PdfFont = 'regular'): number {
  return (widthUnits(toWinAnsi(text), font) * size) / 1000
}

/** Quebra o texto em linhas que cabem em maxWidth (respeita quebras de linha do texto). */
export function wrapText(text: string, maxWidth: number, size: number, font: PdfFont = 'regular'): string[] {
  const lines: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(/ +/).filter((w, _i, arr) => w !== '' || arr.length === 1)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (textWidth(candidate, size, font) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      // Palavra maior que a linha: corta por caractere.
      let rest = word
      while (textWidth(rest, size, font) > maxWidth && rest.length > 1) {
        let n = rest.length - 1
        while (n > 1 && textWidth(rest.slice(0, n), size, font) > maxWidth) n--
        lines.push(rest.slice(0, n))
        rest = rest.slice(n)
      }
      line = rest
    }
    lines.push(line)
  }
  return lines
}

function pdfString(bytes: number[]): string {
  let s = '('
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += '\\' + String.fromCharCode(b)
    else if (b < 32 || b > 126) s += '\\' + b.toString(8).padStart(3, '0')
    else s += String.fromCharCode(b)
  }
  return s + ')'
}

const num = (n: number) => (Math.round(n * 100) / 100).toString()
const rgb = (c: Rgb, op: 'rg' | 'RG') => `${num(c[0] / 255)} ${num(c[1] / 255)} ${num(c[2] / 255)} ${op}`

export class PdfDocument {
  readonly width = A4.width
  readonly height = A4.height
  private pages: string[][] = []
  private images: PdfJpeg[] = []

  constructor() {
    this.addPage()
  }

  get pageCount(): number {
    return this.pages.length
  }

  addPage(): void {
    this.pages.push([])
  }

  /** Página atual (0 = primeira). Permite desenhar cabeçalho/rodapé depois. */
  private ops(page?: number): string[] {
    const p = this.pages[page ?? this.pages.length - 1]
    if (!p) throw new Error('Página inexistente')
    return p
  }

  text(x: number, y: number, text: string, opts: { size?: number; font?: PdfFont; color?: Rgb; align?: 'left' | 'right' | 'center'; page?: number } = {}): void {
    const size = opts.size ?? 10
    const font = opts.font ?? 'regular'
    const bytes = toWinAnsi(text)
    const w = (widthUnits(bytes, font) * size) / 1000
    const left = opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x
    const baseline = this.height - y - size * 0.8
    this.ops(opts.page).push(
      `BT ${rgb(opts.color ?? [17, 24, 39], 'rg')} /${font === 'bold' ? 'F2' : 'F1'} ${num(size)} Tf ${num(left)} ${num(baseline)} Td ${pdfString(bytes)} Tj ET`,
    )
  }

  line(x1: number, y1: number, x2: number, y2: number, opts: { width?: number; color?: Rgb; page?: number } = {}): void {
    this.ops(opts.page).push(
      `${rgb(opts.color ?? [17, 24, 39], 'RG')} ${num(opts.width ?? 0.75)} w ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`,
    )
  }

  rect(x: number, y: number, w: number, h: number, opts: { fill?: Rgb; stroke?: Rgb; width?: number; page?: number }): void {
    const parts: string[] = []
    if (opts.fill) parts.push(rgb(opts.fill, 'rg'))
    if (opts.stroke) parts.push(`${rgb(opts.stroke, 'RG')} ${num(opts.width ?? 0.75)} w`)
    parts.push(`${num(x)} ${num(this.height - y - h)} ${num(w)} ${num(h)} re`)
    parts.push(opts.fill && opts.stroke ? 'B' : opts.fill ? 'f' : 'S')
    this.ops(opts.page).push(parts.join(' '))
  }

  /** Desenha uma imagem JPEG; registre a mesma imagem uma vez e reutilize o índice. */
  addImage(img: PdfJpeg): number {
    this.images.push(img)
    return this.images.length - 1
  }

  image(index: number, x: number, y: number, w: number, h: number, page?: number): void {
    if (!this.images[index]) throw new Error('Imagem não registrada')
    this.ops(page).push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.height - y - h)} cm /Im${index} Do Q`)
  }

  /** Monta o arquivo PDF. */
  output(): Uint8Array {
    const chunks: Uint8Array[] = []
    const offsets: number[] = []
    let length = 0
    const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)
    const push = (b: Uint8Array) => {
      chunks.push(b)
      length += b.length
    }
    const obj = (id: number, body: string | Uint8Array[]) => {
      offsets[id] = length
      if (typeof body === 'string') push(enc(`${id} 0 obj\n${body}\nendobj\n`))
      else {
        push(enc(`${id} 0 obj\n`))
        body.forEach(push)
        push(enc('\nendobj\n'))
      }
    }

    // 1 catálogo, 2 árvore de páginas, 3/4 fontes, depois imagens, páginas e conteúdos.
    const imageBase = 5
    const pageBase = imageBase + this.images.length
    const pageIds = this.pages.map((_, i) => pageBase + i * 2)

    push(enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'))
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
    obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    this.images.forEach((img, i) => {
      obj(imageBase + i, [
        enc(
          `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`,
        ),
        img.data,
        enc('\nendstream'),
      ])
    })
    const xobjects = this.images.map((_, i) => `/Im${i} ${imageBase + i} 0 R`).join(' ')
    this.pages.forEach((ops, i) => {
      const pageId = pageIds[i] as number
      const content = enc(ops.join('\n'))
      obj(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >> /Contents ${pageId + 1} 0 R >>`,
      )
      obj(pageId + 1, [enc(`<< /Length ${content.length} >>\nstream\n`), content, enc('\nendstream')])
    })

    const count = pageBase + this.pages.length * 2
    const xrefAt = length
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
    for (let id = 1; id < count; id++) xref += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`
    push(enc(`${xref}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`))

    const out = new Uint8Array(length)
    let at = 0
    for (const c of chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  }
}

/** Lê largura e altura de um JPEG (marcador SOF). */
export function jpegSize(data: Uint8Array): { width: number; height: number } {
  let i = 2
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) {
      i++
      continue
    }
    const marker = data[i + 1] as number
    const len = ((data[i + 2] as number) << 8) | (data[i + 3] as number)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: ((data[i + 5] as number) << 8) | (data[i + 6] as number), width: ((data[i + 7] as number) << 8) | (data[i + 8] as number) }
    }
    i += 2 + len
  }
  throw new Error('JPEG inválido')
}
