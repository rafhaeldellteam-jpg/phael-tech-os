import * as Dialog from '@radix-ui/react-dialog'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, MailPlus, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField, TextField } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/core/auth/useAuth'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { roleDescriptions, roleLabels } from '@/core/permissions/permissions'
import type { MemberRole, MemberStatus } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { settingsKeys, useInvitations, useMembers, useOverrides, usePermissionCatalog } from './queries'

const roles: MemberRole[] = ['admin', 'technician', 'finance', 'attendant']
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })

type Member = NonNullable<ReturnType<typeof useMembers>['data']>[number]

export function MembersPage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const canManage = can(['members.manage'])
  const members = useMembers(company.id)
  const [permsFor, setPermsFor] = useState<Member | null>(null)

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Equipe e permissões"
        description="Cada papel tem permissões padrão. O administrador pode conceder ou revogar permissões específicas por pessoa."
      />

      {canManage && <InviteSection companyId={company.id} />}

      <section className="grid gap-3" aria-labelledby="membros">
        <h2 id="membros" className="text-lg font-semibold">
          Membros
        </h2>
        {members.isPending ? (
          <Spinner label="Carregando equipe" />
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={members.refetch} />
        ) : members.data.length === 0 ? (
          <EmptyState icon={Users} title="Nenhum membro" />
        ) : (
          <div className="surface overflow-x-auto rounded-lg">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Pessoa</th>
                  <th className="px-4 py-2.5 font-medium">Papel</th>
                  <th className="px-4 py-2.5 font-medium">Situação</th>
                  <th className="px-4 py-2.5 font-medium">Desde</th>
                  {canManage && <th className="px-4 py-2.5"><span className="sr-only">Ações</span></th>}
                </tr>
              </thead>
              <tbody>
                {members.data.map((m) => (
                  <MemberRow
                    key={m.member_id}
                    member={m}
                    companyId={company.id}
                    canManage={canManage}
                    onEditPermissions={() => setPermsFor(m)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {permsFor && (
        <PermissionsDialog member={permsFor} companyId={company.id} onClose={() => setPermsFor(null)} />
      )}
    </div>
  )
}

function MemberRow({
  member,
  companyId,
  canManage,
  onEditPermissions,
}: {
  member: Member
  companyId: string
  canManage: boolean
  onEditPermissions: () => void
}) {
  const { user } = useAuth()
  const { refresh } = useCompany()
  const queryClient = useQueryClient()
  const [confirmSuspend, setConfirmSuspend] = useState(false)
  const isSelf = member.user_id === user?.id

  const update = useMutation({
    mutationFn: async (next: { role: MemberRole; status: MemberStatus }) => {
      const { error } = await requireSupabase().rpc('update_member', {
        p_member_id: member.member_id,
        p_role: next.role,
        p_status: next.status,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      setConfirmSuspend(false)
      await queryClient.invalidateQueries({ queryKey: settingsKeys.members(companyId) })
      if (isSelf) await refresh()
    },
  })

  return (
    <tr className="border-b border-line last:border-0 align-top">
      <td className="px-4 py-3">
        <p className="font-medium">
          {member.full_name ?? member.email} {isSelf && <span className="text-muted">(você)</span>}
        </p>
        <p className="text-muted">{member.email}</p>
        {update.isError && <p className="mt-1 text-[13px] text-danger-600" role="alert">{toUserMessage(update.error)}</p>}
      </td>
      <td className="px-4 py-3">
        {canManage ? (
          <select
            aria-label={`Papel de ${member.email}`}
            value={member.role}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ role: e.target.value as MemberRole, status: member.status })}
            className="h-8 rounded-md border border-line bg-[var(--surface)] px-2"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {roleLabels[r]}
              </option>
            ))}
          </select>
        ) : (
          roleLabels[member.role]
        )}
      </td>
      <td className="px-4 py-3">
        {member.status === 'active' ? <Badge tone="ok">Ativo</Badge> : <Badge tone="attn">Suspenso</Badge>}
      </td>
      <td className="px-4 py-3 text-muted tabular-nums">{dateFmt.format(new Date(member.created_at))}</td>
      {canManage && (
        <td className="px-4 py-3">
          <div className="flex justify-end gap-1">
            {member.role !== 'admin' && (
              <Button size="sm" variant="ghost" onClick={onEditPermissions}>
                <KeyRound className="size-4" aria-hidden /> Permissões
              </Button>
            )}
            {member.status === 'active' ? (
              <Button size="sm" variant="ghost" onClick={() => setConfirmSuspend(true)}>
                Suspender
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                loading={update.isPending}
                onClick={() => update.mutate({ role: member.role, status: 'active' })}
              >
                Reativar
              </Button>
            )}
          </div>
          <ConfirmDialog
            open={confirmSuspend}
            onOpenChange={setConfirmSuspend}
            title={`Suspender ${member.full_name ?? member.email}?`}
            description="A pessoa perde o acesso aos dados desta empresa imediatamente. O histórico dela é mantido e você pode reativar depois."
            confirmLabel="Suspender acesso"
            loading={update.isPending}
            onConfirm={() => update.mutate({ role: member.role, status: 'suspended' })}
          />
        </td>
      )}
    </tr>
  )
}

