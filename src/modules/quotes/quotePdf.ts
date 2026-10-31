import { formatCode, formatDate, formatDateTime, formatPhone } from '@/lib/format'
import { downloadBytes, loadLogoJpeg } from '@/lib/pdf/logo'
import { requireSupabase } from '@/lib/supabase'
import { formatIsoDate } from '../finance/period'
import { modeLabels } from '../orders/meta'
import { buildOrderPdf, NAVY } from '../orders/orderPdf'
import type { QuoteItem, QuoteRow } from './queries'

/** PDF do orçamento (mesmo layout dos comprovantes, com o logo no topo e no rodapé). */
export async function downloadQuotePdf(orderId: string, quote: QuoteRow): Promise<void> {
  const sb = requireSupabase()
  const [o, logo, diag] = await Promise.all([
    sb
      .from('service_orders')
      .select('number, mode, received_at, reported_problem, intake_condition, intake_accessories, company_id, client:clients!inner(name, whatsapp, phone, email), equipment:equipment(manufacturer, model, serial_number)')
      .eq('id', orderId)
      .single(),
    loadLogoJpeg('/brand/phael-logo.webp', NAVY),
    sb.from('order_diagnostics').select('summary').eq('order_id', orderId).not('finalized_at', 'is', null).order('finalized_at', { ascending: false }).limit(1),
  ])
  if (o.error) throw o.error
  const order = o.data as unknown as {
    number: number
    mode: keyof typeof modeLabels
    received_at: string
    reported_problem: string
    intake_condition: string | null
    intake_accessories: string[]
    company_id: string
    client: { name: string; whatsapp: string | null; phone: string | null; email: string | null }
    equipment: { manufacturer: string | null; model: string | null; serial_number: string | null } | null
  }
  const c = await sb.from('companies').select('name, phone, email').eq('id', order.company_id).single()
  if (c.error) throw c.error
  const items = (quote.items as unknown as QuoteItem[]) ?? []
  const services = items.filter((i) => i.kind === 'service').reduce((a, i) => a + i.qty * i.unit_price_cents, 0)
  const parts = items.filter((i) => i.kind === 'part').reduce((a, i) => a + i.qty * i.unit_price_cents, 0)
  const discount = items.reduce((a, i) => a + i.discount_cents, 0)
  const code = formatCode('OS', order.number)
  const decision =
    quote.status === 'approved'
      ? `Aprovado por ${quote.decided_by_name ?? 'cliente'} em ${quote.decided_at ? formatDateTime(quote.decided_at) : ''}${quote.decided_via === 'portal' ? ' (portal do cliente)' : ''}.`
      : quote.status === 'refused'
        ? `Recusado por ${quote.decided_by_name ?? 'cliente'} em ${quote.decided_at ? formatDateTime(quote.decided_at) : ''}.`
        : null

  const bytes = buildOrderPdf(
    {
      kind: 'quote',
      quote: {
        version: quote.version,
        validUntil: quote.valid_until ? formatIsoDate(quote.valid_until) : null,
        deliveryDays: quote.delivery_days,
        notes: quote.notes,
        status: quote.status,
        decision,
        diagnosis: diag.data?.[0]?.summary ?? null,
      },
      company: {
        name: c.data.name,
        legal_name: null,
        taxIdLabel: null,
        contact: [c.data.phone && formatPhone(c.data.phone), c.data.email].filter(Boolean).join('   ·   ') || null,
      },
      order: {
        code,
        receivedAt: formatDateTime(order.received_at),
        deliveredAt: null,
        dueAt: null,
        statusLabel: '',
        modeLabel: modeLabels[order.mode],
        reportedProblem: order.reported_problem,
        intakeCondition: order.intake_condition,
        accessories: order.intake_accessories,
      },
      client: { name: order.client.name, contact: formatPhone(order.client.whatsapp ?? order.client.phone) || order.client.email },
      equipment: {
        title: order.equipment ? [order.equipment.manufacturer, order.equipment.model].filter(Boolean).join(' ') || null : null,
        serial: order.equipment?.serial_number ?? null,
      },
      items: items.map((i) => ({
        description: i.description + (i.warranty_days ? ` (garantia de ${i.warranty_days} dias)` : ''),
        qty: i.qty,
        unitCents: i.unit_price_cents,
        discountCents: i.discount_cents,
        kindLabel: i.kind === 'part' ? 'Peça' : 'Serviço',
      })),
      totals: { servicesCents: services, partsCents: parts, discountCents: discount, totalCents: quote.total_cents },
      warranties: [],
      terms: null,
      generatedAt: formatDateTime(new Date().toISOString()),
    },
    { header: logo, footer: logo },
  )
  downloadBytes(bytes, `${code}-orcamento-v${quote.version}${quote.sent_at ? `-${formatDate(quote.sent_at).replace(/\//g, '-')}` : ''}.pdf`)
}
