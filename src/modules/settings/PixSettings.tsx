import { useMutation, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { toUserMessage } from '@/lib/errors'
import { buildPixPayload, normalizePixKey, pixText, type PixKeyType } from '@/lib/pix'
import { requireSupabase } from '@/lib/supabase'
import { settingsKeys } from './queries'

const typeLabels: Record<PixKeyType, string> = {
  phone: 'Celular',
  email: 'E-mail',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  random: 'Chave aleatória',
}

interface PixData {
  pix_key_type: string | null
  pix_key: string | null
  pix_merchant_name: string | null
  pix_city: string | null
  name: string
}

/** Chave Pix usada nas cobranças, com QR de teste (sem valor) para conferir no app do banco. */
export function PixSettings({ companyId, data, canEdit }: { companyId: string; data: PixData; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [type, setType] = useState<PixKeyType>((data.pix_key_type as PixKeyType | null) ?? 'phone')
  const [key, setKey] = useState(data.pix_key ?? '')
  const [name, setName] = useState(data.pix_merchant_name ?? pixText(data.name, 25))
  const [city, setCity] = useState(data.pix_city ?? 'Sao Paulo')
  const [qr, setQr] = useState<string | null>(null)
  const normalized = key.trim() ? normalizePixKey(type, key) : null
  const nameOk = pixText(name, 25).length >= 2
  const cityOk = pixText(city, 15).length >= 2
  const valid = (key.trim() === '' || normalized !== null) && nameOk && cityOk

  useEffect(() => {
    if (!data.pix_key) {
      setQr(null)
      return
    }
    const payload = buildPixPayload({ key: data.pix_key, name: data.pix_merchant_name ?? data.name, city: data.pix_city ?? 'BRASIL', txid: 'TESTE' })
    void QRCode.toDataURL(payload, { margin: 1, width: 180 }).then(setQr)
  }, [data])

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase()
        .from('companies')
        .update({
          pix_key_type: normalized ? type : null,
          pix_key: normalized,
          pix_merchant_name: pixText(name, 25),
          pix_city: pixText(city, 15),
        })
        .eq('id', companyId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.company(companyId) }),
  })

  return (
    <section className="surface grid max-w-2xl gap-4 rounded-lg p-5" aria-labelledby="pix-h">
      <div className="grid gap-1">
        <h2 id="pix-h" className="font-semibold">
          Pix para cobranças
        </h2>
        <p className="text-[13px] text-muted">
          Vai no QR Code e no "copia e cola" das cobranças enviadas aos clientes. Nome e cidade aparecem no app do banco de quem paga (sem acentos, como o
          padrão do Pix exige).
        </p>
      </div>
      {save.isError && <Alert tone="error">{toUserMessage(save.error)}</Alert>}
      {save.isSuccess && <Alert tone="success">Dados do Pix salvos.</Alert>}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) save.mutate()
        }}
      >
        <fieldset disabled={!canEdit} className="contents">
          <SelectField label="Tipo de chave" value={type} onChange={(e) => setType(e.target.value as PixKeyType)}>
            {(Object.keys(typeLabels) as PixKeyType[]).map((t) => (
              <option key={t} value={t}>
                {typeLabels[t]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Chave Pix"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            error={key.trim() && !normalized ? 'Chave inválida para o tipo escolhido' : undefined}
            hint={normalized ? `Será usada como: ${normalized}` : 'Deixe vazio para não usar Pix.'}
          />
          <TextField label="Nome do recebedor" value={name} onChange={(e) => setName(e.target.value)} error={nameOk ? undefined : 'Informe o nome'} hint="Até 25 letras." />
          <TextField label="Cidade" value={city} onChange={(e) => setCity(e.target.value)} error={cityOk ? undefined : 'Informe a cidade'} hint="Até 15 letras." />
        </fieldset>
        {canEdit && (
          <Button type="submit" className="justify-self-start" loading={save.isPending} disabled={!valid}>
            Salvar Pix
          </Button>
        )}
      </form>
      {qr && (
        <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4 text-sm">
          <img src={qr} alt="QR Code Pix de teste, sem valor" className="size-36 rounded bg-white p-1" />
          <p className="max-w-xs text-muted">
            QR de teste, sem valor: leia no app do seu banco e confira se aparece o seu nome antes de enviar cobranças. Não precisa concluir o pagamento.
          </p>
        </div>
      )}
    </section>
  )
}
