// =============================================================================
// server/mentors/mentor-engine.ts
// SEEK 5.0 P4 budget + E-06 structured artifact channel (post-content)
// SEEK 5.0 P8b — multi-signal decision: tokens 400→700 + explicit multi-call reminder
// SEEK 5.0 P8c — root cause fix: decision call only saw taught.slice(0, 8000).
// Forensic WILLY FREE run produced 16,941 chars; the second taught domain
// (Acupuntura) landed past the 8000-char cut and was invisible to the model
// deciding signal_artifact calls — so only the first domain could ever be
// signalled. Raised to 40000 (comfortably above observed compound-act length,
// well within model context).
//
// SEEK 5.0 P10 — ARTIFACT EMISSION RELIABILITY.
// Root cause: the decision call relied on the model spontaneously emitting
// MULTIPLE tool_calls (signal_artifact) within a single completion. Measured
// via an isolated harness (20 controlled runs against one fixed captured
// taught text, decision temperature 0): 16/20 (80%) produced 2 signals, 4/20
// produced only 1 — and in every failure, the FIRST domain (Español) was kept
// and the SECOND (Acupuntura) was silently dropped. finish_reason was
// "tool_calls" (never "length") in 100% of sampled runs — ruling out token
// truncation. This is inherent unreliability in multi-tool-call emission,
// not a token budget or context-window problem.
// Fix: replaced multi-tool-calling with a single structured JSON list
// ("list every subject that warrants materialization"), which CODE then
// iterates deterministically to build one ArtifactSignal per listed entry.
// The model still decides WHAT/WHETHER to materialize — unchanged authority
// over pedagogical/materialization judgment. The CODE now executes that
// decision deterministically instead of depending on the API returning N
// tool_calls in one turn. Validated in the same harness: 40/40 (100%) across
// two independent captured taught texts, versus the tool-calling baseline's
// measured 80%. Teaching/streaming untouched; only the decision mechanism
// after teaching changed.
//
// SEEK 5.0 P19-F — SPONTANEOUS ARTIFACT ON TRIVIAL TURNS.
// Root cause confirmed in production (reproduced ~1 in 3-4 tries, so
// non-deterministic — an LLM decision at temperature > 0, not a fixed
// routing bug): a bare first-turn greeting + opening question ("¡Hola!
// ... escribe 2 frases sobre ti") sometimes triggered emit_pdf and
// materialized the greeting itself as a downloadable PDF titled "Saludo
// inicial...". Two contributing factors, both fixed together:
// 1) FIRST_TURN_DIRECTIVE / DIAGNOSTIC_FIRST_TURN_DIRECTIVE and
//    ARTIFACT_CHANNEL_INSTRUCTION (lib/artifact-signal.ts) never told the
//    model that a greeting/opening-question/diagnostic-prompt turn does
//    NOT constitute "pedagogical completion" worth materializing — both
//    now say so explicitly.
// 2) The `taught.trim().length < 200` guard below decided whether
//    decideArtifactSignals ran at all. A real first-turn greeting response
//    naturally lands at 150-270 characters — straddling that threshold, so
//    the guard was close to a coin flip rather than a reliable filter.
//    Raised to 350 (see inline comment) as a deterministic backstop
//    alongside the instruction-level fix, not a replacement for it.
//
// SEEK 5.0 BASE-MODEL-PARITY — CONVERSATION HISTORY RESTORED.
// Root gap confirmed by direct code inspection (not theory): every OpenAI
// call below sent exactly [{system}, {user: current turn}] — two messages,
// always. No prior turn ever reached the model as real dialogue; only a
// handful of derived SessionState scalars (lastConcept, lastUserGoal,
// confirmedLevel) survived across turns, extracted by regex
// (context-pack.ts's extractDomain). This is a materially different, far
// poorer signal than an actual multi-turn conversation: the Zakia
// benchmark's class of intelligence (profile, hesitation, and goal
// surfacing gradually across 8 real turns) is exactly what this bottleneck
// prevents — the model answering turn 6 could never see what was actually
// said in turn 3, only whatever a regex happened to extract. Fix: recent
// real turns now flow through end to end — ChatRequest.conversationHistory
// (contracts.ts) -> NormalizedMentorCall.history -> spliced into the actual
// `messages` array sent to OpenAI, between system and the current turn, in
// both getMentorResponse and getMentorResponseStream. Additive: any caller
// that doesn't supply history (legacy normalizeLegacyCall, existing
// harnesses) gets an empty array and behaves exactly as before.
//
// SEEK 5.0 BASE-MODEL-PARITY — GENERAL-QUESTION OVERSTRUCTURING.
// Root cause confirmed via same-model harness (general_control_comparison):
// the SAME model, asked "Explícame brevemente por qué el cielo es azul"
// with only a minimal purpose statement, answered in 252 chars with no
// table. Through the normal runtime (RICH_CONTENT_DIRECTIVE — the DEFAULT
// mentor directive for 'interact' mode, i.e. most ordinary conversation;
// see orchestrator.ts line ~635), the same question produced 770 chars
// with a markdown table, an added "matiz importante" aside, and a closing
// menu of follow-up offers. The directive's own wording — "Use tables,
// structured explanations... when they serve the student" — was being
// read as a standing default for ANY substantive answer, not a condition
// tied to whether THIS content actually benefits from that structure.
// Fix: reworded RICH_CONTENT_DIRECTIVE to make depth explicitly
// proportional to the question, reserving tables/structure for content
// that genuinely needs it (comparisons, vocab sets, grammar contrasts,
// explicit step-by-step requests) and stating plainly that a simple
// factual aside gets a direct, ordinary-conversation-length answer unless
// the student's own wording asks for depth. This is a single directive's
// text, not a new mechanism — routing, artifact authority and memory are
// untouched.
// =============================================================================

