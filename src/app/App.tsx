import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { RouterProvider } from 'react-router'
import { AuthProvider } from '@/core/auth/AuthProvider'
import { useAuth } from '@/core/auth/useAuth'
import { CompanyProvider } from '@/core/company/CompanyProvider'
import { envResult } from '@/lib/env'
import { ConfigMissing } from './ConfigMissing'
import { createQueryClient } from './query-client'
import { router } from './router'

function DataLayer() {
  const { markSessionExpired, user } = useAuth()
  const [queryClient] = useState(() => createQueryClient(() => void markSessionExpired()))
  // Troca de usuário: nenhum dado do usuário anterior pode permanecer em cache.
  const [lastUser, setLastUser] = useState(user?.id)
  if (lastUser !== user?.id) {
    queryClient.clear()
    setLastUser(user?.id)
  }
  return (
    <QueryClientProvider client={queryClient}>
      <CompanyProvider>
        <RouterProvider router={router} />
      </CompanyProvider>
    </QueryClientProvider>
  )
}

export function App() {
  if (!envResult.ok) return <ConfigMissing problems={envResult.problems} />
  return (
    <AuthProvider>
      <DataLayer />
    </AuthProvider>
  )
}
