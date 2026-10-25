// 7.5 P1-B — native visuals leave the screen as the same drawing: SVG (the exact file) or PNG rasterized
// from that same SVG. A PNG that cannot be produced is reported; it is never replaced by an SVG download.
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** True when the bytes start with the PNG signature and carry an IHDR of the given size (when given). */
export function isPng(bytes: Uint8Array, expect?: { width: number; height: number }): boolean {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return false
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return false
  if (!expect) return true
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return dv.getUint32(16) === expect.width && dv.getUint32(20) === expect.height
}

export type PngResult = { ok: true; blob: Blob; width: number; height: number } | { ok: false; reason: string }

/** Rasterize an SVG document (with explicit width/height) at `scale`. Browser only. Never throws. */
export async function svgToPng(svg: string, scale = 2, timeoutMs = 15000): Promise<PngResult> {
  const m = /<svg[^>]*\swidth="(\d+(?:\.\d+)?)"[^>]*\sheight="(\d+(?:\.\d+)?)"/.exec(svg)
  if (!m) return { ok: false, reason: 'la imagen no tiene dimensiones fijas' }
  const width = Math.round(Number(m[1]) * scale), height = Math.round(Number(m[2]) * scale)
  if (width * height > 40_000_000) return { ok: false, reason: 'la imagen es demasiado grande para convertirla a PNG en este navegador' }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    const loaded = await Promise.race([
      new Promise<boolean>(res => { img.onload = () => res(true); img.onerror = () => res(false); img.src = url }),
      new Promise<boolean>(res => setTimeout(() => res(false), timeoutMs)),
    ])
    if (!loaded) return { ok: false, reason: 'el navegador no pudo dibujar la imagen' }
    const c = document.createElement('canvas'); c.width = width; c.height = height
    const g = c.getContext('2d')
    if (!g) return { ok: false, reason: 'este navegador no permite crear imágenes PNG' }
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, width, height)
    g.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'))
    if (!blob || blob.size === 0) return { ok: false, reason: 'el navegador no generó el PNG' }
    const head = new Uint8Array(await blob.slice(0, 33).arrayBuffer())
    if (!isPng(head, { width, height })) return { ok: false, reason: 'el PNG generado no es válido' }
    return { ok: true, blob, width, height }
  } catch {
    return { ok: false, reason: 'el navegador no pudo convertir la imagen a PNG' }
  } finally { URL.revokeObjectURL(url) }
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
