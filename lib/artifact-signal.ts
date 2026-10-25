import { NATIVE_ARTIFACT_CONTENT_TOOL_SCHEMA } from './native-visual-schema'
// SEEK 5.0 E-06/P8 — structured artifact signal. Not inferred from pedagogical text.
export type ArtifactSignalType = 'show_visual' | 'emit_pdf' | 'show_quiz' | 'emit_audio' | 'emit_image' | 'table_matrix' | 'schema_pro' | 'quiz' | 'chart' | 'flowchart' | 'infographic'
export type ArtifactSignalTrigger = 'pedagogical_completion' | 'explicit_user_request'

export interface ArtifactSignal {
  type: ArtifactSignalType
  trigger: ArtifactSignalTrigger
  subject: string
  format?: string
  content?: Record<string, unknown>
}

export interface MentorTurnResult {
  content: string
  artifactSignals: ArtifactSignal[]
}

const TYPES: ArtifactSignalType[] = ['show_visual', 'emit_pdf', 'show_quiz', 'emit_audio', 'emit_image', 'table_matrix', 'schema_pro', 'quiz', 'chart', 'flowchart', 'infographic']
/** Native components: typed content authored by the Tutor, validated and drawn by the runtime. */
export const NATIVE_TYPES: ArtifactSignalType[] = ['table_matrix', 'schema_pro', 'quiz', 'chart', 'flowchart', 'infographic']
const TRIGGERS: ArtifactSignalTrigger[] = ['pedagogical_completion', 'explicit_user_request']

export function parseArtifactSignal(raw: unknown): ArtifactSignal | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const type = typeof o.type === 'string' ? o.type : ''
  const trigger = typeof o.trigger === 'string' ? o.trigger : ''
  const subject = typeof o.subject === 'string' ? o.subject.trim() : ''
  if (!TYPES.includes(type as ArtifactSignalType)) return null
  if (!TRIGGERS.includes(trigger as ArtifactSignalTrigger)) return null
  if (subject.length < 2) return null
  const format = typeof o.format === 'string' ? o.format : undefined
  const content = o.content && typeof o.content === 'object' && !Array.isArray(o.content) ? o.content as Record<string, unknown> : undefined
  return { type: type as ArtifactSignalType, trigger: trigger as ArtifactSignalTrigger, subject, format, content }
}

