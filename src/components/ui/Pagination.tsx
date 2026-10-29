import { Button } from './Button'

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return <p className="text-sm text-muted tabular-nums">{total} registro(s)</p>
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Paginação">
      <span className="text-muted tabular-nums">
        Página {page + 1} de {pages}, {total} registros
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Anterior
        </Button>
        <Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
          Próxima
        </Button>
      </div>
    </nav>
  )
}
