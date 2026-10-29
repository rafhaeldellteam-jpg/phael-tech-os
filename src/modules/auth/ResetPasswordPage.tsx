import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useAuth } from '@/core/auth/useAuth'
import { toUserMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { AuthLayout } from './AuthLayout'
import { resetSchema, type ResetValues } from './schemas'

export function ResetPasswordPage() {
  const { user, loading, clearRecovery } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<ResetValues>({ resolver: zodResolver(resetSchema) })

  if (loading) return <FullPageSpinner label="Validando link" />

  if (!user) {
    return (
      <AuthLayout title="Link inválido ou expirado">
        <Alert tone="warning">Peça um novo link de recuperação. Cada link vale por tempo limitado e só uma vez.</Alert>
        <Link to="/recuperar-senha" className="text-sm underline underline-offset-4">
          Pedir novo link
        </Link>
      </AuthLayout>
    )
  }

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null)
    const { error: err } = await requireSupabase().auth.updateUser({ password })
    if (err) return setError(toUserMessage(err))
    clearRecovery()
    navigate('/', { replace: true })
  })

  return (
    <AuthLayout title="Criar nova senha" description={user.email ?? undefined}>
      {error && <Alert tone="error">{error}</Alert>}
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <TextField
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          hint="Mínimo de 10 caracteres, com letras e números."
          error={formState.errors.password?.message}
          {...register('password')}
        />
        <TextField
          label="Confirmar nova senha"
          type="password"
          autoComplete="new-password"
          error={formState.errors.confirm?.message}
          {...register('confirm')}
        />
        <Button type="submit" loading={formState.isSubmitting}>
          Salvar nova senha
        </Button>
      </form>
    </AuthLayout>
  )
}
