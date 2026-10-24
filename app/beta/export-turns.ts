import { resolveMsgArtifacts, type Artifact, type Msg } from './beta-model'

/**
 * 7.4.6 — ONE builder for every PDF export entry point (header menu and chat chip).
 * Fidelity rules: an unfinished or interrupted turn refuses the export; a delivered file (pdf, audio...)
 * is a link, not printable content; every other artifact with content is SENT, never filtered out here,
 * so the server either prints it or refuses explicitly. Nothing is dropped silently on the client.
 */
/** Vercel caps a request body at 4.5 MB; an export above this is refused visibly, not truncated. */
export const EXPORT_PAYLOAD_LIMIT_BYTES = 4_000_000
export const LINK_ONLY_ARTIFACT_TYPES: ReadonlyArray<Artifact['type']> = ['pdf', 'course_pdf', 'pdf_chat', 'pdf_assignment', 'audio']
export type ExportTurnPayload = { sender: string; text: string; complete: boolean; artifacts: Array<{ type: string; content?: Record<string, unknown> }> }
export function buildExportTurns(msgs: Msg[]): { ok: true; turns: ExportTurnPayload[] } | { ok: false; message: string } {
  const turns: ExportTurnPayload[] = []
  for (const m of msgs) {
    if (m.sender === 'ln') continue
    const sender = m.sender === 'user' ? 'Student' : String(m.sender).toUpperCase()
    if (m.persistLoss) {
      return { ok: false, message: `Esta sesión se recuperó reducida: el navegador no conservó un archivo de ${sender}. No se exporta un historial incompleto; descarga los archivos que aún tengas.` }
    }
    if (m.complete === false) {
      return { ok: false, message: `La respuesta de ${sender} está en curso o quedó interrumpida. No se exporta un historial incompleto.` }
    }
    const artifacts = resolveMsgArtifacts(m)
      .filter(a => !LINK_ONLY_ARTIFACT_TYPES.includes(a.type))
      // An illustration prints its own image (its content is the address and the prompt).
      .map(a => a.type === 'illustration'
        ? { type: a.type, content: { url: (a as { url?: string }).url ?? '', prompt: (a as { prompt?: string }).prompt ?? '' } }
        : { type: a.type, content: a.content })
    turns.push({ sender, text: m.text || '', complete: true, artifacts })
  }
  const printable = turns.filter(t => t.text.trim().length > 0 || t.artifacts.length > 0)
  if (printable.length === 0) return { ok: false, message: 'Todavía no hay conversación para exportar.' }
  return { ok: true, turns: printable }
}

/**
 * 7.5 — the ONE preparation every conversation export goes through (header menu, chat chip and a Tutor's
 * conversation_pdf delivery): same builder, same refusals (reduced session, unfinished turn), same size
 * limit with the real size in the message. Nothing is trimmed to fit.
 */
export function prepareConversationExport(msgs: Msg[]): { ok: true; turns: ExportTurnPayload[]; bytes: number } | { ok: false; message: string } {
  const built = buildExportTurns(msgs)
  if (!built.ok) return built
  const bytes = new TextEncoder().encode(JSON.stringify(built.turns)).length
  if (bytes > EXPORT_PAYLOAD_LIMIT_BYTES) {
    return { ok: false, message: `La conversación con sus materiales ocupa ${(bytes / 1e6).toFixed(1)} MB y supera los ${(EXPORT_PAYLOAD_LIMIT_BYTES / 1e6).toFixed(0)} MB que se pueden enviar para imprimir. No se exporta un historial incompleto.` }
  }
  return { ok: true, turns: built.turns, bytes }
}
