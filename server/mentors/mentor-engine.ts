// ================================================
// LINGORA SEEK 3.0 — MENTOR ENGINE
// Compatible with legacy v10.2 signature + SEEK 3.0 execution engines
// Adds:
// - buildMentorPrompt()
// - getMentorResponse() with dual signature support
// - getMentorResponseStream()
// ================================================

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

/**
 * Bridges contracts TutorMode to tutorProtocol accepted mode.
 * If tutorProtocol does not yet expose 'free', we safely map it to
 * conversational instructions while preserving SEEK 3.0 runtime semantics.
 */
function resolveProtocolMode(mode: ContractsTutorMode): ProtocolTutorMode {
  if (mode === 'free') {
    return 'conversational' as ProtocolTutorMode
  }
  return mode as ProtocolTutorMode
}

function resolveTopic(state: LegacyMentorState): string | null {
  if (state.curriculumPlan?.topic) return state.curriculumPlan.topic
  if (state.lastConcept) return state.lastConcept
  if (state.topic) return state.topic
  return null
}

function resolveLevel(state: LegacyMentorState): string | undefined {
  return state.confirmedLevel ?? state.userLevel ?? state.level
}

function buildContext(state: LegacyMentorState): string {
  const parts: string[] = []

  const level = resolveLevel(state)
  const topic = resolveTopic(state)
  const lang = resolveInterfaceLanguage(state)

  if (level && level !== 'A0') parts.push(`Level: ${level}`)
  if ((state.tokens ?? 0) > 0) parts.push(`Exchanges: ${state.tokens}`)
  if (topic) parts.push(`Topic: ${topic}`)
  if (lang) parts.push(`Student language: ${lang}`)
  if (state.lastAction) parts.push(`Last action: ${state.lastAction}`)

  const lessonIndex = state.currentModuleIndex ?? state.lessonIndex
  if (lessonIndex && lessonIndex > 0) {
    parts.push(`Lesson index: ${lessonIndex}`)
  }

  if (state.tutorPhase) parts.push(`Current phase: ${state.tutorPhase}`)
  if (state.courseActive !== undefined) parts.push(`Course active: ${state.courseActive}`)
  if (state.awaitingQuizAnswer) parts.push(`Awaiting quiz answer: true`)
  if ((state.samples ?? []).length > 0) parts.push(`Student samples collected: ${state.samples!.length}`)
  if ((state.diagnosticSamples ?? 0) > 0) parts.push(`Diagnostic samples: ${state.diagnosticSamples}`)

  return parts.length > 0
    ? '\n\n[Session state: ' + parts.join(' · ') + ']'
    : ''
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
    parts.push(`Mentor execution directive: ${params.plan.mentor.directive}`)
  }

  if (params.action) {
    parts.push(`Current execution action: ${params.action}`)
  }

  if (params.priorContext && params.priorContext.trim()) {
    parts.push(`Prior execution context:\n${params.priorContext}`)
  }

  return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : ''
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
  const modeInstructions = getModeInstruction(protocolMode, topic)
  const executionDirective = buildExecutionDirective({
    systemDirective: params.systemDirective,
    plan: params.plan,
    action: params.action,
    priorContext: params.priorContext,
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
): { message: string; state: LegacyMentorState; systemDirective?: string } {
  return { message, state, systemDirective }
}

function normalizeRuntimeCall(params: MentorRuntimeParams): {
  message: string
  state: LegacyMentorState
  systemDirective?: string
  plan?: ExecutionPlan
  action?: string
  priorContext?: string
} {
  return {
    message: params.request?.message ?? '',
    state: params.state ?? {},
    systemDirective: undefined,
    plan: params.plan,
    action: params.action,
    priorContext: params.priorContext,
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
  const normalized =
    typeof arg1 === 'string'
      ? normalizeLegacyCall(arg1, arg2 ?? {}, arg3)
      : normalizeRuntimeCall(arg1)

  const { system, user } = buildMentorPrompt({
    message: normalized.message,
    state: normalized.state,
    systemDirective: normalized.systemDirective,
    plan: normalized.plan,
    action: normalized.action,
    priorContext: normalized.priorContext,
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
          { role: 'user', content: user },
        ],
        temperature: 0.7,
        top_p: 0.88,
        max_tokens: 650,
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

/**
 * getMentorResponseStream
 * SEEK 3.0 — Streaming variant of getMentorResponse().
 * Used by execution-engine-stream.ts.
 *
 * Contract:
 * - Input: MentorRuntimeParams
 * - Output: AsyncGenerator<string>
 * - If streaming fails, falls back to one single full-text delta
 */
export async function getMentorResponseStream(
  params: MentorRuntimeParams,
): Promise<AsyncGenerator<string>> {
  const normalized = normalizeRuntimeCall(params)

  const { system, user } = buildMentorPrompt({
    message: normalized.message,
    state: normalized.state,
    systemDirective: normalized.systemDirective,
    plan: normalized.plan,
    action: normalized.action,
    priorContext: normalized.priorContext,
  })

  try {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      stream: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.7,
      top_p: 0.88,
      max_tokens: 650,
    })

    return (async function* () {
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) yield delta
      }
    })()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn('[MENTOR] Streaming unavailable, falling back to single response:', msg)

    const fallbackText = await getMentorResponse(params)

    return (async function* () {
      if (fallbackText) yield fallbackText
    })()
  }
}
