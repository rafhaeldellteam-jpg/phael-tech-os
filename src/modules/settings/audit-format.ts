import type { Json } from '@/lib/database.types'

export const entityLabels: Record<string, string> = {
  companies: 'Empresa',
  company_members: 'Membro',
  member_permission_overrides: 'Permissão individual',
  company_invitations: 'Convite',
}

export const actionLabels: Record<string, string> = {
  insert: 'Criou',
  update: 'Alterou',
  delete: 'Removeu',
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
