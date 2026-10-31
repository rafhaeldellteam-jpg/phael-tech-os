import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'
import { TextAreaField } from '@/components/ui/TextArea'
import type { Json } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { orderKeys } from '../orders/queries'

export type CheckResult = 'ok' | 'fail' | 'na' | null
export interface CheckItem {
  label: string
  result: CheckResult
  note: string | null
}

export const resultLabels: Record<Exclude<CheckResult, null>, string> = { ok: 'OK', fail: 'Defeito', na: 'Não se aplica' }

export const diagKeys = {
  order: (companyId: string, orderId: string) => [...orderKeys.all(companyId), 'diagnostics', orderId] as const,
  templates: (companyId: string) => ['checklists', companyId] as const,
}

export function useTemplates(companyId: string) {
  return useQuery({
    queryKey: diagKeys.templates(companyId),
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('checklist_templates').select('*').eq('company_id', companyId).order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

/** Diagnóstico com checklist na OS: escolhe o modelo, marca cada item e conclui com o laudo. */
export function OrderDiagnostics({
  companyId,
  orderId,
  equipmentType,
  canWrite,
  editable,
}: {
  companyId: string
  orderId: string
  equipmentType: string | null
  canWrite: boolean
  editable: boolean
}) {
  const queryClient = useQueryClient()
  const templates = useTemplates(companyId)
  const diags = useQuery({
    queryKey: diagKeys.order(companyId, orderId),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('order_diagnostics')
        .select('id, template_name, results, summary, finalized_at, created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
  const active = (templates.data ?? []).filter((t) => t.active)
  const suggested = active.find((t) => t.equipment_type === equipmentType) ?? active[0]
  const [templateId, setTemplateId] = useState('')
  const chosen = templateId || suggested?.id || ''
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: diagKeys.order(companyId, orderId) }),
      queryClient.invalidateQueries({ queryKey: orderKeys.events(companyId, orderId) }),
    ])
  const start = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('start_diagnostic', { p_order_id: orderId, p_template_id: chosen })
      if (error) throw error
    },
    onSuccess: refresh,
  })
  const draft = (diags.data ?? []).find((d) => !d.finalized_at)
  const done = (diags.data ?? []).filter((d) => d.finalized_at)

  return (
    <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="diag-h">
      <h2 id="diag-h" className="font-semibold">
        Diagnóstico
      </h2>
      {diags.isPending || templates.isPending ? (
        <Spinner label="Carregando" />
      ) : (
        <>
          {start.isError && <Alert tone="error">{toUserMessage(start.error)}</Alert>}
          {draft ? (
            <DiagnosticForm key={draft.id} diag={draft} canWrite={canWrite} onSaved={refresh} />
          ) : (
            canWrite &&
            editable &&
            (active.length === 0 ? (
              <p className="text-sm text-muted">
                Nenhum modelo de checklist.{' '}
                <Link to="/diagnosticos" className="underline">
                  Criar modelos
                </Link>
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <SelectField label="Checklist" value={chosen} onChange={(e) => setTemplateId(e.target.value)}>
                  {active.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.items.length} itens)
                    </option>
                  ))}
                </SelectField>
                <Button variant="secondary" loading={start.isPending} onClick={() => start.mutate()}>
                  <ClipboardCheck className="size-4" aria-hidden /> Iniciar diagnóstico
                </Button>
              </div>
            ))
          )}
          {done.map((d) => (
            <DoneDiagnostic key={d.id} diag={d} />
          ))}
          {!draft && done.length === 0 && (!canWrite || !editable) && <p className="text-sm text-muted">Sem diagnóstico registrado.</p>}
        </>
      )}
    </section>
  )
}

