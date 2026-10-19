// No grammar template and no forced tool on ordinary turns.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require=createRequire(import.meta.url)
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(require('node:fs').readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
process.env.AWS_REGION='us-east-1'
process.env.S3_BUCKET='lingora-test-nonexistent'
process.env.AWS_ACCESS_KEY_ID='test-key-only'
process.env.AWS_SECRET_ACCESS_KEY='test-secret-only'
const {commercialContextForTurn,recordedImmersionOfferPatch}=require('../server/core/commercial-context.ts')
const state={activeMode:'interact',tokens:3,sessionId:'student-session',commercialOffers:[],interfaceLanguage:'es'}
const context=commercialContextForTurn('Quiero practicar',state)
assert.match(context,/immersion/)
assert.equal(recordedImmersionOfferPatch(state,'Respuesta pedagógica').commercialOffers,undefined)
const now=Date.now()
const patch=recordedImmersionOfferPatch(state,'Puedes explorar /immersion.',now)
assert.equal(patch.commercialOffers,undefined,'DAE privacy gate must keep PII collection closed')
assert.doesNotMatch(commercialContextForTurn('Continuemos',{...state,commercialOffers:[]}),/MAY naturally mention/)
const fs=require('node:fs')
const mentor=fs.readFileSync(new URL('../server/mentors/mentor-engine.ts',import.meta.url),'utf8')
const stream=fs.readFileSync(new URL('../server/core/execution-engine-stream.ts',import.meta.url),'utf8')
assert.match(mentor,/tool_choice: mustDeliver/)
assert.match(mentor,/: 'auto'/)
assert.doesNotMatch(mentor,/Structural closure rejection/)
assert.doesNotMatch(stream,/evaluateCommercial\(/)
assert.doesNotMatch(stream,/groundedMilestoneReview\(/)
console.info('Tutor-first commercial contextual contract: PASS')
