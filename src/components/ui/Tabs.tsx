import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './cn'

export interface TabItem<K extends string> {
  key: K
  label: string
  badge?: ReactNode
}

/** Abas acessíveis (setas do teclado, aria-selected). O conteúdo é renderizado pelo chamador. */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<K>[]
  value: K
  onChange: (key: K) => void
  label: string
}) {
  const id = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKey = (e: KeyboardEvent, index: number) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const next = (index + dir + items.length) % items.length
    const item = items[next]
    if (!item) return
    onChange(item.key)
    refs.current[next]?.focus()
  }
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line">
      {items.map((item, i) => {
        const selected = item.key === value
        return (
          <button
            key={item.key}
            ref={(el) => {
              refs.current[i] = el
            }}
            id={`${id}-${item.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap',
              selected ? 'border-brand-600 font-medium dark:border-ok-500' : 'border-transparent text-muted hover:text-[var(--text)]',
            )}
          >
            {item.label}
            {item.badge}
          </button>
        )
      })}
    </div>
  )
}
