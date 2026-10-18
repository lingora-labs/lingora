// SEEK 5.0 E-06/P8 — structured artifact signal. Not inferred from pedagogical text.
export type ArtifactSignalType = 'show_visual' | 'emit_pdf' | 'show_quiz' | 'emit_audio' | 'emit_image' | 'table_matrix' | 'schema_pro' | 'quiz'
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

const TYPES: ArtifactSignalType[] = ['show_visual', 'emit_pdf', 'show_quiz', 'emit_audio', 'emit_image', 'table_matrix', 'schema_pro', 'quiz']
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
export const ARTIFACT_CHANNEL_INSTRUCTION = `
TUTOR TURN CONTRACT:
Make exactly one complete_tutor_turn call per response. It includes your complete pedagogical reply and an artifacts array.
You alone decide which NEW deliverables the CURRENT student requested. Use artifacts: [] for ordinary questions, greetings and continuation of prior exercises without a new document request.
When the student requests a PDF, printable learning sheet, take-away document or both PDF and web HTML, compose actual useful study content and declare emit_pdf with trigger explicit_user_request, subject specifying its contents, format pdf_html for both versions or pdf for PDF alone.
When the student's CURRENT message explicitly requests generation or drawing of a new image, declare emit_image with trigger explicit_user_request, format image, and a detailed subject describing the image to generate. Image generation is available through the artifact runtime: never say you cannot generate it, and never claim the image is ready until the runtime supplies it. Do not request an image merely because a lesson is complete or the student discusses images; ordinary greetings, explanations, quizzes, schemas, and tables do not authorize image generation. Never request an image when the student says not to create one.\nInclude all distinct deliverables in one turn, never postpone them to the next student message. For deliberate audio use emit_audio with format audio. Native interactive outputs use type table_matrix (colored cells), schema_pro (expandable concept blocks), or quiz (touchable choices), with format native and a complete content object. These are actual interface components, never HTML markup inside reply. For an explicitly requested visual matrix, schema or touch quiz, author the respective native artifact and a concise accompanying reply. QUIZ QUALITY GATE: each question must be independently evaluable, with exactly one grammatical/true option. Use ONE fill-in blank at most per question; NEVER combine two fill-in sentences with slash-separated answer pairs. The correct-indexed option and its explanation must agree. If you cannot establish a correct option, do not emit the quiz. In structured mode, a genuine study lesson contains a guide and explanation plus a native schema_pro and quiz; the quiz collects responses before feedback. In pdf_course mode, never create a PDF on mode selection alone.
Do not claim files already exist: the runtime will materialize your choices or visibly report an execution failure. Do not emit raw tool metadata to the student.
`

export const COMPLETE_TUTOR_TURN_TOOL = {
  type: 'function' as const,
  function: {
    name: 'complete_tutor_turn',
    description: 'The sole tutor turn closure. Give a substantive reply and zero or more newly requested deliverables. Always invoke once; artifacts: [] is normal conversation.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        reply: { type: 'string', description: 'Complete student-facing answer; write the material itself, never an introductory promise.' },
        artifacts: { type: 'array', description: 'Only artifacts authorized by the current student message. [] when none.', items: {
          type: 'object', additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['emit_pdf', 'emit_audio', 'emit_image', 'table_matrix', 'schema_pro', 'quiz'] },
            trigger: { type: 'string', enum: ['explicit_user_request', 'pedagogical_completion'] },
            subject: { type: 'string', description: 'For emit_image, supply a concrete visual prompt with subject, composition and style; the runtime, not the tutor, generates the bytes.' },
            format: { type: 'string', enum: ['pdf', 'pdf_html', 'audio', 'image', 'native'] },
            content: { type: 'object', description: 'Native only. table_matrix: {title,columns:[{key,label}],rows:[[ {text,tone:ok|warn|danger|info|neutral} ]]}. schema_pro: {title,subtitle,blocks:[{type:concept,title,body},{type:highlight,text,tone},{type:flow,steps:[...]},{type:table,columns:[...],rows:[[...]]}]}. quiz: {title,questions:[{question,options:[...],correct:0-based index,explanation}]}. Use meaningful source-grounded material.', additionalProperties: true },
          },
          required: ['type', 'trigger', 'subject', 'format'],
        } },
      },
      required: ['reply', 'artifacts'],
    },
  },
}
export interface ClosedTutorTurn { reply: string; artifacts: ArtifactSignal[] }
export function parseClosedTutorTurn(raw: unknown): ClosedTutorTurn | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.reply !== 'string' || !r.reply.trim()
      || !Array.isArray(r.artifacts) || r.artifacts.length > 5) return null
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
    } else if (s.type === 'table_matrix' || s.type === 'schema_pro' || s.type === 'quiz') {
      if (s.format !== 'native' || !s.content) return null
    } else return null
    artifacts.push(s)
  }
  return { reply: r.reply, artifacts: dedupeSignals(artifacts) }
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
