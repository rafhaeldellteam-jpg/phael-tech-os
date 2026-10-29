import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-content-center gap-3 p-6 text-center">
      <p className="text-5xl font-semibold tabular-nums [font-stretch:75%]">404</p>
      <p className="text-muted">Esta página não existe ou foi movida.</p>
      <Link to="/" className="underline underline-offset-4">
        Ir para o painel
      </Link>
    </div>
  )
}