import OpenAI from 'openai'
import { getMentorProfile } from './profiles'
import { getModeInstruction, TUTOR_PROHIBITIONS } from '@/lib/tutorProtocol'
import { buildContextPack, formatContextPack, type ContextPack } from '@/lib/context-pack'
import {
  ARTIFACT_CHANNEL_INSTRUCTION,
  COMPLETE_TUTOR_TURN_TOOL,
  parseClosedTutorTurn,
  streamedTutorReplyPrefix,
  type ArtifactSignal,
} from '@/lib/artifact-signal'
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
  // BASE-MODEL-PARITY — see ChatRequest.conversationHistory (contracts.ts)
  // for the root-gap rationale. Empty/undefined for any caller that hasn't
  // opted in (legacy path, harnesses) — behavior there is unchanged.
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

export type MentorStream = AsyncGenerator<string> & { artifactSignals: ArtifactSignal[] }

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
  if (pack?.compoundPedagogicalAct || pack?.artifactDepth === 'comprehensive') return COMPOUND_MAX_OUTPUT_TOKENS
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
function resolveTurnContextPack(message: string, state: LegacyMentorState, plan?: ExecutionPlan): ContextPack {
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
  return parts.length > 0 ? '\n\n[Session state: ' + parts.join(' | ') + ']' : ''
}

