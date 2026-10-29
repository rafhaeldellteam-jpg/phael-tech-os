import { Navigate, Outlet, useLocation } from 'react-router'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useAuth } from './useAuth'

/** Protege rotas que exigem login. Preserva o destino para voltar após entrar. */
export function RequireAuth() {
  const { user, loading, passwordRecovery } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageSpinner label="Verificando sessão" />
  if (passwordRecovery) return <Navigate to="/redefinir-senha" replace />
  if (!user) {
    const from = location.pathname + location.search
    return <Navigate to="/entrar" replace state={{ from }} />
  }
  return <Outlet />
}

/** Para páginas públicas (login, cadastro): quem já entrou vai para o painel. */
export function RedirectIfAuthenticated() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageSpinner label="Verificando sessão" />
  if (user) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from.startsWith('/') && !from.startsWith('//') ? from : '/'} replace />
  }
  return <Outlet />
}
