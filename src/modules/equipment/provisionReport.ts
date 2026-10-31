/**
 * Leitor do relatório que o Phael Tech Provision grava ao finalizar
 * ("Provisionamento-<PC>-<data>.txt", na Área de Trabalho e em ProgramData).
 * Formato gerado por core/provision.py:write_report.
 */

export interface ProvisionReport {
  generatedAt: string | null // ISO, horário local do relatório
  hostname: string | null
  manufacturer: string | null
  model: string | null
  serial: string | null
  assetTag: string | null
  os: string | null
  processor: string | null
  board: string | null
  memory: string | null
  graphics: string | null
  audio: string | null
  disks: string[]
  log: string[]
}

const field = (line: string, label: string): string | null => {
  const m = new RegExp(`^${label}\\s*\\.*\\s*(.*)$`).exec(line)
  if (!m) return null
  const v = (m[1] ?? '').trim()
  return v && v !== '—' ? v : null
}

const KNOWN_VENDORS = ['Dell Inc.', 'Dell', 'LENOVO', 'Lenovo', 'HP', 'Hewlett-Packard', 'Positivo Tecnologia SA', 'Positivo', 'ASUSTeK COMPUTER INC.', 'Acer', 'Samsung']

/** Separa "Dell Inc. Latitude 5440" em fabricante e modelo. */
export function splitMakerModel(value: string): { manufacturer: string | null; model: string | null } {
  const v = value.trim()
  const known = KNOWN_VENDORS.find((k) => v.toLowerCase().startsWith(k.toLowerCase() + ' ') || v.toLowerCase() === k.toLowerCase())
  if (known) {
    const model = v.slice(known.length).trim()
    return { manufacturer: v.slice(0, known.length).replace(/ Inc\.$/, ''), model: model || null }
  }
  const [first, ...rest] = v.split(/\s+/)
  return { manufacturer: first || null, model: rest.join(' ') || null }
}

export function parseProvisionReport(text: string): ProvisionReport {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  if (!/PHAEL TECH PROVISION/i.test(lines[0] ?? '')) {
    throw new Error('Este arquivo não parece um relatório do Phael Tech Provision.')
  }
  const r: ProvisionReport = {
    generatedAt: null,
    hostname: null,
    manufacturer: null,
    model: null,
    serial: null,
    assetTag: null,
    os: null,
    processor: null,
    board: null,
    memory: null,
    graphics: null,
    audio: null,
    disks: [],
    log: [],
  }
  const d = /\((\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})\)/.exec(lines[0] ?? '')
  if (d) r.generatedAt = `${d[3]}-${d[2]}-${d[1]}T${d[4]}:${d[5]}:00`

  let inLog = false
  for (const raw of lines.slice(1)) {
    const line = raw.trimEnd()
    if (inLog) {
      if (!/^-{5,}$/.test(line) && line) r.log.push(line)
      continue
    }
    if (line === 'LOG DA SESSÃO') {
      inLog = true
      continue
    }
    const maker = field(line, 'Fabricante/Modelo')
    if (maker) Object.assign(r, splitMakerModel(maker))
    r.hostname ??= field(line, 'Computador')
    r.assetTag ??= field(line, 'Patrimônio')
    r.os ??= field(line, 'Sistema')
    r.processor ??= field(line, 'Processador')
    r.board ??= field(line, 'Placa-mãe')
    r.memory ??= field(line, 'Memória')
    r.graphics ??= field(line, 'Vídeo')
    r.audio ??= field(line, 'Áudio')
    const disk = field(line, 'Disco')
    if (disk) r.disks.push(disk)
    const serial = /^(Service Tag|Número de série[^:]*|Serial)\s*:\s*(.+)$/.exec(line)
    if (serial && !r.serial) r.serial = (serial[2] ?? '').trim() || null
  }
  // "Microsoft Windows 11 Pro 24H2 (build 26100.2314)" → sem o build longo
  if (r.os) r.os = r.os.replace(/\s+\(build [^)]*\)\s*$/, '').trim()
  // "16 GB em 2 pente(s) de 2 slot(s)" → "16 GB (2 pentes, 2 slots)"
  if (r.memory) {
    const m = /^(\d+ GB) em (\d+) pente\(s\) de (\d+) slot\(s\)$/.exec(r.memory)
    if (m) r.memory = `${m[1]} (${m[2]} pente${m[2] === '1' ? '' : 's'}, ${m[3]} slot${m[3] === '1' ? '' : 's'})`
  }
  return r
}

/** Converte para os campos da ficha do equipamento (limites do banco). */
export function toEquipmentFields(r: ProvisionReport) {
  const cut = (v: string | null, n: number) => (v ? v.slice(0, n) : null)
  return {
    manufacturer: cut(r.manufacturer, 80),
    model: cut(r.model, 120),
    serial_number: cut(r.serial, 80),
    asset_tag: cut(r.assetTag, 80),
    processor: cut(r.processor, 120),
    memory: cut(r.memory, 60),
    storage: cut(r.disks.map((d) => d.replace(/\s+—\s+(Healthy|OK)$/i, '')).join('; ') || null, 120),
    graphics: cut(r.graphics, 120),
    operating_system: cut(r.os, 80),
  }
}