const DIRECTIVE_INSTRUCTIONS: Record<string, string> = {
  RICH_CONTENT_DIRECTIVE:
    'Respond with depth PROPORTIONAL to what the question actually needs — not maximal depth by default. Use tables, structured headings, and multi-section breakdowns only for content that genuinely benefits from that structure: comparisons, vocabulary sets, grammar contrasts, step-by-step processes the student will practice, or anything explicitly sequenced in the student\'s message. ' +
    'For a simple factual or general-knowledge question — including one unrelated to Spanish, asked in passing — answer directly and concisely, the way you would in an ordinary conversation, UNLESS the student\'s own wording asks for depth, a table, a lesson, or step-by-step teaching. A short aside does not need a table, a "further nuance" paragraph, or a closing menu of follow-up options. Do not pad. Do not repeat. If the student sequenced several requests in this message, cover that sequence in this turn instead of deferring parts.' +
    '\n\nCRITICAL: NEVER refuse a task by citing your Spanish-teaching function. If the task is in Spanish or serves learning — execute it with expert depth.',
  STRUCTURED_COURSE_DIRECTIVE:
    'You are in structured course mode. Follow the pedagogical sequence: guide -> lesson -> schema -> quiz -> feedback. Do not skip steps. Do not blend phases unless the student explicitly sequenced several requests in this message — then fulfill that sequence now.',
  FREE_CONVERSATION_DIRECTIVE: 'You are in free conversation mode. Respond naturally. Correct errors inline and briefly.',
  PDF_COURSE_DIRECTIVE: 'You are generating formal course material. Content should be structured, downloadable-quality, and self-contained.',
  CORRECTION_ONLY_DIRECTIVE: 'The student asked for a correction. Correct exactly what they wrote. Do not teach a full lesson.',
  TRANSLATION_ONLY_DIRECTIVE: 'The student asked for a translation. Provide ONLY the translation.',
  FIRST_TURN_DIRECTIVE: 'This is the first message of the session. Greet the student warmly. Ask one concrete opening question. Do not give a lesson yet. Use artifacts: [] on this turn — a greeting plus an opening question is not taught content, so there is nothing yet worth materializing as a document.',
  CURRICULUM_PRESENTER_DIRECTIVE: 'Present a full, structured curriculum for the requested topic.',
  EXERCISE_FEEDBACK_DIRECTIVE: 'The student just responded to an active exercise. Evaluate that specific response only.',
  SCHEMA_DIRECTIVE: 'You are generating a LINGORA study schema. Use only plain text and standard markdown.',
  TABLE_DIRECTIVE: 'You are generating a comparison table. Columns: CONCEPT / CORRECT USE / COMMON ERROR / RISK / NOTE.',
  PRONUNCIATION_EVAL_DIRECTIVE: 'Evaluate pronunciation. Respond with JSON only.',
  DIAGNOSTIC_FIRST_TURN_DIRECTIVE: 'Level unknown. Greet and ask the student to write 2-3 sentences in Spanish. Do NOT start a lesson. Use artifacts: [] on this turn — a diagnostic prompt with no taught content yet is not worth materializing.',
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
  const profile = getMentorProfile(resolveMentorName(state))
  const mode = resolveTutorMode(state)
  const topic = resolveTopic(state)
  const executionDirective = buildExecutionDirective({
    systemDirective: params.systemDirective,
    plan: params.plan,
    action: params.action,
    priorContext: params.priorContext,
    state,
  })
  const baseModeInstructions = getModeInstruction(resolveProtocolMode(mode), topic)
  const modeInstructions = (params.plan?.priority ?? 0) >= 70
    ? baseModeInstructions + '\n\n[OVERRIDE ACTIVE] An explicit artifact was requested. Deliver it now.'
    : baseModeInstructions
  const pack = resolveTurnContextPack(params.message, state, params.plan)
  const system = [profile.system, ARTIFACT_CHANNEL_INSTRUCTION, executionDirective, modeInstructions, TUTOR_PROHIBITIONS, buildContext(state), '\n\n' + formatContextPack(pack)].filter(Boolean).join('')
  return { system, user: String(params.message || '') }
}

