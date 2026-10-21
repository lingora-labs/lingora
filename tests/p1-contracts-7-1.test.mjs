import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const {DEFAULT_SESSION_STATE}=require('../lib/contracts.ts')
const {orchestrateTutorFirst}=require('../server/core/tutor-first-orchestrator.ts')
const {MODE_UI_COPY}=require('../app/beta/beta-model.ts')
const s={...DEFAULT_SESSION_STATE,interfaceLanguage:'ar',activeMode:'structured',tokens:4,mentorProfile:'Sarah'}
const quiz='Convierte esa explicación en un quiz táctil de tres preguntas. Quiero responder tocando opciones, sin PDF.'
assert.equal(orchestrateTutorFirst({message:quiz,state:s,interfaceLanguage:'ar'}).executor,'mentor')
assert.equal(MODE_UI_COPY.ar.modes.length,4)
for(const lang of ['es','en','no','fr','de','it','pt','ar','ja','zh'])assert.equal(MODE_UI_COPY[lang].modes.length,4)
const stream=fs.readFileSync(new URL('../server/core/execution-engine-stream.ts',import.meta.url),'utf8')
assert.ok(stream.includes("if(request.uiAction==='create_visual_review')"),'Article 27 materialization occurs ONLY on user click, never scheduled automatically')
console.log('PASS — 7.1 P1 planning/guards; UI retest still required')
