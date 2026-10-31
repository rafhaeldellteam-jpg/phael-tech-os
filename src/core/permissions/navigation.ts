import {
  Activity,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  ClipboardList,
  FileSignature,
  Globe,
  Laptop,
  LayoutDashboard,
  Repeat,
  ScrollText,
  ShieldCheck,
  Stethoscope,
  Tags,
  Truck,
  type LucideIcon,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { canAny, type AccessRequirement } from './permissions'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  requires: AccessRequirement
  /** Fase do roadmap a que o módulo pertence. */
  phase: number
  /** true quando o módulo já está implementado; os demais aparecem como indisponíveis. */
  ready?: boolean
}

export interface NavSection {
  label: string
  items: NavItem[]
}

/** Fase em andamento (usada no painel). */
export const CURRENT_PHASE = 4

export const navigation: NavSection[] = [
  {
    label: 'Operação',
    items: [
      { path: '/', label: 'Painel', icon: LayoutDashboard, requires: [], phase: 1, ready: true },
      { path: '/ordens', label: 'Ordens de serviço', icon: ClipboardList, requires: ['orders.read_all', 'orders.read_assigned'], phase: 2, ready: true },
      { path: '/clientes', label: 'Clientes', icon: UsersRound, requires: ['clients.read'], phase: 2, ready: true },
      { path: '/equipamentos', label: 'Equipamentos', icon: Laptop, requires: ['equipment.read'], phase: 2, ready: true },
      { path: '/diagnosticos', label: 'Diagnósticos', icon: Stethoscope, requires: ['diagnostics.write'], phase: 2 },
      { path: '/orcamentos', label: 'Orçamentos', icon: FileSignature, requires: ['quotes.read'], phase: 2 },
      { path: '/agenda', label: 'Agenda', icon: CalendarDays, requires: ['schedule.read'], phase: 3, ready: true },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { path: '/servicos', label: 'Catálogo de serviços', icon: Tags, requires: ['catalog.read'], phase: 3, ready: true },
      { path: '/estoque', label: 'Estoque e peças', icon: Boxes, requires: ['inventory.read'], phase: 3, ready: true },
      { path: '/fornecedores', label: 'Fornecedores e compras', icon: Truck, requires: ['suppliers.write', 'inventory.write'], phase: 3, ready: true },
      { path: '/financeiro', label: 'Financeiro', icon: Wallet, requires: ['finance.read'], phase: 3, ready: true },
      { path: '/garantias', label: 'Garantias', icon: ShieldCheck, requires: ['orders.read_all', 'orders.read_assigned'], phase: 3, ready: true },
      { path: '/sites', label: 'Sites e serviços digitais', icon: Globe, requires: ['clients.read'], phase: 4, ready: true },
      { path: '/contratos', label: 'Contratos recorrentes', icon: Repeat, requires: ['finance.read'], phase: 4, ready: true },
      { path: '/relatorios', label: 'Relatórios', icon: BarChart3, requires: ['reports.operational', 'reports.financial'], phase: 4, ready: true },
      { path: '/conhecimento', label: 'Base de conhecimento', icon: BookOpen, requires: ['knowledge.read'], phase: 4 },
    ],
  },
  {
    label: 'Empresa',
    items: [
      { path: '/empresa', label: 'Dados da empresa', icon: Building2, requires: ['company.read'], phase: 1, ready: true },
      { path: '/equipe', label: 'Equipe e permissões', icon: Users, requires: ['members.read'], phase: 1, ready: true },
      { path: '/auditoria', label: 'Auditoria', icon: ScrollText, requires: ['audit.read'], phase: 1, ready: true },
      { path: '/atividade', label: 'Automações', icon: Activity, requires: ['company.update', 'finance.write'], phase: 4, ready: true },
    ],
  },
]

/** Navegação visível para o usuário: remove itens sem permissão e seções vazias. */
export function visibleNavigation(granted: ReadonlySet<string>): NavSection[] {
  return navigation
    .map((s) => ({ ...s, items: s.items.filter((i) => canAny(granted, i.requires)) }))
    .filter((s) => s.items.length > 0)
}

export function isAvailable(item: NavItem): boolean {
  return item.ready === true
}

export function findNavItem(path: string): NavItem | undefined {
  return navigation.flatMap((s) => s.items).find((i) => i.path === path)
}