function DoneDiagnostic({ diag }: { diag: { template_name: string | null; results: Json; summary: string | null; finalized_at: string | null } }) {
  const items = (diag.results as unknown as CheckItem[]) ?? []
  const fails = items.filter((i) => i.result === 'fail')
  return (
    <div className="grid gap-2 rounded-md border border-line p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone="ok">Concluído</Badge>
        <span className="text-muted">
          {diag.template_name}, {diag.finalized_at && formatDateTime(diag.finalized_at)}
        </span>
      </p>
      <p className="whitespace-pre-line">
        <strong>Laudo:</strong> {diag.summary}
      </p>
      {fails.length > 0 && (
        <ul className="grid gap-0.5">
          {fails.map((f) => (
            <li key={f.label} className="text-danger-600">
              Defeito: {f.label}
              {f.note && <span className="text-muted"> ({f.note})</span>}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-[13px]">Ver checklist completo</summary>
        <ul className="mt-2 grid gap-0.5 text-[13px]">
          {items.map((i) => (
            <li key={i.label} className="flex justify-between gap-3">
              <span>
                {i.label}
                {i.note && <span className="text-muted"> ({i.note})</span>}
              </span>
              <span className={i.result === 'fail' ? 'text-danger-600' : 'text-muted'}>{i.result ? resultLabels[i.result] : '—'}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

function DiagnosticForm({
  diag,
  canWrite,
  onSaved,
}: {
  diag: { id: string; template_name: string | null; results: Json; summary: string | null }
  canWrite: boolean
  onSaved: () => Promise<unknown>
}) {
  const [items, setItems] = useState<CheckItem[]>(() => (diag.results as unknown as CheckItem[]) ?? [])
  const [summary, setSummary] = useState(diag.summary ?? '')

  const save = useMutation({
    mutationFn: async (finalize: boolean) => {
      const { error } = await requireSupabase().rpc('save_diagnostic', {
        p_diagnostic_id: diag.id,
        p_results: items as unknown as Json,
        p_summary: summary.trim() || null,
        p_finalize: finalize,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await onSaved()
    },
  })
  const set = (i: number, patch: Partial<CheckItem>) => setItems((list) => list.map((it, n) => (n === i ? { ...it, ...patch } : it)))
  const pending = items.filter((i) => !i.result).length

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">
        {diag.template_name}: {items.length - pending} de {items.length} itens marcados
      </p>
      {save.isError && <Alert tone="error">{toUserMessage(save.error)}</Alert>}
      <ul className="divide-y divide-[var(--border)] rounded-md border border-line">
        {items.map((it, i) => (
          <li key={it.label} className="grid gap-1.5 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-40 flex-1">{it.label}</span>
              <div role="radiogroup" aria-label={it.label} className="flex gap-1">
                {(['ok', 'fail', 'na'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={it.result === r}
                    disabled={!canWrite}
                    onClick={() => set(i, { result: it.result === r ? null : r })}
                    className={`h-8 rounded-md border px-2.5 text-[13px] ${
                      it.result === r
                        ? r === 'ok'
                          ? 'border-ok-600 bg-ok-600 text-white'
                          : r === 'fail'
                            ? 'border-danger-600 bg-danger-600 text-white'
                            : 'border-navy-300 bg-navy-300 text-navy-950'
                        : 'border-line hover:bg-[var(--surface-muted)]'
                    }`}
                  >
                    {resultLabels[r]}
                  </button>
                ))}
              </div>
            </div>
            {it.result === 'fail' && (
              <input
                aria-label={`Observação: ${it.label}`}
                placeholder="O que foi encontrado"
                value={it.note ?? ''}
                onChange={(e) => set(i, { note: e.target.value })}
                className="h-8 rounded-md border border-line bg-[var(--surface)] px-2 text-[13px]"
              />
            )}
          </li>
        ))}
      </ul>
      <TextAreaField label="Laudo (conclusão)" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Ex.: bateria viciada, recomendada a troca." />
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>
            Salvar rascunho
          </Button>
          <Button loading={save.isPending && save.variables === true} disabled={pending > 0 || !summary.trim()} onClick={() => save.mutate(true)}>
            Concluir diagnóstico
          </Button>
          {pending > 0 && <span className="self-center text-[13px] text-muted">Marque os {pending} item(ns) restantes para concluir.</span>}
        </div>
      )}
    </div>
  )
}
