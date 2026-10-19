import assert from 'node:assert/strict'
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
const valid={reply:'Responde tocando las opciones.',artifacts:[quiz]}
const invalid={reply:'PRIVATE_DRAFT',artifacts:[{...quiz,subject:'x'}]}
const message='Hazme un quiz táctil de tres preguntas sobre SER y ESTAR. No generes una imagen ni un PDF.'
const state={...DEFAULT_SESSION_STATE,mentorProfile:'Sarah',interfaceLanguage:'es',activeMode:'interact',tokens:2}
const params={request:{message,conversationHistory:[{role:'user',content:'PRIVATE_HISTORY'},{role:'assistant',content:'Contexto anterior'}]},state}
function entries(raw){return raw?.envelope??[{name:'complete_tutor_turn',args:typeof raw==='string'?raw:JSON.stringify(raw)}]}
async function* stream(raw){for(const [index,c]of entries(raw).entries()){
 // Multiple chunks exercise the actual streaming prefix and buffering behavior.
 const mid=Math.floor(c.args.length/2)
 yield {choices:[{delta:{tool_calls:[{index,function:{name:c.name,arguments:c.args.slice(0,mid)}}]}}]}
 yield {choices:[{delta:{tool_calls:[{index,function:{arguments:c.args.slice(mid)}}]}}]}
}}
function completion(raw){return {choices:[{message:{tool_calls:entries(raw).map(c=>({type:'function',function:{name:c.name,arguments:c.args}}))}}]}}
const warn=console.warn, originalInfo=console.info, originalError=console.error
console.warn=(...args)=>logs.push(args)
console.info=(...args)=>infoLogs.push(args)
console.error=(...args)=>errorLogs.push(args)
async function run(outputs,input=params){queue=[...outputs];requests=[];logs=[];infoLogs=[];errorLogs=[];const deltas=[];let error;const stream=await getMentorResponseStream(input)
 try{for await(const d of stream)deltas.push(d)}catch(e){error=e}
 assert.equal(queue.length,0,'all and only prescribed completions consumed')
 assert.ok(requests.length<=3,'global two-extra-completions budget')
 for(const r of requests)assert.equal(r.options,undefined,'restore SDK default retry behavior for transient HTTP errors')
 const wireLogs=JSON.stringify([logs,infoLogs,errorLogs])
 for(const secret of ['PRIVATE_DRAFT','PRIVATE_HISTORY',message,quiz.subject])assert.ok(!wireLogs.includes(secret),'no source content in logs')
 for(const [tag,json]of logs.filter(l=>l[0]==='[tutor-closure]')){const entry=JSON.parse(json);assert.deepEqual(Object.keys(entry),['cause','artifactCount','artifactTypes']);assert.ok(entry.cause)}
 return {text:deltas.join(''),deltas,signals:stream.artifactSignals,error,requests:[...requests],logs:[...logs],infos:[...infoLogs],errors:[...errorLogs]}
}
let count=0
function pass(name){count++;process.stdout.write(`PASS ${name}\n`)}
try{
 let r=await run([invalid,valid]);assert.equal(r.text,valid.reply);assert.equal(r.deltas.length,1);assert.equal(r.error,undefined);assert.deepEqual(r.signals,[quiz]);assert.equal(r.requests.length,2)
 const [initial,retry]=r.requests.map(x=>x.request)
 for(const key of ['model','temperature','top_p','max_tokens','max_completion_tokens','tools','tool_choice'])assert.deepEqual(retry[key],initial[key])
 assert.deepEqual(retry.messages.slice(0,-1),initial.messages)
 assert.deepEqual(retry.messages.at(-1),{role:'system',content:'Structural closure rejection: bad_subject:0'})
 assert.equal(JSON.parse(r.logs[0][1]).cause,'bad_subject:0')
 assert.equal(materializeNativeArtifact(r.signals[0])?.content.questions.length,3)
 pass('buffered recovery: same Tutor/model/system/history/context; one visible reply; structured safe log')
 r=await run([valid]);assert.equal(r.text,valid.reply);assert.equal(r.requests.length,1);pass('valid closure incurs no retry')
 const reviewSignal={...quiz,content:{...quiz.content,questions:[
   {question:'La película ___ triste.',options:['es','está'],correct:0,explanation:'Ambiguous meaning.'},
   ...quiz.content.questions.slice(1),
 ]}}
 const reviewTurn={reply:'Quiz táctil con revisión pedagógica.',artifacts:[reviewSignal]}
 const reviewMaterialized=materializeNativeArtifact(reviewSignal)
 assert.equal(reviewMaterialized?.content?.gradingMode,'tutor_review')
 assert.equal(reviewMaterialized?.content?.questions[0].correct,0,
   'ambiguous SER key must not be rewritten')
 r=await run([reviewTurn,valid])
 assert.equal(r.error,undefined)
 assert.equal(r.text,valid.reply)
 assert.deepEqual(r.signals,[quiz])
 assert.equal(r.requests.length,2,'at most one semantic recovery for a review-only quiz')
 assert.match(r.requests[1].request.messages.at(-2).content,/quiz_review_only:unverified_copula_cloze:0/)
 assert.doesNotMatch(r.requests[1].request.messages.at(-2).content,/correctedIndex|correctedKey|expectedForm/)
 assert.equal(JSON.parse(r.infos.find(l=>l[0]==='[quiz-grading]')[1]).gradingMode,'auto')
 pass('review-only quiz attempts SAME Tutor with code and index, no expected answer or key')
 r=await run([reviewTurn,reviewTurn])
 assert.equal(r.error,undefined)
 assert.equal(r.text,reviewTurn.reply)
 assert.equal(r.requests.length,2)
 assert.equal(materializeNativeArtifact(r.signals[0])?.content?.gradingMode,'tutor_review')
 assert.equal(JSON.parse(r.infos.find(l=>l[0]==='[quiz-grading]')[1]).gradingMode,'tutor_review')
 pass('unverified recovery remains a real tactile tutor_review, never a hard error')
 r=await run([reviewTurn,invalid])
 assert.equal(r.error,undefined)
 assert.equal(r.text,reviewTurn.reply)
 assert.equal(materializeNativeArtifact(r.signals[0])?.content?.gradingMode,'tutor_review')
 pass('invalid OPTIONAL semantic closure cannot destroy an original valid tutor_review quiz')
 const missingSignal={...quiz,content:{...quiz.content,questions:[
   {question:'María ___ en casa.',options:['es','son'],correct:0,explanation:'Correct option absent.'},
   ...quiz.content.questions.slice(1),
 ]}}
 r=await run([{reply:'Quiz con opción ausente',artifacts:[missingSignal]},valid])
 assert.match(r.requests[1].request.messages.at(-2).content,/quiz_review_only:missing_or_ambiguous_correct_option:0/)
 assert.equal(r.requests.length,2)
 pass('missing-or-ambiguous correct option yields code/index, not fabricated score')
 r=await run([invalid,reviewTurn,valid])
 assert.equal(r.text,valid.reply)
 assert.equal(r.requests.length,3,'structural and semantic one each, two extra total')
 pass('structural plus semantic tutor recovery shares global two-completion limit')
 const rawProviderError=Object.assign(new Error('PRIVATE_HISTORY provider secret'),
   {name:'RateLimitError',status:429,code:'rate_limit_exceeded'})
 r=await run([rawProviderError])
 assert.ok(r.text.length>0)
 const providerEntry=r.errors.find(l=>l[0]==='[tutor-provider]')
 assert.deepEqual(JSON.parse(providerEntry[1]),{
   errorClass:'RateLimitError',httpStatus:429,providerCode:'rate_limit_exceeded'
 })
 assert.equal(r.requests.length,1)
 pass('outer provider catch logs only safe class/status/code and keeps fallback')

 const ordinary={...params,request:{...params.request,message:'Explícame la diferencia.'}}
 r=await run([invalid],ordinary);assert.ok(r.error);assert.equal(r.text,'PRIVATE_DRAFT');assert.equal(r.requests.length,1);assert.deepEqual(r.signals,[]);pass('visible text forbids retry and no artifact is salvaged')
 r=await run([{reply:'',artifacts:[]},{reply:'Respuesta completa',artifacts:[]}],ordinary);assert.equal(r.text,'Respuesta completa');assert.equal(r.deltas.length,1);pass('unbuffered empty emission permits exactly one recovery')
 r=await run([invalid,invalid]);assert.ok(r.error?.message.includes('no artifacts delivered'));assert.equal(r.text,'');assert.deepEqual(r.signals,[]);assert.equal(r.logs.length,2);pass('second structural failure is honest and publishes no partial turn')
 r=await run([invalid,new Error('PRIVATE_DRAFT')]);assert.ok(r.error);assert.equal(r.text,'');pass('retry transport failure is honest and sanitized')
 r=await run([invalid,{reply:'Explicación sin quiz',artifacts:[]},valid]);assert.equal(r.text,valid.reply);assert.equal(r.requests.length,3);pass('structural plus semantic recovery uses exactly two additional completions')
 r=await run([invalid,{reply:'Sin quiz',artifacts:[]},invalid]);assert.equal(r.error,undefined);assert.equal(r.text,'Sin quiz');assert.deepEqual(r.signals,[]);assert.equal(r.requests.length,3);pass('invalid optional semantic revision preserves the structurally valid tutor turn within global budget')
 for(const [cause,bad]of [['closure_json_invalid','{'],['closure_count',{envelope:[]}],['closure_type',{envelope:[{name:'other',args:'{}'}]}],['closure_count',{envelope:[{name:'complete_tutor_turn',args:'{}'},{name:'complete_tutor_turn',args:'{}'}]}]]){
  r=await run([bad,valid]);assert.equal(r.text,valid.reply);assert.equal(JSON.parse(r.logs[0][1]).cause,cause);pass(cause+' envelope recovery')
 }
 const pdf={type:'emit_pdf',trigger:'explicit_user_request',subject:'Documento',format:'pdf'}
 const image={type:'emit_image',trigger:'explicit_user_request',subject:'Una cocina',format:'image'}
 r=await run([invalid,{...valid,artifacts:[quiz,pdf,image]}]);assert.ok(!r.signals.some(s=>s.type==='emit_pdf'))
 // Use the actual downstream authorization boundary; generator execution would fail this credential-free test.
 const materialized=await fulfillArtifactSignals(r.signals,r.text,state,message)
 assert.equal(materialized.artifacts.length,1);assert.equal(materialized.artifacts[0].type,'quiz');assert.deepEqual(materialized.failures,[])
 pass('real PDF and image authorization gates reject unrequested side effects after retry')
 for(const signal of [{...pdf,trigger:'pedagogical_completion'},{...image,trigger:'pedagogical_completion'},{...quiz,format:'pdf'},{...quiz,content:undefined}]){
  r=await run([invalid,{...valid,artifacts:[signal]}]);assert.ok(r.error);assert.equal(r.text,'');assert.deepEqual(r.signals,[])
 }
 pass('retry retains PDF/image/native structural contracts; no partial artifact salvage')
}finally{console.warn=warn;console.info=originalInfo;console.error=originalError}
console.log(`PASS Gate B: ${count} recovery scenarios (mocked transport, actual mentor generator and artifact guards)`)
