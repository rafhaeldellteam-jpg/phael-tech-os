import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 dark:bg-ok-500 dark:text-navy-950 dark:hover:bg-[#9dd22f]',
  secondary: 'surface hover:bg-[var(--surface-muted)]',
  ghost: 'hover:bg-black/5 dark:hover:bg-white/10',
  danger: 'bg-danger-600 text-white hover:brightness-110',
}

/** Classes de botão, também usadas em links que parecem botões. */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55',
    size === 'md' ? 'h-10 px-4 text-sm' : 'h-8 px-3 text-[13px]',
    variants[variant],
    extra,
  )
}
