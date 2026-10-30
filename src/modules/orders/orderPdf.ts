import { formatBRL } from '@/lib/money'
import { PdfDocument, wrapText, type PdfJpeg, type Rgb } from '@/lib/pdf/writer'

/** Dados do documento da OS (já formatados onde é texto livre). */
export interface OrderPdfData {
  kind: 'intake' | 'delivery'
  company: { name: string; legal_name: string | null; taxIdLabel: string | null; contact: string | null }
  order: {
    code: string
    receivedAt: string
    deliveredAt: string | null
    dueAt: string | null
    statusLabel: string
    modeLabel: string
    reportedProblem: string
    intakeCondition: string | null
    accessories: string[]
  }
  client: { name: string; contact: string | null }
  equipment: { title: string | null; serial: string | null }
  items: { description: string; qty: number; unitCents: number; discountCents: number; kindLabel: string }[]
  totals: { servicesCents: number; partsCents: number; discountCents: number; totalCents: number } | null
  warranties: { description: string; days: number; until: string }[]
  terms: string | null
  generatedAt: string
  /** Assinaturas eletrônicas já colhidas para este documento. */
  signatures?: { client?: SignedImage; company?: SignedImage }
}

export interface SignedImage {
  image: PdfJpeg
  name: string
  signedAt: string
}

export interface OrderPdfLogos {
  /** Logo completo sobre fundo azul-marinho (cabeçalho). */
  header: PdfJpeg
  /** Logo completo sobre fundo azul-marinho (rodapé). Pode ser o mesmo do cabeçalho. */
  footer: PdfJpeg
}

export const NAVY: Rgb = [8, 24, 58]
const BRAND: Rgb = [0, 64, 160]
const GREEN: Rgb = [140, 194, 31]
const INK: Rgb = [17, 24, 39]
const MUTED: Rgb = [90, 98, 112]
const RULE: Rgb = [210, 214, 222]
const ZEBRA: Rgb = [243, 245, 249]
const WHITE: Rgb = [255, 255, 255]

const M = 40 // margem lateral
const HEADER_H = 84
const FOOTER_H = 52

