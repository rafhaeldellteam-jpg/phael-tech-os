import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight [font-stretch:88%]">{title}</h1>
        {description && <p className="max-w-prose text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  )
}
