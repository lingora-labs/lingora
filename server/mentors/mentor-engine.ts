// =============================================================================
// server/mentors/mentor-engine.ts
// LINGORA SEEK 3.1 — Mentor Engine
// =============================================================================
// FIX LOG:
//   FIX-6A  buildContext: uses SEEK 3.0 state field names with legacy fallbacks
//   FIX-6B  normalizeRuntimeCall: audio fallback to priorContext
//   FIX-6C  buildMentorPrompt: injects "Current topic" explicitly
//   FIX-6D  buildExecutionDirective: directive names → concrete instructions
//   FIX-7A  SEEK 3.1 Fase 0-A: EXERCISE_FEEDBACK_DIRECTIVE instruction added
//   FIX-7B  SEEK 3.1 Fase 0-A: activeExercise + activeTopic injected into prompt
// =============================================================================

import OpenAI from 'openai'
import { getMentorProfile } from './profiles'
import { getModeInstruction, TUTOR_PROHIBITIONS } from '@/lib/tutorProtocol'
import type {
  SessionState,
  ChatRequest,
  ExecutionPlan,
  TutorMode as ContractsTutorMode,
} from '@/lib/contracts'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const FALLBACKS: Record<string, string> = {
  es: 'No pude procesar tu mensaje. Intenta de nuevo.',
  en: 'Could not process your message. Please try again.',
  no: 'Kunne ikke behandle meldingen din. Prøv igjen.',
  fr: "Je n'ai pas pu traiter votre message. Réessayez.",
  de: 'Konnte Ihre Nachricht nicht verarbeiten. Versuchen Sie es erneut.',
  it: 'Non ho potuto elaborare il tuo messaggio. Riprova.',
  pt: 'Não consegui processar sua mensagem. Tente novamente.',
  ar: 'لم أتمكن من معالجة رسالتك. يرجى المحاولة مرة أخرى.',
  ja: 'メッセージを処理できませんでした。もう一度お試しください。',
  zh: '无法处理您的消息。请重试。',
}

type LegacyMentorState = Partial<SessionState> & {
  mentor?: 'Alex' | 'Sarah' | 'Nick'
  tutorMode?: ContractsTutorMode
  level?: string
  topic?: string
  lang?: string
  lastAction?: string
  lessonIndex?: number
  courseActive?: boolean
  awaitingQuizAnswer?: boolean
  samples?: unknown[]
}

type MentorRuntimeParams = {
  request: ChatRequest
  state: SessionState
  plan?: ExecutionPlan
  priorContext?: string
  action?: string
}

type ProtocolTutorMode = Parameters<typeof getModeInstruction>[0]

type NormalizedMentorCall = {
  message: string
  state: LegacyMentorState
  systemDirective?: string
  plan?: ExecutionPlan
  action?: string
  priorContext?: string
}

function resolveInterfaceLanguage(state: LegacyMentorState): string {
  return state.interfaceLanguage ?? state.lang ?? 'en'
}

function resolveMentorName(state: LegacyMentorState): 'Alex' | 'Sarah' | 'Nick' {
  return state.mentorProfile ?? state.mentor ?? 'Alex'
}

function resolveTutorMode(state: LegacyMentorState): ContractsTutorMode {
  if (state.tutorMode) return state.tutorMode
  switch (state.activeMode) {
    case 'structured':
    case 'pdf_course':
      return 'structured'
    case 'free':
      return 'free'
    case 'interact':
    default:
      return 'conversational'
  }
}

function resolveProtocolMode(mode: ContractsTutorMode): ProtocolTutorMode {
  if (mode === 'free') return 'conversational' as ProtocolTutorMode
  return mode as ProtocolTutorMode
}

function resolveTopic(state: LegacyMentorState): string | null {
  // SEEK 3.1 Fase 0-A: currentLessonTopic has highest priority
  if ((state as any).currentLessonTopic?.trim()) return (state as any).currentLessonTopic
  if (state.curriculumPlan?.topic)               return state.curriculumPlan.topic
  if (state.lastConcept)                         return state.lastConcept
  if (state.lastUserGoal)                        return state.lastUserGoal
  if (state.topic)                               return state.topic
  return null
}

function resolveLevel(state: LegacyMentorState): string | undefined {
  return state.confirmedLevel ?? state.userLevel ?? state.level
}

