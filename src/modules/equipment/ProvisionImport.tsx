import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp, MonitorCog } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import type { Json } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { ClientPicker, type PickedClient } from '../clients/ClientPicker'
import { parseProvisionReport, toEquipmentFields, type ProvisionReport } from './provisionReport'
import { equipmentKeys, useEquipmentTypes } from './queries'

/** Importa o relatório .txt do Phael Tech Provision para a ficha do equipamento. */
export function ProvisionImportDialog({ companyId, initialClient, onClose }: { companyId: string; initialClient?: PickedClient; onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const types = useEquipmentTypes()
  const [client, setClient] = useState<PickedClient | null>(initialClient ?? null)
  const [file, setFile] = useState<{ name: string; report: ProvisionReport } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [type, setType] = useState('notebook')
  const fields = file ? toEquipmentFields(file.report) : null

  const importIt = useMutation({
    mutationFn: async () => {
      if (!file || !client || !fields) throw new Error('Escolha o cliente e o relatório')
      const r = file.report
      const { data, error } = await requireSupabase().rpc('import_provision_report', {
        p_company_id: companyId,
        p_client_id: client.id,
        p_data: {
          type,
          file_name: file.name,
          provisioned_at: r.generatedAt,
          hostname: r.hostname,
          summary: { board: r.board, audio: r.audio, disks: r.disks, hostname: r.hostname },
          log: r.log.join('\n'),
          fields,
        } as unknown as Json,
      })
      if (error) throw error
      const row = data?.[0]
      if (!row) throw new Error('Importação sem resposta')
      return row
    },
    onSuccess: async (row) => {
      await queryClient.invalidateQueries({ queryKey: equipmentKeys.all(companyId) })
      onClose()
      navigate(`/equipamentos/${row.equipment_id}`, { state: { provisioned: row.created ? 'created' : 'updated' } })
    },
  })

  return (
    <FormDialog
      title="Importar do Phael Tech Provision"
      description='Use o relatório que o Provision salva ao finalizar ("Provisionamento-<PC>-<data>.txt", na Área de Trabalho ou em C:\ProgramData\PhaelTechProvision).'
      onClose={onClose}
      wide
    >
      <div className="grid gap-4">
        {importIt.isError && <Alert tone="error">{importIt.error instanceof Error && !('code' in importIt.error) ? importIt.error.message : toUserMessage(importIt.error)}</Alert>}
        <ClientPicker companyId={companyId} value={client} onChange={setClient} />
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 justify-self-start rounded-md border border-line px-4 text-sm font-medium hover:bg-[var(--surface-muted)] focus-within:outline-2 focus-within:outline-brand-600">
          <FileUp className="size-4" aria-hidden />
          {file ? file.name : 'Escolher relatório (.txt)'}
          <input
            type="file"
            accept=".txt,text/plain"
            className="sr-only"
            aria-label="Relatório do Provision"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              setReadError(null)
              setFile(null)
              if (!f) return
              try {
                if (f.size > 2_000_000) throw new Error('Arquivo maior que 2 MB')
                const report = parseProvisionReport(await f.text())
                if (!report.serial) throw new Error('O relatório não traz o número de série (Service Tag/S/N).')
                setFile({ name: f.name, report })
              } catch (err) {
                setReadError(err instanceof Error ? err.message : String(err))
              }
            }}
          />
        </label>
        {readError && <Alert tone="error">{readError}</Alert>}
        {file && fields && (
          <>
            <dl className="grid gap-x-6 gap-y-2 rounded-md border border-line p-3 text-sm sm:grid-cols-2">
              {(
                [
                  ['Computador', file.report.hostname],
                  ['Provisionado em', file.report.generatedAt ? formatDateTime(file.report.generatedAt) : null],
                  ['Fabricante', fields.manufacturer],
                  ['Modelo', fields.model],
                  ['Número de série', fields.serial_number],
                  ['Patrimônio', fields.asset_tag],
                  ['Processador', fields.processor],
                  ['Memória', fields.memory],
                  ['Armazenamento', fields.storage],
                  ['Vídeo', fields.graphics],
                  ['Sistema', fields.operating_system],
                  ['Log', `${file.report.log.length} linha(s)`],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="grid gap-0.5">
                  <dt className="text-[12px] text-muted">{k}</dt>
                  <dd>{v || <span className="text-muted">—</span>}</dd>
                </div>
              ))}
            </dl>
            <SelectField label="Tipo de equipamento (usado se for um equipamento novo)" value={type} onChange={(e) => setType(e.target.value)}>
              {(types.data ?? []).map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </SelectField>
            <p className="text-[13px] text-muted">
              Se o número de série já existir para este cliente, a ficha é atualizada e o provisionamento entra no histórico. Senão, o equipamento é criado.
            </p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={importIt.isPending} disabled={!file || !client} onClick={() => importIt.mutate()}>
            <MonitorCog className="size-4" aria-hidden /> Importar
          </Button>
        </div>
      </div>
    </FormDialog>
  )
}

/** Histórico de provisionamentos na ficha do equipamento. */
export function ProvisionHistory({ companyId, equipmentId }: { companyId: string; equipmentId: string }) {
  const list = useQuery({
    queryKey: [...equipmentKeys.all(companyId), 'provisionings', equipmentId],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('equipment_provisionings')
        .select('id, file_name, provisioned_at, hostname, log, created_at')
        .eq('equipment_id', equipmentId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
  if (!list.isSuccess || list.data.length === 0) return null
  return (
    <section className="surface grid gap-2 rounded-lg p-5 text-sm" aria-labelledby="prov-h">
      <h2 id="prov-h" className="font-semibold">
        Provisionamentos (Phael Tech Provision)
      </h2>
      <ul className="grid gap-2">
        {list.data.map((p) => (
          <li key={p.id} className="rounded-md border border-line p-3">
            <p className="font-medium">
              {p.provisioned_at ? formatDateTime(p.provisioned_at) : formatDateTime(p.created_at)}
              {p.hostname && <span className="font-normal text-muted"> · {p.hostname}</span>}
            </p>
            {p.log && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[13px]">Ver log ({p.log.split('\n').length} linhas)</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-[var(--surface-muted)] p-2 text-[12px] whitespace-pre-wrap">{p.log}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
