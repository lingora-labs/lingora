import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const {DEFAULT_SESSION_STATE}=require('../lib/contracts.ts')
const {orchestrateTutorFirst}=require('../server/core/tutor-first-orchestrator.ts')
const {isExplicitQuizRequest}=require('../lib/quiz-intent-guard.ts')
const {isPdfProhibitedByUser}=require('../lib/pdf-intent-authorization.ts')
const {MODE_UI_COPY}=require('../app/beta/beta-model.ts')
const s={...DEFAULT_SESSION_STATE,interfaceLanguage:'ar',activeMode:'structured',tokens:4,mentorProfile:'Sarah'}
const quiz='Convierte esa explicación en un quiz táctil de tres preguntas. Quiero responder tocando opciones, sin PDF.'
assert.equal(isExplicitQuizRequest(quiz),true)
assert.equal(isPdfProhibitedByUser(quiz),true)
assert.equal(orchestrateTutorFirst({message:quiz,state:s,interfaceLanguage:'ar'}).executor,'mentor')
const dual='Prepara un material autónomo para mí, Zakia, sobre SER y ESTAR aplicado a cocina y al DELE A2, con explicación en árabe, ejemplos en español, ejercicios y soluciones. Necesito PDF y versión web en este mismo turno.'
const plan=orchestrateTutorFirst({message:dual,state:s,interfaceLanguage:'ar'})
assert.equal(plan.documentContractReady,true)
assert.equal(plan.documentContractUpdate?.format,'pdf_html')
assert.equal(plan.documentContractUpdate?.level,'A2')
assert.match(plan.documentContractUpdate?.topic??'',/SER y ESTAR/)
assert.equal(MODE_UI_COPY.ar.modes.length,4)
for(const lang of ['es','en','no','fr','de','it','pt','ar','ja','zh'])assert.equal(MODE_UI_COPY[lang].modes.length,4)
const stream=fs.readFileSync(new URL('../server/core/execution-engine-stream.ts',import.meta.url),'utf8')
assert.ok(stream.includes('!isExplicitQuizRequest(request.message)'))
assert.ok(stream.includes("format: plan.documentContractUpdate.format ?? 'pdf'"))
console.log('PASS — 7.1 P1 planning/guards; UI retest still required')
