// SEEK 5.0 P8 — execute each structured signal after content.
// 7.3: NO user-text logic here. A typed signal declared by the Tutor is the
// authorization; this layer validates technically (declared trigger, per-turn
// caps, real content, real bytes) and reports failures truthfully.
// History condensed (P9 composer routing, P9b subject isolation, P9c render
// self-validation + sha256 chain of custody, P14-C failure truth, P15 audio,
// P19-D dual delivery): see git history.
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
  webUrl?: string,
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
      // P19-D — additive: undefined when composition fell back to the
      // flat-text path (no DocumentContent to render as HTML).
      ...(webUrl ? { webUrl } : {}),
    } as ArtifactPayload,
  }
}

export async function fulfillArtifactSignals(
  signals: ArtifactSignal[],
  pedagogicalContent: string,
  state: SessionState,
): Promise<FulfillResult> {
  const deduped = dedupeSignals(signals);
  // 7.3: the Tutor's typed signal IS the authorization. The runtime validates
  // technically (trigger declared, per-turn caps, real content) and never
  // reinterprets the student's words.
  const pdfs = deduped.filter((s) => s.type === 'emit_pdf' && s.trigger === 'explicit_user_request').slice(0, 3);
  const native = deduped.filter(s => ['table_matrix', 'schema_pro', 'quiz'].includes(s.type)).slice(0, 3);
  const audioSignals = deduped.filter((s) => s.type === 'emit_audio').slice(0, 2);
  // Costed operation: Tutor declaration with trigger, hard cap of one per turn.
  const imageSignals = deduped.filter((s) =>
    s.type === 'emit_image' && s.trigger === 'explicit_user_request').slice(0, 1);
  if (pdfs.length === 0 && audioSignals.length === 0 && native.length === 0 && imageSignals.length === 0) return { artifacts: [], failures: [] };

  const mentorName = (state as unknown as { mentorProfile?: string }).mentorProfile ?? 'Sarah'
  const level = (state as unknown as { confirmedLevel?: string; userLevel?: string }).confirmedLevel
    ?? (state as unknown as { userLevel?: string }).userLevel
  const nativeLanguage = (state as unknown as { interfaceLanguage?: string }).interfaceLanguage

  const allSubjects = pdfs.map((s) => s.subject)

  const artifacts: ArtifactPayload[] = []
  const failures: ArtifactFailure[] = []

  // The SAME tutor closure delivers typed native UI artifacts alongside PDFs.
  // Validation is deterministic; no second model, markdown-to-HTML parsing,
  // fabricated exercise or automatic file is involved.
  if (native.length) {
    const { materializeNativeArtifact } = await import('./native-artifact')
    for (const signal of native) {
      const payload = materializeNativeArtifact(signal)
      if (payload) artifacts.push(payload)
      else failures.push({ subject: `Componente interactivo no válido: ${signal.subject}` })
    }
  }

  for (const signal of pdfs) {
    const { generatePDF } = await import('../tools/pdf-generator')
    const { composeDocumentFromTaught } = await import('../tools/pdf/composeArtifactDocument')
    // Honest failure for an explicitly requested file: preserve the tutor
    // response and other successful native artifacts rather than raising
    // an exception that destroys the whole turn.
    // Do not convert a Tutor refusal into deceptively downloadable files.
    const sourceText=pedagogicalContent.trim()
    const refusalSource=sourceText.length<1800 && /\b(?:no tengo acceso|no dispongo de acceso|no puedo (?:generar|adjuntar|crear)|no tengo la capacidad de generar)\b/iu.test(sourceText.slice(0,800))
    if (pedagogicalContent.trim().length < 500 || refusalSource) {
      failures.push({ subject: signal.subject + ' (PDF: explicación insuficiente)' })
      continue
    }
    const otherSubjects = allSubjects.filter((s) => s !== signal.subject)

    const composed = await composeDocumentFromTaught({
      subject: signal.subject,
      fullContent: pedagogicalContent,
      otherSubjects,
      mentorName,
      level,
      nativeLanguage,
      preferVerbatim: signal.format === 'pdf_html',
    })

    // A partial multi-subject fallback would silently drop most of the
    // student's material. Reject rather than pretend that a clipped PDF
    // satisfies the request. A single-subject fallback carries ALL text.
    if (!composed.ok && pdfs.length > 1) {
      console.error('[document-compose]', JSON.stringify({format:signal.format, reason:composed.reason, subjectLength:signal.subject.length}))
      failures.push({ subject: signal.subject })
      continue
    }
    if (signal.format === 'pdf_html' && !composed.ok) {
      console.error('[document-compose]', JSON.stringify({format:'pdf_html',reason:composed.reason,sourceLength:pedagogicalContent.length}))
      failures.push({ subject: signal.subject + ' (PDF y HTML no disponibles)' })
      continue
    }
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
          content: `# ${signal.subject}\n\n${pedagogicalContent}`,
          filename: `lingora-${Date.now()}-${artifacts.length}`,
        })

    if (!result.success || !result.url) {
      console.error('[document-render]', JSON.stringify({format:signal.format,reason:result.error ?? result.message ?? 'unknown',sourceLength:pedagogicalContent.length}))
    }

    // P19-D — DUAL DELIVERY. Only possible when composition succeeded
    // (composed.content is the same DocumentContent already sent to the
    // PDF renderer above).
    let webUrl: string | undefined
    if (composed.ok && result.success && result.url) {
      try {
        const { renderArtifactHtml } = await import('../tools/web/renderArtifactHtml')
        const html = renderArtifactHtml(composed.content)
        webUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`
      } catch (e) {
        console.error('[P19-D] renderArtifactHtml failed', signal.subject, e instanceof Error ? e.message : e)
      }
    }

    if (signal.format === 'pdf_html' && !webUrl) {
      failures.push({ subject: signal.subject + ' (versión HTML no disponible)' })
      continue
    }
    const entry = buildFulfillmentEntry(signal.subject, title, composed, result, webUrl)
    if (entry.kind === 'artifact') artifacts.push(entry.payload)
    else failures.push(entry.failure)
  }

  // emit_image: executor only. One Tutor declaration -> one image or one failure.
  if (imageSignals.length) {
    const { generateImage } = await import('../tools/image-generator')
    for (const signal of imageSignals) {
      try {
        const result = await generateImage(signal.subject)
        if (result.success && result.url) {
          artifacts.push({
            type: 'illustration',
            prompt: signal.subject,
            url: result.url,
          } as ArtifactPayload)
        } else {
          console.error('[emit_image] generation failed', result.error ?? result.message)
          failures.push({ subject: signal.subject })
        }
      } catch (error) {
        console.error('[emit_image] execution error', error instanceof Error ? error.message : error)
        failures.push({ subject: signal.subject })
      }
    }
  }

  // P15 — audio output: the Tutor decides WHETHER audio is warranted; this
  // executes that decision with the same generateSpeech() used elsewhere.
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
