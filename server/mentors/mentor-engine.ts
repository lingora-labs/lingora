// =============================================================================
// server/mentors/mentor-engine.ts
// LINGORA SEEK 3.9 — Mentor Engine
// SEEK 5.0 S1 E-11 — ContextPack injected into the turn as information.
// SEEK 5.0 P4 — adaptive output budget (4096 default / 8192 compound)
// =============================================================================

import OpenAI from 'openai'
import { getMentorProfile } from './profiles'
import { getModeInstruction, TUTOR_PROHIBITIONS } from '@/lib/tutorProtocol'
import { buildContextPack, formatContextPack, type ContextPack } from '@/lib/context-pack'
import type {
  SessionState,
  ChatRequest,
  ExecutionPlan,
  TutorMode as ContractsTutorMode,
} from '@/lib/contracts'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const MENTOR_MAX_OUTPUT_TOKENS = 4096
const COMPOUND_MAX_OUTPUT_TOKENS = 8192

const FALLBACKS: Record<string, string> = {
  es: 'No pude procesar tu mensaje. Intenta de nuevo.',
  en: 'Could not process your message. Please try again.',
  no: 'Kunne ikke behandle meldingen din. Proev igjen.',
  fr: "Je n'ai pas pu traiter votre message. Reessayez.",
  de: 'Konnte Ihre Nachricht nicht verarbeiten. Versuchen Sie es erneut.',
  it: 'Non ho potuto elaborare il tuo messaggio. Riprova.',
  pt: 'Nao consegui processar sua mensagem. Tente novamente.',
  ar: "Could not process your message. Please try again.",
  ja: 'messeji wo shori dekimasendeshita. mou ichido o tameshi kudasai.',
  zh: 'Wufa chuli nin de xiaoxi. Qing chongshi.',
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
  if ((state as any).currentLessonTopic?.trim()) return (state as any).currentLessonTopic
  if (state.curriculumPlan?.topic) return state.curriculumPlan.topic
  if (state.lastConcept) return state.lastConcept
  if (state.lastUserGoal) return state.lastUserGoal
  if (state.topic) return state.topic
  return null
}

function resolveLevel(state: LegacyMentorState): string | undefined {
  return state.confirmedLevel ?? state.userLevel ?? state.level
}

function resolveOutputBudget(plan?: ExecutionPlan, pack?: ContextPack): number {
  const step = plan?.executionOrder?.find(
    (item) => item.params != null && Object.prototype.hasOwnProperty.call(item.params, 'outputBudget'),
  )
  const raw = step?.params?.outputBudget
  if (typeof raw === 'number' && raw > 0) return raw
  if (pack?.compoundPedagogicalAct) return COMPOUND_MAX_OUTPUT_TOKENS
  return MENTOR_MAX_OUTPUT_TOKENS
}

function readPlanContextPack(plan?: ExecutionPlan): ContextPack | undefined {
  const step = plan?.executionOrder?.find(
    (item) => item.params != null && Object.prototype.hasOwnProperty.call(item.params, 'contextPack'),
  )
  const raw = step?.params?.contextPack
  if (raw && typeof raw === 'object') return raw as ContextPack
  return undefined
}

function resolveTurnContextPack(
  message: string,
  state: LegacyMentorState,
  plan?: ExecutionPlan,
): ContextPack {
  const transported = readPlanContextPack(plan)
  if (transported) return transported
  return buildContextPack({
    interfaceLanguage: resolveInterfaceLanguage(state),
    languageProficiency: resolveLevel(state),
    message,
    lastConcept: state.lastConcept,
    lastUserGoal: state.lastUserGoal,
    turnCount: state.tokens ?? 0,
    activeMode: state.activeMode,
  })
}

function buildContext(state: LegacyMentorState): string {
  const parts: string[] = []
  const level = resolveLevel(state)
  const topic = resolveTopic(state)
  const lang = resolveInterfaceLanguage(state)
  if (level && level !== 'A0') parts.push(`Level: ${level}`)
  if ((state.tokens ?? 0) > 0) parts.push(`Exchanges: ${state.tokens}`)
  if (topic) parts.push(`Current topic: ${topic}`)
  if (lang) parts.push(`Student interface language: ${lang}`)
  if (state.lastAction) parts.push(`Last action: ${state.lastAction}`)
  const lessonIndex = state.currentModuleIndex ?? state.lessonIndex
  if (lessonIndex && lessonIndex > 0) parts.push(`Module index: ${lessonIndex}`)
  if (state.tutorPhase) parts.push(`Current phase: ${state.tutorPhase}`)
  const courseActive = state.curriculumPlan != null || state.courseActive
  if (courseActive !== undefined) parts.push(`Course active: ${courseActive}`)
  if (state.awaitingQuizAnswer) parts.push(`Awaiting quiz answer: true`)
  if ((state.samples ?? []).length > 0) parts.push(`Student samples collected: ${(state.samples ?? []).length}`)
  if ((state.diagnosticSamples ?? 0) > 0) parts.push(`Diagnostic samples: ${state.diagnosticSamples}`)
  if (state.errorMemory) {
    const errs = [
      ...(state.errorMemory.grammar ?? []),
      ...(state.errorMemory.vocabulary ?? []),
      ...(state.errorMemory.pronunciation ?? []),
    ]
    if (errs.length > 0) parts.push(`Recurring errors: ${errs.slice(0, 3).join(', ')}`)
  }
  if ((state as Record<string, unknown>).lastUserAudioTranscript) {
    const t = (state as Record<string, unknown>).lastUserAudioTranscript as string
    parts.push(`Audio transcript from prior turn: "${t}" — do NOT ask the student to send audio again.`)
  }
  return parts.length > 0 ? '\n\n[Session state: ' + parts.join(' | ') + ']' : ''
}

