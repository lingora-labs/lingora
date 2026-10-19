import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import Module,{createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url),ts=require('typescript')
const root=fileURLToPath(new URL('../',import.meta.url))
const originalResolve=Module._resolveFilename,originalLoad=Module._load
Module._resolveFilename=function(name,...rest){return originalResolve.call(this,name.startsWith('@/')?path.join(root,name.slice(2)):name,...rest)}
let queue=[],requests=[],logs=[]
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
const warn=console.warn
console.warn=(...args)=>logs.push(args)
async function run(outputs,input=params){queue=[...outputs];requests=[];logs=[];const deltas=[];let error;const stream=await getMentorResponseStream(input)
 try{for await(const d of stream)deltas.push(d)}catch(e){error=e}
 assert.equal(queue.length,0,'all and only prescribed completions consumed')
 assert.ok(requests.length<=3,'global two-extra-completions budget')
 for(const r of requests)assert.deepEqual(r.options,{maxRetries:0},'no hidden SDK retry')
 const wireLogs=JSON.stringify(logs)
 for(const secret of ['PRIVATE_DRAFT','PRIVATE_HISTORY',message,quiz.subject])assert.ok(!wireLogs.includes(secret),'no source content in logs')
 for(const [tag,json]of logs.filter(l=>l[0]==='[tutor-closure]')){const entry=JSON.parse(json);assert.deepEqual(Object.keys(entry),['cause','artifactCount','artifactTypes']);assert.ok(entry.cause)}
 return {text:deltas.join(''),deltas,signals:stream.artifactSignals,error,requests:[...requests],logs:[...logs]}
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
 const ordinary={...params,request:{...params.request,message:'Explícame la diferencia.'}}
 r=await run([invalid],ordinary);assert.ok(r.error);assert.equal(r.text,'PRIVATE_DRAFT');assert.equal(r.requests.length,1);assert.deepEqual(r.signals,[]);pass('visible text forbids retry and no artifact is salvaged')
 r=await run([{reply:'',artifacts:[]},{reply:'Respuesta completa',artifacts:[]}],ordinary);assert.equal(r.text,'Respuesta completa');assert.equal(r.deltas.length,1);pass('unbuffered empty emission permits exactly one recovery')
 r=await run([invalid,invalid]);assert.ok(r.error?.message.includes('no artifacts delivered'));assert.equal(r.text,'');assert.deepEqual(r.signals,[]);assert.equal(r.logs.length,2);pass('second structural failure is honest and publishes no partial turn')
 r=await run([invalid,new Error('PRIVATE_DRAFT')]);assert.ok(r.error);assert.equal(r.text,'');pass('retry transport failure is honest and sanitized')
 r=await run([invalid,{reply:'Explicación sin quiz',artifacts:[]},valid]);assert.equal(r.text,valid.reply);assert.equal(r.requests.length,3);pass('structural plus semantic recovery uses exactly two additional completions')
 r=await run([invalid,{reply:'Sin quiz',artifacts:[]},invalid]);assert.ok(r.error);assert.equal(r.text,'');assert.deepEqual(r.signals,[]);assert.equal(r.requests.length,3);pass('invalid final semantic closure cannot exceed global budget or deliver partial content')
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
}finally{console.warn=warn}
console.log(`PASS Gate B: ${count} recovery scenarios (mocked transport, actual mentor generator and artifact guards)`)
