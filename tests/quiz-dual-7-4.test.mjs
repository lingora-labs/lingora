// 7.4: quiz dual evaluation. Auto-score ONLY from a key the system proves itself; the Tutor reviews the rest.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const root=new URL('../',import.meta.url).pathname
const {verifiedKeyFor,quizFingerprint}=require('../lib/quiz-answer-key.ts')

// verifiable: independent of whatever index the model claimed
assert.equal(verifiedKeyFor('Yo ___ médico.',['estoy','soy','es']),1)
assert.equal(verifiedKeyFor('Madrid ___ en España.',['es','está','están']),1)
assert.equal(verifiedKeyFor('Nosotros ___ cansados.',['somos','estamos','están']),1)
// not provable → null → Tutor review (open, ambiguous, non-cloze, no unique option)
assert.equal(verifiedKeyFor('¿Cuál es la capital de Francia?',['París','Roma','Lisboa']),null)
assert.equal(verifiedKeyFor('Ella ___ lista.',['es','está','son']),null,'ser/estar + lista changes meaning: not auto-scored')
assert.equal(verifiedKeyFor('Yo ___ médico.',['eres','es','somos']),null,'correct form not offered: not scored')
assert.equal(verifiedKeyFor('Yo ___ ___ médico.',['soy','estoy']),null,'multi-gap not scored')
assert.equal(verifiedKeyFor('Escribe una frase con "ser".',['a','b']),null)
assert.equal(verifiedKeyFor(5,['a']),null)
// fingerprint: stable and sensitive to content
const q1=[{question:'a ___',options:['x','y']},{question:'b',options:['z','w']}]
assert.equal(quizFingerprint(q1),quizFingerprint(JSON.parse(JSON.stringify(q1))))
assert.notEqual(quizFingerprint(q1),quizFingerprint([q1[0],{question:'b',options:['z','v']}]))

// UI contract (structure)
const ui=fs.readFileSync(root+'app/beta/beta-schema-a.tsx','utf8')
const quiz=ui.slice(ui.indexOf('export function QuizBlock'),ui.indexOf('export function SchemaBlock'))
assert.match(quiz,/verifiedKeyFor\(q\.question, q\.options\)/,'scores come from the system verifier')
assert.ok(!/(?:ans\[[a-z]+\]|sel|oi|key) === q\.correct|expected:q\.options\[q\.correct\]/.test(quiz),'the model-authored index never decides a score')
assert.match(quiz,/verified\.some\(v => v === null\)/,'any unverifiable item forces Tutor review')
assert.match(quiz,/lingora-quiz-progress/);assert.match(quiz,/lingora-quiz-continue/);assert.match(quiz,/lingora-quiz-review-request/)
assert.match(quiz,/initial\?\.answers/,'answers restored after reload')
assert.match(quiz,/Pendiente de la revisión de tu Tutor/)
const hook=fs.readFileSync(root+'app/beta/use-beta-page.ts','utf8')
assert.match(hook,/addEventListener\('lingora-quiz-progress'/);assert.match(hook,/addEventListener\('lingora-quiz-continue'/)
assert.match(hook,/Comprobación automática con clave independiente/,'Tutor is told which items were auto-checked')
assert.match(hook,/sin calificación automática/)
const art=fs.readFileSync(root+'app/beta/beta-artifacts.tsx','utf8');assert.match(art,/initial=\{a\.progress\}/)
console.log('PASS 7.4 — quiz dual evaluation: system-verified keys only, Tutor review for the rest, persisted, continuable')
