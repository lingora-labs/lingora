// =============================================================================
// server/mentors/mentor-engine.ts
// LINGORA SEEK 3.9 — Mentor Engine
// No functional changes from SEEK 3.8 — header bump only.
// All logic, directives, buildModelParams, and getMentorResponseStream
// preserved exactly as delivered in SEEK 3.8.
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
  no: 'Kunne ikke behandle meldingen din. Proev igjen.',
  fr: "Je n'ai pas pu traiter votre message. Reessayez.",
  de: 'Konnte Ihre Nachricht nicht verarbeiten. Versuchen Sie es erneut.',
  it: 'Non ho potuto elaborare il tuo messaggio. Riprova.',
  pt: 'Nao consegui processar sua mensagem. Tente novamente.',
  ar: "Could not process your message. Please try again.", // Arabic UI fallback — ASCII safe
  ja: 'messeji wo shori dekimasendeshita. mou ichido o tameshi kudasai.',
  zh: 'Wufa chuli您de xiaoxi. Qing chongshi.',
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
  if ((state as Record<string,unknown>).lastUserAudioTranscript) {
    const t = (state as Record<string,unknown>).lastUserAudioTranscript as string
    parts.push(`Audio transcript from prior turn: "${t}" — do NOT ask the student to send audio again.`)
  }
  return parts.length > 0
    ? '\n\n[Session state: ' + parts.join(' | ') + ']'
    : ''
}

