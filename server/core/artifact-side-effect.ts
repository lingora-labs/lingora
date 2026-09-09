// SEEK 5.0 P8 — execute each structured signal after content. No user-text keyword logic.
// SEEK 5.0 P9 — route through the existing rich renderCoursePdf pipeline via a
// structuring composer. Falls back to the prior flat-text path only if
// composition fails — never worse than the pre-P9 baseline.
// P9-diag: surfaces WHY the fallback was used, as a non-breaking additive
// field on the artifact object, so DAE can diagnose from run_diagnostic
// output without server log access. Not rendered by the product UI.
//
// SEEK 5.0 P9b — SUBJECT CONTENT ISOLATION.
// excerptForSubject()'s blind text.slice(start, start+6000) window is now
// used ONLY as the fallback path's input (when composition fails). The rich
// path passes the FULL taught text plus the other subjects in this turn to
// the composer, which performs semantic isolation itself — see
// composeArtifactDocument.ts. No domain names hardcoded here; subjects come
// entirely from the caller-supplied signals.
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

  const allSubjects = pdfs.map((s) => s.subject)

  const out: ArtifactPayload[] = []
  for (const signal of pdfs) {
    const otherSubjects = allSubjects.filter((s) => s !== signal.subject)

    const composed = await composeDocumentFromTaught({
      subject: signal.subject,
      fullContent: pedagogicalContent,
      otherSubjects,
      mentorName,
      level,
      nativeLanguage,
    })

    const title = composed.ok ? composed.content.title : `LINGORA — ${signal.subject}`.slice(0, 80)

    const result = composed.ok
      ? await generatePDF({
          title,
          content: '',
          courseContent: composed.content,
          filename: `lingora-${Date.now()}-${out.length}`,
        })
      : await generatePDF({
          title,
          content: `# ${signal.subject}\n\n${excerptForSubject(pedagogicalContent, signal.subject)}`,
          filename: `lingora-${Date.now()}-${out.length}`,
        })

    if (!result.success || !result.url) {
      console.error('[P8] generatePDF failed', signal.subject, result.error ?? result.message)
      continue
    }
    out.push({
      type: 'pdf',
      url: result.url,
      title,
      composerStatus: composed.ok ? 'rich' : `fallback:${composed.reason}`,
    } as ArtifactPayload)
  }
  return out
}
