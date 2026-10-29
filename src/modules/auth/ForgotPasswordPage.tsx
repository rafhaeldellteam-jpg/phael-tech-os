import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { toUserMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { AuthLayout } from './AuthLayout'
import { forgotSchema, type ForgotValues } from './schemas'

export function ForgotPasswordPage() {
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<ForgotValues>({ resolver: zodResolver(forgotSchema) })

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null)
    const { error: err } = await requireSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    })
    // Por segurança, a mensagem é a mesma exista ou não a conta.
    if (err && err.status !== 400) return setError(toUserMessage(err))
    setDone(true)
  })

  return (
    <AuthLayout title="Recuperar senha" description="Enviaremos um link para você criar uma nova senha.">
      {done ? (
        <Alert tone="success">
          Se houver uma conta com esse e-mail, o link de recuperação chegará em alguns minutos. Confira também o spam.
        </Alert>
      ) : (
        <>
          {error && <Alert tone="error">{error}</Alert>}
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <TextField label="E-mail" type="email" autoComplete="email" error={formState.errors.email?.message} {...register('email')} />
            <Button type="submit" loading={formState.isSubmitting}>
              Enviar link
            </Button>
          </form>
        </>
      )}
      <Link to="/entrar" className="text-sm underline underline-offset-4">
        Voltar para entrar
      </Link>
    </AuthLayout>
  )
}
