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
const missingOption={...signal,content:{...signal.content,questions:[
 {question:'María ___ en casa.',options:['es','son'],correct:0,explanation:'Revisión necesaria; respuesta esperada no ofrecida.'},
 {question:'Ella ___ médica.',options:['es','está'],correct:0,explanation:'Profesión.'},
]}}
const missing=materializeNativeArtifact(missingOption)
assert.equal(missing?.type,'quiz')
assert.equal(missing?.content?.gradingMode,'tutor_review',
  'missing or ambiguous correct option must never auto-grade')
const multiWrong={...signal,content:{...signal.content,questions:[
 {question:'La boda ___ en Madrid.',options:['es','está'],correct:1,explanation:'Evento'},
 {question:'María ___ en casa.',options:['es','está'],correct:0,explanation:'Ubicación'},
 {question:'Ella ___ médica.',options:['es','está'],correct:1,explanation:'Profesión'},
]}}
const originalKeys=multiWrong.content.questions.map(q=>q.correct)
const repaired=materializeNativeArtifact(multiWrong)
assert.equal(repaired?.type,'quiz')
assert.deepEqual(repaired?.content?.questions.map(q=>q.correct),[0,1,0],
  'correct ALL wrong indices, not merely the first')
assert.deepEqual(multiWrong.content.questions.map(q=>q.correct),originalKeys,
  'never mutate the Tutor-authored source signal')
assert.equal(repaired?.content?.gradingMode,undefined)
assert.deepEqual(repaired?.content?.questions.map(q=>q.question),
  multiWrong.content.questions.map(q=>q.question))
const malformed={...signal,content:{...signal.content,questions:[
 {question:'María ___ en casa y Ana ___ cansada.',options:['es','está'],correct:0,explanation:'Two blanks'},
 {question:'Ella ___ médica.',options:['es','está'],correct:0,explanation:'Profession'},
]}}
assert.equal(materializeNativeArtifact(malformed),null,'compound cloze remains reject')
const duplicates={...signal,content:{...signal.content,questions:[
 {question:'María ___ en casa.',options:['está','A) está'],correct:0,explanation:'Duplicate'},
 {question:'Ella ___ médica.',options:['es','está'],correct:0,explanation:'Profession'},
]}}
assert.equal(materializeNativeArtifact(duplicates),null,'duplicate options remain reject')
const ui=fs.readFileSync(new URL('../app/beta/beta-schema-a.tsx',import.meta.url),'utf8')
const hook=fs.readFileSync(new URL('../app/beta/use-beta-page.ts',import.meta.url),'utf8')
assert.ok(ui.includes('lingora-quiz-review-request'))
assert.ok(ui.includes('if (reviewMode || reported.current'))
assert.ok(ui.includes('No se asignará una puntuación automática'))
assert.ok(hook.includes("window.addEventListener('lingora-quiz-review-request'"))
assert.ok(hook.includes("sin calificación automática"))
console.log('PASS — tutor-reviewed unverified native quiz is interactive, never auto-graded')
