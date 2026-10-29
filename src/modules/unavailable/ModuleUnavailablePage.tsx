import { Construction } from 'lucide-react'
import { Navigate, useLocation } from 'react-router'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { useCompany } from '@/core/company/useCompany'
import { findNavItem, isAvailable } from '@/core/permissions/navigation'

const phaseNames: Record<number, string> = {
  2: 'Operação principal',
  3: 'Gestão',
  4: 'Expansão',
  5: 'Preparação comercial',
}

/** Página explícita para módulos ainda não implementados (sem botões decorativos). */
export function ModuleUnavailablePage() {
  const { pathname } = useLocation()
  const { can } = useCompany()
  const item = findNavItem(pathname)

  if (!item || isAvailable(item)) return <Navigate to="/" replace />
  if (!can(item.requires)) return <Navigate to="/" replace />

  return (
    <div className="grid gap-6">
      <PageHeader title={item.label} />
      <EmptyState icon={Construction} title="Módulo ainda não disponível">
        Este módulo será entregue na Fase {item.phase} ({phaseNames[item.phase]}). Nada aqui é simulado: quando ele
        estiver pronto, os dados virão direto do banco da sua empresa.
      </EmptyState>
    </div>
  )
}
