import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import type { FinanceAccountKind, FinanceDirection } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatBRL, parseMoney } from '@/lib/money'
import { requireSupabase } from '@/lib/supabase'
import { isoDate } from './period'
import { financeKeys, useAccounts, useCategories } from './queries'

const kindLabels: Record<FinanceAccountKind, string> = { cash: 'Caixa (dinheiro)', bank: 'Conta bancária', digital: 'Carteira digital' }

export function SettingsTab({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const queryClient = useQueryClient()
  const accounts = useAccounts(companyId)
  const categories = useCategories(companyId)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: financeKeys.all(companyId) })

  const seed = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('seed_finance_defaults', { p_company_id: companyId })
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const [accName, setAccName] = useState('')
  const [accKind, setAccKind] = useState<FinanceAccountKind>('bank')
  const [accOpening, setAccOpening] = useState('')
  const [accDate, setAccDate] = useState(isoDate(new Date()))
  const addAccount = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase()
        .from('finance_accounts')
        .insert({ company_id: companyId, name: accName.trim(), kind: accKind, opening_balance_cents: parseMoney(accOpening) ?? 0, opening_date: accDate })
      if (error) throw error
    },
    onSuccess: async () => {
      setAccName('')
      setAccOpening('')
      await invalidate()
    },
  })
  const toggleAccount = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await requireSupabase().from('finance_accounts').update({ active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const [catName, setCatName] = useState('')
  const [catDir, setCatDir] = useState<FinanceDirection>('out')
  const addCategory = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().from('finance_categories').insert({ company_id: companyId, name: catName.trim(), direction: catDir })
      if (error) throw error
    },
    onSuccess: async () => {
      setCatName('')
      await invalidate()
    },
  })
  const toggleCategory = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await requireSupabase().from('finance_categories').update({ active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const openingOk = accOpening.trim() === '' || parseMoney(accOpening) !== null
  const empty = accounts.isSuccess && categories.isSuccess && accounts.data.length === 0 && categories.data.length === 0

  return (
    <div className="grid gap-6">
      {canWrite && empty && (
        <Alert tone="info" title="Comece com o básico">
          <p className="mb-2">Cria as contas "Caixa" e "Conta bancária" e categorias comuns de uma assistência técnica. Você ajusta depois.</p>
          <Button size="sm" loading={seed.isPending} onClick={() => seed.mutate()}>
            <Sparkles className="size-4" aria-hidden /> Criar contas e categorias sugeridas
          </Button>
        </Alert>
      )}
      {seed.isError && <Alert tone="error">{toUserMessage(seed.error)}</Alert>}

      <section aria-labelledby="contas-h" className="grid gap-3">
        <h2 id="contas-h" className="text-lg font-semibold">
          Contas
        </h2>
        <p className="text-sm text-muted">Onde o dinheiro está. O saldo inicial é o valor na data de início do controle.</p>
        {accounts.isPending ? (
          <Spinner label="Carregando" />
        ) : (
          <ul className="surface divide-y divide-[var(--border)] rounded-lg text-sm">
            {(accounts.data ?? []).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex-1 font-medium">
                  {a.name} {!a.active && <Badge tone="attn">Inativa</Badge>}
                </span>
                <span className="text-muted">{kindLabels[a.kind]}</span>
                <span className="tabular-nums">saldo inicial {formatBRL(a.opening_balance_cents)}</span>
                {canWrite && (
                  <Button size="sm" variant="ghost" onClick={() => toggleAccount.mutate({ id: a.id, active: !a.active })}>
                    {a.active ? 'Desativar' : 'Reativar'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <form
            className="grid items-start gap-3 sm:grid-cols-[1fr_170px_150px_150px_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              if (accName.trim().length >= 2 && openingOk) addAccount.mutate()
            }}
          >
            <TextField label="Nova conta" placeholder="Nubank, Banco do Brasil…" value={accName} onChange={(e) => setAccName(e.target.value)} />
            <SelectField label="Tipo" value={accKind} onChange={(e) => setAccKind(e.target.value as FinanceAccountKind)}>
              {(Object.keys(kindLabels) as FinanceAccountKind[]).map((k) => (
                <option key={k} value={k}>
                  {kindLabels[k]}
                </option>
              ))}
            </SelectField>
            <TextField label="Saldo inicial (R$)" inputMode="decimal" value={accOpening} onChange={(e) => setAccOpening(e.target.value)} error={openingOk ? undefined : 'Valor inválido'} />
            <TextField label="Data do saldo" type="date" value={accDate} onChange={(e) => setAccDate(e.target.value)} />
            <Button type="submit" className="sm:mt-[26px]" loading={addAccount.isPending}>
              Adicionar
            </Button>
          </form>
        )}
        {addAccount.isError && <Alert tone="error">{toUserMessage(addAccount.error)}</Alert>}
      </section>

      <section aria-labelledby="cats-h" className="grid gap-3">
        <h2 id="cats-h" className="text-lg font-semibold">
          Categorias
        </h2>
        {categories.isPending ? (
          <Spinner label="Carregando" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {(['in', 'out'] as const).map((dir) => (
              <div key={dir} className="grid content-start gap-2">
                <h3 className="text-sm font-semibold text-muted">{dir === 'in' ? 'Receitas' : 'Despesas'}</h3>
                <ul className="surface divide-y divide-[var(--border)] rounded-lg text-sm">
                  {(categories.data ?? [])
                    .filter((c) => c.direction === dir)
                    .map((c) => (
                      <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                        <span className={`flex-1 ${c.active ? '' : 'text-muted line-through'}`}>{c.name}</span>
                        {canWrite && (
                          <Button size="sm" variant="ghost" onClick={() => toggleCategory.mutate({ id: c.id, active: !c.active })}>
                            {c.active ? 'Desativar' : 'Reativar'}
                          </Button>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {canWrite && (
          <form
            className="grid items-start gap-3 sm:grid-cols-[1fr_170px_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              if (catName.trim().length >= 2) addCategory.mutate()
            }}
          >
            <TextField label="Nova categoria" value={catName} onChange={(e) => setCatName(e.target.value)} />
            <SelectField label="Tipo" value={catDir} onChange={(e) => setCatDir(e.target.value as FinanceDirection)}>
              <option value="out">Despesa</option>
              <option value="in">Receita</option>
            </SelectField>
            <Button type="submit" className="sm:mt-[26px]" loading={addCategory.isPending}>
              Adicionar
            </Button>
          </form>
        )}
        {addCategory.isError && <Alert tone="error">{toUserMessage(addCategory.error)}</Alert>}
      </section>
    </div>
  )
}
