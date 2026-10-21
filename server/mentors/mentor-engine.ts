// =============================================================================
// server/mentors/mentor-engine.ts
// One Tutor Maestro. 7.3: tool_choice is 'auto'; a typed tool call by the Tutor
// (deliver_from_text / complete_tutor_turn) is the authorization for any file
// or native component. The runtime validates technically and never reads the
// student's words. Long documents are written as ordinary streamed text, never
// serialized into tool JSON (truncation risk).
// History of earlier hardening (P4 budget, P8-P10 structured channel, P19-F
// trivial-turn exclusion, BASE-MODEL-PARITY conversation history, general
// question over-structuring directive): see git history.
// =============================================================================

import OpenAI from 'openai'
import { getMentorProfile } from './profiles'
import { getModeInstruction, TUTOR_PROHIBITIONS } from '@/lib/tutorProtocol'
import { buildContextPack, formatContextPack, type ContextPack } from '@/lib/context-pack'
import { formatQuizEvidence } from '@/lib/quiz-evidence'
import { commercialContextForTurn } from '@/server/core/commercial-context'
import {
  ARTIFACT_CHANNEL_INSTRUCTION,
  COMPLETE_TUTOR_TURN_TOOL,
  DELIVER_FROM_TEXT_TOOL,
  parseClosedTutorTurn,
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
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
  // BASE-MODEL-PARITY — recent real turns flow to the model as real dialogue.
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

export type MentorStream = AsyncGenerator<string> & { artifactSignals: ArtifactSignal[]; textDeliveries: TextDelivery[]; deliveryFailure?: string }

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
  const modeInstructions = getModeInstruction(resolveProtocolMode(mode), topic)
  const pack = resolveTurnContextPack(params.message, state, params.plan)
  // Data from the completed UI quiz: actual selected, expected, and graded answers.
  // Context to inform the Tutor, never an independent answer generator.
  const recentQuiz = formatQuizEvidence(state.quizEvidence)
  // Session metadata comes from the actual UI selection, not a regex classifier.
  const localeEnvelope = `[SESSION LOCALE: interfaceLanguage=${resolveInterfaceLanguage(state)}; targetLanguage=es. The tutor's initial greeting and explanations use interfaceLanguage; Spanish examples use targetLanguage. A later explicit change of language overrides this default.]\n\n`
  const system = [localeEnvelope, profile.system, ARTIFACT_CHANNEL_INSTRUCTION, executionDirective, modeInstructions, TUTOR_PROHIBITIONS, buildContext(state), recentQuiz ? '\n\n[QUIZ UI EVIDENCE]\n' + recentQuiz : '', '\n\n' + formatContextPack(pack), commercialContextForTurn(params.message, state)].filter(Boolean).join('')
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

/** 7.3: one Tutor, typed tools. A tool call by the Tutor is the authorization;
 *  the runtime only validates technically and never reads the student's words. */
export async function getMentorResponseStream(params: MentorRuntimeParams): Promise<MentorStream> {
 const n=normalizeRuntimeCall(params)
 const {system,user}=buildMentorPrompt({message:n.message,state:n.state,systemDirective:n.systemDirective,plan:n.plan,action:n.action,priorContext:n.priorContext})
 const signals:ArtifactSignal[]=[]
 const deliveries:TextDelivery[]=[]
 const pack=resolveTurnContextPack(n.message,n.state,n.plan)
 // Only a clicked Article 27 review (a direct uiAction) is a pure formatting effect.
 const wantsVisualReview = params.request.uiAction==='create_visual_review'
 const fallback=FALLBACKS[resolveInterfaceLanguage(n.state)]??FALLBACKS.en
 const model=process.env.OPENAI_MAIN_MODEL||'gpt-4o-mini'
 const budget=resolveOutputBudget(n.plan,pack)
 const baseMessages:any[]=[{role:'system',content:system},...n.history,{role:'user',content:user}]
 const tools=[COMPLETE_TUTOR_TURN_TOOL,DELIVER_FROM_TEXT_TOOL]
 let response:AsyncIterable<any>|undefined
 try{
   response=await openai.chat.completions.create({
     ...buildModelParams(model,budget,0.7,0.88),
     stream:true,tools,tool_choice:wantsVisualReview?'none':'auto',
     messages:baseMessages,
   })
 }catch(e){
   const p=e&&typeof e==='object'?e as {status?:number;name?:string}:{}
   console.error('[tutor-provider]',JSON.stringify({reason:'provider_unavailable',status:p.status??null,class:p.name??'UnknownError'}))
 }
 const wrapped=(async function*(){
   const calls=new Map<number,{id:string;name:string;args:string}>()
   let spoken=''
   const fail=(reason:string)=>{wrapped.deliveryFailure=reason;console.warn('[tutor-delivery]',JSON.stringify({reason,hadText:Boolean(spoken.trim())}))}
   if(!response){fail('provider_unavailable');yield fallback;return}
   try{
     for await(const chunk of response){
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
   if(!calls.size){if(!spoken.trim()){fail('empty_response');yield fallback}return}
   let closed:ReturnType<typeof parseClosedTutorTurn>=null
   let closureSeen=false
   for(const call of calls.values()){
     let raw:unknown
     try{raw=JSON.parse(call.args||'{}')}catch{fail('invalid_tool_json');continue}
     if(call.name==='deliver_from_text'){
       const dl=parseTextDelivery(raw)
       if(dl&&deliveries.length<2)deliveries.push(dl);else fail('invalid_delivery_call')
     }else if(call.name==='complete_tutor_turn'){
       if(closureSeen){fail('multiple_closures');continue}
       closureSeen=true
       closed=parseClosedTutorTurn(raw)
       if(!closed&&raw&&typeof raw==='object'){
         const item=raw as Record<string,unknown>
         const reply=typeof item.reply==='string'?item.reply:''
         const pieces=Array.isArray(item.artifacts)?item.artifacts:[]
         if(reply.trim()){
           const valid=pieces.flatMap(part=>parseClosedTutorTurn({reply,artifacts:[part]})?.artifacts??[])
           if(valid.length) closed={reply,artifacts:valid}
         }
       }
       if(!closed)fail('invalid_tool_contract')
     }else{fail('unknown_tool')}
   }
   // The Tutor declared a delivery but wrote (almost) nothing: let the same
   // Tutor write the material now, in this same turn. No second author.
   if(deliveries.length&&!closed&&spoken.trim().length<400){
     const asst:any={role:'assistant',content:spoken||null,tool_calls:[...calls.values()].filter(c=>c.id).map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:c.args||'{}'}}))}
     const results=[...calls.values()].filter(c=>c.id).map(c=>({role:'tool',tool_call_id:c.id,content:'Delivery registered. Now write the complete material as your reply text, starting with its title. The platform will render exactly your text.'}))
     try{
       const more:AsyncIterable<any>=await openai.chat.completions.create({
         ...buildModelParams(model,budget,0.7,0.88),
         stream:true,tools,tool_choice:'none',
         messages:[...baseMessages,asst,...results],
       })
       if(spoken.trim())yield '\n\n'
       for await(const chunk of more){
         const d=chunk.choices?.[0]?.delta
         if(typeof d?.content==='string'&&d.content){spoken+=d.content;yield d.content}
       }
     }catch{fail('continuation_interrupted')}
     if(!spoken.trim()){fail('empty_response');yield fallback}
     return
   }
   if(closed){
     const reply=(closed as {reply:string}).reply
     if(!deliveries.length&&spoken.trim()&&spoken.trim()!==reply.trim()){fail('tool_reply_mismatch');return}
     if(!spoken.trim()){spoken=reply;yield reply}
     signals.push(...(closed as {artifacts:ArtifactSignal[]}).artifacts)
   }else if(!spoken.trim()){fail('empty_response');yield fallback}
 })() as MentorStream
 wrapped.artifactSignals=signals
 wrapped.textDeliveries=deliveries
 return wrapped
}
