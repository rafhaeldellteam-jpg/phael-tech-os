import { jpegSize, type PdfJpeg } from './writer'

const cache = new Map<string, Promise<PdfJpeg>>()

/**
 * Converte uma imagem (webp/png com transparência) em JPEG sobre um fundo sólido,
 * no formato que o PDF aceita. Resultado em cache por URL e cor.
 */
export function loadLogoJpeg(url: string, background: [number, number, number], scale = 2): Promise<PdfJpeg> {
  const key = `${url}|${background.join(',')}|${scale}`
  let p = cache.get(key)
  if (!p) {
    p = (async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error('Não foi possível carregar o logo')
      const bitmap = await createImageBitmap(await res.blob())
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width * scale
      canvas.height = bitmap.height * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas indisponível')
      ctx.fillStyle = `rgb(${background.join(',')})`
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('Falha ao converter o logo')
      const data = new Uint8Array(await blob.arrayBuffer())
      return { data, ...jpegSize(data) }
    })()
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

/** Dispara o download de bytes como arquivo. */
export function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/pdf'): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