export function buildOrderPdf(data: OrderPdfData, logos: OrderPdfLogos): Uint8Array {
  const doc = new PdfDocument()
  const W = doc.width
  const H = doc.height
  const contentW = W - 2 * M
  const headerImg = doc.addImage(logos.header)
  const footerImg = logos.footer === logos.header ? headerImg : doc.addImage(logos.footer)
  const title = data.kind === 'intake' ? 'Comprovante de entrada' : 'Comprovante de entrega'
  const bottomLimit = H - FOOTER_H - 24
  let y = 0

  const drawHeader = () => {
    doc.rect(0, 0, W, HEADER_H, { fill: NAVY })
    doc.rect(0, HEADER_H, W, 3, { fill: GREEN })
    const logoH = 60
    const logoW = (logos.header.width / logos.header.height) * logoH
    doc.image(headerImg, M - 6, (HEADER_H - logoH) / 2, logoW, logoH)
    doc.text(W - M, 16, title.toUpperCase(), { size: 9, font: 'bold', color: GREEN, align: 'right' })
    doc.text(W - M, 30, data.order.code, { size: 20, font: 'bold', color: WHITE, align: 'right' })
    const dates = [`Entrada: ${data.order.receivedAt}`]
    if (data.kind === 'delivery' && data.order.deliveredAt) dates.push(`Entrega: ${data.order.deliveredAt}`)
    doc.text(W - M, 58, dates.join('   '), { size: 8.5, color: WHITE, align: 'right' })
    y = HEADER_H + 18
  }

  const newPage = () => {
    doc.addPage()
    drawHeader()
  }
  const ensure = (h: number) => {
    if (y + h > bottomLimit) newPage()
  }

  const section = (label: string) => {
    ensure(34)
    y += 6
    doc.text(M, y, label.toUpperCase(), { size: 8.5, font: 'bold', color: BRAND })
    y += 13
    doc.line(M, y, W - M, y, { color: RULE, width: 0.6 })
    y += 7
  }

  const paragraph = (text: string, opts: { size?: number; color?: Rgb; x?: number; width?: number } = {}) => {
    const size = opts.size ?? 9.5
    const x = opts.x ?? M
    const lines = wrapText(text, opts.width ?? contentW, size)
    const lh = size * 1.35
    for (const l of lines) {
      ensure(lh)
      doc.text(x, y, l, { size, color: opts.color ?? INK })
      y += lh
    }
  }

  /** Pares rótulo/valor em duas colunas. */
  const fields = (pairs: [string, string | null][]) => {
    const colW = (contentW - 20) / 2
    for (let i = 0; i < pairs.length; i += 2) {
      const row = pairs.slice(i, i + 2)
      const heights = row.map(([, v]) => wrapText(v || 'Não informado', colW, 9.5).length * 12.8 + 12)
      const h = Math.max(...heights)
      ensure(h)
      row.forEach(([label, value], c) => {
        const x = M + c * (colW + 20)
        doc.text(x, y, label, { size: 7.5, color: MUTED })
        wrapText(value || 'Não informado', colW, 9.5).forEach((l, n) => doc.text(x, y + 11 + n * 12.8, l, { size: 9.5, color: value ? INK : MUTED }))
      })
      y += h + 4
    }
  }

  drawHeader()

  // Empresa (nome fantasia; a razão social não aparece no comprovante)
  doc.text(M, y, data.company.name, { size: 11, font: 'bold' })
  y += 15
  const companyLine = [data.company.taxIdLabel, data.company.contact].filter(Boolean).join('   ·   ')
  if (companyLine) {
    doc.text(M, y, companyLine, { size: 8.5, color: MUTED })
    y += 12
  }
  y += 4

  section('Cliente e equipamento')
  fields([
    ['Cliente', data.client.name],
    ['Contato', data.client.contact],
    ['Equipamento', data.equipment.title ?? 'Atendimento sem equipamento'],
    ['Nº de série', data.equipment.serial],
    ['Tipo de atendimento', data.order.modeLabel],
    [data.kind === 'intake' ? 'Previsão' : 'Situação na entrega', data.kind === 'intake' ? data.order.dueAt : data.order.statusLabel],
  ])

  section('Problema e condições de entrada')
  doc.text(M, y, 'Problema relatado', { size: 7.5, color: MUTED })
  y += 11
  paragraph(data.order.reportedProblem)
  y += 4
  fields([
    ['Condições na entrada', data.order.intakeCondition ?? 'Não registradas'],
    ['Acessórios recebidos', data.order.accessories.length ? data.order.accessories.join(', ') : 'Nenhum'],
  ])

  if (data.items.length > 0) {
    section('Serviços e peças')
    const cols = { desc: M + 6, qty: M + contentW - 190, unit: M + contentW - 100, total: W - M - 6 }
    const descW = cols.qty - cols.desc - 36
    ensure(20)
    doc.rect(M, y - 2, contentW, 18, { fill: ZEBRA })
    doc.text(cols.desc, y + 2, 'Descrição', { size: 8, font: 'bold', color: MUTED })
    doc.text(cols.qty, y + 2, 'Qtd.', { size: 8, font: 'bold', color: MUTED, align: 'right' })
    doc.text(cols.unit, y + 2, 'Unitário', { size: 8, font: 'bold', color: MUTED, align: 'right' })
    doc.text(cols.total, y + 2, 'Total', { size: 8, font: 'bold', color: MUTED, align: 'right' })
    y += 22
    for (const it of data.items) {
      const lines = wrapText(it.description, descW, 9.5)
      const h = lines.length * 12.5 + (it.discountCents ? 11 : 0) + 8
      ensure(h)
      lines.forEach((l, n) => doc.text(cols.desc, y + n * 12.5, l, { size: 9.5 }))
      const sub = it.qty * it.unitCents - it.discountCents
      doc.text(cols.qty, y, String(it.qty), { size: 9.5, align: 'right' })
      doc.text(cols.unit, y, formatBRL(it.unitCents), { size: 9.5, align: 'right' })
      doc.text(cols.total, y, formatBRL(sub), { size: 9.5, align: 'right', font: 'bold' })
      doc.text(cols.desc, y + lines.length * 12.5, it.kindLabel + (it.discountCents ? `, desconto de ${formatBRL(it.discountCents)}` : ''), {
        size: 7.5,
        color: MUTED,
      })
      y += h + 4
      doc.line(M, y - 4, W - M, y - 4, { color: RULE, width: 0.4 })
    }
    if (data.totals) {
      const t = data.totals
      const rows: [string, number, boolean][] = [
        ['Serviços', t.servicesCents, false],
        ['Peças', t.partsCents, false],
      ]
      if (t.discountCents) rows.push(['Descontos', -t.discountCents, false])
      rows.push(['Total', t.totalCents, true])
      ensure(rows.length * 15 + 8)
      y += 2
      for (const [label, value, strong] of rows) {
        doc.text(cols.unit, y, label, { size: strong ? 10.5 : 9, font: strong ? 'bold' : 'regular', color: strong ? INK : MUTED, align: 'right' })
        doc.text(cols.total, y, formatBRL(value), { size: strong ? 10.5 : 9, font: strong ? 'bold' : 'regular', align: 'right' })
        y += strong ? 16 : 13
      }
    }
  }

  if (data.kind === 'delivery' && data.warranties.length > 0) {
    section('Garantia (contada a partir da entrega)')
    for (const w of data.warranties) {
      paragraph(`${w.description}: ${w.days} dias, válida até ${w.until}`)
    }
  }

  if (data.terms) {
    section(data.kind === 'intake' ? 'Termos de entrada' : 'Termos de entrega')
    paragraph(data.terms, { size: 8.5, color: MUTED })
  }

  // Assinaturas (desenhadas acima da linha quando já colhidas)
  const SIG_H = 46
  ensure(SIG_H + 70)
  y += SIG_H + 18
  const sigW = (contentW - 40) / 2
  const slots: { x: number; sig: SignedImage | undefined; name: string; role: string }[] = [
    { x: M, sig: data.signatures?.client, name: data.client.name, role: 'Cliente' },
    { x: W - M - sigW, sig: data.signatures?.company, name: data.company.name, role: 'Responsável técnico' },
  ]
  for (const s of slots) {
    if (s.sig) {
      const ratio = s.sig.image.width / s.sig.image.height
      const h = Math.min(SIG_H, (sigW - 20) / ratio)
      const w = h * ratio
      doc.image(doc.addImage(s.sig.image), s.x + (sigW - w) / 2, y - h - 2, w, h)
    }
    doc.line(s.x, y, s.x + sigW, y, { color: INK, width: 0.6 })
    doc.text(s.x + sigW / 2, y + 5, s.sig?.name ?? s.name, { size: 8.5, align: 'center' })
    doc.text(s.x + sigW / 2, y + 16, s.role, { size: 7.5, color: MUTED, align: 'center' })
    if (s.sig) {
      doc.text(s.x + sigW / 2, y + 26, `Assinado eletronicamente em ${s.sig.signedAt}`, { size: 6.5, color: MUTED, align: 'center' })
    }
  }
  y += 34

  // Rodapé com o logo em todas as páginas.
  const total = doc.pageCount
  for (let p = 0; p < total; p++) {
    const top = H - FOOTER_H
    doc.rect(0, top - 3, W, 3, { fill: GREEN, page: p })
    doc.rect(0, top, W, FOOTER_H, { fill: NAVY, page: p })
    const logoH = 38
    const logoW = (logos.footer.width / logos.footer.height) * logoH
    doc.image(footerImg, M - 4, top + (FOOTER_H - logoH) / 2, logoW, logoH, p)
    doc.text(W - M, top + 14, `${data.order.code}   ·   Página ${p + 1} de ${total}`, { size: 8, color: WHITE, align: 'right', page: p })
    doc.text(W - M, top + 28, `Gerado pelo Phael Tech OS em ${data.generatedAt}`, { size: 7, color: [190, 200, 220], align: 'right', page: p })
  }

  return doc.output()
}
