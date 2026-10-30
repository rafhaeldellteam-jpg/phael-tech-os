import { Eraser } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from './Button'

export interface SignaturePadHandle {
  /** PNG em data URL, recortado na área desenhada; null se vazio. */
  toDataUrl: () => string | null
  clear: () => void
}

/**
 * Campo para assinar com o dedo, caneta ou mouse.
 * Desenha em alta resolução e exporta PNG com fundo transparente.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, { label: string; onChange?: (empty: boolean) => void }>(function SignaturePad(
  { label, onChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const bounds = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null)
  const [empty, setEmpty] = useState(true)

  const setup = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const ratio = Math.max(window.devicePixelRatio || 1, 2)
    const rect = c.getBoundingClientRect()
    c.width = Math.round(rect.width * ratio)
    c.height = Math.round(rect.height * ratio)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0b1f4d'
    ctx.fillStyle = '#0b1f4d'
    bounds.current = null
    setEmpty(true)
    onChange?.(true)
  }, [onChange])

  useEffect(() => {
    setup()
  }, [setup])

  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const grow = (p: { x: number; y: number }) => {
    const b = bounds.current
    bounds.current = b
      ? { minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) }
      : { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
  }

  useImperativeHandle(ref, () => ({
    clear: setup,
    toDataUrl: () => {
      const c = canvasRef.current
      const b = bounds.current
      if (!c || !b || empty) return null
      const ratio = c.width / c.getBoundingClientRect().width
      const pad = 8
      const sx = Math.max(0, Math.floor((b.minX - pad) * ratio))
      const sy = Math.max(0, Math.floor((b.minY - pad) * ratio))
      const sw = Math.min(c.width - sx, Math.ceil((b.maxX - b.minX + 2 * pad) * ratio))
      const sh = Math.min(c.height - sy, Math.ceil((b.maxY - b.minY + 2 * pad) * ratio))
      // Limita o tamanho final para caber no banco (assinatura nítida até ~900 px).
      const scale = Math.min(1, 900 / sw)
      const out = document.createElement('canvas')
      out.width = Math.max(1, Math.round(sw * scale))
      out.height = Math.max(1, Math.round(sh * scale))
      out.getContext('2d')?.drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height)
      return out.toDataURL('image/png')
    },
  }))

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Button size="sm" variant="ghost" onClick={setup} disabled={empty}>
          <Eraser className="size-4" aria-hidden /> Limpar
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${label}: área para desenhar a assinatura`}
        className="h-44 w-full touch-none rounded-md border border-dashed border-line bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          const p = point(e)
          last.current = p
          grow(p)
          const ctx = e.currentTarget.getContext('2d')
          ctx?.beginPath()
          ctx?.arc(p.x, p.y, 1.2, 0, Math.PI * 2)
          ctx?.fill()
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return
          const ctx = e.currentTarget.getContext('2d')
          if (!ctx) return
          const p = point(e)
          ctx.beginPath()
          ctx.moveTo(last.current.x, last.current.y)
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
          last.current = p
          grow(p)
          if (empty) {
            setEmpty(false)
            onChange?.(false)
          }
        }}
        onPointerUp={() => {
          drawing.current = false
          last.current = null
        }}
        onPointerCancel={() => {
          drawing.current = false
          last.current = null
        }}
      />
      <p className="text-[12px] text-muted">Assine com o dedo, a caneta ou o mouse dentro do quadro.</p>
    </div>
  )
})
