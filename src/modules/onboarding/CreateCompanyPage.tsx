import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router'
import { z } from 'zod'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
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
  const { signOut } = useAuth()
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

  if (active && !create.isPending && !create.isSuccess) return <Navigate to="/" replace />

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
