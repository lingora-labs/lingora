// LINGORA 7.5 — execute what the Tutor declared, after the reply. Nothing here reads
// the student's words or judges the Tutor's content: a typed declaration IS the
// authorization; this layer only materialises it and reports, by name, anything it
// could not deliver. Nothing declared is dropped without a visible failure.
//
// Documents: ONE document per turn, whatever the number of PDF declarations — the
// Tutor's reply (plus the turn's native artifacts) rendered by the canonical page
// (lib/content/document-page). PDF = its print surface through Chromium; HTML = its
// web surface. No second model, no excerpting by subject, no length heuristics.
import type { ArtifactPayload, SessionState } from '../../lib/contracts'
import { dedupeSignals, NATIVE_TYPES, type ArtifactSignal } from '../../lib/artifact-signal'
import { fidelityTokens } from '../../lib/content/markdown'

export interface ArtifactFailure {
  subject: string
}

export interface FulfillResult {
  artifacts: ArtifactPayload[]
  failures: ArtifactFailure[]
}

/** Costed operations keep a per-turn budget; what exceeds it is reported, never silently skipped. */
export const PER_TURN_BUDGET = { images: 1, audio: 2 } as const

const MENTOR_VOICES: Record<string, string> = { sarah: 'shimmer', alex: 'fable', nick: 'onyx' }
export const voiceFor = (mentor: unknown): string => MENTOR_VOICES[String(mentor ?? '').toLowerCase()] ?? 'fable'

const PRINTABLE_NATIVE = new Set(['table_matrix', 'schema_pro', 'quiz', 'chart', 'flowchart', 'infographic'])

