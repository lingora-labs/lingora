// =============================================================================
// server/mentors/mentor-engine.ts
// (header history condensed in this DIAGNOSTIC branch copy; the candidate branch keeps the full header)
// =============================================================================

import OpenAI from 'openai'
import { getMentorProfile } from './profiles'
import { getModeInstruction, TUTOR_PROHIBITIONS } from '@/lib/tutorProtocol'
import { buildContextPack, formatContextPack, formatLanguageTurnNote, type ContextPack } from '@/lib/context-pack'
import { SET_EXPLANATORY_LANGUAGE_TOOL, parseExplanatoryLanguage } from '@/lib/explanatory-language'
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
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  // True only when the student has written nothing yet (session-open turn): a
  // structural fact about the request, not a reading of anyone's words.
  opening: boolean
}

export type MentorStream = AsyncGenerator<string> & { artifactSignals: ArtifactSignal[]; textDeliveries: TextDelivery[]; explanatoryLanguage?: string; deliveryFailure?: string }

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
  const recentQuiz = formatQuizEvidence(state.quizEvidence)
  // This session metadata comes from the actual UI selection, not a regex classifier.
  const opening = Boolean(params.opening)
  const localeEnvelope = state.explanatoryLanguage
    ? `[SESSION LOCALE: explanatoryLanguage=${state.explanatoryLanguage}; targetLanguage=es. The language of your explanations is the one you settled on for this student; Spanish examples use targetLanguage.]\n\n`
    : opening
      ? '[SESSION LOCALE: targetLanguage=es. This is the opening greeting; its language format is given in the language note.]\n\n'
      : '[SESSION LOCALE: targetLanguage=es. The language of your explanations is the language the student writes in or asks for; any language you can write well is allowed. Spanish examples use targetLanguage.]\n\n'
  // DIAGNOSTIC 7.3.3c (temporary): bisect the system prompt by piece via state._lx 'drop:a+b' / 'only:a+b'.
  const lxs = String((state as { _lx?: unknown })._lx ?? '')
  const dropSet = (/drop:([a-z+]+)/.exec(lxs)?.[1] ?? '').split('+')
  const onlySet = /only:([a-z+]+)/.exec(lxs)?.[1]?.split('+')
  const keep = (k: string) => (onlySet ? onlySet.includes(k) : !dropSet.includes(k))
  const system = [keep('env') ? localeEnvelope : '', keep('persona') ? profile.system : '', keep('artifact') ? ARTIFACT_CHANNEL_INSTRUCTION : '', keep('directive') ? executionDirective : '', keep('mode') ? modeInstructions : '', keep('prohib') ? TUTOR_PROHIBITIONS : '', keep('ctx') ? buildContext(state, opening) : '', recentQuiz ? '\n\n[QUIZ UI EVIDENCE]\n' + recentQuiz : '', keep('pack') ? '\n\n' + formatContextPack(pack, { opening }) : '', keep('comm') ? commercialContextForTurn(params.message, state) : ''].filter(Boolean).join('')
  return { system, user: String(params.message || ''), languageNote: formatLanguageTurnNote(pack, { opening, other: state.uiLanguageChoice === 'other' }) }
}