function buildContext(state: LegacyMentorState): string {
  const parts: string[] = []

  const level  = resolveLevel(state)
  const topic  = resolveTopic(state)
  const lang   = resolveInterfaceLanguage(state)

  if (level && level !== 'A0')   parts.push(`Level: ${level}`)
  if ((state.tokens ?? 0) > 0)   parts.push(`Exchanges: ${state.tokens}`)
  if (topic)                      parts.push(`Current topic: ${topic}`)
  if (lang)                       parts.push(`Student interface language: ${lang}`)
  if (state.lastAction)           parts.push(`Last action: ${state.lastAction}`)

  const lessonIndex = state.currentModuleIndex ?? state.lessonIndex
  if (lessonIndex && lessonIndex > 0) parts.push(`Module index: ${lessonIndex}`)

  if (state.tutorPhase)           parts.push(`Current phase: ${state.tutorPhase}`)

  const courseActive = state.curriculumPlan != null || state.courseActive
  if (courseActive !== undefined) parts.push(`Course active: ${courseActive}`)

  if (state.awaitingQuizAnswer)   parts.push(`Awaiting quiz answer: true`)
  if ((state.samples ?? []).length > 0) parts.push(`Student samples collected: ${(state.samples ?? []).length}`)
  if ((state.diagnosticSamples ?? 0) > 0) parts.push(`Diagnostic samples: ${state.diagnosticSamples}`)

  if (state.errorMemory) {
    const errs = [
      ...(state.errorMemory.grammar       ?? []),
      ...(state.errorMemory.vocabulary    ?? []),
      ...(state.errorMemory.pronunciation ?? []),
    ]
    if (errs.length > 0) parts.push(`Recurring errors: ${errs.slice(0, 3).join(', ')}`)
  }

  return parts.length > 0
    ? '\n\n[Session state: ' + parts.join(' · ') + ']' 
    : ''
}

// ─────────────────────────────────────────────────────────────────────────────
// DIRECTIVE INSTRUCTIONS
// FIX-7A (SEEK 3.1 Fase 0-A): EXERCISE_FEEDBACK_DIRECTIVE added
// ─────────────────────────────────────────────────────────────────────────────

const DIRECTIVE_INSTRUCTIONS: Record<string, string> = {
  RICH_CONTENT_DIRECTIVE:
    'Respond with full pedagogical depth. Use tables, structured explanations, and examples when they serve the student. Do not pad. Do not repeat. One focused action per response.',
  STRUCTURED_COURSE_DIRECTIVE:
    'You are in structured course mode. Follow the pedagogical sequence: guide → lesson → schema → quiz → feedback. Do not skip steps. Do not blend phases. Deliver exactly one phase action per response.',
  FREE_CONVERSATION_DIRECTIVE:
    'You are in free conversation mode. Respond naturally. Correct errors inline and briefly — one correction per response maximum. If the student gives a very short or vague message, introduce one concrete topic or micro-action appropriate to their level. Never leave the student without direction.',
  PDF_COURSE_DIRECTIVE:
    'You are generating formal course material. Content should be structured, downloadable-quality, and self-contained. Include theory, examples, and exercises.',
  CORRECTION_ONLY_DIRECTIVE:
    'The student asked for a correction. Correct exactly what they wrote. List each error with explanation. Do not teach a full lesson. Do not add content beyond the correction.',
  TRANSLATION_ONLY_DIRECTIVE:
    'The student asked for a translation. Provide ONLY the translation. No explanation. No pedagogy. No extra content.',
  FIRST_TURN_DIRECTIVE:
    'This is the first message of the session. Greet the student warmly and specifically — you already know their topic and language. Ask one concrete opening question to understand their starting point. Do not give a lesson yet.',
  CURRICULUM_PRESENTER_DIRECTIVE:
    'Present a full, structured curriculum for the requested topic. Include module titles, learning objectives, and progression logic. Be concrete and specific to the domain. Produce the same quality a domain expert would — not a generic outline.',
  // FIX-7A — SEEK 3.1 Fase 0-A
  EXERCISE_FEEDBACK_DIRECTIVE:
    'The student just responded to an active exercise. Your ONLY job is to evaluate that specific response.\n' +
    'DO:\n' +
    '  1. State clearly if the answer is correct or not.\n' +
    '  2. If incorrect, explain the specific error in 1-2 sentences.\n' +
    '  3. Give the correct form with a brief explanation of why.\n' +
    '  4. One memory tip if useful.\n' +
    'DO NOT: start a new lesson. Do not change the topic. Do not ask what they want to study.\n' +
    'The exercise and topic context are provided below.',
}

function buildExecutionDirective(params: {
  systemDirective?: string
  plan?: ExecutionPlan
  action?: string
  priorContext?: string
}): string {
  const parts: string[] = []

  if (params.systemDirective) {
    parts.push(params.systemDirective)
  }

  if (params.plan?.mentor?.directive) {
    const instruction = DIRECTIVE_INSTRUCTIONS[params.plan.mentor.directive]
    if (instruction) {
      parts.push(`\nINSTRUCTION FOR THIS RESPONSE:\n${instruction}`)
    } else {
      parts.push(`Mentor directive: ${params.plan.mentor.directive}`)
    }
  }

  // FIX-7B — SEEK 3.1 Fase 0-A: inject exercise context when available
  // plan.mentor.activeExercise and plan.mentor.activeTopic are set by orchestrator
  // when building the EXERCISE_FEEDBACK_DIRECTIVE plan. They must reach the LLM.
  // FIX: use NonNullable<ExecutionPlan['mentor']> to avoid unsafe typeof on optional plan
  const mentor: (NonNullable<ExecutionPlan['mentor']> & {
    activeExercise?: string
    activeTopic?: string
  }) | undefined = params.plan?.mentor as (NonNullable<ExecutionPlan['mentor']> & {
    activeExercise?: string
    activeTopic?: string
  }) | undefined
  if (mentor?.activeExercise) {
    parts.push(`\nACTIVE EXERCISE (what the student is responding to):\n"${mentor.activeExercise}"`)
  }
  if (mentor?.activeTopic) {
    parts.push(`LESSON TOPIC: ${mentor.activeTopic}`)
  }

  if (params.action && params.action !== 'conversation') {
    parts.push(`Current execution action: ${params.action}`)
  }

  if (params.priorContext?.trim()) {
    parts.push(`Prior context for this response:\n${params.priorContext}`)
  }

  return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : ''
}