export async function fulfillArtifactSignals(
  signals: ArtifactSignal[],
  pedagogicalContent: string,
  state: SessionState,
  studentMessage = '',
): Promise<FulfillResult> {
  const deduped = dedupeSignals(signals)
  // Costed side effects (documents, images) need the Tutor's explicit-request trigger. The closure
  // parser already refused (and reported to the student) any declaration without it; this is the
  // second, execution-side boundary, so nothing reaches it in the product flow.
  const pdfs = deduped.filter((s) => s.type === 'emit_pdf' && s.trigger === 'explicit_user_request')
  const native = deduped.filter((s) => NATIVE_TYPES.includes(s.type))
  const audioSignals = deduped.filter((s) => s.type === 'emit_audio')
  const imageSignals = deduped.filter((s) => s.type === 'emit_image' && s.trigger === 'explicit_user_request')
  const artifacts: ArtifactPayload[] = []
  const failures: ArtifactFailure[] = []
  if (!pdfs.length && !native.length && !audioSignals.length && !imageSignals.length) return { artifacts, failures }
  const mentorName = (state as unknown as { mentorProfile?: string }).mentorProfile ?? 'sarah'

  // Native components: validated deterministically against the same turn's text and tables.
  if (native.length) {
    const { materializeNativeArtifactOrReason } = await import('./native-artifact')
    const tables = native.filter((x) => x.type === 'table_matrix').flatMap((x) => {
      const c = x.content as { rows?: unknown } | undefined
      const rows = Array.isArray(c?.rows) ? (c!.rows as unknown[]).map((r) => Array.isArray(r) ? r.map((cell) => String((cell as { text?: unknown })?.text ?? cell ?? '')) : []) : []
      return rows.length ? [{ rows }] : []
    })
    for (const signal of native) {
      const out = materializeNativeArtifactOrReason(signal, { text: `${studentMessage}\n${pedagogicalContent}`, tables })
      if ('payload' in out) artifacts.push(out.payload)
      else failures.push({ subject: `Componente interactivo no válido: ${signal.subject} — ${out.reason}` })
    }
  }

  // Documents: one per turn.
  if (pdfs.length) {
    const title = pdfs[0].subject.trim() || 'Material de LINGORA'
    const withHtml = pdfs.some((s) => s.format === 'pdf_html')
    if (!fidelityTokens(pedagogicalContent).length) {
      failures.push({ subject: `${title}: el Tutor no escribió material en esta respuesta, así que no hay documento que entregar` })
    } else {
      const doc = await deliverDocument({
        title,
        sections: [{ text: pedagogicalContent, artifacts: artifacts.filter((a) => PRINTABLE_NATIVE.has(a.type)).map((a) => ({ type: a.type, content: (a as { content?: Record<string, unknown> }).content })) }],
      }, { withHtml, filename: `lingora-${Date.now()}` })
      if ('failure' in doc) failures.push({ subject: `${title}: ${doc.failure}` })
      else artifacts.push(doc.artifact)
    }
  }

  // emit_image: costed; one per turn. Excess declarations are reported.
  if (imageSignals.length) {
    const { generateImage } = await import('../tools/image-generator')
    for (const [i, signal] of imageSignals.entries()) {
      if (i >= PER_TURN_BUDGET.images) { failures.push({ subject: `${signal.subject}: solo se genera ${PER_TURN_BUDGET.images} imagen por respuesta` }); continue }
      try {
        const result = await generateImage(signal.subject)
        if (result.success && result.url) artifacts.push({ type: 'illustration', prompt: signal.subject, url: result.url } as ArtifactPayload)
        else failures.push({ subject: `${signal.subject}: ${result.message ?? result.error ?? 'la imagen no se generó'}` })
      } catch (error) {
        failures.push({ subject: `${signal.subject}: ${error instanceof Error ? error.message : 'la imagen no se generó'}` })
      }
    }
  }

  // emit_audio: the Tutor decides that audio is warranted; the whole reply is spoken.
  if (audioSignals.length) {
    const { speakTutorText } = await import('../tools/audio-toolkit')
    for (const [i, signal] of audioSignals.entries()) {
      if (i >= PER_TURN_BUDGET.audio) { failures.push({ subject: `${signal.subject}: solo se generan ${PER_TURN_BUDGET.audio} audios por respuesta` }); continue }
      const result = await speakTutorText(pedagogicalContent, { voice: voiceFor(mentorName) })
      if (result.success && result.url) artifacts.push({ type: 'audio', dataUrl: result.url } as ArtifactPayload)
      else failures.push({ subject: `${signal.subject}: ${result.message ?? 'el audio no se generó'}` })
    }
  }

  return { artifacts, failures }
}

/** Render one canonical document as PDF (and HTML when asked). Failure carries the student-facing reason. */
export async function deliverDocument(
  page: import('../../lib/content/document-page').DocumentPage,
  options: { withHtml: boolean; filename: string },
): Promise<{ artifact: ArtifactPayload } | { failure: string }> {
  const { renderDocumentPage, explainDocumentRefusal } = await import('../../lib/content/document-page')
  let print: string, web: string | undefined
  try {
    print = renderDocumentPage(page, 'print')
    if (options.withHtml) web = renderDocumentPage(page, 'web')
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[document-render]', message)
    return { failure: explainDocumentRefusal(message) ?? 'el documento no se pudo componer' }
  }
  const { generatePDF } = await import('../tools/pdf-generator')
  const result = await generatePDF({ title: page.title, html: print, filename: options.filename })
  if (!result.success || !result.url) {
    console.error('[document-pdf]', JSON.stringify({ reason: result.error, message: result.message }))
    return { failure: explainDocumentRefusal(result.message) ?? `el PDF no se pudo generar (${result.error ?? 'error del motor de impresión'})` }
  }
  return {
    artifact: {
      type: 'pdf', url: result.url, title: page.title,
      composerStatus: 'canonical',
      renderValidated: result.renderValidated,
      pdfByteLength: result.pdfByteLength,
      pdfSha256: result.pdfSha256,
      pageCount: result.pageCount,
      ...(web ? { webUrl: `data:text/html;charset=utf-8;base64,${Buffer.from(web, 'utf8').toString('base64')}` } : {}),
    } as ArtifactPayload,
  }
}
