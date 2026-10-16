// SEEK 5.0 E-06/P8 — structured artifact signal. Not inferred from pedagogical text.
export type ArtifactSignalType = 'show_visual' | 'emit_pdf' | 'show_quiz' | 'emit_audio'
export type ArtifactSignalTrigger = 'pedagogical_completion' | 'explicit_user_request'

export interface ArtifactSignal {
  type: ArtifactSignalType
  trigger: ArtifactSignalTrigger
  subject: string
  format?: string
}

export interface MentorTurnResult {
  content: string
  artifactSignals: ArtifactSignal[]
}

const TYPES: ArtifactSignalType[] = ['show_visual', 'emit_pdf', 'show_quiz', 'emit_audio']
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
  return { type: type as ArtifactSignalType, trigger: trigger as ArtifactSignalTrigger, subject, format }
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
ARTIFACT CHANNEL:
You have a structured side-effect channel named signal_artifact.
Teach or write the content in normal text first, then call signal_artifact in this same model turn when the student actually requested a deliverable.
Only request emit_pdf when the student's CURRENT message explicitly asks for a PDF, printable material, or a take-away document. Use trigger explicit_user_request. You may offer a PDF in ordinary text when it was not requested, but do not generate one.
If the student requested multiple distinct artifacts, emit one signal per requested subject. Subject must identify only the content it materializes. Avoid duplicates.
Do not print JSON, tool names, or debug to the student.
Do not call the tool before producing the substantive content. If the user asked ONLY for a document, create the document content directly; do not force an unrelated lesson or preliminary quiz.
Do not call signal_artifact for a bare greeting, an opening question, or a diagnostic prompt with no substantive taught content yet — "pedagogical completion" means you actually taught something the student could study from, not that the turn is merely finished. A first-turn greeting or a request for a sample sentence is not, by itself, material worth a document.
emit_pdf IS available in this runtime: you may truthfully offer a downloadable PDF, but must never claim one is already generated before execution succeeds. When the student requests a PDF, provide complete source content and emit the structured signal; the runtime handles the real file or an explicit failure.
emit_audio IS available in this runtime: you may truthfully offer to speak what you taught aloud. This states the mechanism exists, not that audio has already been generated — never claim audio is ready before it actually is. Only offer or emit audio when it genuinely serves the student (e.g. pronunciation modeling, listening practice) — not by default on every turn.
`
