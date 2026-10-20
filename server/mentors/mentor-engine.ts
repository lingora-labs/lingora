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
import { formatQuizEvidence } from '@/lib/quiz-evidence'
import { isExplicitPdfRequest } from '@/lib/pdf-intent-authorization'
import { isExplicitQuizRequest } from '@/lib/quiz-intent-guard'
import { isExplicitImageRequest } from '@/server/core/artifact-side-effect'
import { commercialContextForTurn } from '@/server/core/commercial-context'
import { deliveryContextForTurn } from './delivery-context'
import {
  ARTIFACT_CHANNEL_INSTRUCTION,
  COMPLETE_TUTOR_TURN_TOOL,
  parseClosedTutorTurn,
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

export type MentorStream = AsyncGenerator<string> & { artifactSignals: ArtifactSignal[]; deliveryFailure?: string }

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
    'For a simple factual or general-knowledge question — including one unrelated to Spanish, asked in passing — answer directly and concisely, the way you would in an ordinary conversation, UNLESS the student\'s own wording asks for depth, a table, a lesson, or step-by-step teaching. A short aside does not need a table, a "further nuance" paragraph, or a closing menu of follow-up options. Do not pad. Do not repeat. A request for a complete domain curriculum from beginner to expert is explicitly a deep deliverable, not a short aside: give a substantial staged syllabus covering foundations, terminology, applied practice, assessments, progression and expert boundaries. Do not replace a complete course request with a five-bullet teaser. If the student sequenced several requests in this message, cover that sequence in this turn instead of deferring parts.' +
    '\n\nCRITICAL: NEVER refuse a task by citing your Spanish-teaching function. If the task is in Spanish or serves learning — execute it with expert depth.',
  STRUCTURED_COURSE_DIRECTIVE:
    'You are in structured course mode. Follow the pedagogical sequence: guide -> lesson -> schema -> quiz -> feedback. Do not skip steps. Do not blend phases unless the student explicitly sequenced several requests in this message — then fulfill that sequence now.',
  FREE_CONVERSATION_DIRECTIVE: 'You are in free conversation mode. Respond naturally. Correct errors inline and briefly.',
  PDF_COURSE_DIRECTIVE: 'You are generating formal course material. Content should be structured, downloadable-quality, and self-contained.',
  CORRECTION_ONLY_DIRECTIVE: 'The student asked for a correction. Correct exactly what they wrote. Do not teach a full lesson.',
  TRANSLATION_ONLY_DIRECTIVE: 'The student asked for a translation. Provide ONLY the translation.',
  FIRST_TURN_DIRECTIVE: 'On a simple first greeting in Free mode, greet briefly and invite one immediate concrete microaction: ask the student to write or say a single sentence about today in Spanish, which you can then respond to naturally. Do not offer a list of alternative menus or defer to a mode choice. The Spanish-learning opportunity is optional if the student then changes subject. No lesson or unsolicited artifacts for the greeting: use artifacts: [].',
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
  if(params.plan?.documentContractUpdate){
    const c=params.plan.documentContractUpdate
    // Facts from a student-authorized request; the Tutor Maestro decides
    // how to ask, teach and materialize. No separate cognitive executor.
    parts.push('Document request context: type=course PDF; level='+
      (c.level??'not yet specified')+'; topic='+(c.topic??'not yet specified')+
      '; ready='+Boolean(params.plan.documentContractReady)+'.')
  }
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
  // A runtime milestone, not an independent pedagogical brain. The tutor
  // writes the actual review content through the same typed turn closure.
  // Data from completed UI quiz: actual selected, expected, and graded answers.
  // This is context to inform Willy, never an independent answer generator.
  const recentQuiz = formatQuizEvidence(state.quizEvidence)
  // This session metadata comes from the actual UI selection, not a regex classifier.
  const localeEnvelope = `[SESSION LOCALE: interfaceLanguage=${resolveInterfaceLanguage(state)}; targetLanguage=es. The tutor's initial greeting and explanations use interfaceLanguage; Spanish examples use targetLanguage. A later explicit change of language overrides this default.]\n\n`
  const system = [localeEnvelope, profile.system, ARTIFACT_CHANNEL_INSTRUCTION, executionDirective, modeInstructions, TUTOR_PROHIBITIONS, buildContext(state), recentQuiz ? '\n\n[QUIZ UI EVIDENCE]\n' + recentQuiz : '', '\n\n' + formatContextPack(pack), commercialContextForTurn(params.message, state), deliveryContextForTurn(params.message, state.activeMode, params.plan)].filter(Boolean).join('')
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

/** 7.2: one Tutor, optional typed tools, no destruction of streamed text. */
export async function getMentorResponseStream(params: MentorRuntimeParams): Promise<MentorStream> {
 const n=normalizeRuntimeCall(params)
 const {system,user}=buildMentorPrompt({message:n.message,state:n.state,systemDirective:n.systemDirective,plan:n.plan,action:n.action,priorContext:n.priorContext})
 const signals:ArtifactSignal[]=[]
 const pack=resolveTurnContextPack(n.message,n.state,n.plan)
 // An explicit student authorization is a binding delivery contract, not a
 // classifier deciding what the Tutor may teach. Free conversation stays auto.
 const wantsPdf = isExplicitPdfRequest(n.message,n.state.activeMode)
 // Full documents are authored as ordinary text, then deterministically
 // materialized from those exact words. Large JSON tool arguments truncate.
 // A clicked Article 27 review is a document-formatting effect, not a
 // need to pack a long teaching explanation into fragile JSON arguments.
 const wantsVisualReview = params.request.uiAction==='create_visual_review'
 const wantsQuiz = isExplicitQuizRequest(n.message)
 const mustDeliver = !wantsPdf && !wantsVisualReview && !wantsQuiz && isExplicitImageRequest(n.message)
 const fallback=FALLBACKS[resolveInterfaceLanguage(n.state)]??FALLBACKS.en
 let response:AsyncIterable<any>|undefined
 try{
   response=await openai.chat.completions.create({
     ...buildModelParams(process.env.OPENAI_MAIN_MODEL||'gpt-4o-mini',resolveOutputBudget(n.plan,pack),0.7,0.88),
     stream:true,tools:[COMPLETE_TUTOR_TURN_TOOL],
     tool_choice: wantsPdf || wantsVisualReview || wantsQuiz ? 'none' : mustDeliver ? {type:'function' as const,function:{name:'complete_tutor_turn'}} : 'auto',
     messages:[{role:'system',content:system},...n.history,{role:'user',content:user}],
   })
 }catch(e){
   const p=e&&typeof e==='object'?e as {status?:number;name?:string}:{}
   console.error('[tutor-provider]',JSON.stringify({reason:'provider_unavailable',status:p.status??null,class:p.name??'UnknownError'}))
 }
 const wrapped=(async function*(){
   const calls=new Map<number,{name:string;args:string}>()
   let spoken=''
   const fail=(reason:string)=>{wrapped.deliveryFailure=reason;console.warn('[tutor-delivery]',JSON.stringify({reason,hadText:Boolean(spoken.trim())}))}
   if(!response){fail('provider_unavailable');yield fallback;return}
   try{
     for await(const chunk of response){
       const d=chunk.choices?.[0]?.delta
       if(typeof d?.content==='string'&&d.content){spoken+=d.content;yield d.content}
       for(const t of d?.tool_calls??[]){
         const c=calls.get(t.index)??{name:'',args:''}
         c.name+=t.function?.name??''
         c.args+=t.function?.arguments??''
         calls.set(t.index,c)
       }
     }
   }catch{fail('provider_stream_interrupted');if(!spoken.trim())yield fallback;return}
   if(!calls.size){if(!spoken.trim()){fail('empty_response');yield fallback}return}
   if(calls.size!==1){fail('multiple_tool_calls');if(!spoken.trim())yield fallback;return}
   const call=[...calls.values()][0]
   if(call.name!=='complete_tutor_turn'){fail('unknown_tool');if(!spoken.trim())yield fallback;return}
   let raw:unknown
   try{raw=JSON.parse(call.args)}catch{fail('invalid_tool_json');if(!spoken.trim())yield fallback;return}
   // Preserve valid independent deliverables even if another entry in the
   // same closure was malformed. Never bypass any artifact validator.
   let closed=parseClosedTutorTurn(raw)
   if(!closed && raw && typeof raw==='object'){
     const item=raw as Record<string,unknown>
     const reply=typeof item.reply==='string'?item.reply:''
     const pieces=Array.isArray(item.artifacts)?item.artifacts:[]
     if(reply.trim()){
       const valid=pieces.flatMap(part=>parseClosedTutorTurn({reply,artifacts:[part]})?.artifacts??[])
       if(valid.length) closed={reply,artifacts:valid}
     }
   }
   if(!closed){fail('invalid_tool_contract');if(!spoken.trim())yield fallback;return}
   if(spoken.trim()&&spoken.trim()!==closed.reply.trim()){fail('tool_reply_mismatch');return}
   if(!spoken.trim()){spoken=closed.reply;yield closed.reply}
   const pending=Boolean(n.plan?.documentContractUpdate&&!n.plan.documentContractReady)
   const pdfOk=!pending&&(isExplicitPdfRequest(n.message,n.state.activeMode)||Boolean(n.plan?.documentContractReady))
   signals.push(...closed.artifacts.filter(a=>a.type!=='emit_pdf'||pdfOk))
 })() as MentorStream
 wrapped.artifactSignals=signals
 return wrapped
}
