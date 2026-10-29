import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { formatCode, formatPhone } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'
import { searchTerm } from './queries'

export interface PickedClient {
  id: string
  name: string
  code: number
}

/** Campo de busca de cliente (combobox acessível). */
export function ClientPicker({
  companyId,
  value,
  onChange,
  error,
}: {
  companyId: string
  value: PickedClient | null
  onChange: (client: PickedClient | null) => void
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

  const term = searchTerm(debounced)
  const results = useQuery({
    queryKey: ['clients', companyId, 'picker', term],
    enabled: open && term !== null,
    queryFn: async () => {
      const { data, error: err } = await requireSupabase()
        .from('clients')
        .select('id, name, code, whatsapp, phone')
        .eq('company_id', companyId)
        .is('archived_at', null)
        .ilike('search_text', `%${term}%`)
        .order('name')
        .limit(8)
      if (err) throw err
      return data ?? []
    },
  })
  const options = results.data ?? []

  if (value) {
    return (
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Cliente</span>
        <div className="flex h-10 items-center gap-3 rounded-md border border-line bg-[var(--surface-muted)] px-3 text-sm">
          <span className="text-muted tabular-nums">{formatCode('CL', value.code)}</span>
          <span className="flex-1 truncate font-medium">{value.name}</span>
          <button type="button" className="text-[13px] underline underline-offset-4" onClick={() => onChange(null)}>
            Trocar
          </button>
        </div>
      </div>
    )
  }

  const choose = (o: (typeof options)[number]) => {
    onChange({ id: o.id, name: o.name, code: o.code })
    setText('')
    setOpen(false)
  }

  return (
    <div className="relative grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Cliente
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
        placeholder="Digite nome, telefone ou código"
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
      {open && term !== null && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="surface absolute top-full z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md py-1 text-sm shadow-lg"
        >
          {results.isPending ? (
            <li className="px-3 py-2 text-muted">Buscando…</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-muted">Nenhum cliente encontrado. Cadastre o cliente antes.</li>
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
                <span className="w-16 text-muted tabular-nums">{formatCode('CL', o.code)}</span>
                <span className="flex-1 truncate">{o.name}</span>
                <span className="text-muted">{formatPhone(o.whatsapp ?? o.phone)}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
