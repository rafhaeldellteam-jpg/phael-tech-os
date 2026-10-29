import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="grid justify-items-start gap-2 rounded-md border border-dashed border-line p-6">
      <Icon className="size-5 text-muted" aria-hidden />
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-prose text-sm text-muted">{children}</div>}
      {action}
    </div>
  )
}
