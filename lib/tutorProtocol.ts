// LINGORA SEEK 3.0 — TUTOR PROTOCOL v1.2 + P2 compound-sequence exception
import type { SessionState } from '@/lib/contracts'

export type PedagogicalAction =
  | 'guide' | 'lesson' | 'schema' | 'quiz' | 'feedback'
  | 'conversation' | 'illustration' | 'pdf' | 'pronunciation'

export type TutorMode = 'structured' | 'conversational' | 'professional' | 'diagnostic'
export type TutorPhase = 'idle' | 'guide' | 'lesson' | 'conversation' | 'schema' | 'quiz' | 'feedback'
export type LearningStage = 'diagnosis' | 'schema' | 'examples' | 'quiz' | 'score' | 'next'

const SEQUENCE: Record<TutorMode, TutorPhase[]> = {
  structured: ['guide', 'lesson', 'schema', 'quiz', 'feedback'],
  conversational: ['guide', 'conversation', 'schema', 'quiz'],
  professional: ['guide', 'lesson', 'quiz', 'feedback'],
  diagnostic: ['quiz', 'feedback', 'guide'],
}

function resolveTopic(state: Partial<SessionState>): string {
  return state.lastUserGoal ?? state.lastConcept ?? 'Spanish'
}
function resolveMentor(state: Partial<SessionState>): string {
  return state.mentorProfile ?? 'Sarah'
}
function resolveLevel(state: Partial<SessionState>): string {
  return state.confirmedLevel ?? state.userLevel ?? 'A1'
}
function resolveLang(state: Partial<SessionState>): string {
  return state.interfaceLanguage ?? 'en'
}
function resolveModuleIndex(state: Partial<SessionState>): number {
  return state.currentModuleIndex ?? 0
}
function resolveCourseActive(state: Partial<SessionState>): boolean {
  return !!state.curriculumPlan
}
function resolveAwaitingQuiz(state: Partial<SessionState>): boolean {
  return state.tutorPhase === 'quiz'
}

export function resolveTutorMode(topic: string | null, mentor: string | null): TutorMode {
  const t = topic ?? 'conversation'
  const m = (mentor ?? 'sarah').toLowerCase()
  if (t === 'leveltest') return 'diagnostic'
  if (m === 'alex' || t === 'conversation' || t === 'travel') return 'conversational'
  if (m === 'nick' || t === 'business') return 'professional'
  return 'structured'
}

export function resolvePedagogicalAction(params: {
  message: string
  state: Partial<SessionState>
  explicit: PedagogicalAction | null
}): {
  action: PedagogicalAction
  mode: TutorMode
  systemDirective: string
  nextPhase: TutorPhase
  nextLessonIndex: number
  nextCourseActive: boolean
} {
  const { state, explicit } = params
  const topic = resolveTopic(state)
  const mentor = resolveMentor(state)
  if (state.activeMode === 'interact' || state.activeMode === 'free') {
    const freeMode = modeToTutorMode(state.activeMode as 'interact' | 'free', topic, mentor)
    return {
      action: 'conversation', mode: freeMode, systemDirective: buildDirective('conversation', state),
      nextPhase: 'conversation', nextLessonIndex: resolveModuleIndex(state), nextCourseActive: resolveCourseActive(state),
    }
  }
  if (explicit && explicit !== 'conversation') {
    const mode = state.activeMode
      ? modeToTutorMode(state.activeMode as 'interact' | 'structured' | 'pdf_course' | 'free', topic, mentor)
      : resolveTutorMode(topic, mentor)
    return {
      action: explicit, mode, systemDirective: buildDirective(explicit, state),
      nextPhase: phaseFromAction(explicit), nextLessonIndex: resolveModuleIndex(state), nextCourseActive: resolveCourseActive(state),
    }
  }
  const mode = state.activeMode
    ? modeToTutorMode(state.activeMode as 'interact' | 'structured' | 'pdf_course' | 'free', topic, mentor)
    : resolveTutorMode(topic, mentor)
  const tokens = state.tokens ?? 0
  const awaitingAnswer = resolveAwaitingQuiz(state)
  const lastAct = (state.tutorPhase ?? null) as PedagogicalAction | null
  if (awaitingAnswer) {
    return {
      action: 'feedback', mode, systemDirective: buildDirective('feedback', state),
      nextPhase: 'feedback', nextLessonIndex: resolveModuleIndex(state), nextCourseActive: resolveCourseActive(state),
    }
  }
  const currentPhase = derivePhase(lastAct, tokens, mode)
  const nextPhase = advancePhase(currentPhase, mode, tokens, awaitingAnswer)
  const action = actionFromPhase(nextPhase, mode)
  const completingCycle = currentPhase === 'feedback'
  return {
    action, mode, systemDirective: buildDirective(action, state), nextPhase,
    nextLessonIndex: completingCycle ? resolveModuleIndex(state) + 1 : resolveModuleIndex(state),
    nextCourseActive: true,
  }
}

