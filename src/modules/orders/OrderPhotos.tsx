import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Eye, EyeOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { Json, PhotoStage } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { compressImage } from '@/lib/image'
import { requireSupabase } from '@/lib/supabase'
import { orderKeys } from './queries'

export const stageLabels: Record<PhotoStage, string> = { intake: 'Entrada', repair: 'Reparo', delivery: 'Entrega', other: 'Outra' }
const BUCKET = 'order-photos'

/** Fotos da OS: envio pelo celular (comprimidas), legenda, etapa e liberação para o cliente. */
export function OrderPhotos({ companyId, orderId, canUpload, canDelete }: { companyId: string; orderId: string; canUpload: boolean; canDelete: boolean }) {
  const queryClient = useQueryClient()
  const key = [...orderKeys.all(companyId), 'photos', orderId] as const
  const [stage, setStage] = useState<PhotoStage>('intake')
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const photos = useQuery({
    queryKey: key,
    queryFn: async () => {
      const sb = requireSupabase()
      const { data, error: e } = await sb
        .from('order_photos')
        .select('id, storage_path, stage, caption, visible_to_client, created_at')
        .eq('order_id', orderId)
        .order('created_at')
      if (e) throw e
      const rows = data ?? []
      if (rows.length === 0) return []
      const signed = await sb.storage.from(BUCKET).createSignedUrls(
        rows.map((r) => r.storage_path),
        3600,
      )
      if (signed.error) throw signed.error
      const urls = new Map(signed.data.map((s) => [s.path, s.signedUrl]))
      return rows.map((r) => ({ ...r, url: urls.get(r.storage_path) ?? null }))
    },
  })
  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: orderKeys.events(companyId, orderId) })])

  const upload = async (files: FileList) => {
    setError(null)
    const sb = requireSupabase()
    const list = Array.from(files).slice(0, 10)
    try {
      for (let i = 0; i < list.length; i++) {
        setProgress(`Enviando ${i + 1} de ${list.length}…`)
        const file = list[i] as File
        const img = await compressImage(file)
        const path = `${companyId}/${orderId}/${crypto.randomUUID()}.jpg`
        const up = await sb.storage.from(BUCKET).upload(path, img.blob, { contentType: 'image/jpeg', upsert: false })
        if (up.error) throw up.error
        const { error: e } = await sb.rpc('register_order_photo', {
          p_order_id: orderId,
          p_path: path,
          p_data: { stage, width: img.width, height: img.height, size_bytes: img.blob.size } as Json,
        })
        if (e) {
          await sb.storage.from(BUCKET).remove([path])
          throw e
        }
      }
    } catch (e) {
      setError(e)
    } finally {
      setProgress(null)
      await refresh()
    }
  }

  const update = useMutation({
    mutationFn: async (a: { id: string; data: Record<string, unknown> }) => {
      const { error: e } = await requireSupabase().rpc('update_order_photo', { p_photo_id: a.id, p_data: a.data as Json })
      if (e) throw e
    },
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const sb = requireSupabase()
      const { data: path, error: e } = await sb.rpc('delete_order_photo', { p_photo_id: id })
      if (e) throw e
      if (path) await sb.storage.from(BUCKET).remove([path])
    },
    onSuccess: refresh,
  })
  const err = error ?? update.error ?? remove.error

  return (
    <section className="surface grid gap-3 rounded-lg p-5" aria-labelledby="fotos-h">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="fotos-h" className="font-semibold">
          Fotos
        </h2>
        {canUpload && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-[12px] text-muted">
              Etapa
              <select value={stage} onChange={(e) => setStage(e.target.value as PhotoStage)} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]">
                {(Object.keys(stageLabels) as PhotoStage[]).map((s) => (
                  <option key={s} value={s}>
                    {stageLabels[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm font-medium hover:bg-[var(--surface-muted)] focus-within:outline-2 focus-within:outline-brand-600">
              <Camera className="size-4" aria-hidden />
              {progress ?? 'Adicionar fotos'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                disabled={Boolean(progress)}
                aria-label="Adicionar fotos"
                onChange={(e) => {
                  const files = e.target.files
                  if (files && files.length) void upload(files)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        )}
      </div>
      {err != null && <Alert tone="error">{toUserMessage(err)}</Alert>}
      {photos.isPending ? (
        <Spinner label="Carregando fotos" />
      ) : (photos.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">Nenhuma foto. Registre o estado do equipamento na entrada: protege você em caso de reclamação.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(photos.data ?? []).map((p) => (
            <li key={p.id} className="grid content-start gap-1.5 text-[13px]">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-line bg-black/5">
                  <img src={p.url} alt={p.caption ?? `Foto de ${stageLabels[p.stage].toLowerCase()}`} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                </a>
              ) : (
                <div className="aspect-[4/3] rounded-md border border-line" />
              )}
              <div className="flex flex-wrap items-center gap-1">
                <Badge>{stageLabels[p.stage]}</Badge>
                {p.visible_to_client && <Badge tone="ok">Cliente vê</Badge>}
              </div>
              {canUpload ? (
                <input
                  defaultValue={p.caption ?? ''}
                  placeholder="Legenda"
                  aria-label="Legenda da foto"
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v !== (p.caption ?? '')) update.mutate({ id: p.id, data: { caption: v } })
                  }}
                  className="h-8 rounded-md border border-line bg-[var(--surface)] px-2"
                />
              ) : (
                p.caption && <p>{p.caption}</p>
              )}
              <span className="text-[12px] text-muted">{formatDateTime(p.created_at)}</span>
              {canUpload && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: p.id, data: { visible_to_client: !p.visible_to_client } })}>
                    {p.visible_to_client ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    {p.visible_to_client ? 'Ocultar do cliente' : 'Mostrar ao cliente'}
                  </Button>
                  {canDelete && (
                    <Button size="sm" variant="ghost" aria-label="Apagar foto" loading={remove.isPending && remove.variables === p.id} onClick={() => remove.mutate(p.id)}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