const DIRECTIVE_INSTRUCTIONS: Record<string, string> = {
  RICH_CONTENT_DIRECTIVE:
    'Respond with full pedagogical depth. Use tables, structured explanations, and examples when they serve the student. Do not pad. Do not repeat. One focused action per response.' +
    '\n\nCRITICAL: NEVER refuse a task by citing your Spanish-teaching function. NEVER say "mi funcion es enseniar espanol", "no puedo cumplir", or equivalent. If the task is in Spanish or serves learning — execute it with expert depth. A brief pedagogical bridge at the end is optional, never mandatory.',
  STRUCTURED_COURSE_DIRECTIVE:
    'You are in structured course mode. Follow the pedagogical sequence: guide -> lesson -> schema -> quiz -> feedback. Do not skip steps. Do not blend phases. Deliver exactly one phase action per response.',
  FREE_CONVERSATION_DIRECTIVE:
    'You are in free conversation mode. Respond naturally. Correct errors inline and briefly — one correction per response maximum. If the student gives a very short or vague message, introduce one concrete topic or micro-action appropriate to their level. Never leave the student without direction.' +
    '\n\nCRITICAL: NEVER refuse a task by citing your Spanish-teaching function. NEVER say phrases like "mi funcion es enseniar espanol", "no puedo cumplir con esa solicitud", or "my role is to teach Spanish". If the task is in Spanish, about a topic the student wants to explore, or serves Spanish learning in any way — EXECUTE IT FULLY with expert depth.',
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
  EXERCISE_FEEDBACK_DIRECTIVE:
    'The student just responded to an active exercise. Your ONLY job is to evaluate that specific response.\n' +
    'DO:\n' +
    '  1. State clearly if the answer is correct or not.\n' +
    '  2. If incorrect, explain the specific error in 1-2 sentences.\n' +
    '  3. Give the correct form with a brief explanation of why.\n' +
    '  4. One memory tip if useful.\n' +
    'DO NOT: start a new lesson. Do not change the topic. Do not ask what they want to study.\n' +
    'The exercise and topic context are provided below.',
  SCHEMA_DIRECTIVE:
    'You are generating a STRUCTURED STUDY SCHEMA. Format: 1) Title+emoji+topic block 2) Objective 2-3 lines 3) Each subtopic: context + bullets + KEY TAKEAWAY 4) 80/20 synthesis 5) Practice quiz 5 questions. No tables. Balance bullets and prose.',
  TABLE_DIRECTIVE:
    'You are generating a COLOR-CODED COMPARISON TABLE. Columns: CONCEPT / CORRECT USE / COMMON ERROR / RISK / NOTE. Use checkmark for correct, X for errors, warning for risks. Each row concrete and actionable. No narrative text outside the table.',
  PRONUNCIATION_EVAL_DIRECTIVE:
    'You are evaluating the student\'s Spanish pronunciation based on their audio transcription.\n' +
    'Respond with ONLY a JSON object — no prose, no markdown:\n' +
    '{"score":<0-100>,"feedback":"<1-2 sentences>","tip":"<one actionable tip>","errors":["<error1>","<error2>"]}\n' +
    'Be encouraging but precise. Score 70+ = good.',
  DIAGNOSTIC_FIRST_TURN_DIRECTIVE:
    'This is the student\'s very first message and their level is unknown. ' +
    'Greet them warmly, introduce yourself in 1 sentence, then ask them to ' +
    'write 2-3 sentences in Spanish about themselves or their day. ' +
    'Do NOT start a lesson. Do NOT ask multiple questions. One request only.',
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
  const pedagogicalMode = params.state?.pedagogicalMode;
  if (pedagogicalMode === 'schema' && params.plan?.mentor?.directive &&
      !['CORRECTION_ONLY_DIRECTIVE','TRANSLATION_ONLY_DIRECTIVE','FIRST_TURN_DIRECTIVE',
        'DIAGNOSTIC_FIRST_TURN_DIRECTIVE','PRONUNCIATION_EVAL_DIRECTIVE'].includes(params.plan.mentor.directive)) {
    parts.push(`\nOUTPUT FORMAT INSTRUCTION:\n${DIRECTIVE_INSTRUCTIONS['SCHEMA_DIRECTIVE']}`);
  } else if (pedagogicalMode === 'table' && params.plan?.mentor?.directive &&
      !['CORRECTION_ONLY_DIRECTIVE','TRANSLATION_ONLY_DIRECTIVE'].includes(params.plan.mentor.directive)) {
    parts.push(`\nOUTPUT FORMAT INSTRUCTION:\n${DIRECTIVE_INSTRUCTIONS['TABLE_DIRECTIVE']}`);
  }
  if (params.plan?.mentor?.directive) {
    const instruction = DIRECTIVE_INSTRUCTIONS[params.plan.mentor.directive]
    if (instruction) {
      parts.push(`\nINSTRUCTION FOR THIS RESPONSE:\n${instruction}`)
    } else {
      parts.push(`Mentor directive: ${params.plan.mentor.directive}`)
    }
  }
  const mentor: (NonNullable<ExecutionPlan['mentor']> & {
    activeExercise?: string
    activeTopic?: string
  }) | undefined = params.plan?.mentor as (NonNullable<ExecutionPlan['mentor']> & {
    activeExercise?: string
    activeTopic?: string
  }) | undefined
  if (mentor?.activeExercise) parts.push(`\nACTIVE EXERCISE:\n"${mentor.activeExercise}"`)
  if (mentor?.activeTopic)    parts.push(`LESSON TOPIC: ${mentor.activeTopic}`)
  if (params.action && params.action !== 'conversation') parts.push(`Current execution action: ${params.action}`)
  if (params.priorContext?.trim()) parts.push(`Prior context for this response:\n${params.priorContext}`)
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
  const executionDirective = buildExecutionDirective({
    systemDirective: params.systemDirective,
    plan:            params.plan,
    action:          params.action,
    priorContext:    params.priorContext,
    state,
  })
  const baseModeInstructions = getModeInstruction(protocolMode, topic)
  const modeInstructions = (params.plan?.priority ?? 0) >= 70
    ? baseModeInstructions +
      '\n\n[OVERRIDE ACTIVE] An explicit artifact was requested. Deliver it now. ' +
      'The phase sequence above is suspended for this response only.'
    : baseModeInstructions
  const fastPathOverride =
    (params.plan?.priority ?? 0) >= 70
      ? '\n\nOVERRIDE — EXPLICIT ARTIFACT REQUEST: The user has explicitly requested ' +
        'a table, schema, or other artifact. Deliver it immediately. ' +
        'The pedagogical phase sequence does NOT apply to this response. ' +
        'Ignore any prior instruction to stay in phase or not blend steps.'
      : ''
  const system = [
    profile.system,
    fastPathOverride,
    executionDirective,
    modeInstructions,
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

// ─────────────────────────────────────────────────────────────────────────────
// MODEL PARAMS — single source of truth for entire runtime
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelParams {
  model: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
}

export function buildModelParams(
  model: string,
  tokens: number,
  temperature?: number,
  topP?: number,
): ModelParams {
  const isGPT5Family = /^gpt-5/i.test(model) || /^o[0-9]/i.test(model);
  if (isGPT5Family) {
    return {
      model,
      max_completion_tokens: tokens,
      ...(temperature !== undefined ? { temperature } : {}),
    };
  }
  return {
    model,
    max_tokens: tokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP      !== undefined ? { top_p: topP }  : {}),
  };
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
    const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Mentor timeout')), 14000),
    )
    const completion = await Promise.race([
      openai.chat.completions.create({
        ...buildModelParams(RUNTIME_MODEL, 650, 0.7, 0.88),
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
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
    const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';
    const stream = await openai.chat.completions.create({
      ...buildModelParams(RUNTIME_MODEL, 650, 0.7, 0.88),
      stream:   true,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
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
