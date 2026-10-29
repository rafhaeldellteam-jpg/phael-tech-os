import { BrandLogo } from '@/components/ui/BrandLogo'
import { formatCode, formatDateTime, formatPhone } from '@/lib/format'
import { formatTaxId } from '@/lib/tax-id'
import { formatIsoDate } from '../finance/period'

export interface ReceiptData {
  kind: 'intake' | 'delivery'
  company: { name: string; legal_name: string | null; tax_id: string | null; phone: string | null; email: string | null }
  terms: string | null
  order: {
    number: number
    received_at: string
    delivered_at: string | null
    reported_problem: string
    intake_condition: string | null
    intake_accessories: string[]
    due_at: string | null
    statusLabel: string
  }
  client: { name: string; whatsapp: string | null; phone: string | null }
  equipment: string | null
  serial: string | null
  /** Prazos de garantia (só no comprovante de entrega). */
  warranties?: { description: string; warranty_days: number; expires_on: string }[]
}

/**
 * Comprovante de entrada ou de entrega, para imprimir e colher assinatura.
 * Fica oculto na tela e aparece só na impressão (classe print-area).
 */
export function OrderReceipt({ data }: { data: ReceiptData }) {
  const { company, order, client } = data
  const title = data.kind === 'intake' ? 'Comprovante de entrada' : 'Comprovante de entrega'
  const contact = [company.phone && formatPhone(company.phone), company.email].filter(Boolean).join(', ')
  return (
    <div className="print-area hidden w-[180mm] p-2 text-[12px] leading-snug text-black print:block">
      <header className="flex items-start justify-between gap-4 border-b border-black pb-2">
        <div className="flex items-center gap-3">
          <BrandLogo variant="shield" className="size-12" />
          <div>
            <p className="text-base font-bold">{company.legal_name ?? company.name}</p>
            {company.tax_id && <p>{company.tax_id.length === 14 ? 'CNPJ' : 'CPF'} {formatTaxId(company.tax_id)}</p>}
            {contact && <p>{contact}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-base font-bold">{title}</p>
          <p className="text-lg font-bold tabular-nums">{formatCode('OS', order.number)}</p>
          <p>Entrada: {formatDateTime(order.received_at)}</p>
          {data.kind === 'delivery' && order.delivered_at && <p>Entrega: {formatDateTime(order.delivered_at)}</p>}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-x-6 gap-y-1 border-b border-black py-2">
        <p>
          <strong>Cliente:</strong> {client.name}
        </p>
        <p>
          <strong>Contato:</strong> {formatPhone(client.whatsapp ?? client.phone) || '—'}
        </p>
        <p>
          <strong>Equipamento:</strong> {data.equipment ?? 'Atendimento sem equipamento'}
        </p>
        <p>
          <strong>Nº de série:</strong> {data.serial ?? '—'}
        </p>
      </section>

      <section className="grid gap-1 border-b border-black py-2">
        <p>
          <strong>Problema relatado:</strong> {order.reported_problem}
        </p>
        <p>
          <strong>Condições na entrada:</strong> {order.intake_condition ?? 'Não registradas'}
        </p>
        <p>
          <strong>Acessórios:</strong> {order.intake_accessories.length ? order.intake_accessories.join(', ') : 'Nenhum'}
        </p>
        {data.kind === 'intake' && order.due_at && (
          <p>
            <strong>Previsão:</strong> {formatDateTime(order.due_at)}
          </p>
        )}
        {data.kind === 'delivery' && (
          <p>
            <strong>Situação na entrega:</strong> {order.statusLabel}
          </p>
        )}
      </section>

      {data.kind === 'delivery' && data.warranties && data.warranties.length > 0 && (
        <section className="border-b border-black py-2">
          <p className="font-bold">Garantia (contada a partir da entrega)</p>
          <ul>
            {data.warranties.map((w, i) => (
              <li key={i}>
                {w.description}: {w.warranty_days} dias, válida até {formatIsoDate(w.expires_on)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.terms && <section className="border-b border-black py-2 whitespace-pre-line">{data.terms}</section>}

      <footer className="mt-10 grid grid-cols-2 gap-10">
        <div className="border-t border-black pt-1 text-center">{client.name}</div>
        <div className="border-t border-black pt-1 text-center">{company.name}</div>
      </footer>
    </div>
  )
}
