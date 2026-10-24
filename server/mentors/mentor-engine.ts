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
import { buildContextPack, formatContextPack, formatLanguageTurnNote, type ContextPack } from '@/lib/context-pack'
import { SET_EXPLANATORY_LANGUAGE_TOOL, parseExplanatoryLanguage } from '@/lib/explanatory-language'
import { UPDATE_STUDENT_MEMORY_TOOL, parseMemoryOps, formatMemoryBlock, selectHistoryWindow, planHistoryBudget, formatContextNote, type TutorMemoryOp } from '@/lib/tutor-memory'
import { formatQuizEvidence } from '@/lib/quiz-evidence'
import { formatSpaceContext } from '@/server/space/context'
import { RECORD_LEARNING_FACT_TOOL, parseLearningFacts, type LearningFactDeclaration } from '@/lib/learning-facts'
import type { SpaceContextPayload } from '@/lib/space/retrieve'
import {
  ARTIFACT_CHANNEL_INSTRUCTION,
  COMPLETE_TUTOR_TURN_TOOL,
  DELIVER_FROM_TEXT_TOOL,
  parseClosedTutorTurn,
  diagnoseClosedTutorTurn,
  dedupeSignals,
  parseTextDelivery,
  type ArtifactSignal,
  type TextDelivery,
} from '@/lib/artifact-signal'
import type {
  SessionState,
  ChatRequest,
  ExecutionPlan,
  TutorMode as ContractsTutorMode,
} from '@/lib/contracts'

// Transient provider pressure (429 / 5xx / connection resets) is retried by the SDK with
// exponential backoff and Retry-After before the student ever sees a failure.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 })
const COMPOUND_MAX_OUTPUT_TOKENS = 8192

const FALLBACKS: Record<string, string> = {
  es: 'No pude procesar tu mensaje. Intenta de nuevo.',
  en: 'Could not process your message. Please try again.',
  no: 'Kunne ikke behandle meldingen din. Proev igjen.',
  fr: "Je n'ai pas pu traiter votre message. Reessayez.",
  de: 'Konnte Ihre Nachricht nicht verarbeiten. Versuchen Sie es erneut.',
  it: 'Non ho potuto elaborare il tuo messaggio. Riprova.',
  pt: 'Nao consegui processar sua mensagem. Tente novamente.',
  ar: 'تعذرت معالجة رسالتك. يرجى المحاولة مرة أخرى.',
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
  explanatoryLanguage?: string
  // UI fact: the student picked OTROS (their language is not in the picker).
  uiLanguageChoice?: string
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
  // True only when the student has written nothing yet (session-open turn): a
  // structural fact about the request, not a reading of anyone's words.
  opening: boolean
  // 7.5: what the student's Space contributes to this turn (validated in chat-entry).
  spaceContext: SpaceContextPayload | null
}

export interface ProviderUsage { prompt: number; completion: number; cached: number; calls: number }
export type MentorStream = AsyncGenerator<string> & { artifactSignals: ArtifactSignal[]; textDeliveries: TextDelivery[]; explanatoryLanguage?: string; memoryOps?: TutorMemoryOp[]; learningFacts?: LearningFactDeclaration[]; deliveryFailure?: string; deliveryFailures?: string[]; rejectedSignals?: number; rejectedReasons?: string[]; usage?: ProviderUsage; servedModel?: string }

export const PRODUCT_MODEL = 'gpt-5.6-sol'

function configuredModelMismatch(): string | null {
  const configured = process.env.OPENAI_MAIN_MODEL
  return configured && configured !== PRODUCT_MODEL ? configured : null
}

