// ORDEN AE 7.4.1 §6 — "Reintentar entrega" must not duplicate messages nor leave inconsistent artifacts.
// Before: the retry re-sent the student's text as a NEW bubble and ran a whole new Tutor turn (a second, possibly
// different, authored answer + a second set of artifacts). Now: it repeats only the DELIVERY of the material the Tutor
// already wrote, and updates the message that failed. Run: node tests/delivery-retry-7-4-1.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file)
const root=new URL('../',import.meta.url).pathname
const {applyDeliveryRetry}=require('../app/beta/beta-model.ts')

const retryAction={type:'retry_delivery',action:'retry_delivery',label:'Reintentar entrega',payload:{signals:[{type:'emit_pdf',trigger:'explicit_user_request',subject:'SER y ESTAR',format:'pdf_html'}]}}
const exportAction={type:'export_chat_pdf',action:'export_chat_pdf',label:'Exportar PDF'}
const thread=[
  {id:'u1',sender:'user',text:'Quiero una ficha PDF y HTML sobre SER y ESTAR'},
  {id:'s1',sender:'sarah',text:'# SER y ESTAR\n\nMaterial completo del Tutor…',artifact:null,artifacts:null,
   artifactFailures:[{subject:'SER y ESTAR (PDF y HTML no disponibles)'}],suggestedActions:[retryAction,exportAction]},
]
const pdf={type:'pdf',url:'data:application/pdf;base64,AAAA',title:'SER y ESTAR',webUrl:'data:text/html;base64,BBBB'}

// success: same message updated, nothing appended, failure and retry action gone, other actions kept
let next=applyDeliveryRetry(thread,'s1',{artifacts:[pdf],suggestedActions:[]})
assert.equal(next.length,thread.length,'no new message of any kind')
assert.deepEqual(next[0],thread[0],'the student bubble is untouched')
assert.equal(next[1].text,thread[1].text,'the Tutor text is untouched: it is NOT re-authored')
assert.deepEqual(next[1].artifacts,[pdf]);assert.equal(next[1].artifactFailures,null)
assert.deepEqual(next[1].suggestedActions,[exportAction])
// idempotent: applying the same result again (double tap, replay) cannot duplicate the artifact
const again=applyDeliveryRetry(next,'s1',{artifacts:[pdf],suggestedActions:[]})
assert.equal(again[1].artifacts.length,1,'one artifact, not two');assert.deepEqual(again,next)
// repeated failure: the failure stays visible and the retry stays available, still one message
const failed=applyDeliveryRetry(thread,'s1',{artifactFailures:[{subject:'SER y ESTAR (PDF y HTML no disponibles)'}],suggestedActions:[retryAction]})
assert.equal(failed.length,thread.length);assert.equal(failed[1].artifactFailures.length,1)
assert.ok(failed[1].suggestedActions.some(a=>a.action==='retry_delivery'));assert.equal(failed[1].artifacts,null)
// a retry of another message cannot touch this one
assert.deepEqual(applyDeliveryRetry(thread,'other',{artifacts:[pdf]}),thread)
// artifacts that already succeeded in the same turn survive a retry of a sibling
const sibling={type:'quiz',content:{title:'Q'}}
const mixed=applyDeliveryRetry([{...thread[1],artifacts:[sibling]}],'s1',{artifacts:[pdf]})
assert.deepEqual(mixed[0].artifacts,[sibling,pdf])

// contracts in code
const stream=fs.readFileSync(root+'server/core/execution-engine-stream.ts','utf8')
assert.match(stream,/retrySignals\.length && artifactFailures\.length \? \[\{type:'retry_delivery'/,'retry is offered only when a PDF declaration can be repeated')
assert.match(stream,/payload:\{signals:retrySignals\}/,'the retry carries the Tutor\'s own typed declarations, not the student text')
const entry=fs.readFileSync(root+'server/api/chat-entry.ts','utf8')
const branch=entry.slice(entry.indexOf("body.uiAction === 'retry_delivery'"),entry.indexOf("body.uiAction && !(['export_chat_pdf'"))
assert.ok(branch.length>300,'dedicated server branch')
assert.ok(!/getMentorResponse|executePlan|orchestrateTutorFirst|OpenAI|openai/.test(branch),'the retry never reaches the Tutor or any model')
assert.match(branch,/parseClosedTutorTurn/,'declarations are re-validated server-side');assert.match(branch,/filter\(sig => sig\.type === 'emit_pdf'\)/)
assert.match(branch,/text\.length > 50000/,'bounded input')
const hook=fs.readFileSync(root+'app/beta/use-beta-page.ts','utf8')
const handler=hook.slice(hook.indexOf("if (actionKey === 'retry_delivery') {"),hook.indexOf("if (!['export_chat_pdf', 'download_pdf', 'hear_audio'].includes(actionKey)) {"))
assert.ok(handler.length>300);assert.ok(!/addMsg\(/.test(handler),'a retry adds no bubble')
assert.match(handler,/retryTargetId: target\.id/);assert.match(handler,/rewindToLastUser: true/)
assert.match(hook,/applyDeliveryRetry\(msgsRef\.current, opts\.retryTargetId, data\)/,'result is applied in place')
assert.match(hook,/lastIndexOf\('user'\)/,'the re-ask path stops the history before the student message it repeats')
const contracts=fs.readFileSync(root+'lib/contracts.ts','utf8')
assert.match(contracts,/'retry_delivery';\n?\s*\/\/ Material currently visible/);assert.match(contracts,/retrySignals\?: unknown\[\]/)
console.log('PASS 7.4.1 — delivery retry: in place, idempotent, no new bubble, no new Tutor turn, no model call')
