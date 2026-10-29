import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

/** Diálogo com formulário (rolável em telas pequenas). */
export function FormDialog({
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  title: string
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy-950/50" />
        <Dialog.Content
          className={`surface fixed top-1/2 left-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_1fr] gap-4 rounded-lg p-5 shadow-xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        >
          <div className="flex items-start gap-3">
            <div className="grid flex-1 gap-1">
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Fechar">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto pr-1">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