function incorrectModelMessage(served: string): string {
  return `Modelo incorrecto: se sirvió ${served}, el producto es ${PRODUCT_MODEL}.`
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
  void pack
  return COMPOUND_MAX_OUTPUT_TOKENS
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
    explanatoryLanguage: state.explanatoryLanguage,
    commercialState: state as Parameters<typeof buildContextPack>[0]['commercialState'],
  })
}
function buildContext(state: LegacyMentorState, opening: boolean): string {
  const parts: string[] = []
  const level = resolveLevel(state)
  const topic = resolveTopic(state)
  void opening
  const lang = state.explanatoryLanguage
  if (level && level !== 'A0') parts.push(`Level: ${level}`)
  if ((state.tokens ?? 0) > 0) parts.push(`Exchanges: ${state.tokens}`)
  if (topic) parts.push(`Current topic: ${topic}`)
  if (lang) parts.push(`Explanatory language: ${lang}`)
  return parts.length > 0 ? '\n\n[Session state: ' + parts.join(' | ') + ']' : ''
}

const DIRECTIVE_INSTRUCTIONS: Record<string, string> = {
  RICH_CONTENT_DIRECTIVE:
    'Respond with depth PROPORTIONAL to what the question actually needs — not maximal depth by default. Use tables, structured headings, and multi-section breakdowns only for content that genuinely benefits from that structure: comparisons, vocabulary sets, grammar contrasts, step-by-step processes the student will practice, or anything explicitly sequenced in the student\'s message. ' +
    'For a simple factual or general-knowledge question — including one unrelated to Spanish, asked in passing — answer directly and concisely, the way you would in an ordinary conversation, UNLESS the student\'s own wording asks for depth, a table, a lesson, or step-by-step teaching. A short aside does not need a table, a "further nuance" paragraph, or a closing menu of follow-up options. Do not pad. Do not repeat. A request for a complete domain curriculum from beginner to expert is explicitly a deep deliverable, not a short aside: give a substantial staged syllabus covering foundations, terminology, applied practice, assessments, progression and expert boundaries. Do not replace a complete course request with a five-bullet teaser. If the student sequenced several requests in this message, cover that sequence in this turn instead of deferring parts.' +
    '\n\nCRITICAL: NEVER refuse a task by citing your Spanish-teaching function. If the task is in Spanish or serves learning — execute it with expert depth.',
  STRUCTURED_COURSE_DIRECTIVE:
    'You are in structured course mode. Follow the pedagogical sequence: guide -> lesson -> schema -> quiz -> feedback. Do not skip steps. Do not blend phases unless the student explicitly sequenced several requests in this message — then fulfill that sequence now.',
  FREE_CONVERSATION_DIRECTIVE: 'You are in free conversation mode. Respond naturally. Correct errors inline and briefly.',
  PDF_COURSE_DIRECTIVE: 'You are generating formal course material. Content should be structured, downloadable-quality, and self-contained.',
  CORRECTION_ONLY_DIRECTIVE: 'The student asked for a correction. Correct exactly what they wrote. Do not teach a full lesson.',
  TRANSLATION_ONLY_DIRECTIVE: 'The student asked for a translation. Provide ONLY the translation.',
  FIRST_TURN_DIRECTIVE: 'On a simple first greeting in Free mode, greet briefly and invite one immediate concrete microaction: invite the student to write a single sentence about today, which you can then respond to naturally. The language format of this greeting is given in the language note. Do not offer a list of alternative menus or defer to a mode choice. The Spanish-learning opportunity is optional if the student then changes subject. No lesson or unsolicited artifacts for the greeting: use artifacts: [].',
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
  history?: Array<{ role: string; content: string }>
  opening?: boolean
  spaceContext?: SpaceContextPayload | null
}): { system: string; user: string; languageNote: string } {
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
  const modeInstructions = baseModeInstructions
  const pack = resolveTurnContextPack(params.message, state, params.plan)
  // A runtime milestone, not an independent pedagogical brain. The tutor
  // writes the actual review content through the same typed turn closure.
  // Data from completed UI quiz: actual selected, expected, and graded answers.
  // This is context to inform Willy, never an independent answer generator.
  const recentQuiz = formatQuizEvidence(state.quizEvidence)
  // This session metadata comes from the actual UI selection, not a regex classifier.
  const opening = Boolean(params.opening)
  const localeEnvelope = state.explanatoryLanguage
    ? `[SESSION LOCALE: explanatoryLanguage=${state.explanatoryLanguage}; targetLanguage=es. The language of your explanations is the one you settled on for this student; Spanish examples use targetLanguage.]\n\n`
    : opening
      ? '[SESSION LOCALE: targetLanguage=es. This is the opening greeting; its language format is given in the language note.]\n\n'
      : '[SESSION LOCALE: targetLanguage=es. The language of your explanations is the language the student writes in or asks for; any language you can write well is allowed. Spanish examples use targetLanguage.]\n\n'
  const system = [localeEnvelope, profile.system, ARTIFACT_CHANNEL_INSTRUCTION, executionDirective, modeInstructions, TUTOR_PROHIBITIONS, buildContext(state, opening), formatMemoryBlock(state.tutorMemory), recentQuiz ? '\n\n[QUIZ UI EVIDENCE]\n' + recentQuiz : '', '\n\n' + formatContextPack(pack, { opening }), formatSpaceContext(params.spaceContext)].filter(Boolean).join('')
  return { system, user: String(params.message || ''), languageNote: formatLanguageTurnNote(pack, { opening, other: state.uiLanguageChoice === 'other' }) }
}

