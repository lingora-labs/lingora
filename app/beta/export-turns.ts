import { resolveMsgArtifacts, type Artifact, type Msg } from './beta-model'

/**
 * 7.4.6 — ONE builder for every PDF export entry point (header menu and chat chip).
 * Fidelity rules: an unfinished or interrupted turn refuses the export; a delivered file (pdf, audio...)
 * is a link, not printable content; every other artifact with content is SENT, never filtered out here,
 * so the server either prints it or refuses explicitly. Nothing is dropped silently on the client.
 */
export const LINK_ONLY_ARTIFACT_TYPES: ReadonlyArray<Artifact['type']> = ['pdf', 'course_pdf', 'pdf_chat', 'pdf_assignment', 'audio']
export type ExportTurnPayload = { sender: string; text: string; complete: boolean; artifacts: Array<{ type: string; content?: Record<string, unknown> }> }
export function buildExportTurns(msgs: Msg[]): { ok: true; turns: ExportTurnPayload[] } | { ok: false; message: string } {
  const turns: ExportTurnPayload[] = []
  for (const m of msgs) {
    if (m.sender === 'ln') continue
    const sender = m.sender === 'user' ? 'Student' : String(m.sender).toUpperCase()
    if (m.complete === false) {
      return { ok: false, message: `La respuesta de ${sender} está en curso o quedó interrumpida. No se exporta un historial incompleto.` }
    }
    const artifacts = resolveMsgArtifacts(m)
      .filter(a => !LINK_ONLY_ARTIFACT_TYPES.includes(a.type))
      .map(a => ({ type: a.type, content: a.content }))
    turns.push({ sender, text: m.text || '', complete: true, artifacts })
  }
  const printable = turns.filter(t => t.text.trim().length > 0 || t.artifacts.length > 0)
  if (printable.length === 0) return { ok: false, message: 'Todavía no hay conversación para exportar.' }
  return { ok: true, turns: printable }
}