const DIRECTIVE_INSTRUCTIONS: Record<string, string> = {
  RICH_CONTENT_DIRECTIVE:
    'Respond with full pedagogical depth. Use tables, structured explanations, and examples when they serve the student. Do not pad. Do not repeat. If the student sequenced several requests in this message, cover that sequence in this turn instead of deferring parts.' +
    '\n\nCRITICAL: NEVER refuse a task by citing your Spanish-teaching function. If the task is in Spanish or serves learning — execute it with expert depth.',
  STRUCTURED_COURSE_DIRECTIVE:
    'You are in structured course mode. Follow the pedagogical sequence: guide -> lesson -> schema -> quiz -> feedback. Do not skip steps. Do not blend phases unless the student explicitly sequenced several requests in this message — then fulfill that sequence now.',
  FREE_CONVERSATION_DIRECTIVE:
    'You are in free conversation mode. Respond naturally. Correct errors inline and briefly.',
  PDF_COURSE_DIRECTIVE:
    'You are generating formal course material. Content should be structured, downloadable-quality, and self-contained.',
  CORRECTION_ONLY_DIRECTIVE:
    'The student asked for a correction. Correct exactly what they wrote. Do not teach a full lesson.',
  TRANSLATION_ONLY_DIRECTIVE:
    'The student asked for a translation. Provide ONLY the translation.',
  FIRST_TURN_DIRECTIVE:
    'This is the first message of the session. Greet the student warmly. Ask one concrete opening question. Do not give a lesson yet.',
  CURRICULUM_PRESENTER_DIRECTIVE:
    'Present a full, structured curriculum for the requested topic.',
  EXERCISE_FEEDBACK_DIRECTIVE:
    'The student just responded to an active exercise. Evaluate that specific response only.',
  SCHEMA_DIRECTIVE:
    'You are generating a LINGORA study schema. Use only plain text and standard markdown.',
  TABLE_DIRECTIVE:
    'You are generating a comparison table. Columns: CONCEPT / CORRECT USE / COMMON ERROR / RISK / NOTE.',
  PRONUNCIATION_EVAL_DIRECTIVE:
    'Evaluate pronunciation. Respond with JSON only.',
  DIAGNOSTIC_FIRST_TURN_DIRECTIVE:
    'Level unknown. Greet and ask the student to write 2-3 sentences in Spanish. Do NOT start a lesson.',
}

function buildExecutionDirective(params: {
  systemDirective?: string
  plan?: ExecutionPlan
  action?: string
  priorContext?: string
  state?: LegacyMentorState
}): string {
  const parts: string[] = []
  if (params.systemDirective) parts.push(params.systemDirective)
  if (params.plan?.mentor?.directive) {
    const instruction = DIRECTIVE_INSTRUCTIONS[params.plan.mentor.directive]
    if (instruction) parts.push('\nINSTRUCTION FOR THIS RESPONSE:\n' + instruction)
    else parts.push('Mentor directive: ' + params.plan.mentor.directive)
  }
  const mentor = params.plan?.mentor as (NonNullable<ExecutionPlan['mentor']> & { activeExercise?: string; activeTopic?: string }) | undefined
  if (mentor?.activeExercise) parts.push('\nACTIVE EXERCISE:\n"' + mentor.activeExercise + '"')
  if (mentor?.activeTopic) parts.push('LESSON TOPIC: ' + mentor.activeTopic)
  if (params.action && params.action !== 'conversation') parts.push('Current execution action: ' + params.action)
  if (params.priorContext?.trim()) parts.push('Prior context for this response:\n' + params.priorContext)
  return parts.length > 0 ? '\n\n' + parts.join('\n\n') : ''
}

