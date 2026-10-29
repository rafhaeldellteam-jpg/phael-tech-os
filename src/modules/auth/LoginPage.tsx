import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { useAuth } from '@/core/auth/useAuth'
import { toUserMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { AuthLayout } from './AuthLayout'
import { loginSchema, type LoginValues } from './schemas'

export function LoginPage() {
  const { sessionExpired } = useAuth()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    const { error: err } = await requireSupabase().auth.signInWithPassword(values)
    if (err) setError(toUserMessage(err))
    // Em caso de sucesso, RedirectIfAuthenticated leva ao destino.
  })

  return (
    <AuthLayout title="Entrar" description="Use o e-mail e a senha da sua conta.">
      {sessionExpired && !error && (
        <Alert tone="warning" title="Sua sessão expirou">
          Entre novamente para continuar de onde parou.
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <TextField label="E-mail" type="email" autoComplete="email" error={formState.errors.email?.message} {...register('email')} />
        <TextField
          label="Senha"
          type="password"
          autoComplete="current-password"
          error={formState.errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" loading={formState.isSubmitting}>
          Entrar
        </Button>
      </form>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <Link to="/recuperar-senha" className="underline underline-offset-4">
          Esqueci minha senha
        </Link>
        <Link to="/cadastro" state={location.state} className="underline underline-offset-4">
          Criar conta
        </Link>
      </div>
    </AuthLayout>
  )
}
