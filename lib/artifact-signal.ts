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
      'Call after teaching. One call per distinct taught part that warrants materialization. Subject must name only that part. Never print this to the student. Never use this instead of teaching.',
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
export const ARTIFACT_CHANNEL_INSTRUCTION = `
ARTIFACT CHANNEL:
You have a structured side-effect channel named signal_artifact.
Teach in normal text first. After the pedagogical act is complete, you may call signal_artifact if materialization is warranted.
If the act contains distinct taught parts and each part independently warrants its own artifact, you may call signal_artifact once per part. Each subject must identify only the content it materializes.
Do not emit an artifact per part by default. Decide.
Do not print JSON, tool names, or debug to the student.
Do not call the tool merely because the user wrote PDF or artifact; finish teaching, then decide.
emit_pdf IS available in this runtime: you may truthfully offer to prepare/materialize what you taught as a downloadable PDF. This states that the mechanism exists, not that a specific file is already generated — never claim a document has been created or is ready to download before it actually has been; simply teach, then let materialization happen through the normal signal_artifact decision.
emit_audio is unavailable in this runtime.
`