const inviteSchema = z.object({
  email: z.string().trim().pipe(z.email({ message: 'E-mail inválido' })),
  role: z.enum(['admin', 'technician', 'finance', 'attendant']),
})
type InviteValues = z.infer<typeof inviteSchema>

function InviteSection({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient()
  const invitations = useInvitations(companyId, true)
  const [link, setLink] = useState<{ email: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<{ id: string; email: string } | null>(null)
  const { register, handleSubmit, formState, reset, watch } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'technician' },
  })
  const selectedRole = watch('role')

  const invite = useMutation({
    mutationFn: async (v: InviteValues) => {
      const { data, error } = await requireSupabase().rpc('create_invitation', {
        p_company_id: companyId,
        p_email: v.email,
        p_role: v.role,
      })
      if (error) throw error
      return { email: v.email, url: `${window.location.origin}/convite?token=${data}` }
    },
    onSuccess: async (result) => {
      setLink(result)
      setCopied(false)
      reset({ email: '', role: 'technician' })
      await queryClient.invalidateQueries({ queryKey: settingsKeys.invitations(companyId) })
    },
  })

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await requireSupabase().rpc('revoke_invitation', { p_invitation_id: id })
      if (error) throw error
    },
    onSuccess: async () => {
      setRevoking(null)
      await queryClient.invalidateQueries({ queryKey: settingsKeys.invitations(companyId) })
    },
  })

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="surface grid gap-4 rounded-lg p-5" aria-labelledby="convidar">
      <div className="grid gap-1">
        <h2 id="convidar" className="text-lg font-semibold">
          Convidar pessoa
        </h2>
        <p className="text-sm text-muted">
          O envio automático por e-mail ainda não está configurado: copie o link e envie pelo canal que preferir. O link
          vale por 7 dias e só funciona para o e-mail convidado.
        </p>
      </div>

      <form
        onSubmit={handleSubmit((v) => invite.mutate(v))}
        className="grid items-start gap-3 sm:grid-cols-[1fr_200px_auto]"
        noValidate
      >
        <TextField label="E-mail" type="email" error={formState.errors.email?.message} {...register('email')} />
        <SelectField label="Papel" hint={roleDescriptions[selectedRole]} {...register('role')}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleLabels[r]}
            </option>
          ))}
        </SelectField>
        <Button type="submit" loading={invite.isPending} className="sm:mt-[26px]">
          <MailPlus className="size-4" aria-hidden /> Gerar convite
        </Button>
      </form>

      {invite.isError && <Alert tone="error">{toUserMessage(invite.error)}</Alert>}
      {link && (
        <Alert tone="success" title={`Convite criado para ${link.email}`}>
          <p className="mb-2">Este link só aparece agora. Copie e envie para a pessoa.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded bg-[var(--surface)] px-2 py-1 text-xs">{link.url}</code>
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              <Copy className="size-4" aria-hidden /> {copied ? 'Link copiado' : 'Copiar link'}
            </Button>
          </div>
        </Alert>
      )}

      {invitations.data && invitations.data.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Convites pendentes</h3>
          <ul className="divide-y divide-[var(--border)] rounded-md border border-line text-sm">
            {invitations.data.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="flex-1 truncate">{inv.email}</span>
                <span className="text-muted">{roleLabels[inv.role]}</span>
                <span className="text-muted tabular-nums">expira {dateFmt.format(new Date(inv.expires_at))}</span>
                <Button size="sm" variant="ghost" onClick={() => setRevoking({ id: inv.id, email: inv.email })}>
                  Cancelar convite
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(revoking)}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Cancelar convite?"
        description={`O link enviado para ${revoking?.email ?? ''} deixará de funcionar.`}
        confirmLabel="Cancelar convite"
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
      {revoke.isError && <Alert tone="error">{toUserMessage(revoke.error)}</Alert>}
    </section>
  )
}

