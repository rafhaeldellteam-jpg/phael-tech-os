import { z } from 'zod'

const text = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres`)

/** Campos de configuração que só fazem sentido para computadores. */
export const COMPUTER_TYPES = new Set(['notebook', 'desktop', 'all_in_one', 'server'])

export const equipmentSchema = z.object({
  clientId: z.string().min(1, 'Escolha o cliente'),
  type: z.string().min(1, 'Escolha o tipo'),
  manufacturer: text(80),
  model: text(120),
  serialNumber: text(80),
  assetTag: text(80),
  processor: text(120),
  memory: text(60),
  storage: text(120),
  graphics: text(120),
  operatingSystem: text(80),
  conditionNotes: text(2000),
  accessories: text(600),
})

export type EquipmentFormValues = z.infer<typeof equipmentSchema>

/** "Carregador, mochila; mouse" → ["Carregador", "mochila", "mouse"] (sem repetidos). */
export function parseAccessories(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,;\n]/)) {
    const item = part.trim()
    const key = item.toLowerCase()
    if (item && !seen.has(key)) {
      seen.add(key)
      out.push(item)
    }
  }
  return out.slice(0, 30)
}

export function toEquipmentPayload(v: EquipmentFormValues): Record<string, unknown> {
  // Configuração só vale para computadores; trocar o tipo descarta o que ficou oculto.
  const computer = COMPUTER_TYPES.has(v.type)
  const spec = (value: string) => (computer ? value : '')
  return {
    client_id: v.clientId,
    type: v.type,
    manufacturer: v.manufacturer,
    model: v.model,
    serial_number: v.serialNumber,
    asset_tag: v.assetTag,
    processor: spec(v.processor),
    memory: spec(v.memory),
    storage: spec(v.storage),
    graphics: spec(v.graphics),
    operating_system: spec(v.operatingSystem),
    condition_notes: v.conditionNotes,
    accessories: parseAccessories(v.accessories),
  }
}

