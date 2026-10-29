import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { toUserMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { AuthLayout } from './AuthLayout'
import { signUpSchema, type SignUpValues } from './schemas'

export function SignUpPage() {
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema) })

  const onSubmit = handleSubmit(async ({ fullName, email, password }) => {
    setError(null)
    const from = (location.state as { from?: string } | null)?.from ?? '/'
    const { data, error: err } = await requireSupabase().auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}${from.startsWith('/') && !from.startsWith('//') ? from : '/'}`,
      },
    })
    if (err) return setError(toUserMessage(err))
    // Com confirmação de e-mail ligada, não há sessão até o usuário clicar no link.
    if (!data.session) setSentTo(email)
  })

  if (sentTo) {
    return (
      <AuthLayout title="Confirme seu e-mail">
        <Alert tone="success">
          Enviamos um link de confirmação para <strong>{sentTo}</strong>. Abra o link para ativar a conta e depois entre.
        </Alert>
        <Link to="/entrar" className="text-sm underline underline-offset-4">
          Voltar para entrar
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Criar conta" description="Depois você cria sua empresa ou aceita um convite da equipe.">
      {error && <Alert tone="error">{error}</Alert>}
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <TextField label="Nome completo" autoComplete="name" error={formState.errors.fullName?.message} {...register('fullName')} />
        <TextField label="E-mail" type="email" autoComplete="email" error={formState.errors.email?.message} {...register('email')} />
        <TextField
          label="Senha"
          type="password"
          autoComplete="new-password"
          hint="Mínimo de 10 caracteres, com letras e números."
          error={formState.errors.password?.message}
          {...register('password')}
        />
        <TextField
          label="Confirmar senha"
          type="password"
          autoComplete="new-password"
          error={formState.errors.confirm?.message}
          {...register('confirm')}
        />
        <Button type="submit" loading={formState.isSubmitting}>
          Criar conta
        </Button>
      </form>
      <Link to="/entrar" state={location.state} className="text-sm underline underline-offset-4">
        Já tenho conta
      </Link>
    </AuthLayout>
  )
}