type OverrideState = 'default' | 'granted' | 'revoked'

function PermissionsDialog({ member, companyId, onClose }: { member: Member; companyId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const catalog = usePermissionCatalog()
  const overrides = useOverrides(companyId, true)

  const roleDefaults = useMemo(
    () =>
      new Set(
        (catalog.data?.rolePermissions ?? []).filter((rp) => rp.role === member.role).map((rp) => rp.permission_key),
      ),
    [catalog.data, member.role],
  )
  const memberOverrides = useMemo(
    () =>
      new Map(
        (overrides.data ?? [])
          .filter((o) => o.member_id === member.member_id)
          .map((o) => [o.permission_key, o.granted] as const),
      ),
    [overrides.data, member.member_id],
  )

  const setOverride = useMutation({
    mutationFn: async ({ key, state }: { key: string; state: OverrideState }) => {
      const { error } = await requireSupabase().rpc('set_member_permission', {
        p_member_id: member.member_id,
        p_permission_key: key,
        p_granted: state === 'default' ? null : state === 'granted',
      })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.overrides(companyId) }),
  })

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy-950/50" />
        <Dialog.Content className="surface fixed top-1/2 left-1/2 z-50 grid max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_1fr] gap-4 rounded-lg p-5 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="grid flex-1 gap-1">
              <Dialog.Title className="text-lg font-semibold">
                Permissões de {member.full_name ?? member.email}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted">
                Papel: {roleLabels[member.role]}. “Padrão do papel” segue o perfil; as demais opções valem só para esta
                pessoa.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Fechar">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto">
            {catalog.isPending || overrides.isPending ? (
              <Spinner label="Carregando permissões" />
            ) : catalog.isError || overrides.isError ? (
              <ErrorState error={catalog.error ?? overrides.error} />
            ) : (
              <ul className="divide-y divide-[var(--border)] text-sm">
                {catalog.data.permissions.map((p) => {
                  const o = memberOverrides.get(p.key)
                  const state: OverrideState = o === undefined ? 'default' : o ? 'granted' : 'revoked'
                  const effective = o ?? roleDefaults.has(p.key)
                  return (
                    <li key={p.key} className="flex flex-wrap items-center gap-3 py-2">
                      <span className={effective ? 'size-2 rounded-full bg-ok-500' : 'size-2 rounded-full bg-navy-300/50'} aria-hidden />
                      <span className="min-w-48 flex-1">
                        {p.description}
                        <span className="sr-only">{effective ? ' (permitido)' : ' (não permitido)'}</span>
                      </span>
                      <select
                        aria-label={`Permissão: ${p.description}`}
                        value={state}
                        disabled={setOverride.isPending}
                        onChange={(e) => setOverride.mutate({ key: p.key, state: e.target.value as OverrideState })}
                        className="h-8 rounded-md border border-line bg-[var(--surface)] px-2"
                      >
                        <option value="default">Padrão do papel ({roleDefaults.has(p.key) ? 'sim' : 'não'})</option>
                        <option value="granted">Conceder</option>
                        <option value="revoked">Revogar</option>
                      </select>
                    </li>
                  )
                })}
              </ul>
            )}
            {setOverride.isError && <Alert tone="error">{toUserMessage(setOverride.error)}</Alert>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
