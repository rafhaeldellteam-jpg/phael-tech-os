import { Lock } from 'lucide-react'
import { Outlet } from 'react-router'
import { EmptyState } from '@/components/ui/EmptyState'
import { useCompany } from '@/core/company/useCompany'
import type { AccessRequirement } from './permissions'

/** Bloqueia a rota na interface. O banco aplica a mesma regra de forma independente. */
export function RequirePermission({ anyOf }: { anyOf: AccessRequirement }) {
  const { can } = useCompany()
  if (!can(anyOf)) {
    return (
      <EmptyState icon={Lock} title="Acesso restrito">
        Seu papel nesta empresa não permite abrir esta área. Se precisar, peça ao administrador.
      </EmptyState>
    )
  }
  return <Outlet />
}
