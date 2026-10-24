// ADJUDICATED in 7.4.1 against the CURRENT contracts (7.3 "Tutor libre" + 7.4 dual evaluation).
//
// What this file used to prove, and why it was retired:
//   * "structural closure recovery": a rejected closure triggered a SECOND completion carrying the system message
//     "Structural closure rejection: <code>", plus a semantic "quiz_review_only" second completion and a global
//     two-extra-completion budget. 7.3 removed that mechanism on purpose (one Tutor, no second author, no prompt
//     patching; tests/tutor-free-commercial.test.mjs asserts the string is gone). Those scenarios test an
//     architecture that no longer exists and are retired, not weakened.
//   * "signals are filtered by the student's words" (a prohibition in the message removing a PDF): the runtime no
//     longer reads the student's words; the Tutor's typed declaration is the authorization (7.3 barrier).
//
// What it still protects (all kept, now stated against the current engine):
//   1. Exactly ONE completion per turn: no hidden retry, no second author, no "Structural closure rejection".
//   2. An invalid artifact declaration can never destroy the Tutor's own reply (REAL DEFECT FOUND HERE: before 7.4.1
//      a reply whose every artifact piece was invalid was replaced by the generic fallback, discarding the Tutor).
//   3. Rejected declarations are reported (rejectedSignals + safe reason), never silently lost and never salvaged.
//   4. PDF / image side effects need an explicit Tutor trigger; native artifacts need native format and content.
//   5. A quiz whose key the system cannot prove stays a real tactile tutor_review (never a hard error, never a key).
//   6. Provider failure logs only class / status / code, and still answers; SDK retry options are not overridden.
//   7. No source content (history, student message, Tutor text) ever reaches the logs.
import assert from 'node:assert/strict'
process.env.OPENAI_MAIN_MODEL='gpt-5.6-sol'
import fs from 'node:fs'
import path from 'node:path'
import Module,{createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),ts=require('typescript')
const root=fileURLToPath(new URL('../',import.meta.url))
const originalResolve=Module._resolveFilename,originalLoad=Module._load
Module._resolveFilename=function(name,...rest){return originalResolve.call(this,name.startsWith('@/')?path.join(root,name.slice(2)):name,...rest)}
let queue=[],requests=[],logs=[],infoLogs=[],errorLogs=[]
class FakeOpenAI {chat={completions:{create:async(request,options)=>{
 requests.push({request,options});assert.ok(queue.length,'unexpected extra completion')
 const result=queue.shift();if(result instanceof Error)throw result;return request.stream?stream(result):completion(result)
}}}}
Module._load=function(name,...rest){if(name==='openai')return FakeOpenAI;return originalLoad.call(this,name,...rest)}
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file)
const {getMentorResponseStream}=require('../server/mentors/mentor-engine.ts')
const {fulfillArtifactSignals}=require('../server/core/artifact-side-effect.ts')
const {materializeNativeArtifact}=require('../server/core/native-artifact.ts')
const {DEFAULT_SESSION_STATE}=require('../lib/contracts.ts')
const quiz={type:'quiz',trigger:'explicit_user_request',subject:'SER y ESTAR',format:'native',content:{title:'SER y ESTAR',questions:[
 {question:'Ella ___ médica.',options:['es','está'],correct:0,explanation:'Profesión.'},
 {question:'María ___ en casa.',options:['es','está'],correct:1,explanation:'Ubicación.'},
 {question:'Nosotros ___ estudiantes.',options:['somos','estamos'],correct:0,explanation:'Identidad.'},
]}}
const REPLY='Responde tocando las opciones.'
const valid={reply:REPLY,artifacts:[quiz]}
const invalidPiece={...quiz,subject:'x'}
const message='Hazme un quiz táctil de tres preguntas sobre SER y ESTAR. No generes una imagen ni un PDF.'
const state={...DEFAULT_SESSION_STATE,mentorProfile:'Sarah',interfaceLanguage:'es',activeMode:'interact',tokens:2}
const params={request:{message,conversationHistory:[{role:'user',content:'PRIVATE_HISTORY'},{role:'assistant',content:'Contexto anterior'}]},state}
const FALLBACK='No pude procesar tu mensaje. Intenta de nuevo.'
function entries(raw){return raw?.envelope??[{name:'complete_tutor_turn',args:typeof raw==='string'?raw:JSON.stringify(raw)}]}
// 7.5: the provider reports the served model on every chunk (the product verifies it before publishing).
async function* stream(raw){for(const [index,c]of entries(raw).entries()){
 // Multiple chunks exercise the actual streaming prefix and buffering behavior.
 const mid=Math.floor(c.args.length/2)
 yield {model:'gpt-5.6-sol',choices:[{delta:{tool_calls:[{index,function:{name:c.name,arguments:c.args.slice(0,mid)}}]}}]}
 yield {model:'gpt-5.6-sol',choices:[{delta:{tool_calls:[{index,function:{arguments:c.args.slice(mid)}}]}}]}
}}
function completion(raw){return {choices:[{message:{tool_calls:entries(raw).map(c=>({type:'function',function:{name:c.name,arguments:c.args}}))}}]}}
const warn=console.warn, originalInfo=console.info, originalError=console.error
console.warn=(...args)=>logs.push(args)
console.info=(...args)=>infoLogs.push(args)
console.error=(...args)=>errorLogs.push(args)
async function run(output,input=params){queue=[output];requests=[];logs=[];infoLogs=[];errorLogs=[];const deltas=[];let error;const s=await getMentorResponseStream(input)
 try{for await(const d of s)deltas.push(d)}catch(e){error=e}
 // 1. one Tutor, one completion; nothing is left over and nothing extra was requested
 assert.equal(queue.length,0,'the single prescribed completion was consumed')
 assert.equal(requests.length,1,'exactly one completion per turn: no hidden retry, no second author')
 assert.equal(requests[0].options,undefined,'SDK retry behaviour is not overridden per request')
 assert.ok(!JSON.stringify(requests[0].request.messages).includes('Structural closure rejection'))
 // 7. no source content in any log line
 const wireLogs=JSON.stringify([logs,infoLogs,errorLogs])
 for(const secret of ['PRIVATE_DRAFT','PRIVATE_HISTORY','Contexto anterior',message,quiz.subject,REPLY])assert.ok(!wireLogs.includes(secret),'no source content in logs: '+secret)
 for(const [tag,json]of logs.filter(l=>l[0]==='[tutor-delivery]')){const entry=JSON.parse(json);assert.deepEqual(Object.keys(entry),['reason','hadText'])}
 return {text:deltas.join(''),deltas,signals:s.artifactSignals,rejected:s.rejectedSignals??0,failure:s.deliveryFailure,error,logs:[...logs],errors:[...errorLogs]}
}
let count=0
function pass(name){count++;process.stdout.write(`PASS ${name}\n`)}
try{
 // 1. a valid closure is delivered once, untouched
 let r=await run(valid);assert.equal(r.text,REPLY);assert.equal(r.deltas.length,1);assert.equal(r.error,undefined)
 assert.deepEqual(r.signals,[quiz]);assert.equal(r.rejected,0);assert.equal(r.failure,undefined)
 assert.equal(materializeNativeArtifact(r.signals[0])?.content.questions.length,3)
 pass('valid closure: one completion, one visible reply, native quiz materializes')

 // 2. REAL DEFECT FIXED IN 7.4.1: an invalid artifact declaration never destroys the Tutor's reply
 r=await run({reply:REPLY,artifacts:[invalidPiece]})
 assert.equal(r.text,REPLY,'the Tutor reply survives an invalid artifact piece')
 assert.notEqual(r.text,FALLBACK);assert.deepEqual(r.signals,[]);assert.equal(r.rejected,1);assert.equal(r.failure,'artifact_signal_rejected')
 pass('invalid artifact piece: reply delivered, piece dropped and reported, no retry')

 // 3. mixed pieces: the valid one is kept, the invalid one reported
 r=await run({reply:REPLY,artifacts:[invalidPiece,quiz]})
 assert.equal(r.text,REPLY);assert.deepEqual(r.signals,[quiz]);assert.equal(r.rejected,1)
 pass('mixed pieces: valid declaration kept, invalid one reported')

 // 4. side effects need an explicit Tutor trigger / native format and content
 const pdf={type:'emit_pdf',trigger:'explicit_user_request',subject:'Documento',format:'pdf'}
 const image={type:'emit_image',trigger:'explicit_user_request',subject:'Una cocina',format:'image'}
 for(const bad of [{...pdf,trigger:'pedagogical_completion'},{...image,trigger:'pedagogical_completion'},{...quiz,format:'pdf'},{...quiz,content:undefined}]){
  r=await run({reply:REPLY,artifacts:[bad]})
  assert.equal(r.text,REPLY);assert.deepEqual(r.signals,[]);assert.equal(r.rejected,1,JSON.stringify(bad.type+bad.trigger))
 }
 const gated=await fulfillArtifactSignals([{...pdf,trigger:'pedagogical_completion'},{...image,trigger:'pedagogical_completion'}],REPLY.repeat(40),state)
 assert.deepEqual(gated,{artifacts:[],failures:[]},'the real authorization boundary executes nothing without an explicit trigger')
 const native=await fulfillArtifactSignals([quiz],REPLY.repeat(40),state)
 assert.equal(native.artifacts.length,1);assert.equal(native.artifacts[0].type,'quiz');assert.deepEqual(native.failures,[])
 pass('PDF / image / native contracts: rejected declarations never execute; the Tutor reply is kept')

 // 5. unverified answer keys stay a real tactile review
 const reviewSignal={...quiz,content:{...quiz.content,questions:[
   {question:'La película ___ triste.',options:['es','está'],correct:0,explanation:'Ambiguous meaning.'},
   ...quiz.content.questions.slice(1),
 ]}}
 const reviewed=materializeNativeArtifact(reviewSignal)
 assert.equal(reviewed?.content?.gradingMode,'tutor_review');assert.equal(reviewed?.content?.questions[0].correct,0,'ambiguous SER key is never rewritten')
 r=await run({reply:'Quiz táctil con revisión pedagógica.',artifacts:[reviewSignal]})
 assert.equal(r.error,undefined);assert.equal(r.text,'Quiz táctil con revisión pedagógica.');assert.equal(r.signals.length,1)
 assert.equal(materializeNativeArtifact(r.signals[0])?.content?.gradingMode,'tutor_review')
 const missing={...quiz,content:{...quiz.content,questions:[{question:'María ___ en casa.',options:['es','son'],correct:0,explanation:'Correct option absent.'},...quiz.content.questions.slice(1)]}}
 assert.equal(materializeNativeArtifact(missing)?.content?.gradingMode,'tutor_review','a missing correct option is reviewed, not scored')
 pass('unverifiable key: tutor_review is delivered in the same single completion, no key invented')

 // 6. provider failure: safe log, graceful answer, SDK retry untouched
 const rawProviderError=Object.assign(new Error('PRIVATE_HISTORY provider secret'),{name:'RateLimitError',status:429,code:'rate_limit_exceeded'})
 r=await run(rawProviderError)
 assert.equal(r.text,FALLBACK);assert.equal(r.failure,'provider_unavailable')
 const providerEntry=r.errors.find(l=>l[0]==='[tutor-provider]')
 assert.deepEqual(JSON.parse(providerEntry[1]),{reason:'provider_unavailable',status:429,code:'rate_limit_exceeded',type:null,class:'RateLimitError'})
 pass('provider error: only class/status/code logged, fallback answer')

 // 7. malformed or empty closures degrade to a clear fallback without a retry
 for(const [cause,bad] of [['invalid_tool_json','{'],['invalid_tool_contract',{reply:'',artifacts:[]}],['unknown_tool',{envelope:[{name:'other',args:'{}'}]}]]){
  r=await run(bad)
  const reasons=r.logs.filter(l=>l[0]==='[tutor-delivery]').map(l=>JSON.parse(l[1]).reason)
  assert.ok(reasons.includes(cause),cause+' in '+reasons)
  assert.equal(r.text,FALLBACK)
 }
 // 7.5: two closures in one turn are merged (7.4 kept the first and dropped the second's artifacts).
 r=await run({envelope:[{name:'complete_tutor_turn',args:JSON.stringify(valid)},{name:'complete_tutor_turn',args:JSON.stringify(valid)}]})
 assert.equal(r.text,REPLY);assert.deepEqual(r.signals,[quiz],'identical closures deduplicated')
 const table={type:'table_matrix',trigger:'explicit_user_request',subject:'Tabla',format:'native',content:{title:'T',columns:['a','b'],rows:[['1','2']]}}
 r=await run({envelope:[{name:'complete_tutor_turn',args:JSON.stringify(valid)},{name:'complete_tutor_turn',args:JSON.stringify({artifacts:[table]})}]})
 assert.equal(r.text,REPLY);assert.deepEqual(r.signals.map(x=>x.type),['quiz','table_matrix'],'second closure no longer lost')
 pass('malformed closure / unknown tool: single completion, honest outcome; duplicate closures merged without loss')
}finally{console.warn=warn;console.info=originalInfo;console.error=originalError}
console.log(`PASS Gate B (7.4.1): ${count} scenarios against the current single-Tutor contract (mocked transport, real mentor generator and artifact guards)`)
