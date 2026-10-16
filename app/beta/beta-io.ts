import { BACKEND_LANG, type Msg, type SS } from './beta-model'
import { CLEARABLE_FIELDS } from '../../lib/contracts'

// DAE fix (AE-EXECUTE round, defect C) — the client half of the SAME shared,
// typed delete-semantics mechanism as the server's mergeStatePatch()/
// toWireState() (server/core/state-manager.ts). The server now sends an
// explicit `null` (not a dropped key) whenever it means "clear this field" —
// null is the only CLEARABLE_FIELDS value that survives JSON.stringify/parse
// intact. use-beta-page.ts's client-side state merge must honor that same
// sentinel: a naive `{ ...prev, ...incoming }` spread would keep `null`
// itself as the field's value (wrong — the client's own SS type does not
// expect null there either, and downstream code checking `if (x.foo)` would
// still treat null as falsy today, but any strict-equality/typed consumer
// would not), instead of actually deleting the key the way "cleared" means
// everywhere else in this codebase. applyServerStatePatch deletes the key
// outright on null, otherwise behaves exactly like the spread it replaces.
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

export async function doExportPdfBackend(msgs: Msg[], ss: SS) {
  if (!msgs.length) return
  const lines = msgs
    .map(m => ({ sender: m.sender === 'user' ? 'Student' : m.sender.toUpperCase(), text: (m.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))
    .filter(l => l.text.length > 0)
  const transcript = lines.map(l => `[${l.sender}]: ${l.text}`).join('\n\n')
  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Exporta esta conversación a PDF',
        exportTranscript: transcript,
        state: {
          ...trimStateForPayload(ss as unknown as Record<string, unknown>),
          mentor: ss.mentor,
          lang: ss.lang,
          topic: ss.topic,
          interfaceLanguage: BACKEND_LANG(ss.lang),
        },
      }),
    })
    if (!res.ok) {
      if (res.status === 413) {
        doExportTxt(msgs)
        return
      }
      throw new Error(`PDF export failed: HTTP ${res.status}`)
    }
    const data = await res.json()
    const artifactUrl = data.artifact?.url
    if (artifactUrl && ['pdf', 'pdf_chat'].includes(data.artifact?.type)) {
      const a = document.createElement('a'); a.href = artifactUrl; a.download = `lingora-session-${Date.now()}.pdf`; a.click()
      return
    }
    doExportTxt(msgs)
  } catch { doExportTxt(msgs) }
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
