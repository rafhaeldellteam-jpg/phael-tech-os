import { useMutation } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/core/auth/useAuth'
import { useCompany } from '@/core/company/useCompany'
import { toUserMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { AuthLayout } from './AuthLayout'

/** Rota protegida: o usuário já está logado com o e-mail convidado. */
export function AcceptInvitePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { user } = useAuth()
  const { refresh, selectCompany } = useCompany()
  const navigate = useNavigate()

  const accept = useMutation({
    mutationFn: async () => {
      const { data, error } = await requireSupabase().rpc('accept_invitation', { p_token: token })
      if (error) throw error
      return data
    },
    onSuccess: async (companyId) => {
      await refresh()
      selectCompany(companyId)
      navigate('/', { replace: true })
    },
  })

  return (
    <AuthLayout
      title="Convite para equipe"
      description={<>Você entrará na empresa com a conta <strong>{user?.email}</strong>.</>}
    >
      {!/^[0-9a-f]{64}$/.test(token) ? (
        <Alert tone="error">O link do convite está incompleto. Peça ao administrador para enviá-lo de novo.</Alert>
      ) : (
        <>
          {accept.isError && <Alert tone="error">{toUserMessage(accept.error)}</Alert>}
          <Button onClick={() => accept.mutate()} loading={accept.isPending}>
            Aceitar convite
          </Button>
          <p className="text-sm text-muted">
            O convite só funciona para o e-mail convidado. Se for outra conta, saia e entre com o e-mail correto.
          </p>
        </>
      )}
    </AuthLayout>
  )
}
