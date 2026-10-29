import type { ReactNode } from 'react'

export function AuthLayout({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-navy-900 p-10 text-navy-100 lg:flex">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-9" />
          <span className="text-lg font-semibold text-white [font-stretch:85%]">Phael Tech OS</span>
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
        <p className="text-xs text-navy-300">Phael Tech Support</p>
      </aside>
      <main className="grid place-items-center p-6">
        <div className="grid w-full max-w-sm gap-6">
          <div className="flex items-center gap-2 lg:hidden">
            <img src="/favicon.svg" alt="" className="size-8" />
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
