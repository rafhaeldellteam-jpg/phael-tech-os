import type { Json } from '@/lib/database.types'

export const entityLabels: Record<string, string> = {
  companies: 'Empresa',
  company_members: 'Membro',
  member_permission_overrides: 'Permissão individual',
  company_invitations: 'Convite',
  clients: 'Cliente',
  client_sensitive: 'Dados restritos de cliente',
  equipment: 'Equipamento',
  service_orders: 'Ordem de serviço',
  service_catalog: 'Serviço do catálogo',
  suppliers: 'Fornecedor',
  products: 'Produto',
  purchases: 'Compra',
  service_order_items: 'Item de OS',
  finance_accounts: 'Conta financeira',
  finance_categories: 'Categoria financeira',
  finance_entries: 'Lançamento financeiro',
  finance_payments: 'Pagamento',
}

export const actionLabels: Record<string, string> = {
  insert: 'Criou',
  update: 'Alterou',
  delete: 'Removeu',
  export: 'Exportou',
}

const fieldLabels: Record<string, string> = {
  name: 'nome',
  legal_name: 'razão social',
  tax_id: 'CPF/CNPJ',
  email: 'e-mail',
  phone: 'telefone',
  role: 'papel',
  status: 'situação',
  granted: 'concedida',
  permission_key: 'permissão',
  revoked_at: 'cancelado em',
  accepted_at: 'aceito em',
  timezone: 'fuso horário',
  kind: 'tipo',
  trade_name: 'nome fantasia',
  whatsapp: 'WhatsApp',
  preferred_channel: 'canal preferido',
  zip_code: 'CEP',
  street: 'rua',
  street_number: 'número',
  complement: 'complemento',
  district: 'bairro',
  city: 'cidade',
  state: 'UF',
  marketing_consent: 'aceita avisos',
  consent_updated_at: 'consentimento em',
  has_tax_id: 'tem CPF/CNPJ',
  archived_at: 'arquivado em',
  internal_notes: 'observações internas',
  client_id: 'cliente',
  type: 'tipo',
  manufacturer: 'fabricante',
  model: 'modelo',
  serial_number: 'número de série',
  asset_tag: 'patrimônio',
  processor: 'processador',
  memory: 'memória',
  storage: 'armazenamento',
  graphics: 'placa de vídeo',
  operating_system: 'sistema operacional',
  condition_notes: 'condições físicas',
  accessories: 'acessórios',
  priority: 'prioridade',
  assigned_to: 'responsável',
  reported_problem: 'problema relatado',
  symptoms: 'sintomas',
  intake_condition: 'condições na entrada',
  intake_accessories: 'acessórios na entrada',
  device_password_note: 'acesso ao sistema',
  due_at: 'prazo',
  ready_at: 'pronta em',
  delivered_at: 'entregue em',
  closed_at: 'encerrada em',
  intake_terms: 'termo de entrada',
  delivery_terms: 'termo de entrega',
  price_cents: 'preço (centavos)',
  cost_cents: 'custo (centavos)',
  min_qty: 'estoque mínimo',
  qty_on_hand: 'saldo',
  sku: 'SKU',
  active: 'ativo',
  returned_at: 'removido em',
  returned_reason: 'motivo da remoção',
  received_at: 'recebida em',
  invoice_number: 'nota fiscal',
  amount_cents: 'valor (centavos)',
  paid_cents: 'pago (centavos)',
  canceled_at: 'cancelado em',
  cancel_reason: 'motivo do cancelamento',
  opening_balance_cents: 'saldo inicial (centavos)',
}

function show(value: Json | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Resumo legível das alterações de um registro de auditoria. */
export function summarizeChanges(action: string, changes: Json): string[] {
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) return []
  if (action !== 'update') return []
  return Object.entries(changes).map(([field, diff]) => {
    const label = fieldLabels[field] ?? field
    if (diff && typeof diff === 'object' && !Array.isArray(diff)) {
      const d = diff as { old?: Json; new?: Json }
      return `${label}: ${show(d.old)} → ${show(d.new)}`
    }
    return `${label}: ${show(diff as Json)}`
  })
}
