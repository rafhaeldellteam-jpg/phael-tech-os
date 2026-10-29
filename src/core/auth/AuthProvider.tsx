import type { Session, User } from '@supabase/supabase-js'
import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'

export interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  /** true quando a sessão terminou sem o usuário pedir (token expirado/revogado). */
  sessionExpired: boolean
  /** true quando o usuário chegou pelo link de recuperação de senha. */
  passwordRecovery: boolean
  signOut: () => Promise<void>
  markSessionExpired: () => Promise<void>
  clearRecovery: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [sessionExpired, setSessionExpired] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const userInitiatedSignOut = useRef(false)
  const hadSession = useRef(false)

  useEffect(() => {
    if (!supabase) return
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      hadSession.current = Boolean(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      if (event === 'SIGNED_OUT') {
        if (hadSession.current && !userInitiatedSignOut.current) setSessionExpired(true)
        userInitiatedSignOut.current = false
      }
      if (event === 'SIGNED_IN') setSessionExpired(false)
      hadSession.current = Boolean(next)
      setSession(next)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    userInitiatedSignOut.current = true
    setSessionExpired(false)
    await supabase.auth.signOut()
  }, [])

  const markSessionExpired = useCallback(async () => {
    if (!supabase) return
    setSessionExpired(true)
    // scope local: limpa a sessão deste navegador mesmo se o servidor recusar o token.
    await supabase.auth.signOut({ scope: 'local' })
  }, [])

  const clearRecovery = useCallback(() => setPasswordRecovery(false), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      sessionExpired,
      passwordRecovery,
      signOut,
      markSessionExpired,
      clearRecovery,
    }),
    [session, loading, sessionExpired, passwordRecovery, signOut, markSessionExpired, clearRecovery],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
