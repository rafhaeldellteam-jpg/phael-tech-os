import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { isAuthError } from '@/lib/errors'

/**
 * Cria o QueryClient. Erros de sessão (token expirado/revogado) em qualquer
 * consulta ou mutação disparam onSessionExpired, que encerra a sessão local e
 * leva o usuário ao login com aviso.
 */
export function createQueryClient(onSessionExpired: () => void): QueryClient {
  const handle = (error: unknown) => {
    if (isAuthError(error)) onSessionExpired()
  }
  return new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => !isAuthError(error) && count < 2,
      },
      mutations: { retry: false },
    },
  })
}