export function buildMentorPrompt(params: {
  message: string
  state?: LegacyMentorState
  systemDirective?: string
  priorContext?: string
  action?: string
  plan?: ExecutionPlan
}): { system: string; user: string } {
  const state = params.state ?? {}
  const mentorName = resolveMentorName(state)
  const profile = getMentorProfile(mentorName)
  const mode = resolveTutorMode(state)
  const protocolMode = resolveProtocolMode(mode)
  const topic = resolveTopic(state)
  const context = buildContext(state)
  const executionDirective = buildExecutionDirective({
    systemDirective: params.systemDirective,
    plan: params.plan,
    action: params.action,
    priorContext: params.priorContext,
    state,
  })
  const baseModeInstructions = getModeInstruction(protocolMode, topic)
  const modeInstructions = (params.plan?.priority ?? 0) >= 70
    ? baseModeInstructions + '\n\n[OVERRIDE ACTIVE] An explicit artifact was requested. Deliver it now.'
    : baseModeInstructions
  const fastPathOverride =
    (params.plan?.priority ?? 0) >= 70
      ? '\n\nOVERRIDE — EXPLICIT ARTIFACT REQUEST: Deliver the requested artifact immediately.'
      : ''
  const pack = resolveTurnContextPack(params.message, state, params.plan)
  const packBlock = '\n\n' + formatContextPack(pack)
  const system = [profile.system, fastPathOverride, executionDirective, modeInstructions, TUTOR_PROHIBITIONS, context, packBlock].filter(Boolean).join('')
  return { system, user: String(params.message || '') }
}

function normalizeLegacyCall(message: string, state: LegacyMentorState = {}, systemDirective?: string): NormalizedMentorCall {
  return { message, state, systemDirective, plan: undefined, action: undefined, priorContext: undefined }
}

function normalizeRuntimeCall(params: MentorRuntimeParams): NormalizedMentorCall {
  const rawMessage = params.request?.message?.trim()
  const message = rawMessage ? rawMessage : params.priorContext?.trim() ? params.priorContext : '[Audio input — respond to the transcription in the prior context]'
  return { message, state: params.state ?? {}, systemDirective: undefined, plan: params.plan, action: params.action, priorContext: params.priorContext }
}

export interface ModelParams {
  model: string
  temperature?: number
  top_p?: number
  max_tokens?: number
  max_completion_tokens?: number
}

export function buildModelParams(model: string, tokens: number, temperature?: number, topP?: number): ModelParams {
  const isGPT5Family = /^gpt-5/i.test(model) || /^o[0-9]/i.test(model)
  if (isGPT5Family) {
    return { model, max_completion_tokens: tokens, ...(temperature !== undefined ? { temperature } : {}) }
  }
  return { model, max_tokens: tokens, ...(temperature !== undefined ? { temperature } : {}), ...(topP !== undefined ? { top_p: topP } : {}) }
}

export async function getMentorResponse(message: string, state?: LegacyMentorState, systemDirective?: string): Promise<string>
export async function getMentorResponse(params: MentorRuntimeParams): Promise<string>
export async function getMentorResponse(arg1: string | MentorRuntimeParams, arg2?: LegacyMentorState, arg3?: string): Promise<string> {
  const normalized: NormalizedMentorCall = typeof arg1 === 'string' ? normalizeLegacyCall(arg1, arg2 ?? {}, arg3) : normalizeRuntimeCall(arg1)
  const { system, user } = buildMentorPrompt({
    message: normalized.message, state: normalized.state, systemDirective: normalized.systemDirective,
    plan: normalized.plan, action: normalized.action, priorContext: normalized.priorContext,
  })
  try {
    const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini'
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Mentor timeout')), 14000))
    const pack = resolveTurnContextPack(normalized.message, normalized.state, normalized.plan)
    const completion = await Promise.race([
      openai.chat.completions.create({
        ...buildModelParams(RUNTIME_MODEL, resolveOutputBudget(normalized.plan, pack), 0.7, 0.88),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      timeout,
    ])
    return (completion.choices?.[0]?.message?.content ?? '').trim()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[MENTOR] Error:', msg)
    const lang = resolveInterfaceLanguage(normalized.state)
    return FALLBACKS[lang] ?? FALLBACKS.en
  }
}

export async function getMentorResponseStream(params: MentorRuntimeParams): Promise<AsyncGenerator<string>> {
  const normalized = normalizeRuntimeCall(params)
  const { system, user } = buildMentorPrompt({
    message: normalized.message, state: normalized.state, systemDirective: normalized.systemDirective,
    plan: normalized.plan, action: normalized.action, priorContext: normalized.priorContext,
  })
  try {
    const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini'
    const pack = resolveTurnContextPack(normalized.message, normalized.state, normalized.plan)
    const stream = await openai.chat.completions.create({
      ...buildModelParams(RUNTIME_MODEL, resolveOutputBudget(normalized.plan, pack), 0.7, 0.88),
      stream: true,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
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
