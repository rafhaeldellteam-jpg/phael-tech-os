import { cn } from './cn'

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <svg className={cn('size-5 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className={label ? 'text-sm text-muted' : 'sr-only'}>{label ?? 'Carregando'}</span>
    </span>
  )
}

export function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner label={label} />
    </div>
  )
}
