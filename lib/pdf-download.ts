// 7.5 — «Descargar PDF»: a real file or a visible reason (order "TRES CORRECCIONES", point 2).
// The bytes the student receives are fetched and checked BEFORE anything is called a success:
// PDF header and trailer, and — when the server recorded them at render time — exact length and SHA-256.
// No silent timeout, no link without a file, no substitute (text, browser print).

export const PDF_REQUEST_TIMEOUT_MS = 120_000
export const PDF_FETCH_TIMEOUT_MS = 30_000
const MIN_PDF_BYTES = 500

export interface PdfExpectation { byteLength?: number; sha256?: string }
export type PdfCheck = { ok: true; bytes: Uint8Array; byteLength: number; sha256: string } | { ok: false; reason: string }

const ascii = (b: Uint8Array, from: number, to: number) => { let s = ''; for (let i = from; i < to; i++) s += String.fromCharCode(b[i]); return s }

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle
  if (!subtle) throw new Error('no_webcrypto')
  const d = new Uint8Array(await subtle.digest('SHA-256', bytes as unknown as ArrayBuffer))
  return Array.from(d, x => x.toString(16).padStart(2, '0')).join('')
}

/** Structural and integrity check of the received bytes. */
export async function verifyPdfBytes(bytes: Uint8Array, expected: PdfExpectation = {}): Promise<PdfCheck> {
  if (bytes.length < MIN_PDF_BYTES) return { ok: false, reason: `el archivo recibido tiene ${bytes.length} bytes; no es un PDF completo` }
  if (ascii(bytes, 0, 5) !== '%PDF-') return { ok: false, reason: 'el archivo recibido no es un PDF (cabecera inválida)' }
  if (!ascii(bytes, Math.max(0, bytes.length - 1024), bytes.length).includes('%%EOF')) return { ok: false, reason: 'el PDF recibido está incompleto (sin cierre %%EOF)' }
  if (typeof expected.byteLength === 'number' && expected.byteLength !== bytes.length) {
    return { ok: false, reason: `el PDF recibido mide ${bytes.length} bytes y el generado ${expected.byteLength}; la copia no es íntegra` }
  }
  let sha = ''
  try { sha = await sha256Hex(bytes) } catch { if (expected.sha256) return { ok: false, reason: 'este navegador no permite comprobar la huella del PDF' } }
  if (expected.sha256 && sha !== expected.sha256.toLowerCase()) return { ok: false, reason: 'la huella SHA-256 del PDF recibido no coincide con la del generado; la copia no es íntegra' }
  return { ok: true, bytes, byteLength: bytes.length, sha256: sha }
}

/** Fetch the delivered URL (data: or remote) with a deadline, then verify. Never throws. */
export async function fetchVerifiedPdf(url: string | undefined, expected: PdfExpectation = {},
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<PdfCheck> {
  if (!url) return { ok: false, reason: 'la entrega no incluye ningún archivo' }
  const timeoutMs = opts.timeoutMs ?? PDF_FETCH_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { signal: controller.signal })
    if (!res.ok) return { ok: false, reason: `el servidor del archivo respondió ${res.status}; el PDF no se pudo recuperar` }
    const bytes = new Uint8Array(await res.arrayBuffer())
    return await verifyPdfBytes(bytes, expected)
  } catch (e) {
    if (controller.signal.aborted) return { ok: false, reason: `el archivo no llegó en ${Math.round(timeoutMs / 1000)} s` }
    return { ok: false, reason: 'el archivo no se pudo recuperar (' + (e instanceof Error ? e.message : String(e)).slice(0, 120) + ')' }
  } finally { clearTimeout(timer) }
}

/** Student-facing cause for a «Descargar PDF» request that never produced a file. */
export function explainPdfRequestFailure(error: unknown, timeoutMs = PDF_REQUEST_TIMEOUT_MS): string {
  const name = error instanceof Error ? error.name : ''
  const m = error instanceof Error ? error.message : String(error)
  if (name === 'AbortError' || /aborted/i.test(m)) return `el servidor no terminó el PDF en ${Math.round(timeoutMs / 1000)} s; no se ha creado ningún archivo`
  const http = /HTTP_ERROR_(\d{3})/.exec(m)
  if (http) {
    const code = Number(http[1])
    if (code === 504) return 'el servidor agotó su tiempo al generar el PDF (504); no se ha creado ningún archivo'
    if (code === 413) return 'el material es demasiado grande para enviarlo (413); no se ha creado ningún archivo'
    if (code === 429) return 'el servicio está ocupado (429); no se ha creado ningún archivo'
    return `el servidor respondió con un error ${code}; no se ha creado ningún archivo`
  }
  if (/Failed to fetch|NetworkError|Load failed/.test(m)) return 'no se pudo conectar con el servidor; no se ha creado ningún archivo'
  return 'error inesperado al pedir el PDF; no se ha creado ningún archivo'
}

export function pdfFileName(title: string | undefined): string {
  const slug = String(title ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `lingora-${slug || 'material'}.pdf`
}
