import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField, TextField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { TextAreaField } from '@/components/ui/TextArea'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import type { Database, Json } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { useEquipmentTypes } from '../equipment/queries'
import { diagKeys, useTemplates } from './OrderDiagnostics'

type Template = Database['public']['Tables']['checklist_templates']['Row']

export function ChecklistTemplatesPage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const canWrite = can(['diagnostics.write'])
  const queryClient = useQueryClient()
  const templates = useTemplates(company.id)
  const types = useEquipmentTypes()
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const seed = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('seed_checklist_templates', { p_company_id: company.id })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: diagKeys.templates(company.id) }),
  })
  const typeLabel = (k: string | null) => (k ? (types.data?.find((t) => t.key === k)?.label ?? k) : 'Qualquer equipamento')

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Checklists de diagnóstico"
        description="Modelos usados na OS. Cada diagnóstico guarda uma cópia: alterar o modelo não muda diagnósticos já feitos."
        actions={
          canWrite && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Novo modelo
            </Button>
          )
        }
      />
      {seed.isError && <Alert tone="error">{toUserMessage(seed.error)}</Alert>}
      {templates.isPending ? (
        <Spinner label="Carregando" />
      ) : templates.isError ? (
        <ErrorState error={templates.error} onRetry={templates.refetch} />
      ) : templates.data.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Nenhum modelo ainda">
          {canWrite && (
            <Button className="mt-2" loading={seed.isPending} onClick={() => seed.mutate()}>
              <Sparkles className="size-4" aria-hidden /> Criar modelos sugeridos (notebook, desktop, impressora, celular)
            </Button>
          )}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {templates.data.map((t) => (
            <li key={t.id} className={`surface grid content-start gap-2 rounded-lg p-4 text-sm ${t.active ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-2">
                <span className="flex-1 font-semibold">{t.name}</span>
                {!t.active && <Badge>Inativo</Badge>}
                {canWrite && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                    Editar
                  </Button>
                )}
              </div>
              <p className="text-[13px] text-muted">
                {typeLabel(t.equipment_type)} · {t.items.length} itens
              </p>
              <p className="line-clamp-3 text-[13px]">{t.items.join(' · ')}</p>
            </li>
          ))}
        </ul>
      )}
      {editing && <TemplateDialog companyId={company.id} template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function TemplateDialog({ companyId, template, onClose }: { companyId: string; template: Template | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const types = useEquipmentTypes()
  const [name, setName] = useState(template?.name ?? '')
  const [type, setType] = useState(template?.equipment_type ?? '')
  const [items, setItems] = useState((template?.items ?? []).join('\n'))
  const [active, setActive] = useState(template?.active ?? true)
  const list = items
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
  const valid = name.trim().length >= 2 && list.length > 0 && list.length <= 60
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('save_checklist_template', {
        p_company_id: companyId,
        p_id: template?.id ?? null,
        p_data: { name: name.trim(), equipment_type: type || null, items: list, active } as Json,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: diagKeys.templates(companyId) })
      onClose()
    },
  })
  return (
    <FormDialog title={template ? `Editar ${template.name}` : 'Novo modelo de checklist'} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) save.mutate()
        }}
      >
        {save.isError && <Alert tone="error">{toUserMessage(save.error)}</Alert>}
        <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label="Sugerir para" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Qualquer equipamento</option>
          {(types.data ?? []).map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </SelectField>
        <TextAreaField label="Itens (um por linha)" rows={10} value={items} onChange={(e) => setItems(e.target.value)} hint={`${list.length} item(ns), máximo 60.`} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4" /> Ativo
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!valid}>
            Salvar
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}