function derivePhase(lastAction: PedagogicalAction | null, tokens: number, _mode: TutorMode): TutorPhase {
  if (!lastAction || tokens === 0) return 'idle'
  const map: Partial<Record<PedagogicalAction, TutorPhase>> = {
    guide: 'guide', lesson: 'lesson', schema: 'schema', quiz: 'quiz', feedback: 'feedback',
    conversation: 'conversation', illustration: 'lesson', pdf: 'lesson', pronunciation: 'lesson',
  }
  return map[lastAction] ?? 'lesson'
}

function advancePhase(current: TutorPhase, mode: TutorMode, tokens: number, awaitingAnswer: boolean): TutorPhase {
  const seq = SEQUENCE[mode]
  if (tokens === 0 || current === 'idle') return 'guide'
  if (current === 'quiz' && awaitingAnswer) return 'quiz'
  const idx = seq.indexOf(current)
  if (idx === -1) return seq[0]
  const next = seq[(idx + 1) % seq.length]
  if (next === 'guide' && tokens > 2) return seq[1] ?? seq[0]
  return next
}

function phaseFromAction(action: PedagogicalAction): TutorPhase {
  const map: Partial<Record<PedagogicalAction, TutorPhase>> = {
    guide: 'guide', lesson: 'lesson', schema: 'schema', quiz: 'quiz', feedback: 'feedback',
    conversation: 'conversation', illustration: 'lesson', pdf: 'lesson', pronunciation: 'lesson',
  }
  return map[action] ?? 'idle'
}

function actionFromPhase(phase: TutorPhase, mode: TutorMode): PedagogicalAction {
  if (phase === 'idle') return 'guide'
  if (phase === 'lesson' && mode === 'conversational') return 'conversation'
  return phase as PedagogicalAction
}

function buildDirective(action: PedagogicalAction, state: Partial<SessionState>): string {
  const topic = resolveTopic(state)
  const level = resolveLevel(state)
  const lang = resolveLang(state)
  const mentor = resolveMentor(state).toLowerCase()
  const tokens = state.tokens ?? 0
  const lesson = resolveModuleIndex(state)
  const base = `TUTOR DIRECTIVE — Topic: ${topic}. CEFR: ${level}. Language: ${lang}. Mentor: ${mentor}. Exchanges: ${tokens}. Lesson: ${lesson + 1}.`
  return `${base}\nACTION: ${action.toUpperCase()}\nTeach the requested material for ${topic}.`
}

export function getModeInstruction(mode: TutorMode, topic: string | null): string {
  const map: Record<TutorMode, string> = {
    structured: `\n\nMODE: STRUCTURED TUTORING (${topic ?? 'Spanish'})\nFollow the pedagogical sequence: guide → lesson → schema → quiz → feedback.\nDo not skip steps. Do not blend phases in one response unless the student explicitly sequenced several requests in this message — then fulfill that sequence now.\nTone: professional, warm, university-tutor level.`,
    conversational: `\n\nMODE: CONVERSATIONAL IMMERSION (${topic ?? 'Spanish'})\nPrioritize natural conversation. Grammar correction is inline and brief.`,
    professional: `\n\nMODE: PROFESSIONAL SPANISH (${topic ?? 'Spanish'})\nGround every interaction in a realistic workplace scenario.`,
    diagnostic: `\n\nMODE: LEVEL DIAGNOSTIC\nAssess CEFR over several exchanges. Do not reveal the assessment mid-conversation.`,
  }
  return map[mode] ?? ''
}

export const TUTOR_PROHIBITIONS = `
\nPROHIBITED BEHAVIORS (absolute — never do these):
— Do not ask "What would you like to learn?" when topic is already set.
— Do not ask "How can I help you?" in an active tutoring session.
— Do not restart context when the student changes subject — redirect once, then continue.
— Do not generate a PDF unless explicitly requested by the student.
— Do not generate an image unless explicitly requested by the student.
— Do not blend multiple phases (lesson + quiz + feedback) in a single response unless the student explicitly sequenced several requests in this same message. Then cover those requested parts in this turn.
— Do not act as a general-purpose AI assistant — you have a specific tutoring role.
— Do not give the quiz answer before the student responds.`

export function modeToTutorMode(
  activeMode: 'interact' | 'structured' | 'pdf_course' | 'free' | null | undefined,
  topic: string | null,
  mentor: string | null,
): TutorMode {
  if (activeMode === 'structured' || activeMode === 'pdf_course') return 'structured'
  if (activeMode === 'free') return 'conversational'
  return resolveTutorMode(topic, mentor)
}

export function initialStage(_activeMode: 'interact' | 'structured' | 'pdf_course' | 'free' | null | undefined): LearningStage {
  return 'schema'
}

export function nextStage(current: LearningStage): LearningStage {
  const seq: LearningStage[] = ['diagnosis', 'schema', 'examples', 'quiz', 'score', 'next']
  const idx = seq.indexOf(current)
  if (idx === -1 || idx >= seq.length - 1) return 'schema'
  return seq[idx + 1]
}
