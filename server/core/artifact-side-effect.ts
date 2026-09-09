// SEEK 5.0 E-06 — kernel side-effect AFTER pedagogical content.
// Consumes ArtifactSignal only. Does not inspect user text or mentor prose for keywords.
import type { ArtifactPayload, SessionState } from '../../lib/contracts'
import type { ArtifactSignal } from '../../lib/artifact-signal'

export async function fulfillArtifactSignals(
  signals: ArtifactSignal[],
  pedagogicalContent: string,
  _state: SessionState,
): Promise<ArtifactPayload | undefined> {
  const pdfs = signals.filter((s) => s.type === 'emit_pdf')
  if (pdfs.length === 0) return undefined

  const { generatePDF } = await import('../tools/pdf-generator')
  const chosen = pdfs[pdfs.length - 1]
  const body = pedagogicalContent.trim().slice(0, 12000) || chosen.subject
  const title = `LINGORA — ${chosen.subject}`.slice(0, 80)
  const result = await generatePDF({
    title,
    content: `# ${chosen.subject}\n\n${body}`,
    filename: `lingora-${Date.now()}`,
  })
  if (!result.success || !result.url) {
    console.error('[E-06] generatePDF failed', result.error ?? result.message)
    return undefined
  }
  return { type: 'pdf', url: result.url, title } as ArtifactPayload
}
