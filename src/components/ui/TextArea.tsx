import { forwardRef, useId, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  error?: string | undefined
  hint?: ReactNode
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextAreaField(
  { label, error, hint, id, className, ...rest },
  ref,
) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <div className="grid gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        ref={ref}
        id={fieldId}
        rows={3}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={cn(
          'w-full rounded-md border border-line bg-[var(--surface)] px-3 py-2 text-sm placeholder:text-[var(--text-muted)]/70 focus-visible:border-brand-600 aria-[invalid=true]:border-danger-600',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${fieldId}-error`} className="text-[13px] text-danger-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
})
