import type { ServiceMode } from '@/lib/database.types'
import { formatCode, formatDateTime, formatPhone } from '@/lib/format'
import { downloadBytes, loadLogoJpeg } from '@/lib/pdf/logo'
import { requireSupabase } from '@/lib/supabase'
import { formatTaxId } from '@/lib/tax-id'
import { formatIsoDate } from '../finance/period'
import { modeLabels } from './meta'
import { buildOrderPdf, NAVY, type SignedImage } from './orderPdf'

export interface OrderPdfInput {
  kind: 'intake' | 'delivery'
  company: { name: string; legal_name: string | null; tax_id: string | null; phone: string | null; email: string | null; intake_terms: string | null; delivery_terms: string | null }
  order: {
    id: string
    number: number
    mode: ServiceMode
    received_at: string
    delivered_at: string | null
    due_at: string | null
    reported_problem: string
    intake_condition: string | null
    intake_accessories: string[]
  }
  statusLabel: string
  client: { name: string; whatsapp: string | null; phone: string | null; email: string | null }
  equipmentTitle: string | null
  serial: string | null
  warranties: { description: string; warranty_days: number; expires_on: string }[]
}

export interface OrderPdfParts {
  items: { kind: 'service' | 'part'; description: string; qty: number; unit_price_cents: number; discount_cents: number }[]
  totals: { services_cents: number; parts_cents: number; discount_cents: number; total_cents: number } | null
  signatures: { signer_role: 'client' | 'company'; signer_name: string; image_data: string; signed_at: string; channel?: string | null }[]
}

/** Busca itens, totais e assinaturas atuais, monta o PDF com o logo e baixa o arquivo. */
export async function downloadOrderPdf(input: OrderPdfInput): Promise<void> {
  const sb = requireSupabase()
  const [items, totals, sigs] = await Promise.all([
    sb
      .from('service_order_items')
      .select('kind, description, qty, unit_price_cents, discount_cents, returned_at, created_at')
      .eq('order_id', input.order.id)
      .is('returned_at', null)
      .order('created_at'),
    sb.rpc('service_order_totals', { p_order_id: input.order.id }),
    sb.from('order_signatures').select('signer_role, signer_name, image_data, signed_at, channel').eq('order_id', input.order.id).eq('document', input.kind),
  ])
  if (items.error) throw items.error
  if (totals.error) throw totals.error
  if (sigs.error) throw sigs.error
  const bytes = await renderOrderPdf(input, { items: items.data ?? [], totals: totals.data?.[0] ?? null, signatures: sigs.data ?? [] })
  downloadBytes(bytes, orderPdfFileName(input))
}

export function orderPdfFileName(input: Pick<OrderPdfInput, 'kind' | 'order'>): string {
  return `${formatCode('OS', input.order.number)}-${input.kind === 'intake' ? 'entrada' : 'entrega'}.pdf`
}

/** Monta o PDF (também usado na página pública de assinatura). */
export async function renderOrderPdf(input: OrderPdfInput, parts: OrderPdfParts): Promise<Uint8Array> {
  const logo = await loadLogoJpeg('/brand/phael-logo.webp', NAVY)
  const signed = async (role: 'client' | 'company'): Promise<SignedImage | undefined> => {
    const s = parts.signatures.find((x) => x.signer_role === role)
    if (!s) return undefined
    const when = formatDateTime(s.signed_at)
    return { image: await loadLogoJpeg(s.image_data, [255, 255, 255], 1), name: s.signer_name, signedAt: s.channel === 'remote_link' ? `${when} (pelo link)` : when }
  }
  const [clientSig, companySig] = await Promise.all([signed('client'), signed('company')])
  const t = parts.totals
  const c = input.company
  const code = formatCode('OS', input.order.number)

  const bytes = buildOrderPdf(
    {
      kind: input.kind,
      company: {
        name: c.name,
        legal_name: c.legal_name,
        taxIdLabel: c.tax_id ? `${c.tax_id.length === 14 ? 'CNPJ' : 'CPF'} ${formatTaxId(c.tax_id)}` : null,
        contact: [c.phone && formatPhone(c.phone), c.email].filter(Boolean).join('   ·   ') || null,
      },
      order: {
        code,
        receivedAt: formatDateTime(input.order.received_at),
        deliveredAt: input.order.delivered_at ? formatDateTime(input.order.delivered_at) : null,
        dueAt: input.order.due_at ? formatDateTime(input.order.due_at) : null,
        statusLabel: input.statusLabel,
        modeLabel: modeLabels[input.order.mode],
        reportedProblem: input.order.reported_problem,
        intakeCondition: input.order.intake_condition,
        accessories: input.order.intake_accessories,
      },
      client: { name: input.client.name, contact: formatPhone(input.client.whatsapp ?? input.client.phone) || input.client.email },
      equipment: { title: input.equipmentTitle, serial: input.serial },
      items: parts.items.map((i) => ({
        description: i.description,
        qty: i.qty,
        unitCents: i.unit_price_cents,
        discountCents: i.discount_cents,
        kindLabel: i.kind === 'part' ? 'Peça' : 'Serviço',
      })),
      totals: t ? { servicesCents: t.services_cents, partsCents: t.parts_cents, discountCents: t.discount_cents, totalCents: t.total_cents } : null,
      warranties: input.warranties.map((w) => ({ description: w.description, days: w.warranty_days, until: formatIsoDate(w.expires_on) })),
      terms: input.kind === 'intake' ? c.intake_terms : c.delivery_terms,
      generatedAt: formatDateTime(new Date().toISOString()),
      signatures: { client: clientSig, company: companySig },
    },
    { header: logo, footer: logo },
  )
  return bytes
}