export function dedupeSignals(signals: ArtifactSignal[]): ArtifactSignal[] {
  const seen = new Set<string>()
  const out: ArtifactSignal[] = []
  for (const s of signals) {
    const key = `${s.type}::${s.subject.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

export const SIGNAL_ARTIFACT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'signal_artifact',
    description:
      'Request a real artifact in this same tutor turn, after composing substantive content. PDF only when the student explicitly requested downloadable/printable material; use trigger explicit_user_request. One call per distinct requested subject. Never call just because a lesson finished. Do not print tool data to the student.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: TYPES },
        trigger: { type: 'string', enum: TRIGGERS },
        subject: { type: 'string', description: 'Only the part this artifact materializes.' },
        format: { type: 'string' },
      },
      required: ['type', 'trigger', 'subject'],
    },
  },
}

// SEEK 5.0 P14 — CAPABILITY TRUTH.
// Root gap: this block already declared what the tutor CANNOT do
// ("emit_audio is unavailable in this runtime") but never declared the
// symmetric positive truth for PDF materialization, which IS always
// available in this runtime (composeDocumentFromTaught/renderCoursePdf are
// not gated by any external flag). Left to its own judgment, the model
// sometimes denied a capability the runtime actually has — a false,
// commercially damaging denial.
// Fix: state PDF availability explicitly, in the same declarative style as
// the existing audio line, with the required distinction spelled out —
// capability availability is not the same as a specific file already being
// ready. The tutor may truthfully offer to prepare/materialize a PDF; it
// must never claim one is already generated before signal_artifact and the
// side-effect pipeline actually produce it. No new capability system: this
// reuses the exact mechanism already governing the audio statement.
//
// SEEK 5.0 P15 — AUDIO CAPABILITY RECOVERY.
// The "emit_audio is unavailable" line was accurate about the RUNTIME AS IT
// STOOD, but that runtime state was itself a regression: STT input was
// disconnected from the streaming path and TTS output was never wired to
// signal_artifact at all (see artifact-side-effect.ts P15 for the
// execution-side fix; execution-engine-stream.ts and route.ts P15 for the
// input-side fix). Declarative text must describe truth — it cannot BE the
// fix for a missing capability (Manifiesto 7.0 Art. 16). Now that the
// underlying mechanism is actually wired, the line is flipped to match,
// mirroring the emit_pdf pattern exactly: availability, not a promise that
// audio already exists.
//
// SEEK 5.0 P19-F — TRIVIAL-TURN EXCLUSION.
// Root gap confirmed in production: nothing here ever told the model that
// "pedagogical completion" requires actual taught content — a bare
// greeting or opening question could be (and, ~1 in 3-4 tries, was)
// interpreted as complete enough to materialize. Added an explicit
// negative example. Paired with a matching guard in mentor-engine.ts
// (the taught-length threshold gating whether the decision call even
// runs) — see that file's P19-F note for the full picture.
/** 7.5 P1-B: the tool contract states what this deployment can actually do. Free illustration generation is
 *  offered only while the image capability exists (server/tools/image-generator.ts); academic visuals with
 *  exact text are always native components, whatever the student calls them. */
const VISUAL_ROUTE = 'Any visual with exact text the student asks for, whatever they call it (an infographic, a poster, a visual summary, an "image" or "picture" of an infographic or of a grammar point, a diagram), is a native component you author: type infographic (or flowchart for a process, chart for data), format native. The runtime draws your exact text and the student can download it as SVG and PNG. For sentence analysis use infographic examples with labelled parts and the emphasized core of each part.'
const IMAGE_ON = 'When the student wants a free illustration or drawing that needs no exact text (a scene, an object, a character), declare emit_image with trigger explicit_user_request, format image, and a detailed subject describing the picture. Never claim the image is ready until the runtime supplies it.'
const IMAGE_OFF = 'Free illustration generation is not available here: never declare emit_image. If the student wants a photographic or artistic picture without exact text, say so in one short sentence and offer the native infographic or diagram instead.'
export function artifactChannelInstruction(opts: { image: boolean }): string {
  return `
TUTOR TURN CONTRACT:
Respond to ordinary conversation directly as normal streamed assistant text. Do not call delivery or closure tools for simple conversation; the one exception is set_explanatory_language, which you call once when you settle the language of your explanations. Use complete_tutor_turn only if a newly requested native component or document needs materialization; include the tutor-authored answer and its typed artifacts. You decide what to teach and how to explain it. A structured call is not a second teacher.
DELIVERY: you can deliver real downloadable files. When the student wants a PDF, a printable sheet, a take-away document, a web (HTML) version, a tactile quiz or a PDF of their own conversation, call deliver_from_text with the kind and a short title AND write the ENTIRE material as your reply text in the same turn: all requested languages, exercises and solutions; begin directly with the document title, with no preface or closing about files or formats. The platform renders exactly your text as the real PDF/HTML and attaches it with download buttons. Never say you cannot create or attach files, and never answer with an outline or a promise instead of the material. Call it only when the student wants the deliverable.
${VISUAL_ROUTE} ${opts.image ? IMAGE_ON : IMAGE_OFF} For charts and plots of data (bars, lines) never use emit_image: declare type chart, format native, with the complete data (every category, one value per category per panel); the runtime validates and draws it deterministically. Do not request an image merely because a lesson is complete or the student discusses images.\nInclude all distinct deliverables in one turn, never postpone them to the next student message. For deliberate audio use emit_audio with format audio. Native interactive outputs use type table_matrix (colored cells), schema_pro (expandable concept blocks), or quiz (touchable choices), with format native and a complete content object. These are actual interface components, never HTML markup inside reply. For a tactile quiz, write the actual numbered questions and their A), B), C) options as ordinary text and call deliver_from_text with kind quiz: the runtime converts those exact options into tactile choices and routes grading to tutor_review, without guessing a key. For a process, decision tree or route use type flowchart, format native, with explicit nodes and labelled edges; for a visual summary with headline figures and titled sections use type infographic, format native. Never use emit_image for these. For other visual matrices or schemas, author a validated native artifact when appropriate. QUIZ INTEGRITY: author meaningful questions, answer indices and explanations that agree. Do not invent a score: an unverified key will be sent for tutor review without automatic grading. The tutor decides whether a lesson calls for a quiz or schema.
Do not claim files already exist: the runtime will materialize your choices or visibly report an execution failure. Do not emit raw tool metadata to the student.
`
}
/** The full contract (with the image capability). The engine uses artifactChannelInstruction() per deployment. */
export const ARTIFACT_CHANNEL_INSTRUCTION = artifactChannelInstruction({ image: true })

export function completeTutorTurnTool(opts: { image: boolean }) {
  const types = ['emit_pdf', 'emit_audio', ...(opts.image ? ['emit_image'] : []), 'table_matrix', 'schema_pro', 'quiz', 'chart', 'flowchart', 'infographic']
  const formats = ['pdf', 'pdf_html', 'audio', ...(opts.image ? ['image'] : []), 'native']
  return {
  type: 'function' as const,
  function: {
    name: 'complete_tutor_turn',
    description: 'Optional typed delivery of tutor-authored native components and files. Ordinary dialogue remains free assistant text; no tool call required.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        reply: { type: 'string', description: 'Complete student-facing answer; write the material itself, never an introductory promise.' },
        artifacts: { type: 'array', description: 'Only artifacts authorized by the current student message. [] when none.', items: {
          type: 'object', additionalProperties: false,
          properties: {
            type: { type: 'string', enum: types },
            trigger: { type: 'string', enum: ['explicit_user_request', 'pedagogical_completion'] },
            subject: { type: 'string', description: opts.image ? 'A short title of the deliverable. For emit_image, a concrete visual description with subject, composition and style; the runtime, not the tutor, generates the bytes.' : 'A short title of the deliverable.' },
            format: { type: 'string', enum: formats },
            content: NATIVE_ARTIFACT_CONTENT_TOOL_SCHEMA,
          },
          required: ['type', 'trigger', 'subject', 'format'],
        } },
      },
      required: ['artifacts'],
    },
  },
}
}
export const COMPLETE_TUTOR_TURN_TOOL = completeTutorTurnTool({ image: true })
// The Tutor's own decision to deliver text it has authored as a real file or
// native component. The call is the authorization (same mechanism as any LLM
// tool call); the document itself is ordinary streamed text, never JSON.
export type TextDeliveryKind = 'pdf' | 'pdf_html' | 'quiz' | 'conversation_pdf'
export interface TextDelivery { kind: TextDeliveryKind; title: string }
const DELIVERY_KINDS: TextDeliveryKind[] = ['pdf', 'pdf_html', 'quiz', 'conversation_pdf']
export const DELIVER_FROM_TEXT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'deliver_from_text',
    description: 'Deliver the material you write in THIS reply as a real file or tactile component: pdf = downloadable PDF of your reply; pdf_html = PDF plus a web (HTML) version of your reply; quiz = your numbered questions with A) B) C) options become touchable choices; conversation_pdf = the student\'s own conversation transcript as a PDF. Call it only when the student wants that deliverable. Write the complete material as your reply text in the same turn; the arguments stay small.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: DELIVERY_KINDS },
        title: { type: 'string', description: 'Short title of the material (max 120 characters).' },
      },
      required: ['kind', 'title'],
    },
  },
}
export function parseTextDelivery(raw: unknown): TextDelivery | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!DELIVERY_KINDS.includes(o.kind as TextDeliveryKind)) return null
  const title = typeof o.title === 'string' ? o.title.trim().slice(0, 120) : ''
  if (title.length < 2) return null
  return { kind: o.kind as TextDeliveryKind, title }
}

export interface ClosedTutorTurn { reply: string; artifacts: ArtifactSignal[] }
/**
 * The Tutor's typed closure. 7.5: the text the Tutor streamed is the reply; `reply` in the call is
 * optional (it duplicated the streamed text and, when the two differed, the artifacts were dropped).
 * No count cap on artifacts: costed side effects keep their own per-turn budget, reported visibly.
 */
export function parseClosedTutorTurn(raw: unknown, spokenReply = ''): ClosedTutorTurn | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const reply = typeof r.reply === 'string' && r.reply.trim() ? r.reply : spokenReply
  if (!Array.isArray(r.artifacts) || (!reply.trim() && !r.artifacts.length)) return null
  const artifacts: ArtifactSignal[] = []
  for (const item of r.artifacts) {
    const s = parseArtifactSignal(item)
    if (!s) return null
    if (s.type === 'emit_pdf') {
      if (s.trigger !== 'explicit_user_request' || !['pdf', 'pdf_html'].includes(s.format ?? '')) return null
    } else if (s.type === 'emit_audio') {
      if (s.format !== 'audio') return null
    } else if (s.type === 'emit_image') {
      // Costed side effect: a pedagogical completion can never authorize generation.
      if (s.trigger !== 'explicit_user_request' || s.format !== 'image') return null
    } else if (NATIVE_TYPES.includes(s.type)) {
      if (s.format !== 'native' || !s.content) return null
    } else return null
    artifacts.push(s)
  }
  return { reply, artifacts: dedupeSignals(artifacts) }
}
/** First factual rejection, in parser order. No source content is returned. */
export function diagnoseClosedTutorTurn(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'closure_invalid'
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.artifacts)) return 'artifacts_invalid'
  if ((typeof r.reply !== 'string' || !r.reply.trim()) && !r.artifacts.length) return 'reply_empty'
  for (const [i, item] of r.artifacts.entries()) {
    if (!item || typeof item !== 'object') return `artifact_invalid:${i}`
    const o = item as Record<string, unknown>
    if (!TYPES.includes(o.type as ArtifactSignalType)) return `invalid_type:${i}`
    if (!TRIGGERS.includes(o.trigger as ArtifactSignalTrigger)) return `invalid_trigger:${i}`
    if (typeof o.subject !== 'string' || o.subject.trim().length < 2) return `bad_subject:${i}`
    const s = parseArtifactSignal(item)!
    if (s.type === 'emit_pdf') {
      if (s.trigger !== 'explicit_user_request' || !['pdf', 'pdf_html'].includes(s.format ?? '')) return `pdf_contract:${i}`
    } else if (s.type === 'emit_audio') {
      if (s.format !== 'audio') return `audio_contract:${i}`
    } else if (s.type === 'emit_image') {
      if (s.trigger !== 'explicit_user_request' || s.format !== 'image') return `image_contract:${i}`
    } else if (NATIVE_TYPES.includes(s.type)) {
      if (s.format !== 'native') return `native_format:${i}`
      if (!s.content) return `native_missing_content:${i}`
    } else return `unsupported_type:${i}`
  }
  return null
}

/** Stream the tutor's reply string only, decoding complete JSON escape sequences. */
export function streamedTutorReplyPrefix(json: string): string {
  const marker = /"reply"\s*:\s*"/.exec(json)
  if (!marker) return ''
  const start = marker.index + marker[0].length
  let end = start
  for (let i = start; i < json.length; i++) {
    const ch = json[i]
    if (ch === '"') break
    if (ch === '\\') {
      const next = json[i + 1]
      if (next === undefined) break
      if (next === 'u') {
        if (!/^[0-9a-fA-F]{4}$/.test(json.slice(i + 2, i + 6))) break
        i += 5
      } else i++
      end = i + 1
      continue
    }
    end = i + 1
  }
  try {
    const result = JSON.parse('"' + json.slice(start, end) + '"') as string
    return /[\uD800-\uDBFF]$/.test(result) ? result.slice(0, -1) : result
  } catch { return '' }
}
