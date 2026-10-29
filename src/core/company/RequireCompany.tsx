import { Navigate, Outlet } from 'react-router'
import { ErrorState } from '@/components/ui/ErrorState'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useCompany } from './useCompany'

/** Usuário autenticado sem empresa vai para o onboarding. */
export function RequireCompany() {
  const { active, loading, error, refresh } = useCompany()
  if (loading) return <FullPageSpinner label="Carregando empresa" />
  if (error) return <ErrorState error={error} onRetry={refresh} fullPage />
  if (!active) return <Navigate to="/bem-vindo" replace />
  return <Outlet />
}
