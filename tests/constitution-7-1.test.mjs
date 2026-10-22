// LINGORA Constitution 7.1 (arts. 47-52, conciliated reform approved 16 Oct 2026) — acceptance gate.
// Replaces the 7.0 "central authority" gate. It certifies the NEW split:
//   * cognitive authority = the Tutor Maestro, from the first turn (nothing in the runtime reads intent);
//   * the runtime plan is INSTRUMENTAL: explicit UI operations, diagnostics, structural invariants.
// Determinism here applies to plans, state and delivery — never to the Tutor's wording (art. 52).
// C71-01..C71-06 are semantic contracts: they assert behaviour, not literal phrases.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const {orchestrateTutorFirst}=require('../server/core/tutor-first-orchestrator.ts')
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8')
const base={activeMode:'interact',mentorProfile:'Sarah',tokens:0,userLevel:'A2',confirmedLevel:'A2'}
const plan=(message,state={},uiAction)=>orchestrateTutorFirst({message,state:{...base,...state},interfaceLanguage:'es',uiAction})
const MESSAGES=['Hola','Háblame de acupuntura y los meridianos','Historia de la Roma republicana','Traduce al inglés: ayer fui al mercado','Corrige esto: Yo soy cansado','Hazme un gráfico de barras con estos datos','Cancela el PDF y mejor dame una tabla','Explícame la mecánica cuántica']
const MODES=['interact','structured','pdf_course','free']

// ---- C71-01 Tutor Maestro from the first turn: no gate decides before the Tutor ----
for(const m of MESSAGES)for(const mentor of ['Alex','Sarah','Nick']){
  const p=plan(m,{mentorProfile:mentor,tokens:0})
  assert.equal(p.executor,'mentor','first-turn conversation goes to the Tutor: '+m)
  assert.equal(p.pedagogicalAction,'conversation');assert.equal(p.blocking,false)
  assert.equal(p.executionOrder.length,1,'no pre-Tutor step');assert.deepEqual(p.artifacts,[],'the runtime pre-selects no artifact')
}
// the runtime plan never depends on what the message MEANS
const shape=p=>JSON.stringify({e:p.executor,a:p.pedagogicalAction,b:p.blocking,pr:p.priority,o:p.executionOrder.map(s=>[s.order,s.executor,s.action])})
assert.equal(new Set(MESSAGES.map(m=>shape(plan(m)))).size,1,'identical instrumental plan for every message: intent is read by the Tutor only')

// ---- C71-02 domain freedom: no domain is inferred, gated or redirected by the runtime ----
for(const m of ['Háblame de acupuntura','Historia de Roma','Cómo funciona un transistor','Receta de paella']){
  const cp=plan(m).executionOrder[0].params.contextPack
  assert.equal(cp.domain,null,'runtime does not label the domain of: '+m)
  assert.equal(cp.pedagogicalGoal,null);assert.equal(cp.artifactGoal,null)
}

// ---- C71-03 new intent prevails over any mode, pending contract or earlier flow ----
for(const mode of MODES)for(const m of MESSAGES){
  const p=plan(m,{activeMode:mode,pendingDocumentRequest:{subject:'Curso',artifactType:'course_pdf'}})
  assert.equal(p.executor,'mentor','mode '+mode+' cannot capture the turn');assert.equal(p.pedagogicalAction,'conversation')
  assert.equal(p.clearDocumentContract,true,'a stale pending request is cleared, never obeyed')
}
const pre=read('server/core/tutor-first-plan.ts')
for(const bad of ['directFormatFor','CORRECTION_ONLY','TRANSLATION_ONLY','correction_only','translation_only'])assert.ok(!pre.includes(bad),'tutor-first-plan must not pre-select '+bad)
assert.ok(!fs.existsSync(new URL('../lib/direct-intent-contract.ts',import.meta.url)),'no regex intent classifier with rewriting power')

