import type { MemberRole } from '@/lib/database.types'

/** Chaves de permissão (espelham a tabela public.permissions). */
export type PermissionKey =
  | 'company.read'
  | 'company.update'
  | 'members.read'
  | 'members.manage'
  | 'audit.read'
  | 'clients.read'
  | 'clients.write'
  | 'clients.read_sensitive'
  | 'clients.export'
  | 'equipment.read'
  | 'equipment.write'
  | 'orders.read_all'
  | 'orders.read_assigned'
  | 'orders.create'
  | 'orders.update'
  | 'orders.deliver'
  | 'digital.write'
  | 'diagnostics.write'
  | 'quotes.read'
  | 'quotes.write'
  | 'quotes.record_decision'
  | 'catalog.read'
  | 'catalog.write'
  | 'inventory.read'
  | 'inventory.write'
  | 'suppliers.write'
  | 'finance.read'
  | 'finance.write'
  | 'schedule.read'
  | 'schedule.write'
  | 'reports.operational'
  | 'reports.financial'
  | 'knowledge.read'

/** Requisito de acesso: basta UMA das permissões listadas. */
export type AccessRequirement = readonly PermissionKey[]

/**
 * Verificação para a INTERFACE (mostrar/ocultar). A autorização real acontece
 * no banco; isto só evita oferecer ações que seriam negadas.
 */
export function canAny(granted: ReadonlySet<string>, required: AccessRequirement): boolean {
  if (required.length === 0) return true
  return required.some((p) => granted.has(p))
}

export const roleLabels: Record<MemberRole, string> = {
  admin: 'Administrador',
  technician: 'Técnico',
  finance: 'Financeiro',
  attendant: 'Atendente',
}

export const roleDescriptions: Record<MemberRole, string> = {
  admin: 'Acesso total, incluindo equipe, permissões e auditoria.',
  technician: 'Ordens atribuídas, diagnósticos, peças e base de conhecimento.',
  finance: 'Contas, pagamentos, despesas e relatórios financeiros.',
  attendant: 'Clientes, equipamentos, agenda e abertura de OS.',
}
