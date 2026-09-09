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

export const ARTIFACT_CHANNEL_INSTRUCTION = `
ARTIFACT CHANNEL:
You have a structured side-effect channel named signal_artifact.
Teach in normal text first. After the pedagogical act is complete, you may call signal_artifact if materialization is warranted.
If the act contains distinct taught parts and each part independently warrants its own artifact, you may call signal_artifact once per part. Each subject must identify only the content it materializes.
Do not emit an artifact per part by default. Decide.
Do not print JSON, tool names, or debug to the student.
Do not call the tool merely because the user wrote PDF or artifact; finish teaching, then decide.
emit_audio is unavailable in this runtime.
`
