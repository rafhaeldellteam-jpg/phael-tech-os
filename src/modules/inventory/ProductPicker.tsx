import { useEffect, useId, useState } from 'react'
import { formatBRL } from '@/lib/money'
import { useProductSearch } from './queries'

export interface PickedProduct {
  id: string
  sku: string
  name: string
  unit: string
  price_cents: number
  cost_cents: number
  qty_on_hand: number
  tracks_serial: boolean
  warranty_days?: number | null
}

/** Busca de produto ativo (combobox acessível). Mostra saldo para ajudar a escolher. */
export function ProductPicker({
  companyId,
  label = 'Produto',
  value,
  onChange,
  error,
}: {
  companyId: string
  label?: string
  value: PickedProduct | null
  onChange: (p: PickedProduct | null) => void
  error?: string | undefined
}) {
  const id = useId()
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 250)
    return () => clearTimeout(t)
  }, [text])

  const results = useProductSearch(companyId, debounced, open)
  const options = results.data ?? []

  if (value) {
    return (
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex h-10 items-center gap-3 rounded-md border border-line bg-[var(--surface-muted)] px-3 text-sm">
          <span className="text-muted tabular-nums">{value.sku}</span>
          <span className="flex-1 truncate font-medium">{value.name}</span>
          <span className="text-muted tabular-nums">
            {value.qty_on_hand} {value.unit}
          </span>
          <button type="button" className="text-[13px] underline underline-offset-4" onClick={() => onChange(null)}>
            Trocar
          </button>
        </div>
      </div>
    )
  }

  const choose = (o: PickedProduct) => {
    onChange(o)
    setText('')
    setOpen(false)
  }

  return (
    <div className="relative grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-invalid={Boolean(error) || undefined}
        aria-activedescendant={open && options[active] ? `${id}-opt-${active}` : undefined}
        value={text}
        placeholder="Digite SKU ou nome"
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, options.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && open && options[active]) {
            e.preventDefault()
            choose(options[active])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        className="h-10 w-full rounded-md border border-line bg-[var(--surface)] px-3 text-sm focus-visible:border-brand-600 aria-[invalid=true]:border-danger-600"
      />
      {error && (
        <p className="text-[13px] text-danger-600" role="alert">
          {error}
        </p>
      )}
      {open && (
        <ul id={`${id}-list`} role="listbox" className="surface absolute top-full z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md py-1 text-sm shadow-lg">
          {results.isPending ? (
            <li className="px-3 py-2 text-muted">Buscando…</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-muted">Nenhum produto ativo encontrado.</li>
          ) : (
            options.map((o, i) => (
              <li
                key={o.id}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(o)
                }}
                className={`flex cursor-pointer gap-3 px-3 py-2 ${i === active ? 'bg-[var(--surface-muted)]' : ''}`}
              >
                <span className="w-20 shrink-0 truncate text-muted tabular-nums">{o.sku}</span>
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                <span className={`tabular-nums ${o.qty_on_hand <= 0 ? 'text-danger-600' : 'text-muted'}`}>
                  {o.qty_on_hand} {o.unit}
                </span>
                <span className="w-24 text-right tabular-nums">{formatBRL(o.price_cents)}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
