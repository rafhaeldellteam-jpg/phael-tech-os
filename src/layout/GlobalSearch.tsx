import { useQuery } from '@tanstack/react-query'
import { Laptop, Search, UserRound } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useActiveCompany } from '@/core/company/useCompany'
import { formatCode } from '@/lib/format'
import { requireSupabase } from '@/lib/supabase'

/** Pesquisa global: clientes e equipamentos (OS entram quando o módulo existir). Atalho: Ctrl+K / ⌘K. */
export function GlobalSearch() {
  const id = useId()
  const navigate = useNavigate()
  const { company } = useActiveCompany()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250)
    return () => clearTimeout(t)
  }, [text])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = useQuery({
    queryKey: ['global-search', company.id, q],
    enabled: q.length >= 2,
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('global_search', { p_company_id: company.id, p_query: q })
      if (error) throw error
      return data ?? []
    },
  })
  const items = results.data ?? []

  const go = (item: (typeof items)[number]) => {
    navigate(item.kind === 'client' ? `/clientes/${item.id}` : `/equipamentos/${item.id}`)
    setText('')
    setQ('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const showList = open && q.length >= 2

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        Pesquisar clientes e equipamentos
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={inputRef}
        id={id}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={showList && items[active] ? `${id}-opt-${active}` : undefined}
        value={text}
        placeholder="Pesquisar clientes e equipamentos (Ctrl+K)"
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
            setActive((a) => Math.min(a + 1, items.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && items[active]) {
            e.preventDefault()
            go(items[active])
          } else if (e.key === 'Escape') {
            setOpen(false)
            inputRef.current?.blur()
          }
        }}
        className="h-9 w-full rounded-md border border-line bg-[var(--surface-muted)] pr-3 pl-9 text-sm placeholder:text-muted"
      />
      {showList && (
        <ul id={`${id}-list`} role="listbox" className="surface absolute top-full z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-md py-1 text-sm shadow-lg">
          {results.isPending ? (
            <li className="px-3 py-2 text-muted">Pesquisando…</li>
          ) : results.isError ? (
            <li className="px-3 py-2 text-danger-600">Não foi possível pesquisar agora.</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-2 text-muted">Nada encontrado para “{q}”.</li>
          ) : (
            items.map((item, i) => {
              const Icon = item.kind === 'client' ? UserRound : Laptop
              return (
                <li
                  key={`${item.kind}-${item.id}`}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    go(item)
                  }}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${i === active ? 'bg-[var(--surface-muted)]' : ''}`}
                >
                  <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.title}</span>
                    <span className="block truncate text-[13px] text-muted">{item.subtitle}</span>
                  </span>
                  <span className="text-[13px] text-muted tabular-nums">
                    {formatCode(item.kind === 'client' ? 'CL' : 'EQ', item.code)}
                  </span>
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
