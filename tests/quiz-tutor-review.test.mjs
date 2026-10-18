import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const {materializeNativeArtifact}=require('../server/core/native-artifact.ts')
const signal={type:'quiz',trigger:'explicit_user_request',subject:'language',format:'native',content:{title:'Test',questions:[
 {question:'El tren ___ rápido.',options:['es','está'],correct:0,explanation:'A tutor must review this answer.'},
 {question:'Ella ___ médica.',options:['es','está'],correct:0,explanation:'Profession identity.'}
]}}
const a=materializeNativeArtifact(signal)
assert.equal(a?.type,'quiz')
assert.equal(a?.content?.gradingMode,'tutor_review')
const ui=fs.readFileSync(new URL('../app/beta/beta-schema-a.tsx',import.meta.url),'utf8')
const hook=fs.readFileSync(new URL('../app/beta/use-beta-page.ts',import.meta.url),'utf8')
assert.ok(ui.includes('lingora-quiz-review-request'))
assert.ok(ui.includes('if (reviewMode || reported.current'))
assert.ok(ui.includes('No se asignará una puntuación automática'))
assert.ok(hook.includes("window.addEventListener('lingora-quiz-review-request'"))
assert.ok(hook.includes("sin calificación automática"))
console.log('PASS — tutor-reviewed unverified native quiz is interactive, never auto-graded')
