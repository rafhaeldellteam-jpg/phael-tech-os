import { cn } from './cn'

/**
 * Logo Phael Tech Support.
 * - "full": logo completa (texto branco) — só sobre fundo azul escuro.
 * - "shield": apenas o escudo — funciona sobre qualquer fundo.
 */
export function BrandLogo({ variant, className }: { variant: 'full' | 'shield'; className?: string }) {
  if (variant === 'shield') {
    return <img src="/brand/phael-shield.webp" alt="Phael Tech Support" width={191} height={191} className={cn('object-contain', className)} />
  }
  return <img src="/brand/phael-logo.webp" alt="Phael Tech Support" width={507} height={188} className={cn('h-auto object-contain', className)} />
}
