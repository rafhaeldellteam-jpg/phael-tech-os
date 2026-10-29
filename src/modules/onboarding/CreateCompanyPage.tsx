import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router'
import { z } from 'zod'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { TextField } from '@/components/ui/Field'
import { useAuth } from '@/core/auth/useAuth'
import { useCompany } from '@/core/company/useCompany'
import { toUserMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { AuthLayout } from '../auth/AuthLayout'

const schema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da empresa').max(120, 'Máximo de 120 caracteres'),
  legalName: z.string().trim().max(200, 'Máximo de 200 caracteres').optional(),
})
type Values = z.infer<typeof schema>

export function CreateCompanyPage() {
  const { signOut, user } = useAuth()
  const { active, refresh, selectCompany } = useCompany()
  const navigate = useNavigate()
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) })

  const create = useMutation({
    mutationFn: async (v: Values) => {
      const { data, error } = await requireSupabase().rpc('create_company', {
        p_name: v.name,
        p_legal_name: v.legalName || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: async (companyId) => {
      await refresh()
      selectCompany(companyId)
      navigate('/', { replace: true })
    },
  })

  const allowed = useQuery({
    queryKey: ['can-create-company', user?.id],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('can_create_company')
      if (error) throw error
      return data
    },
  })

  if (active && !create.isPending && !create.isSuccess) return <Navigate to="/" replace />

  if (allowed.isPending) {
    return (
      <AuthLayout title="Preparando seu acesso">
        <Spinner label="Verificando" />
      </AuthLayout>
    )
  }

  // Sistema de uso exclusivo: depois da primeira empresa, só se entra por convite.
  if (allowed.data === false) {
    return (
      <AuthLayout
        title="Aguardando convite"
        description={<>Sua conta <strong>{user?.email}</strong> foi criada, mas ainda não faz parte da equipe.</>}
      >
        <Alert tone="info">
          O Phael Tech OS é de uso interno. Peça ao administrador para enviar um convite para este e-mail e abra o link
          recebido; o acesso é liberado na hora.
        </Alert>
        <button type="button" onClick={() => void signOut()} className="justify-self-start text-sm underline underline-offset-4">
          Sair
        </button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Criar sua empresa"
      description="Você será o administrador e poderá convidar a equipe em seguida."
    >
      {create.isError && <Alert tone="error">{toUserMessage(create.error)}</Alert>}
      <form onSubmit={handleSubmit((v) => create.mutate(v))} className="grid gap-4" noValidate>
        <TextField label="Nome da empresa" placeholder="Phael Tech Support" error={formState.errors.name?.message} {...register('name')} />
        <TextField label="Razão social (opcional)" error={formState.errors.legalName?.message} {...register('legalName')} />
        <Button type="submit" loading={create.isPending}>
          Criar empresa
        </Button>
      </form>
      <Alert tone="info" title="Recebeu um convite?">
        Abra o link que o administrador enviou. Ele adiciona você à empresa existente.
      </Alert>
      <button type="button" onClick={() => void signOut()} className="justify-self-start text-sm underline underline-offset-4">
        Sair
      </button>
    </AuthLayout>
  )
}
