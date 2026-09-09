// SEEK 5.0 P8 — execute each structured signal after content. No user-text keyword logic.
// SEEK 5.0 P9 — route through the existing rich renderCoursePdf pipeline via a
// structuring composer. Falls back to the prior flat-text path only if
// composition fails — never worse than the pre-P9 baseline.
import type { ArtifactPayload, SessionState } from '../../lib/contracts'
import { dedupeSignals, type ArtifactSignal } from '../../lib/artifact-signal'

function excerptForSubject(content: string, subject: string): string {
  const text = content.trim()
  if (!text) return subject
  const needle = subject.trim().split(/\s+/).slice(0, 4).join(' ')
  const idx = needle.length >= 4 ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1
  if (idx < 0) return text.slice(0, 6000)
  const start = Math.max(0, idx - 400)
  return text.slice(start, start + 6000)
}

export async function fulfillArtifactSignals(
  signals: ArtifactSignal[],
  pedagogicalContent: string,
  state: SessionState,
): Promise<ArtifactPayload[]> {
  const pdfs = dedupeSignals(signals).filter((s) => s.type === 'emit_pdf')
  if (pdfs.length === 0) return []

  const { generatePDF } = await import('../tools/pdf-generator')
  const { composeDocumentFromTaught } = await import('../tools/pdf/composeArtifactDocument')

  const mentorName = (state as unknown as { mentorProfile?: string }).mentorProfile ?? 'Sarah'
  const level = (state as unknown as { confirmedLevel?: string; userLevel?: string }).confirmedLevel
    ?? (state as unknown as { userLevel?: string }).userLevel
  const nativeLanguage = (state as unknown as { interfaceLanguage?: string }).interfaceLanguage

  const out: ArtifactPayload[] = []
  for (const signal of pdfs) {
    const body = excerptForSubject(pedagogicalContent, signal.subject)

    const documentContent = await composeDocumentFromTaught({
      subject: signal.subject,
      body,
      mentorName,
      level,
      nativeLanguage,
    })

    const title = documentContent?.title ?? `LINGORA — ${signal.subject}`.slice(0, 80)

    const result = documentContent
      ? await generatePDF({
          title,
          content: '',
          courseContent: documentContent,
          filename: `lingora-${Date.now()}-${out.length}`,
        })
      : await generatePDF({
          title,
          content: `# ${signal.subject}\n\n${body}`,
          filename: `lingora-${Date.now()}-${out.length}`,
        })

    if (!result.success || !result.url) {
      console.error('[P8] generatePDF failed', signal.subject, result.error ?? result.message)
      continue
    }
    out.push({ type: 'pdf', url: result.url, title } as ArtifactPayload)
  }
  return out
}