function normalizeLegacyCall(message: string, state: LegacyMentorState = {}, systemDirective?: string): NormalizedMentorCall {
  return { message, state, systemDirective, plan: undefined, action: undefined, priorContext: undefined, history: [] }
}
function normalizeRuntimeCall(params: MentorRuntimeParams): NormalizedMentorCall {
  const rawMessage = params.request?.message?.trim()
  // A blank opening turn is a real UI session-start event, not an audio file.
  const message = rawMessage ? rawMessage : params.priorContext?.trim() ? params.priorContext : '[Session opened without a written message]'
  const rawHistory = params.request?.conversationHistory
  const history = Array.isArray(rawHistory)
    ? rawHistory.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    : []
  return { message, state: params.state ?? {}, systemDirective: undefined, plan: params.plan, action: params.action, priorContext: params.priorContext, history }
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
  if (isGPT5Family) return { model, max_completion_tokens: tokens, ...(temperature !== undefined ? { temperature } : {}) }
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
    const pack = resolveTurnContextPack(normalized.message, normalized.state, normalized.plan)
    const completion = await openai.chat.completions.create({
      ...buildModelParams(RUNTIME_MODEL, resolveOutputBudget(normalized.plan, pack), 0.7, 0.88),
      messages: [{ role: 'system', content: system }, ...normalized.history, { role: 'user', content: user }],
    })
    return (completion.choices?.[0]?.message?.content ?? '').trim()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[MENTOR] Error:', msg)
    return FALLBACKS[resolveInterfaceLanguage(normalized.state)] ?? FALLBACKS.en
  }
}

export async function getMentorResponseStream(params: MentorRuntimeParams): Promise<MentorStream> {
  const n = normalizeRuntimeCall(params)
  const { system, user } = buildMentorPrompt({
    message: n.message, state: n.state, systemDirective: n.systemDirective,
    plan: n.plan, action: n.action, priorContext: n.priorContext,
  })
  const signals: ArtifactSignal[] = []
  try {
    const model = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini'
    const pack = resolveTurnContextPack(n.message, n.state, n.plan)
    const response = await openai.chat.completions.create({
      ...buildModelParams(model, resolveOutputBudget(n.plan, pack), 0.7, 0.88),
      stream: true,
      tools: [COMPLETE_TUTOR_TURN_TOOL],
      tool_choice: { type: 'function', function: { name: 'complete_tutor_turn' } },
      messages: [{ role: 'system', content: system }, ...n.history, { role: 'user', content: user }],
    })
    const gen = (async function* () {
      const calls = new Map<number, { name: string; args: string }>()
      let emitted = ''
      for await (const chunk of response) {
        for (const item of chunk.choices?.[0]?.delta?.tool_calls ?? []) {
          const prior = calls.get(item.index) ?? { name: '', args: '' }
          prior.name += item.function?.name ?? ''
          prior.args += item.function?.arguments ?? ''
          calls.set(item.index, prior)
          if (prior.name === 'complete_tutor_turn') {
            const candidate = streamedTutorReplyPrefix(prior.args)
            if (candidate.startsWith(emitted) && candidate.length > emitted.length) {
              const delta = candidate.slice(emitted.length)
              emitted = candidate
              yield delta
            }
          }
        }
      }
      if (calls.size !== 1) throw Error('Tutor closure count invalid')
      const call = [...calls.values()][0]
      if (call.name !== 'complete_tutor_turn') throw Error('Tutor closure type invalid')
      let decoded: unknown
      try { decoded = JSON.parse(call.args) }
      catch { throw Error('Tutor closure JSON invalid') }
      const closure = parseClosedTutorTurn(decoded)
      if (!closure) throw Error('Tutor turn did not close with a valid artifact decision')
      if (!closure.reply.startsWith(emitted)) throw Error('Tutor streamed content mismatch')
      if (closure.reply.length > emitted.length) yield closure.reply.slice(emitted.length)
      if (closure.artifacts.some(s => s.type === 'emit_pdf') && closure.reply.trim().length < 500) {
        throw Error('PDF requested without sufficient teaching content')
      }
      signals.push(...closure.artifacts)
    })()
    const wrapped = gen as MentorStream
    wrapped.artifactSignals = signals
    return wrapped
  } catch (err: unknown) {
    console.error('[MENTOR] tutor closure failure', err instanceof Error ? err.message : err)
    const gen = (async function* () {
      yield FALLBACKS[resolveInterfaceLanguage(n.state)] ?? FALLBACKS.en
    })()
    const wrapped = gen as MentorStream
    wrapped.artifactSignals = signals
    return wrapped
  }
}
