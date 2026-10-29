import { toUserMessage } from '@/lib/errors'
import { Alert } from './Alert'
import { Button } from './Button'
import { cn } from './cn'

export function ErrorState({
  error,
  onRetry,
  fullPage = false,
}: {
  error: unknown
  onRetry?: () => unknown
  fullPage?: boolean
}) {
  return (
    <div className={cn('grid gap-3', fullPage && 'mx-auto min-h-dvh max-w-md place-content-center p-6')}>
      <Alert tone="error" title="Não foi possível carregar">
        {toUserMessage(error)}
      </Alert>
      {onRetry && (
        <Button variant="secondary" onClick={() => void onRetry()} className="justify-self-start">
          Tentar novamente
        </Button>
      )}
    </div>
  )
}
