import { presetLabels, presetRange, type PresetKey } from './period'

export function PeriodPicker({ from, to, onChange }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void }) {
  const presets = Object.keys(presetLabels) as PresetKey[]
  const active = presets.find((k) => {
    const r = presetRange(k)
    return r.from === from && r.to === to
  })
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Período">
        {presets.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={active === k}
            onClick={() => onChange(presetRange(k))}
            className={`h-9 rounded-md border px-3 text-sm ${active === k ? 'border-brand-600 bg-brand-600 text-white dark:border-ok-500 dark:bg-ok-500 dark:text-navy-950' : 'border-line hover:bg-[var(--surface-muted)]'}`}
          >
            {presetLabels[k]}
          </button>
        ))}
      </div>
      <label className="grid gap-1 text-[13px] text-muted">
        De
        <input type="date" value={from} max={to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to })} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]" />
      </label>
      <label className="grid gap-1 text-[13px] text-muted">
        Até
        <input type="date" value={to} min={from} onChange={(e) => e.target.value && onChange({ from, to: e.target.value })} className="h-9 rounded-md border border-line bg-[var(--surface)] px-2 text-sm text-[var(--text)]" />
      </label>
    </div>
  )
}