// ---- C71-04 non-cognitive instrumental denial: a failed or refused tool never silences or rewrites the Tutor ----
const chain=JSON.parse(read('package.json')).scripts.build
for(const t of ['tutor-7-3-barrier','delivery-retry-7-4-1','chart-fidelity-7-4-2','native-schema-contract','visual-export-contract','tutor-7-2-contracts'])assert.ok(chain.includes(t),'build chain keeps the instrumental-denial test '+t)
const stream=read('server/core/execution-engine-stream.ts')
assert.ok(/fullText \+= delta[\s\S]{0,400}emit\(\{ delta \}\)/.test(stream),'Tutor text is streamed untouched')
assert.ok(/fulfillArtifactSignals\(/.test(stream),'declared instruments are fulfilled after the reply, not instead of it')
const {materializeNativeArtifact}=require('../server/core/native-artifact.ts')
assert.equal(materializeNativeArtifact({type:'chart',trigger:'explicit_user_request',subject:'x',format:'native',content:{title:'t',categories:['a','b'],panels:[{kind:'bar',title:'p',values:[1]}]}}),null,'unfaithful instrument is refused without inventing a result')

// ---- C71-05 direct UI actions run their instrument and never regenerate the explanation ----
for(const action of ['export_chat_pdf','download_pdf','hear_audio']){
  const p=plan('Some user message',{},action)
  assert.equal(p.blocking,true);assert.notEqual(p.executor,'mentor','UI action '+action+' must not call the Tutor');assert.equal(p.executionOrder.length,1)
  assert.match(p.executor,/^tool_/);assert.equal(p.skipPhaseAdvance,true,'a button press is not a learning turn')
}
assert.throws(()=>plan('x',{},'unlisted'),/unauthorized UI operation/)
const entry=read('server/api/chat-entry.ts')
assert.ok(entry.indexOf("body.uiAction === 'retry_delivery'")>-1&&entry.indexOf("body.uiAction === 'retry_delivery'")<entry.indexOf('executePlanStream('),'retry_delivery is served before any Tutor turn')

// ---- C71-06 one Tutor, one state: planning is pure and never changes mentor, language, level or progress ----
for(const mode of MODES){
  const st={...base,activeMode:mode,mentorProfile:'Nick',tokens:7,explanatoryLanguage:'ar',lastConcept:'SER/ESTAR'}
  const snapshot=JSON.stringify(st)
  const runs=Array.from({length:50},()=>orchestrateTutorFirst({message:'Hola',state:st,interfaceLanguage:'es'}))
  assert.equal(JSON.stringify(st),snapshot,'planning must not mutate session state')
  assert.ok(runs.every(r=>JSON.stringify(r)===JSON.stringify(runs[0])),'same input, same plan')
  assert.equal(runs[0].executor,'mentor')
}
assert.deepEqual([...new Set(['Alex','Sarah','Nick'].map(m=>plan('Hola',{mentorProfile:m}).executor))],['mentor'],'the chosen Tutor is the same executor in every manifestation')

// ---- Instrumental safeguards kept from the 7.0 gate (they restrict tools, not the Tutor) ----
for(const d of ['*1357*#','*2468*#']){const p=plan(d);assert.equal(p.executor,'diagnostic');assert.equal(p.executionOrder.length,1)}
const route=read('app/api/chat/route.ts'),orch=read('server/core/tutor-first-orchestrator.ts')
assert.ok(route.split('\n').length<150&&route.includes("from '../../../server/api/chat-entry'"),'route is a thin adapter')
assert.ok(orch.includes('assertExecutionPlan'));assert.ok(entry.includes('validateStateInvariants(baseState)')&&entry.includes('repairState(baseState, validation.errors)'))
assert.ok(!entry.includes('buildTutorFirstPlan(')&&!entry.includes('orchestrate(testCtx)'),'no planner bypass in the entry')

// ---- 7.0 doctrine must not come back (ledger of discards) ----
for(const [f,src] of [['chat-entry',entry],['orchestrator',orch],['route',route]]){
  assert.ok(!/orchestratorActive/.test(src),f+': no sovereign-orchestrator flag')
  assert.ok(!/SOLE DECISION AUTHORITY|central cognitive|decide WHO answers/i.test(src),f+': no 7.0 sovereignty wording')
}
assert.match(entry,/cognitiveAuthority:\s*'tutor-maestro'/);assert.match(entry,/instrumentalPlanActive:\s*true/)
assert.match(orch,/sole cognitive authority/);assert.match(orch,/7\.1/)
console.log('PASS — Constitution 7.1 gate: C71-01..06 (Tutor from turn 1, domain freedom, new intent prevails, instrumental denial, direct UI actions, one Tutor/state) + instrumental safeguards')