function normalizeRuntimeCall(params: MentorRuntimeParams): NormalizedMentorCall {
  const rawMessage = params.request?.message?.trim()
  // A blank opening turn is a real UI session-start event, not an audio file.
  const message = rawMessage ? rawMessage : params.priorContext?.trim() ? params.priorContext : '[Session opened without a written message]'
  const rawHistory = params.request?.conversationHistory
  const valid = Array.isArray(rawHistory)
    ? rawHistory.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    : []
  // 7.4: the thread is carried whole here; fitHistory() trims it against the INTEGRAL budget
  // (system + tools + memory + current turn + reply) once the prompt and tools are known.
  return { message, state: params.state ?? {}, systemDirective: undefined, plan: params.plan, action: params.action, priorContext: params.priorContext, history: valid, opening: !rawMessage, spaceContext: params.request?.spaceContext ?? null }
}

/** 7.4: the history gets exactly what the rest of the request leaves in the context window. Nothing is
 *  cut silently: the numbers are logged and the Tutor is told through a context note. */
function fitHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  built: { system: string; user: string; languageNote: string },
  tools: unknown,
): { history: Array<{ role: 'user' | 'assistant'; content: string }>; note: string } {
  const ctx = Number(process.env.LINGORA_CONTEXT_TOKENS)
  const cap = Number(process.env.LINGORA_HISTORY_TOKEN_BUDGET)
  const plan = planHistoryBudget({ system: built.system, tools, user: built.user, languageNote: built.languageNote }, {
    contextTokens: Number.isFinite(ctx) && ctx > 0 ? ctx : undefined,
    cap: Number.isFinite(cap) && cap > 0 ? cap : undefined,
  })
  const w = selectHistoryWindow(history, plan.historyBudget)
  if (w.dropped > 0 || w.shortened > 0) console.info('[tutor-history]', JSON.stringify({ received: history.length, kept: w.kept.length, dropped: w.dropped, shortened: w.shortened, historyBudget: plan.historyBudget, fixedTokens: plan.fixedTokens }))
  return { history: w.kept, note: formatContextNote(w) }
}