function normalizeLegacyCall(message: string, state: LegacyMentorState = {}, systemDirective?: string): NormalizedMentorCall {
  return { message, state, systemDirective, plan: undefined, action: undefined, priorContext: undefined, history: [], opening: !String(message ?? '').trim() }
}
function normalizeRuntimeCall(params: MentorRuntimeParams): NormalizedMentorCall {
  const rawMessage = params.request?.message?.trim()
  // A blank opening turn is a real UI session-start event, not an audio file.
  const message = rawMessage ? rawMessage : params.priorContext?.trim() ? params.priorContext : '[Session opened without a written message]'
  const rawHistory = params.request?.conversationHistory
  const history = Array.isArray(rawHistory)
    ? rawHistory.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    : []
  return { message, state: params.state ?? {}, systemDirective: undefined, plan: params.plan, action: params.action, priorContext: params.priorContext, history, opening: !rawMessage }
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
  const { system, user, languageNote } = buildMentorPrompt({
    message: normalized.message, state: normalized.state, systemDirective: normalized.systemDirective,
    plan: normalized.plan, action: normalized.action, priorContext: normalized.priorContext, history: normalized.history, opening: normalized.opening,
  })
  try {
    const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini'
    const pack = resolveTurnContextPack(normalized.message, normalized.state, normalized.plan)
    const completion = await openai.chat.completions.create({
      ...buildModelParams(RUNTIME_MODEL, resolveOutputBudget(normalized.plan, pack), 0.7, 0.88),
      messages: [{ role: 'system', content: system }, ...normalized.history, { role: 'user', content: user }, { role: 'system', content: languageNote }],
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
 const {system,user,languageNote}=buildMentorPrompt({message:n.message,state:n.state,systemDirective:n.systemDirective,plan:n.plan,action:n.action,priorContext:n.priorContext,history:n.history,opening:n.opening})
 const signals:ArtifactSignal[]=[]
 const deliveries:TextDelivery[]=[]
 const pack=resolveTurnContextPack(n.message,n.state,n.plan)
 // Only a clicked Article 27 review (a direct uiAction) is a pure formatting effect.
 const wantsVisualReview = params.request.uiAction==='create_visual_review'
 const fallback=FALLBACKS[resolveInterfaceLanguage(n.state)]??FALLBACKS.en
 // DIAGNOSTIC 7.3.3c/d (temporary, never part of the candidate): controlled comparison switch _lx.
 // Model selection: closed list of three identifiers, honoured only outside production.
 const lx=String((n.state as {_lx?:unknown})._lx??'').split(';')
 const diagOk=process.env.VERCEL_ENV!=='production'
 const ALLOWED_MODELS=['gpt-5.4-mini','gpt-5.4','gpt-5.6-sol']
 const lxModel=(lx.find(x=>x.startsWith('model='))??'').slice(6)
 const model=diagOk&&ALLOWED_MODELS.includes(lxModel)?lxModel:(process.env.OPENAI_MAIN_MODEL||'gpt-4o-mini')
 const diagReasoning={...(diagOk&&lx.includes('rx=none')?{reasoning_effort:'none'}:{})}
 const diagStreamOpts={...(diagOk&&lxModel?{stream_options:{include_usage:true}}:{})}
 let diagErr=''
 const budget=resolveOutputBudget(n.plan,pack)
 const baseMessages:any[]=[{role:'system',content:system},...n.history,{role:'user',content:user},{role:'system',content:languageNote}]
 // The opening greeting settles no language: that tool exists only once the student has written.
 const tools=n.opening?[COMPLETE_TUTOR_TURN_TOOL,DELIVER_FROM_TEXT_TOOL]:[COMPLETE_TUTOR_TURN_TOOL,DELIVER_FROM_TEXT_TOOL,SET_EXPLANATORY_LANGUAGE_TOOL]
 const toolset=lx.includes('notool')&&n.state.explanatoryLanguage?tools.filter(t=>t!==SET_EXPLANATORY_LANGUAGE_TOOL):tools
 const noteMsg={role:'system',content:languageNote}
 const userMsg={role:'user',content:user}
 const msgs:any[]=lx.includes('min')?[{role:'system',content:'You are a Spanish tutor for LINGORA. '+languageNote},...n.history,userMsg]
   :lx.includes('top')?[{role:'system',content:languageNote+'\n\n'+system},...n.history,userMsg]
   :lx.includes('toptail')?[{role:'system',content:languageNote+'\n\n'+system},...n.history,userMsg,noteMsg]
   :lx.includes('topsys')?[{role:'system',content:languageNote},{role:'system',content:system},...n.history,userMsg]
   :lx.includes('insys')?[{role:'system',content:system+'\n\n'+languageNote},...n.history,userMsg]
   :lx.includes('before')?[{role:'system',content:system},...n.history,noteMsg,userMsg]
   :baseMessages
 let response:AsyncIterable<any>|undefined
 try{
   response=await openai.chat.completions.create({
     ...buildModelParams(model,budget,0.7,0.88),
     ...(diagReasoning as {}),...(diagStreamOpts as {}),
     stream:true,tools:toolset,tool_choice:wantsVisualReview?'none':'auto',
     messages:msgs,
   })
 }catch(e){
   const p=e&&typeof e==='object'?e as {status?:number;name?:string;code?:string;message?:string}:{}
   diagErr=`${p.status??'?'}/${p.code??p.name??'Err'}: ${String(p.message??'').slice(0,160)}`
   console.error('[tutor-provider]',JSON.stringify({reason:'provider_unavailable',status:p.status??null,class:p.name??'UnknownError',model,lx:lx.join('+')}))
 }
 const wrapped=(async function*(){
   const calls=new Map<number,{id:string;name:string;args:string}>()
   let spoken=''
   let usage:unknown=null
   const fail=(reason:string)=>{wrapped.deliveryFailure=reason;console.warn('[tutor-delivery]',JSON.stringify({reason,hadText:Boolean(spoken.trim())}))}
   const publishLanguage=(l:string)=>{wrapped.explanatoryLanguage=l}
   if(!response){fail('provider_unavailable');yield (diagOk&&lxModel?`[[PROVIDER_ERROR ${model} ${diagErr}]]`:fallback);return}
   try{
     for await(const chunk of response){
       if(chunk.usage)usage=chunk.usage
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
   const logUsage=usage as {prompt_tokens?:number;completion_tokens?:number}|null
   if(!calls.size){console.info('[tutor-language]',JSON.stringify({declaredIn:n.state.explanatoryLanguage??null,opening:n.opening,tools:[],declaredOut:null,spokenChars:spoken.length,lx:lx.join('+'),model,pt:logUsage?.prompt_tokens??null,ct:logUsage?.completion_tokens??null}));if(!spoken.trim()){fail('empty_response');yield fallback}return}
   let closed:ReturnType<typeof parseClosedTutorTurn>=null
   let closureSeen=false
   let declared:string|undefined
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
     }else if(call.name==='set_explanatory_language'){
       const lang=parseExplanatoryLanguage(raw)
       if(lang){declared=lang;publishLanguage(lang)}else fail('invalid_language_code')
     }else{fail('unknown_tool')}
   }
   // Bounded observability (no user text): how the language state moved this turn.
   console.info('[tutor-language]',JSON.stringify({declaredIn:n.state.explanatoryLanguage??null,opening:n.opening,tools:[...calls.values()].map(c=>c.name),declaredOut:declared??null,spokenChars:spoken.length,lx:lx.join('+'),model,pt:logUsage?.prompt_tokens??null,ct:logUsage?.completion_tokens??null}))
   // A language declaration alone only needs a continuation when the Tutor wrote no text.
   const declaredOnly=!deliveries.length&&!closed&&Boolean(declared)
   if(!closed&&((deliveries.length&&spoken.trim().length<400)||(declaredOnly&&!spoken.trim()))){
     const asst:any={role:'assistant',content:spoken||null,tool_calls:[...calls.values()].filter(c=>c.id).map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:c.args||'{}'}}))}
     const results=[...calls.values()].filter(c=>c.id).map(c=>({role:'tool',tool_call_id:c.id,content:deliveries.length?'Delivery registered. Now write the complete material as your reply text, starting with its title. The platform will render exactly your text.':`Language recorded: ${declared}. Now write your reply to the student as normal text. Your explanations, corrections and the reasons for each correction are in ${declared}, even if the student's message is Spanish practice; Spanish stays only for the examples and exercises you teach.`}))
     try{
       const more:AsyncIterable<any>=await openai.chat.completions.create({
         ...buildModelParams(model,budget,0.7,0.88),
         ...(diagReasoning as {}),
         stream:true,tools:toolset,tool_choice:'none',
         messages:[...msgs,asst,...results],
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
