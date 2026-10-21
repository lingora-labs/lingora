// 7.3 structural barrier: the runtime never classifies the student's words.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const root=new URL('../',import.meta.url).pathname
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.name==='node_modules'||e.name==='.next'||e.name.startsWith('.')?[]:e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)])
const live=['app','server','lib'].flatMap(d=>walk(path.join(root,d))).filter(f=>/\.(ts|tsx)$/.test(f)&&!f.includes('/lib/engineering/'))
const legacy=['pdf-intent-authorization','explicit-delivery','quiz-intent-guard','document-contract','delivery-context','intent-router','intent-detector','core/orchestrator\'']
for(const f of live){
  const src=fs.readFileSync(f,'utf8')
  for(const l of legacy)assert.ok(!new RegExp(`from\\s+['"][^'"]*${l.replace('\'','')}['"]`).test(src),`${f} imports legacy ${l}`)
  assert.ok(!/function\s+is(?:Explicit|Conversation)\w*Request\b/.test(src),`${f} defines a word-list authorizer`)
}
for(const gone of ['lib/pdf-intent-authorization.ts','lib/explicit-delivery.ts','lib/quiz-intent-guard.ts','server/core/document-contract.ts','server/mentors/delivery-context.ts','server/core/orchestrator.ts','server/core/intent-router.ts','server/core/intent-detector.ts'])
  assert.ok(!fs.existsSync(path.join(root,gone)),gone+' must stay deleted')

// Tool contract
const {DELIVER_FROM_TEXT_TOOL,parseTextDelivery,ARTIFACT_CHANNEL_INSTRUCTION}=require('../lib/artifact-signal.ts')
assert.equal(DELIVER_FROM_TEXT_TOOL.function.name,'deliver_from_text')
assert.deepEqual(DELIVER_FROM_TEXT_TOOL.function.parameters.required,['kind','title'])
assert.deepEqual(parseTextDelivery({kind:'pdf_html',title:'Ser y estar'}),{kind:'pdf_html',title:'Ser y estar'})
assert.equal(parseTextDelivery({kind:'docx',title:'x'}),null)
assert.equal(parseTextDelivery({kind:'pdf',title:' '}),null)
assert.equal(parseTextDelivery(null),null)
assert.match(ARTIFACT_CHANNEL_INSTRUCTION,/deliver_from_text/)
assert.match(ARTIFACT_CHANNEL_INSTRUCTION,/Never say you cannot create or attach files/)

// Engine: Tutor decides (tool_choice auto), no regex on the message.
const mentor=fs.readFileSync(root+'server/mentors/mentor-engine.ts','utf8')
assert.match(mentor,/tool_choice:wantsVisualReview\?'none':'auto'/)
assert.match(mentor,/DELIVER_FROM_TEXT_TOOL/)
assert.ok(!/isExplicit/.test(mentor))
const stream=fs.readFileSync(root+'server/core/execution-engine-stream.ts','utf8')
assert.ok(stream.includes('stream.textDeliveries'))
console.log('PASS 7.3 — barrier: no word-list authorizers, no legacy router, tool contract')
