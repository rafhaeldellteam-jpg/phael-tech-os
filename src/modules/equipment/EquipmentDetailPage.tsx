import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Pencil, Printer } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { Button, ButtonLink } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { toUserMessage } from '@/lib/errors'
import { formatCode, formatDate } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { equipmentKeys, equipmentTitle, useEquipment, useEquipmentTypes } from './queries'
import { stageTone } from '../orders/meta'
import { useEquipmentOrders, useWorkflow } from '../orders/queries'
import { ProvisionHistory } from './ProvisionImport'
import { COMPUTER_TYPES } from './schema'

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="break-words">{children || <span className="text-muted">Não informado</span>}</dd>
    </div>
  )
}

/** O QR leva só ao endereço da ficha; abrir exige login e permissão na empresa. */
function useQrSvg(url: string) {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
      .then((s) => active && setSvg(s))
      .catch(() => active && setSvg(null))
    return () => {
      active = false
    }
  }, [url])
  return svg
}

export function EquipmentDetailPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const queryClient = useQueryClient()
  const canWrite = can(['equipment.write'])
  const equipment = useEquipment(company.id, id)
  const types = useEquipmentTypes()
  const [confirmArchive, setConfirmArchive] = useState(false)
  const canOrders = can(['orders.read_all'])
  const orders = useEquipmentOrders(company.id, id, canOrders)
  const workflow = useWorkflow()
  const qr = useQrSvg(`${window.location.origin}/equipamentos/${id}`)

  const archive = useMutation({
    mutationFn: async (archived: boolean) => {
      const { error } = await requireSupabase().rpc('set_equipment_archived', { p_equipment_id: id, p_archived: archived })
      if (error) throw error
    },
    onSuccess: async () => {
      setConfirmArchive(false)
      await queryClient.invalidateQueries({ queryKey: equipmentKeys.all(company.id) })
    },
  })

  if (equipment.isPending) return <Spinner label="Carregando equipamento" />
  if (equipment.isError) return <ErrorState error={equipment.error} onRetry={equipment.refetch} />
  const e = equipment.data
  if (!e) {
    return (
      <Alert tone="warning" title="Equipamento não encontrado">
        Ele pode pertencer a outra empresa ou você não tem acesso. <Link to="/equipamentos" className="underline">Voltar</Link>
      </Alert>
    )
  }

  const typeLabel = types.data?.find((t) => t.key === e.type)?.label ?? e.type
  const title = equipmentTitle(e, typeLabel)
  const code = formatCode('EQ', e.code)

  return (
    <div className="grid gap-5">
      <nav aria-label="Trilha" className="text-sm text-muted">
        <Link to="/equipamentos" className="hover:underline">
          Equipamentos
        </Link>{' '}
        / {code}
      </nav>
      <PageHeader
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{typeLabel}</Badge>
            <span>
              de{' '}
              <Link to={`/clientes/${e.client.id}`} className="underline underline-offset-4">
                {e.client.name}
              </Link>
            </span>
            {e.archived_at && <Badge tone="attn">Arquivado em {formatDate(e.archived_at)}</Badge>}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => window.print()} disabled={!qr}>
              <Printer className="size-4" aria-hidden /> Imprimir etiqueta
            </Button>
            {canWrite && (
              <ButtonLink to={`/equipamentos/${e.id}/editar`} variant="secondary">
                <Pencil className="size-4" aria-hidden /> Editar
              </ButtonLink>
            )}
          </>
        }
      />

      {(location.state as { saved?: boolean } | null)?.saved && <Alert tone="success">Equipamento salvo.</Alert>}
      {(location.state as { provisioned?: string } | null)?.provisioned && (
        <Alert tone="success">
          {(location.state as { provisioned: string }).provisioned === 'created'
            ? 'Equipamento criado a partir do relatório do Provision.'
            : 'Ficha atualizada com o relatório do Provision.'}
        </Alert>
      )}
      {archive.isError && <Alert tone="error">{toUserMessage(archive.error)}</Alert>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-5">
          <section className="surface grid gap-4 rounded-lg p-5" aria-labelledby="ident-h">
            <h2 id="ident-h" className="font-semibold">
              Identificação
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Item label="Código">{code}</Item>
              <Item label="Fabricante e modelo">{[e.manufacturer, e.model].filter(Boolean).join(' ')}</Item>
              <Item label="Número de série">{e.serial_number}</Item>
              <Item label="Patrimônio">{e.asset_tag}</Item>
              <Item label="Cadastrado em">{formatDate(e.created_at)}</Item>
            </dl>
          </section>

          {COMPUTER_TYPES.has(e.type) && (
            <section className="surface grid gap-4 rounded-lg p-5" aria-labelledby="config-h">
              <h2 id="config-h" className="font-semibold">
                Configuração
              </h2>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Item label="Processador">{e.processor}</Item>
                <Item label="Memória RAM">{e.memory}</Item>
                <Item label="Armazenamento">{e.storage}</Item>
                <Item label="Placa de vídeo">{e.graphics}</Item>
                <Item label="Sistema operacional">{e.operating_system}</Item>
              </dl>
            </section>
          )}

          <section className="surface grid gap-4 rounded-lg p-5" aria-labelledby="entrada-h">
            <h2 id="entrada-h" className="font-semibold">
              Entrada
            </h2>
            <dl className="grid gap-4">
              <Item label="Condições físicas">{e.condition_notes && <span className="whitespace-pre-line">{e.condition_notes}</span>}</Item>
              <Item label="Acessórios recebidos">
                {e.accessories.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {e.accessories.map((a) => (
                      <li key={a}>
                        <Badge>{a}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Item>
            </dl>
          </section>
        </div>

        <aside className="grid content-start gap-5">
          <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="etiqueta-h">
            <h2 id="etiqueta-h" className="font-semibold">
              Etiqueta
            </h2>
            <p className="text-sm text-muted">
              Cole no equipamento. O QR abre esta ficha, e só para quem estiver logado na sua empresa.
            </p>
            <div className="print-area justify-self-start rounded border border-dashed border-line bg-white p-3 text-black">
              <div className="flex w-[62mm] items-center gap-3">
                {qr ? (
                  <div className="size-[22mm] shrink-0 [&>svg]:size-full" aria-label={`QR Code da ficha ${code}`} role="img" dangerouslySetInnerHTML={{ __html: qr }} />
                ) : (
                  <div className="grid size-[22mm] shrink-0 place-items-center text-xs">Gerando…</div>
                )}
                <div className="grid min-w-0 gap-0.5 leading-tight">
                  <BrandLogo variant="shield" className="size-6" />
                  <p className="text-base font-bold tabular-nums">{code}</p>
                  <p className="truncate text-[11px]">{title}</p>
                  <p className="truncate text-[11px]">{e.client.name}</p>
                </div>
              </div>
            </div>
          </section>

          <ProvisionHistory companyId={company.id} equipmentId={e.id} />

          <section className="surface grid gap-2 rounded-lg p-5 text-sm" aria-labelledby="hist-h">
            <div className="flex items-center justify-between gap-2">
              <h2 id="hist-h" className="font-semibold">
                Histórico de OS
              </h2>
              {can(['orders.create']) && !e.archived_at && (
                <Link to={`/ordens/nova?cliente=${e.client.id}&equipamento=${e.id}`} className="text-[13px] font-medium underline underline-offset-4">
                  Abrir OS
                </Link>
              )}
            </div>
            {!canOrders ? (
              <p className="text-muted">As OS deste equipamento aparecem para quem acompanha todas as ordens.</p>
            ) : orders.isPending ? (
              <Spinner label="Carregando" />
            ) : orders.isError ? (
              <ErrorState error={orders.error} />
            ) : orders.data.length === 0 ? (
              <p className="text-muted">Nenhuma OS para este equipamento ainda.</p>
            ) : (
              <ul className="grid gap-2">
                {orders.data.map((o) => {
                  const st = workflow.data?.statuses.find((x) => x.key === o.status)
                  return (
                    <li key={o.id} className="grid gap-0.5">
                      <span className="flex items-center gap-2">
                        <Link to={`/ordens/${o.id}`} className="font-semibold tabular-nums hover:underline">
                          {formatCode('OS', o.number)}
                        </Link>
                        <Badge tone={st ? stageTone[st.stage] : 'neutral'}>{st?.label ?? o.status}</Badge>
                        <span className="ml-auto text-muted tabular-nums">{formatDate(o.received_at)}</span>
                      </span>
                      <span className="truncate text-muted">{o.reported_problem}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {canWrite &&
            (e.archived_at ? (
              <Button variant="secondary" loading={archive.isPending} onClick={() => archive.mutate(false)} className="justify-self-start">
                <ArchiveRestore className="size-4" aria-hidden /> Reativar equipamento
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmArchive(true)} className="justify-self-start">
                <Archive className="size-4" aria-hidden /> Arquivar equipamento
              </Button>
            ))}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Arquivar ${code}?`}
        description="Use quando o equipamento não volta mais (vendido, descartado). O histórico é mantido e o número de série fica livre para um novo cadastro."
        confirmLabel="Arquivar equipamento"
        tone="primary"
        loading={archive.isPending}
        onConfirm={() => archive.mutate(true)}
      />
    </div>
  )
}
