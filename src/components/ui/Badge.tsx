import type { ReactNode } from 'react'
import { cn } from './cn'

type Tone = 'neutral' | 'ok' | 'attn' | 'danger'

const tones: Record<Tone, string> = {
  neutral: 'bg-navy-100 text-navy-800 dark:bg-navy-700 dark:text-navy-100',
  ok: 'bg-ok-100 text-ok-600 dark:bg-ok-600/20 dark:text-ok-500',
  attn: 'bg-attn-100 text-attn-600 dark:bg-attn-600/20 dark:text-attn-500',
  danger: 'bg-danger-100 text-danger-600 dark:bg-danger-600/20',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  )
}
