import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from './cn'

type Tone = 'info' | 'success' | 'warning' | 'error'

const tones: Record<Tone, { cls: string; Icon: typeof Info }> = {
  info: { cls: 'border-navy-300/60 bg-navy-100/50 dark:bg-navy-700/40', Icon: Info },
  success: { cls: 'border-ok-500/50 bg-ok-100 dark:bg-ok-600/15', Icon: CircleCheck },
  warning: { cls: 'border-attn-500/50 bg-attn-100 dark:bg-attn-600/15', Icon: TriangleAlert },
  error: { cls: 'border-danger-600/50 bg-danger-100 dark:bg-danger-600/15', Icon: CircleAlert },
}

export function Alert({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const { cls, Icon } = tones[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-md border p-3 text-sm', cls)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid gap-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  )
}