export function buildMentorPrompt(params: {
  message:          string
  state?:           LegacyMentorState
  systemDirective?: string
  priorContext?:    string
  action?:          string
  plan?:            ExecutionPlan
}): { system: string; user: string } {
  const state       = params.state ?? {}
  const mentorName  = resolveMentorName(state)
  const profile     = getMentorProfile(mentorName)
  const mode        = resolveTutorMode(state)
  const protocolMode = resolveProtocolMode(mode)
  const topic       = resolveTopic(state)
  const context     = buildContext(state)
  const modeInstructions   = getModeInstruction(protocolMode, topic)
  const executionDirective = buildExecutionDirective({
    systemDirective: params.systemDirective,
    plan:            params.plan,
    action:          params.action,
    priorContext:    params.priorContext,
  })

  const system = [
    profile.system,
    modeInstructions,
    executionDirective,
    TUTOR_PROHIBITIONS,
    context,
  ].filter(Boolean).join('')

  const user = String(params.message || '')

  return { system, user }
}

function normalizeLegacyCall(
  message: string,
  state: LegacyMentorState = {},
  systemDirective?: string,
): NormalizedMentorCall {
  return { message, state, systemDirective, plan: undefined, action: undefined, priorContext: undefined }
}

function normalizeRuntimeCall(params: MentorRuntimeParams): NormalizedMentorCall {
  const rawMessage = params.request?.message?.trim()
  const message = rawMessage
    ? rawMessage
    : params.priorContext?.trim()
      ? params.priorContext
      : '[Audio input — respond to the transcription in the prior context]'

  return {
    message,
    state:           params.state ?? {},
    systemDirective: undefined,
    plan:            params.plan,
    action:          params.action,
    priorContext:    params.priorContext,
  }
}

export async function getMentorResponse(
  message: string,
  state?: LegacyMentorState,
  systemDirective?: string,
): Promise<string>
export async function getMentorResponse(
  params: MentorRuntimeParams,
): Promise<string>
export async function getMentorResponse(
  arg1: string | MentorRuntimeParams,
  arg2?: LegacyMentorState,
  arg3?: string,
): Promise<string> {
  const normalized: NormalizedMentorCall =
    typeof arg1 === 'string'
      ? normalizeLegacyCall(arg1, arg2 ?? {}, arg3)
      : normalizeRuntimeCall(arg1)

  const { system, user } = buildMentorPrompt({
    message:         normalized.message,
    state:           normalized.state,
    systemDirective: normalized.systemDirective,
    plan:            normalized.plan,
    action:          normalized.action,
    priorContext:    normalized.priorContext,
  })

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Mentor timeout')), 14000),
    )

    const completion = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
        temperature: 0.7,
        top_p:       0.88,
        max_tokens:  650,
      }),
      timeout,
    ])

    return (completion.choices?.[0]?.message?.content ?? '').trim()
  } catch (error: unknown) {
    const msg  = error instanceof Error ? error.message : String(error)
    console.error('[MENTOR] Error:', msg)
    const lang = resolveInterfaceLanguage(normalized.state)
    return FALLBACKS[lang] ?? FALLBACKS.en
  }
}

export async function getMentorResponseStream(
  params: MentorRuntimeParams,
): Promise<AsyncGenerator<string>> {
  const normalized = normalizeRuntimeCall(params)

  const { system, user } = buildMentorPrompt({
    message:         normalized.message,
    state:           normalized.state,
    systemDirective: normalized.systemDirective,
    plan:            normalized.plan,
    action:          normalized.action,
    priorContext:    normalized.priorContext,
  })

  try {
    const stream = await openai.chat.completions.create({
      model:    'gpt-4o',
      stream:   true,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
      temperature: 0.7,
      top_p:       0.88,
      max_tokens:  650,
    })

    return (async function* () {
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) yield delta
      }
    })()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn('[MENTOR] Streaming unavailable, falling back:', msg)
    const fallbackText = await getMentorResponse(params)
    return (async function* () {
      if (fallbackText) yield fallbackText
    })()
  }
}