export interface ModelParams {
  model: string
  temperature?: number
  top_p?: number
  max_tokens?: number
  max_completion_tokens?: number
  // 'none' is valid for gpt-5.1+ but the installed SDK typings predate it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reasoning_effort?: any
}
export function buildModelParams(model: string, tokens: number, temperature?: number, topP?: number): ModelParams {
  const isGPT5Family = /^gpt-5/i.test(model) || /^o[0-9]/i.test(model)
  // 7.3.3d/e: gpt-5.1+ reasons by default; the tutor contract was validated with reasoning off
  // (reasoning_effort=none + temperature 0.7). One place, every product call site.
  const noReasoning = /^gpt-5\.[1-9]/i.test(model)
  if (isGPT5Family) return { model, max_completion_tokens: tokens, ...(noReasoning ? { reasoning_effort: 'none' as const } : {}), ...(temperature !== undefined ? { temperature } : {}) }
  return { model, max_tokens: tokens, ...(temperature !== undefined ? { temperature } : {}), ...(topP !== undefined ? { top_p: topP } : {}) }
}

/** 7.3: one Tutor, typed tools. A tool call by the Tutor is the authorization;
 *  the runtime only validates technically and never reads the student's words. */
export async function getMentorResponseStream(params: MentorRuntimeParams): Promise<MentorStream> {
 const n=normalizeRuntimeCall(params)
 const built=buildMentorPrompt({message:n.message,state:n.state,systemDirective:n.systemDirective,plan:n.plan,action:n.action,priorContext:n.priorContext,history:n.history,opening:n.opening,spaceContext:n.spaceContext})
 const {user,languageNote}=built
 const signals:ArtifactSignal[]=[]
 const deliveries:TextDelivery[]=[]
 const pack=resolveTurnContextPack(n.message,n.state,n.plan)
 // Only a clicked Article 27 review (a direct uiAction) is a pure formatting effect.
 const wantsVisualReview = params.request.uiAction==='create_visual_review'
 const fallback=FALLBACKS[resolveInterfaceLanguage(n.state)]??FALLBACKS.en
 const mismatchedModel=configuredModelMismatch()
 const model=PRODUCT_MODEL
 const budget=resolveOutputBudget(n.plan,pack)
 // The opening greeting settles no language: that tool exists only once the student has written.
 const tools=n.opening?[COMPLETE_TUTOR_TURN_TOOL,DELIVER_FROM_TEXT_TOOL]:[COMPLETE_TUTOR_TURN_TOOL,DELIVER_FROM_TEXT_TOOL,SET_EXPLANATORY_LANGUAGE_TOOL,UPDATE_STUDENT_MEMORY_TOOL,RECORD_LEARNING_FACT_TOOL]
 const fit=fitHistory(n.history,built,tools)
 const baseMessages:any[]=[{role:'system',content:built.system+fit.note},...fit.history,{role:'user',content:user},{role:'system',content:languageNote}]
 let response:AsyncIterable<any>|undefined
 if(mismatchedModel){
   const rejected=(async function*(){yield incorrectModelMessage(mismatchedModel)})() as MentorStream
   rejected.artifactSignals=[]
   rejected.textDeliveries=[]
   rejected.deliveryFailure='model_mismatch'
   rejected.deliveryFailures=['model_mismatch']
   rejected.servedModel=mismatchedModel
   return rejected
 }
 try{
   response=await openai.chat.completions.create({
     ...buildModelParams(model,budget,0.7,0.88),
     stream:true,stream_options:{include_usage:true},tools,tool_choice:wantsVisualReview?'none':'auto',
     messages:baseMessages,
   })
 }catch(e){
   const p=e&&typeof e==='object'?e as {status?:number;name?:string;code?:string|null;type?:string|null}:{}
   console.error('[tutor-provider]',JSON.stringify({reason:'provider_unavailable',status:p.status??null,code:p.code??null,type:p.type??null,class:p.name??'UnknownError'}))
 }
 const box:{w?:MentorStream}={}
 const wrapped=(async function*(){
   const calls=new Map<number,{id:string;name:string;args:string}>()
   let spoken=''
   let served=''
   // 7.5: every failure is collected and shown to the student by the stream engine, not only logged.
   const fail=(reason:string)=>{const w=box.w!;w.deliveryFailure??=reason;(w.deliveryFailures??=[]).push(reason);console.warn('[tutor-delivery]',JSON.stringify({reason,hadText:Boolean(spoken.trim())}))}
   const count=(u:any)=>{if(!u)return;const w=box.w!;const x=w.usage??={prompt:0,completion:0,cached:0,calls:0};x.prompt+=u.prompt_tokens??0;x.completion+=u.completion_tokens??0;x.cached+=u.prompt_tokens_details?.cached_tokens??0;x.calls+=1}
   const publishLanguage=(l:string)=>{wrapped.explanatoryLanguage=l}
   const publishRejected=(n:number)=>{wrapped.rejectedSignals=(wrapped.rejectedSignals??0)+n}
   const publishMemory=(o:TutorMemoryOp[])=>{wrapped.memoryOps=[...(wrapped.memoryOps??[]),...o]}
   const publishFacts=(f:LearningFactDeclaration[])=>{wrapped.learningFacts=[...(wrapped.learningFacts??[]),...f]}
   if(!response){fail('provider_unavailable');yield fallback;return}
   try{
     for await(const chunk of response){
       if(chunk.model){served=chunk.model;box.w!.servedModel=served}
       if(chunk.usage)count(chunk.usage)
       const d=chunk.choices?.[0]?.delta
       if(typeof d?.content==='string'&&d.content){spoken+=d.content;yield d.content}
       for(const t of d?.tool_calls??[]){
         const c=calls.get(t.index)??{id:'',name:'',args:''}
         if(t.id)c.id=t.id
         c.name+=t.function?.name??''
         c.args+=t.function?.arguments??''
         calls.set(t.index,c)
       }
     }
   }catch{fail('provider_stream_interrupted');if(!spoken.trim())yield fallback;return}
   if(!calls.size){console.info('[tutor-language]',JSON.stringify({declaredIn:n.state.explanatoryLanguage??null,opening:n.opening,tools:[],declaredOut:null,spokenChars:spoken.length,model,served}));if(!spoken.trim()){fail('empty_response');yield fallback}return}
   let closed:ReturnType<typeof parseClosedTutorTurn>=null
   let declared:string|undefined
   let memoryCalled=false
   let factsCalled=false
   let memoryCount=0
   for(const call of calls.values()){
     let raw:unknown
     try{raw=JSON.parse(call.args||'{}')}catch{fail('invalid_tool_json');continue}
     if(call.name==='deliver_from_text'){
       const dl=parseTextDelivery(raw)
       if(!dl)fail('invalid_delivery_call')
       else if(!deliveries.some(x=>x.kind===dl.kind))deliveries.push(dl)
     }else if(call.name==='complete_tutor_turn'){
       // Several closures in one turn are merged (7.4 kept only the first and dropped the rest).
       const prior=closed as {reply:string;artifacts:ArtifactSignal[]}|null
       closed=parseClosedTutorTurn(raw,spoken)
       if(!closed&&raw&&typeof raw==='object'){
         const item=raw as Record<string,unknown>
         const reply=typeof item.reply==='string'&&item.reply.trim()?item.reply:spoken
         const pieces=Array.isArray(item.artifacts)?item.artifacts:[]
         // 7.4.1: an invalid artifact declaration can never destroy the Tutor's own reply.
         // Valid pieces are delivered; invalid ones are reported by name, never retried
         // through a second model call.
         const valid=pieces.flatMap(part=>parseClosedTutorTurn({reply:reply||' ',artifacts:[part]})?.artifacts??[])
         const reasons=pieces.map(part=>diagnoseClosedTutorTurn({reply:'x',artifacts:[part]})).filter((r):r is string=>Boolean(r))
         if(reply.trim()||valid.length)closed={reply,artifacts:valid}
         if(reasons.length){publishRejected(reasons.length);box.w!.rejectedReasons=[...(box.w!.rejectedReasons??[]),...reasons];fail('artifact_signal_rejected')}
         else if(!Array.isArray(item.artifacts))fail('closure_artifacts_missing')
       }
       if(!closed)fail('invalid_tool_contract')
       if(prior)closed=closed?{reply:prior.reply||closed.reply,artifacts:dedupeSignals([...prior.artifacts,...closed.artifacts])}:prior
     }else if(call.name==='set_explanatory_language'){
       const lang=parseExplanatoryLanguage(raw)
       if(lang){declared=lang;publishLanguage(lang)}else fail('invalid_language_code')
     }else if(call.name==='update_student_memory'){
       const ops=parseMemoryOps(raw)
       if(ops){publishMemory(ops);memoryCount+=ops.length;memoryCalled=true}else fail('invalid_memory_ops')
     }else if(call.name==='record_learning_fact'){
       // 7.5: the Tutor declares; provenance is checked by the stream engine against the student's own words.
       const facts=parseLearningFacts(raw)
       if(facts){publishFacts(facts);factsCalled=true}else fail('invalid_learning_fact')
     }else{fail('unknown_tool')}
   }
   // Bounded observability (no user text): how the language state moved this turn.
   console.info('[tutor-language]',JSON.stringify({declaredIn:n.state.explanatoryLanguage??null,opening:n.opening,tools:[...calls.values()].map(c=>c.name),declaredOut:declared??null,memoryOps:memoryCount,memoryIn:Array.isArray(n.state.tutorMemory)?n.state.tutorMemory.length:0,spokenChars:spoken.length,model,served}))
   // The Tutor declared a delivery but wrote (almost) nothing: let the same
   // Tutor write the material now, in this same turn. No second author.
   // A language declaration alone only needs a continuation when the Tutor wrote no text.
   const declaredOnly=!deliveries.length&&!closed&&(Boolean(declared)||memoryCalled||factsCalled)
   if(!closed&&((deliveries.length&&spoken.trim().length<400)||(declaredOnly&&!spoken.trim()))){
     const asst:any={role:'assistant',content:spoken||null,tool_calls:[...calls.values()].filter(c=>c.id).map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:c.args||'{}'}}))}
     const results=[...calls.values()].filter(c=>c.id).map(c=>({role:'tool',tool_call_id:c.id,content:deliveries.length?'Delivery registered. Now write the complete material as your reply text, starting with its title. The platform will render exactly your text.':`${declared?`Language recorded: ${declared}. `:''}${memoryCalled?'Memory notes recorded. ':''}${factsCalled?'Facts received. ':''}Now write your reply to the student as normal text.${declared?` Your explanations, corrections and the reasons for each correction are in ${declared}, even if the student's message is Spanish practice; Spanish stays only for the examples and exercises you teach.`:''}`}))
     try{
       const more:AsyncIterable<any>=await openai.chat.completions.create({
         ...buildModelParams(model,budget,0.7,0.88),
         stream:true,stream_options:{include_usage:true},tools,tool_choice:'none',
         messages:[...baseMessages,asst,...results],
       })
       if(spoken.trim())yield '\n\n'
       for await(const chunk of more){
         if(chunk.usage)count(chunk.usage)
         const d=chunk.choices?.[0]?.delta
         if(typeof d?.content==='string'&&d.content){spoken+=d.content;yield d.content}
       }
     }catch{fail('continuation_interrupted')}
     if(!spoken.trim()){fail('empty_response');yield fallback}
     return
   }
   if(closed){
     // The streamed text is the reply; `reply` only matters when the Tutor wrote nothing else.
     // (7.4 dropped every artifact when the two differed: 'tool_reply_mismatch'.)
     const reply=(closed as {reply:string}).reply
     if(!spoken.trim()&&reply.trim()){spoken=reply;yield reply}
     signals.push(...(closed as {artifacts:ArtifactSignal[]}).artifacts)
   }else if(!spoken.trim()){fail('empty_response');yield fallback}
 })() as MentorStream
 box.w=wrapped
 wrapped.artifactSignals=signals
 wrapped.textDeliveries=deliveries
 return wrapped
}
