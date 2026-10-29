import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/Field'
import { FormDialog } from '@/components/ui/FormDialog'
import { TextAreaField } from '@/components/ui/TextArea'
import type { Json, WarrantyClaimStatus } from '@/lib/database.types'
import { toUserMessage } from '@/lib/errors'
import { formatCode } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { formatIsoDate } from '../finance/period'
import { orderKeys } from '../orders/queries'
import { claimStatusLabels, daysLeftLabel } from './meta'
import { warrantyKeys } from './queries'

export interface CoveredItem {
  item_id: string
  description: string
  expires_on: string
  days_left: number
  open_claims: number
}

/** Acionar garantia: escolhe o item, descreve o defeito; fora do prazo pede o motivo da cortesia. */
export function OpenClaimDialog({
  companyId,
  orderId,
  orderNumber,
  items,
  initialItemId,
  onClose,
}: {
  companyId: string
  orderId: string
  orderNumber: number
  items: CoveredItem[]
  initialItemId?: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [itemId, setItemId] = useState(initialItemId ?? items.find((i) => i.days_left >= 0 && i.open_claims === 0)?.item_id ?? items[0]?.item_id ?? '')
  const [reason, setReason] = useState('')
  const [courtesy, setCourtesy] = useState('')
  const [touched, setTouched] = useState(false)
  const item = items.find((i) => i.item_id === itemId)
  const expired = !item || item.days_left < 0
  const errors = {
    reason: reason.trim().length < 5 ? 'Descreva o defeito relatado (mínimo 5 caracteres)' : undefined,
    courtesy: expired && courtesy.trim().length < 5 ? 'Fora do prazo: informe por que vai atender mesmo assim' : undefined,
  }
  const valid = !errors.reason && !errors.courtesy

  const open = useMutation({
    mutationFn: async () => {
      const { data, error } = await requireSupabase().rpc('open_warranty_claim', {
        p_order_id: orderId,
        p_data: {
          item_id: itemId || null,
          reason: reason.trim(),
          courtesy_reason: expired ? courtesy.trim() : null,
        } as Json,
      })
      if (error) throw error
      const row = data?.[0]
      if (!row) throw new Error('O banco não retornou a OS de retorno')
      return row
    },
    onSuccess: async (row) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: warrantyKeys.all(companyId) }),
        queryClient.invalidateQueries({ queryKey: orderKeys.all(companyId) }),
      ])
      onClose()
      navigate(`/ordens/${row.return_order_id}`, { state: { saved: 'warranty' } })
    },
  })

  return (
    <FormDialog
      title={`Acionar garantia da ${formatCode('OS', orderNumber)}`}
      description="Abre uma OS de retorno vinculada a esta, com o mesmo cliente, equipamento e técnico."
      onClose={onClose}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (valid) open.mutate()
        }}
      >
        {open.isError && <Alert tone="error">{toUserMessage(open.error)}</Alert>}
        <SelectField label="Item em garantia" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          {items.map((i) => (
            <option key={i.item_id} value={i.item_id}>
              {i.description}: até {formatIsoDate(i.expires_on)} ({daysLeftLabel(i.days_left)})
              {i.open_claims > 0 ? ', já acionada' : ''}
            </option>
          ))}
        </SelectField>
        {item && item.open_claims > 0 && <Alert tone="warning">Este item já tem um acionamento em andamento. Acompanhe pela OS de retorno.</Alert>}
        <TextAreaField
          label="Defeito relatado pelo cliente"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={touched ? errors.reason : undefined}
        />
        {expired && (
          <TextAreaField
            label="Motivo da cortesia"
            hint="A garantia deste item venceu. O atendimento fica registrado como cortesia."
            rows={2}
            value={courtesy}
            onChange={(e) => setCourtesy(e.target.value)}
            error={touched ? errors.courtesy : undefined}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={open.isPending}>
            Abrir OS de retorno
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}

const decisionVerb: Record<WarrantyClaimStatus, string> = {
  open: '',
  accepted: 'Aceitar garantia',
  denied: 'Negar garantia',
  resolved: 'Marcar como resolvida',
}

export function DecideClaimDialog({
  companyId,
  claim,
  to,
  onClose,
}: {
  companyId: string
  claim: { id: string; number: number }
  to: WarrantyClaimStatus
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const needsNote = to === 'denied'
  const decide = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('decide_warranty_claim', { p_claim_id: claim.id, p_status: to, p_note: note.trim() || null })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: warrantyKeys.all(companyId) }),
        queryClient.invalidateQueries({ queryKey: orderKeys.all(companyId) }),
      ])
      onClose()
    },
  })
  const missing = needsNote && note.trim().length < 5
  return (
    <FormDialog title={`${decisionVerb[to]} (${formatCode('GA', claim.number)})`} description={`Nova situação: ${claimStatusLabels[to]}.`} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!missing) decide.mutate()
        }}
      >
        {decide.isError && <Alert tone="error">{toUserMessage(decide.error)}</Alert>}
        <TextAreaField
          label={needsNote ? 'Motivo da negativa' : 'Observação (opcional)'}
          placeholder={to === 'resolved' ? 'O que foi feito para resolver' : to === 'denied' ? 'Ex.: dano por queda, fora da cobertura' : ''}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant={to === 'denied' ? 'danger' : 'primary'} loading={decide.isPending} disabled={missing}>
            {decisionVerb[to]}
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}
