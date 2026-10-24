// 7.5 — «Descargar PDF»: real file or visible reason. Pure logic of lib/pdf-download.ts on real PDF bytes
// (pdf-lib). The browser control (file saved, alert shown) is proven in tests/e2e/quiz-pdf-7-5.mjs.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PDFDocument, StandardFonts } from 'pdf-lib'
const { load } = await import('./_ts-loader.mjs')
const D = load('lib/pdf-download.ts')

const doc = await PDFDocument.create()
const page = doc.addPage(); page.drawText('Material: el pretérito indefinido', { x: 40, y: 700, font: await doc.embedFont(StandardFonts.Helvetica), size: 14 })
const bytes = new Uint8Array(await doc.save())
const sha = createHash('sha256').update(bytes).digest('hex')
const dataUrl = 'data:application/pdf;base64,' + Buffer.from(bytes).toString('base64')

// Success: the exact bytes, with recorded length and hash.
let r = await D.fetchVerifiedPdf(dataUrl, { byteLength: bytes.length, sha256: sha })
assert.equal(r.ok, true); assert.equal(r.byteLength, bytes.length); assert.equal(r.sha256, sha)
assert.equal(Buffer.from(r.bytes).subarray(0, 5).toString(), '%PDF-')

// Every bad copy is refused with a reason a student can read.
const corrupt = new Uint8Array(bytes); corrupt[0] = 0x3c // '<' instead of '%'
r = await D.verifyPdfBytes(corrupt); assert.equal(r.ok, false); assert.match(r.reason, /cabecera inválida/)
r = await D.verifyPdfBytes(bytes.subarray(0, bytes.length - 40)); assert.equal(r.ok, false); assert.match(r.reason, /incompleto|bytes/)
r = await D.verifyPdfBytes(new Uint8Array(Buffer.from('<html>error</html>'))); assert.equal(r.ok, false); assert.match(r.reason, /no es un PDF completo/)
r = await D.verifyPdfBytes(bytes, { byteLength: bytes.length + 1 }); assert.equal(r.ok, false); assert.match(r.reason, /no es íntegra/)
r = await D.verifyPdfBytes(bytes, { sha256: '0'.repeat(64) }); assert.equal(r.ok, false); assert.match(r.reason, /SHA-256/)
r = await D.fetchVerifiedPdf(undefined); assert.equal(r.ok, false); assert.match(r.reason, /ningún archivo/)
r = await D.fetchVerifiedPdf('https://x/f.pdf', {}, { fetchImpl: async () => new Response('no', { status: 403 }) })
assert.equal(r.ok, false); assert.match(r.reason, /respondió 403/)
// A file that never arrives ends in a visible timeout, not in silence.
const hang = (_u, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
const t0 = Date.now()
r = await D.fetchVerifiedPdf('https://x/f.pdf', {}, { timeoutMs: 150, fetchImpl: hang })
assert.equal(r.ok, false); assert.match(r.reason, /no llegó en 0 s|no llegó en/); assert.ok(Date.now() - t0 < 2000)

// Request failures (the server never produced a file) are explained, never generic.
assert.match(D.explainPdfRequestFailure(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })), /no terminó el PDF en 120 s; no se ha creado ningún archivo/)
assert.match(D.explainPdfRequestFailure(new Error('HTTP_ERROR_504')), /504/)
assert.match(D.explainPdfRequestFailure(new Error('HTTP_ERROR_500')), /error 500; no se ha creado ningún archivo/)
assert.match(D.explainPdfRequestFailure(new TypeError('Failed to fetch')), /no se pudo conectar/)
assert.equal(D.pdfFileName('Pretérito indefinido: usos'), 'lingora-preterito-indefinido-usos.pdf')
assert.equal(D.pdfFileName(''), 'lingora-material.pdf')
console.log('PASS 7.5 pdf download: real bytes verified (header, trailer, length, SHA-256); corrupt/truncated/HTTP/timeout refused with a visible reason')
