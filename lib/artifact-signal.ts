// SEEK 5.0 E-06 — structured artifact signal. Not inferred from pedagogical text.
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

export const SIGNAL_ARTIFACT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'signal_artifact',
    description:
      'Emit after the pedagogical act is complete. Materializes a side-effect. Never use this instead of teaching. Never print this call to the student.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: TYPES },
        trigger: { type: 'string', enum: TRIGGERS },
        subject: { type: 'string', description: 'What the artifact is about.' },
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
Do not print JSON, tool names, or debug to the student.
Do not call the tool merely because the user wrote PDF or artifact; finish teaching, then decide.
emit_audio is unavailable in this runtime.
`
