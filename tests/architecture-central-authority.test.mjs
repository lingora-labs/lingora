// ARCH-9.11 arts 47–52 acceptance preflight.
// Full browser parity remains a separate requirement.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import Module, {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const ts=require('typescript')
require.extensions['.ts']=(mod,filename)=>{
 const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
 }).outputText
 mod._compile(compiled,filename)
}
const original=Module._load
// Stub the pure Tutor Maestro plan only. We test execution AUTHORITY and
// invariants independently, without calling any model or tool side effect.
Module._load=function(request,parent,isMain){
 if(request==='./tutor-first-plan'){
  return {buildTutorFirstPlan:(message,state,language)=>({
   executor:'mentor',priority:10,blocking:false,skipPhaseAdvance:true,
   pedagogicalAction:'conversation',artifacts:[],
   reason:'One cognitive tutor, one explicit action plan',
   executionOrder:[{order:1,executor:'mentor',action:'conversation',params:{message,language,mode:state.activeMode}}],
  })}
 }
 return original.apply(this,arguments)
}
const {orchestrateTutorFirst}=require('../server/core/tutor-first-orchestrator.ts')
Module._load=original
const st={activeMode:'interact',mentorProfile:'Sarah',tokens:2}
for(const action of [undefined,'export_chat_pdf','download_pdf','hear_audio']){
 const inp={message:'Some user message',state:st,interfaceLanguage:'es',uiAction:action}
 const runs=Array.from({length:30},()=>orchestrateTutorFirst(inp))
 assert.ok(runs.every(x=>JSON.stringify(x)===JSON.stringify(runs[0])),'plan must be deterministic')
 const p=runs[0]
 assert.ok(p.reason?.length>10)
 assert.ok(p.executionOrder.length>0)
 assert.equal(p.executor,p.executionOrder[0].executor)
 assert.equal(p.blocking,Boolean(action))
 assert.equal(p.executionOrder[0].order,1)
}
for(const diagnostic of ['*1357*#','*2468*#']){
 const a=orchestrateTutorFirst({message:diagnostic,state:st,interfaceLanguage:'es'})
 assert.equal(a.executor,'diagnostic')
 assert.equal(a.pedagogicalAction,'diagnostic_assessment')
 assert.equal(a.executionOrder.length,1)
}
const convo=orchestrateTutorFirst({message:'Hola',state:st,interfaceLanguage:'es'})
assert.equal(convo.executor,'mentor')
assert.equal(convo.pedagogicalAction,'conversation')
assert.throws(()=>orchestrateTutorFirst({message:'Hola',state:st,interfaceLanguage:'es',uiAction:'unlisted'}),/unauthorized UI operation/)
const nextRoute=fs.readFileSync(new URL('../app/api/chat/route.ts',import.meta.url),'utf8')
const entry=fs.readFileSync(new URL('../server/api/chat-entry.ts',import.meta.url),'utf8')
const orchestrator=fs.readFileSync(new URL('../server/core/tutor-first-orchestrator.ts',import.meta.url),'utf8')
assert.ok(nextRoute.split('\n').length<150,'route must be thinner than 150 LOC')
assert.ok(nextRoute.includes("from '../../../server/api/chat-entry'"),'route delegates')
assert.ok(entry.includes('const plan=orchestrateTutorFirst({'),'each live turn receives central plan')
assert.ok(entry.includes("const preflightPlan=orchestrateTutorFirst({"),'diagnostic must receive central plan')
assert.ok(entry.includes('orchestratorActive: true'),'diagnostic reports real central plan')
assert.ok(!entry.includes('buildTutorFirstPlan('),'no direct plan bypass in entry')
assert.ok(!entry.includes('orchestrate(testCtx)'),'no obsolete hidden routing in diagnostics')
assert.ok(orchestrator.includes('assertExecutionPlan'))
assert.ok(entry.includes('validateStateInvariants(baseState)')&&entry.includes('repairState(baseState, validation.errors)'))
console.log('PASS — ARCH-9.11 deterministic central plan, atomic blocking, route <150, state invariants, no live planner bypass')
