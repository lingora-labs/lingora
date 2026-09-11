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
//
// SEEK 5.0 P9c-diag — propagate the renderer's own self-validation
// (pdf-generator.ts: PDFDocument.load round-trip) onto the artifact object,
// additive only, so DAE can see from run_diagnostic whether generation
// produced structurally valid bytes without needing server logs.
//
// SEEK 5.0 P9c chain-of-custody — also propagate pdfSha256, the server-side
// hash of the exact bytes generated, so any later copy of the PDF (however
// obtained) can be verified byte-for-byte against the source.
//
// SEEK 5.0 P14-C — FAILURE TRUTH.
// Root gap: on generatePDF failure this function logged server-side and
// silently `continue`d — no false success ever reached the UI, but the
// failure was also invisible to it. A user who asked for a document and
// got nothing had no way to know materialization was attempted and failed
// versus never attempted at all.
// Fix: buildFulfillmentEntry() is the ONLY place that decides artifact vs.
// failure, extracted as a pure function so it's unit-testable without any
// API call (see tests/p14-fulfillment.ts). fulfillArtifactSignals now
// returns BOTH arrays — successes and failures — instead of dropping
// failures. This is the layer that actually knows the executor's result;
// per the required contract, failure truth must originate here, not be
// guessed by the tutor. Only `{ subject }` is exposed — no stack traces,
// tool names, or provider details reach the caller/UI. Cardinality is
// preserved per-item: one signal in, one artifact OR one failure out —
// never both, never neither, never a partial success masked as a full one.
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

export interface ArtifactFailure {
  subject: string
}

export interface FulfillResult {
  artifacts: ArtifactPayload[]
  failures: ArtifactFailure[]
}

// Pure decision function: given one signal's compose+render outcome, decide
// artifact vs. failure. No imports, no I/O — directly unit-testable with
// fabricated inputs, no API credits required (tests/p14-fulfillment.ts).
export function buildFulfillmentEntry(
  subject: string,
  title: string,
  composed: { ok: boolean; content?: unknown; reason?: string },
  result: {
    success: boolean
    url?: string
    renderValidated?: boolean
    renderValidationError?: string
    pdfByteLength?: number
    pdfSha256?: string
  },
): { kind: 'artifact'; payload: ArtifactPayload } | { kind: 'failure'; failure: ArtifactFailure } {
  if (!result.success || !result.url) {
    return { kind: 'failure', failure: { subject } }
  }
  return {
    kind: 'artifact',
    payload: {
      type: 'pdf',
      url: result.url,
      title,
      composerStatus: composed.ok ? 'rich' : `fallback:${composed.reason}`,
      renderValidated: result.renderValidated,
      renderValidationError: result.renderValidationError,
      pdfByteLength: result.pdfByteLength,
      pdfSha256: result.pdfSha256,
    } as ArtifactPayload,
  }
}

export async function fulfillArtifactSignals(
  signals: ArtifactSignal[],
  pedagogicalContent: string,
  state: SessionState,
): Promise<FulfillResult> {
  const deduped = dedupeSignals(signals);
  const pdfs = deduped.filter((s) => s.type === 'emit_pdf');
  const audioSignals = deduped.filter((s) => s.type === 'emit_audio');
  if (pdfs.length === 0 && audioSignals.length === 0) return { artifacts: [], failures: [] };

  const { generatePDF } = await import('../tools/pdf-generator')
  const { composeDocumentFromTaught } = await import('../tools/pdf/composeArtifactDocument')

  const mentorName = (state as unknown as { mentorProfile?: string }).mentorProfile ?? 'Sarah'
  const level = (state as unknown as { confirmedLevel?: string; userLevel?: string }).confirmedLevel
    ?? (state as unknown as { userLevel?: string }).userLevel
  const nativeLanguage = (state as unknown as { interfaceLanguage?: string }).interfaceLanguage

  const allSubjects = pdfs.map((s) => s.subject)

  const artifacts: ArtifactPayload[] = []
  const failures: ArtifactFailure[] = []

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
          filename: `lingora-${Date.now()}-${artifacts.length}`,
        })
      : await generatePDF({
          title,
          content: `# ${signal.subject}\n\n${excerptForSubject(pedagogicalContent, signal.subject)}`,
          filename: `lingora-${Date.now()}-${artifacts.length}`,
        })

    if (!result.success || !result.url) {
      console.error('[P8] generatePDF failed', signal.subject, result.error ?? result.message)
    }

    const entry = buildFulfillmentEntry(signal.subject, title, composed, result)
    if (entry.kind === 'artifact') artifacts.push(entry.payload)
    else failures.push(entry.failure)
  }

  // P15 — AUDIO OUTPUT RECONNECTION.
  // Root gap: emit_audio was a valid signal type in the schema (the model
  // could technically call it) but fulfillArtifactSignals only ever
  // filtered for emit_pdf — an emit_audio signal was silently accepted and
  // then never executed. Fix mirrors the emit_pdf pattern exactly: the
  // model (Sarah, via signal_artifact) decides WHETHER audio is warranted;
  // this function executes that decision using the same generateSpeech()
  // already relied upon by execution-engine.ts's non-streaming tool_audio
  // path. No new capability, no second tutor — Tutor Core still decides,
  // this only carries the decision through in the streaming path too.
  if (audioSignals.length > 0) {
    const { generateSpeech } = await import('../tools/audio-toolkit')
    const MENTOR_VOICES: Record<string, string> = { sarah: 'shimmer', alex: 'fable', nick: 'onyx' }
    const voice = MENTOR_VOICES[String(mentorName).toLowerCase()] ?? 'fable'

    for (const signal of audioSignals) {
      const textToSpeak = (excerptForSubject(pedagogicalContent, signal.subject) || pedagogicalContent)
        .slice(0, 3000)
      const result = await generateSpeech(textToSpeak, { voice })
      if (result.success && result.url) {
        artifacts.push({ type: 'audio', dataUrl: result.url } as ArtifactPayload)
      } else {
        console.error('[P15] generateSpeech failed', signal.subject, result.message)
        failures.push({ subject: signal.subject })
      }
    }
  }

  return { artifacts, failures }
}
