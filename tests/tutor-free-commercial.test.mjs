// No grammar template and no forced tool on ordinary turns.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require=createRequire(import.meta.url)
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(require('node:fs').readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {commercialContextForTurn,recordedImmersionOfferPatch}=require('../server/core/commercial-context.ts')
const state={activeMode:'interact',tokens:3,sessionId:'student-session',commercialOffers:[],interfaceLanguage:'es'}
const context=commercialContextForTurn('Quiero practicar',state)
assert.match(context,/immersion/)
assert.equal(recordedImmersionOfferPatch(state,'Respuesta pedagógica').commercialOffers,undefined)
const now=Date.now()
const patch=recordedImmersionOfferPatch(state,'Puedes explorar /immersion.',now)
assert.equal(patch.commercialOffers.length,1)
assert.doesNotMatch(commercialContextForTurn('Continuemos',{...state,commercialOffers:patch.commercialOffers}),/MAY naturally mention/)
console.info('Tutor-first commercial contextual contract: PASS')
