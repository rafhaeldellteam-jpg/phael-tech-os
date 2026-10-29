import type { ReactNode } from 'react'
import { BrandLogo } from '@/components/ui/BrandLogo'

export function AuthLayout({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-navy-900 bg-[radial-gradient(120%_80%_at_0%_100%,rgba(0,64,160,.55),transparent_60%)] p-10 text-navy-100 lg:flex">
        <div className="grid gap-3">
          <BrandLogo variant="full" className="w-56" />
          <p className="text-sm text-navy-300">Phael Tech OS, gestão de assistência técnica</p>
        </div>
        <div className="grid max-w-sm gap-6">
          <p className="text-3xl leading-tight font-semibold text-white [font-stretch:80%]">
            Cada equipamento, do balcão à entrega.
          </p>
          <ul className="grid gap-3 text-sm">
            <li className="flex items-center gap-3">
              <span className="size-2 rounded-full bg-attn-500" aria-hidden /> Aguardando aprovação
            </li>
            <li className="flex items-center gap-3">
              <span className="size-2 rounded-full bg-navy-300" aria-hidden /> Em reparo
            </li>
            <li className="flex items-center gap-3">
              <span className="size-2 rounded-full bg-ok-500" aria-hidden /> Pronto para retirada
            </li>
          </ul>
        </div>
        <p className="text-xs text-navy-300">Soluções e suporte técnico</p>
      </aside>
      <main className="grid place-items-center p-6">
        <div className="grid w-full max-w-sm gap-6">
          <div className="flex items-center gap-2.5 lg:hidden">
            <BrandLogo variant="shield" className="size-10" />
            <span className="font-semibold">Phael Tech OS</span>
          </div>
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-sm text-muted">{description}</p>}
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
