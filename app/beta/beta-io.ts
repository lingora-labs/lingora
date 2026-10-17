import { BACKEND_LANG, type Msg, type SS } from './beta-model'
import { CLEARABLE_FIELDS } from '../../lib/contracts'

// DAE fix (AE-EXECUTE round, defect C) — the client half of the SAME shared,
// typed delete-semantics mechanism as the server's mergeStatePatch()
// (server/core/state-manager.ts). `data.state` coming back from /api/chat —
// whether the blocking JSON response or an SSE `done` event's `state` field
// — may carry an explicit `null` for any field in CLEARABLE_FIELDS. ONLY
// `null` survives JSON.stringify/JSON.parse; a field the server meant to
// clear via bare `undefined` would simply be ABSENT from `data.state`, and
// the naive spread `{ ...prevSession, ...data.state }` then silently keeps
// whatever stale value prevSession already had — this is exactly how a
// cancelled or redirected document contract resurrected itself after
// "Olvídalo." (AE/Work defect C). use-beta-page.ts calls this ONE function
// from both the blocking and the streaming merge sites, instead of two
// independent copies of the same spread.
export function applyServerStatePatch<T extends object>(
  prev: T,
  incoming: Record<string, unknown> | null | undefined,
): T {
  const merged: Record<string, unknown> = { ...(prev as Record<string, unknown>), ...(incoming ?? {}) }
  if (incoming) {
    for (const field of CLEARABLE_FIELDS) {
      if ((incoming as Record<string, unknown>)[field] === null) {
        delete merged[field]
      }
    }
  }
  return merged as unknown as T
}

export function doExportTxt(msgs: Msg[]) {
  const ts = new Date().toISOString().slice(0,10)
  const lines = [`LINGORA Chat Export — ${ts}`, '─'.repeat(42), '', ...msgs.map(m => `[${m.sender.toUpperCase()}]  ${m.text}`), '']
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain'})); a.download = `lingora-${ts}.txt`; a.click()
}

export type PdfExportResult =
  | { ok: true; message: string; bytes: number; archiveUrl: string }
  | { ok: false; message: string }

// This is an explicit UI operation, NEVER another student message or a
// second tutor decision. A failed PDF remains a failed PDF: do not silently
// return TXT under a PDF button.
export async function doExportPdfBackend(msgs: Msg[], ss: SS): Promise<PdfExportResult> {
  const lines = msgs
    .filter(m => m.sender !== 'ln')
    .map(m => ({
      sender: m.sender === 'user' ? 'Student' : m.sender.toUpperCase(),
      text: (m.text || '').trim(),
    }))
    .filter(l => l.text.length > 0)
  if (lines.length === 0) return { ok: false, message: 'Todavía no hay conversación para exportar.' }
  const transcript = lines.map(l => `[${l.sender}]: ${l.text}`).join('\n\n')
  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Exportar conversación',
        uiAction: 'export_chat_pdf',
        exportTranscript: transcript,
        state: {
          ...trimStateForPayload(ss as unknown as Record<string, unknown>),
          mentor: ss.mentor, lang: ss.lang, topic: ss.topic,
          interfaceLanguage: BACKEND_LANG(ss.lang),
        },
      }),
    })
    if (!res.ok) return { ok: false, message: `Error del servidor al exportar PDF (HTTP ${res.status}).` }
    const data = await res.json()
    const artifact = data?.artifact
    if (!['pdf', 'pdf_chat'].includes(artifact?.type) || typeof artifact?.url !== 'string') {
      return { ok: false, message: 'No se generó un PDF. La conversación continúa disponible en pantalla.' }
    }
    if (artifact.renderValidated === false) {
      return { ok: false, message: 'El PDF no pasó la validación estructural.' }
    }
    // Verify the response contains actual PDF bytes, not merely a link or a
    // JSON claim. Browser download must use a Blob to work with data: URLs.
    const pdf = await fetch(artifact.url)
    if (!pdf.ok) return { ok: false, message: 'El PDF existe pero no se pudo recuperar para descargarlo.' }
    const blob = await pdf.blob()
    const magic = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
    const isPdf = magic.length === 5 && magic[0] === 37 && magic[1] === 80
      && magic[2] === 68 && magic[3] === 70 && magic[4] === 45
    if (!isPdf || blob.size < 500) {
      return { ok: false, message: 'La descarga no contiene un archivo PDF íntegro.' }
    }
    const localUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
    try {
      const a = document.createElement('a')
      a.href = localUrl
      a.download = `lingora-session-${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      setTimeout(() => URL.revokeObjectURL(localUrl), 30000)
    }
    // Store the exact verified bytes in the same-browser document archive.
    // S3 links alone may not remain readable when the student returns.
    const archiveUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? Error('Unable to archive exported PDF'))
      reader.readAsDataURL(blob)
    })
    if (!archiveUrl.startsWith('data:application/pdf;base64,')) {
      return { ok: false, message: 'PDF descargado, pero no pudo guardarse para la siguiente visita.' }
    }
    return { ok: true, message: `PDF verificado y listo para recuperar (${blob.size} bytes).`, bytes: blob.size, archiveUrl }
  } catch (error) {
    console.warn('[LINGORA export PDF] download failed', error)
    return { ok: false, message: 'No fue posible descargar el PDF. Inténtalo de nuevo; no se sustituyó por TXT.' }
  }
}

export function trimStateForPayload(state: Record<string, unknown>): Record<string, unknown> {
  const trimmed = { ...state };
  delete trimmed['artifactRegistry'];
  if (trimmed['curriculumPlan'] && typeof trimmed['curriculumPlan'] === 'object') {
    const cp = trimmed['curriculumPlan'] as Record<string, unknown>;
    if (Array.isArray(cp['modules'])) {
      trimmed['curriculumPlan'] = { ...cp, modules: (cp['modules'] as unknown[]).slice(-3) };
    }
  }
  if (trimmed['activeMode'] !== 'structured' && trimmed['activeMode'] !== 'pdf_course') {
    delete trimmed['masteryByModule'];
  }
  return trimmed;
}
