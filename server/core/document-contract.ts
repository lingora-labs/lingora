// LINGORA Tutor First — document contract lifecycle, instrumental ONLY.
//
// This pure function never writes the tutor's reply. It detects an explicit
// unfinished document request, records its parameters, and clears state on a
// later withdrawal/task change. The tutor decides what to teach and whether
// to emit an authorized PDF. Do not import the retired intent-router.
import type { PendingDocumentRequest, SessionState } from '../../lib/contracts'

export type DocumentDecision = {
  kind: 'none'|'open'|'continue'|'ready'|'clear'
  next?: PendingDocumentRequest
  reason: string
}
const normalized=(s:string)=>s.normalize('NFC').trim()
const level=/\b(A0|A1|A2|B1|B2|C1|C2)(?:\s*[-–]\s*(A0|A1|A2|B1|B2|C1|C2))?\b/iu
const courseNoun=/\b(?:curso|gu[ií]a|manual|course|study\s+guide|workbook)\b/iu
const wants=/\b(?:quiero|necesito|hazme|dame|crea(?:me)?|genera(?:me)?|prep[aá]ra(?:me)?|desarrolla|create|generate|prepare|make|give me|i want|i need)\b/iu
const cancel=/^(?:olvídalo|olvidalo|cancela(?:lo|r)?|no,?\s+gracias|ya no lo quiero|desisto|forget it|cancel(?: it)?|never mind|stop)\s*[.!]?$/iu
const explicitNoPdf=/^(?:no\s+quiero|sin|no\s+generes|no\s+hagas|don't\s+make|without)\b.{0,80}\b(?:pdf|curso|documento)\b/iu
const taskSwitch=/^(?:cambiemos de tema|cambia(?:mos)? de tema|hablemos de otra cosa|dejemos (?:eso|el curso)|pasemos a otra cosa|let's change (?:the )?topic|change (?:the )?subject)\b[.!:;, ]*/iu
const nextTask=/^(?:traduce\b|translate\b|corrige\b|correct\b|expl[ií]ca(?:me)?\b|explain\b|cu[eé]ntame\b|tell me\b|haz(?:me)?\b|crea(?:me)?\b|genera(?:me)?\b|dame\b|ens[eé]ñame\b|enseña\b|i want to learn\b)/iu
const confirmation=/^(?:sí|si|vale|ok|listo|adelante|hazlo|genera|genera el pdf|procede|yes|go ahead|proceed)\s*[.!]?$/iu
const topicCue=/\b(?:tema|sobre|acerca de|topic|about)\s*[:\-]?\s*(.+)$/iu
const genericTopic=/^(?:espa[nñ]ol|english|ingl[eé]s|curso|material|pdf|general|todo|idiomas)$/iu
// A bare topic is a short NOMINAL fragment (e.g. "Ser y estar").
// It must never swallow a new conversational instruction as a document field.
const bareTopic=/^[\p{L}]+(?:[\s-]+[\p{L}]+){0,5}$/u
const independentIntent=/^(?:(?:hola|hello|buenas)[,.!\s]+)?(?:(?:ahora|mejor)[,\s]+)?(?:quiero|necesito|prefiero|me gustar[ií]a|vamos a|podemos|quisiera)\b/iu
const levelOnly=/^(?:(?:quiero|necesito|prefiero)\s+)?(?:el\s+)?(?:nivel\s+)?(?:A0|A1|A2|B1|B2|C1|C2)(?:\s*[-–]\s*(?:A0|A1|A2|B1|B2|C1|C2))?\s*[.!]?$/iu
const contractLevelOnly=/^(?:(?:quiero|necesito|prefiero)\s+)?(?:el\s+)?nivel\s*:?\s*(?:A0|A1|A2|B1|B2|C1|C2)(?:\s*[-–]\s*(?:A0|A1|A2|B1|B2|C1|C2))?\s*[.!]?$/iu

function extractLevel(text:string):string|null{
 const m=text.match(level)
 return m?m[1].toUpperCase()+(m[2]?'-'+m[2].toUpperCase():''):null
}
function extractTopic(text:string, allowBare:boolean):string|null{
 const c=text.match(topicCue)
 let raw=c?c[1]:''
 if(!c && allowBare && !nextTask.test(text) && !confirmation.test(text) && !/\?/.test(text))raw=text
 raw=raw.replace(/\b(?:en|a|como)\s+pdf\b.*$/iu,'')
   .replace(/\s+(?:de\s+)?(?:nivel|level)\s+[ABC][0-2](?:\s*[-–]\s*[ABC][0-2])?.*$/iu,'')
   .replace(/\b(?:A0|A1|A2|B1|B2|C1|C2)(?:\s*[-–]\s*(?:A0|A1|A2|B1|B2|C1|C2))?\b/giu,'')
   .replace(/^[,;.\s:-]+|[,;.\s:-]+$/g,'').trim()
 // An apparently new command is not a course topic.
 return raw.length>=3 && raw.length<=100 && !genericTopic.test(raw)
   && !nextTask.test(raw) && (c || !allowBare || bareTopic.test(raw)) ? raw:null
}
function initialTopic(message:string):string|null{
 const explicit=extractTopic(message,false)
 if(explicit)return explicit
 const match=message.match(/\b(?:curso|gu[ií]a|manual|course)\s+(?:completo\s+)?(?:de|sobre|about|on)\s+([^.!?;\n]{3,90})/iu)
 return match?extractTopic(match[1],true):null
}
const courseRequest=(message:string)=>wants.test(message)&&courseNoun.test(message)&&/\bpdf\b/iu.test(message)

export function reconcileDocumentContract(
  message:string, state:Pick<SessionState,'pendingDocumentRequest'|'tokens'>,
):DocumentDecision {
 const input=normalized(message)
 const existing=state.pendingDocumentRequest
 const prior=existing?.type==='course_pdf' ? existing:null
 if(!input)return {kind:'none',reason:'No explicit turn content'}
 if(prior && (explicitNoPdf.test(input) || cancel.test(input) || /^(?:cancela|cancel|olvida|forget)\b.{0,55}\b(?:curso|pdf|documento|request|pedido)\b/iu.test(input)))
   return {kind:'clear',reason:'Explicit student withdrawal outranks a pending document'}
 if(prior && (taskSwitch.test(input) || (nextTask.test(input) && !courseRequest(input) && !confirmation.test(input)) || /^(?:quiero|necesito)\s+(?:cambiar|otro\s+formato|una\s+tabla|un\s+quiz|un\s+(?:archivo|documento)\s+(?:html|word|docx))/iu.test(input)))
   return {kind:'clear',reason:'New explicit student intention outranks legacy document state'}
 if(prior && (state.tokens??0)-prior.openedAtToken>15)
   return {kind:'clear',reason:'Expired document parameters cannot silently resume'}
 // The learner's explicit new goal has priority over an unfinished PDF.
 // No broad "other" fallback to a stale document: only unambiguous parameter
 // fragments remain available for collection. A request such as "Hola,
 // quiero practicar frases" must not become the PDF's course title.
 const anExplicitNewGoal=independentIntent.test(input)
   && !courseRequest(input) && !levelOnly.test(input) && !contractLevelOnly.test(input)
 if(prior && anExplicitNewGoal)
   return {kind:'clear',reason:'New explicit learner goal overrides unfinished document'}
 if(!prior && !courseRequest(input))return {kind:'none',reason:'No explicit new document contract'}
 // Unlike the old exclusive-turn classifier, level and topic can be learned
 // in the same message. The existing contract does not supply the topic from
 // lastConcept or curriculum history.
 const contextLevel=extractLevel(input)
 const freshRequest=courseRequest(input)
 const contextTopic=freshRequest?initialTopic(input):prior?extractTopic(input,!contextLevel):null
 const contract:PendingDocumentRequest={
   type:'course_pdf',level:contextLevel??prior?.level??null,
   topic:contextTopic??(freshRequest?null:prior?.topic??null),
   status:'collecting',
   openedAtToken:freshRequest?(state.tokens??0):prior?.openedAtToken??(state.tokens??0),
 }
 const kind:DocumentDecision['kind']=contract.level&&contract.topic?'ready':prior?'continue':'open'
 return{kind,next:contract,reason:kind==='ready'
   ?'Explicit document parameters ready; Tutor Maestro owns content and PDF decision'
   :'Document parameters collected without taking ownership of tutoring'}
}
