// LINGORA quiz-quality release gate. It checks independent grammatical proof,
// not the index authored by the Tutor Maestro.
// Run: node tests/quiz-answer-key.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require=createRequire(import.meta.url)
const ts=require('typescript')
require.extensions['.ts']=(mod,filename)=>{
  const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}
  }).outputText
  mod._compile(js,filename)
}
const {validateQuizAnswerKey}=require('../lib/quiz-answer-key.ts')
const {materializeNativeArtifact}=require('../server/core/native-artifact.ts')
const question=(question,options,correct)=>({
  question,options,correct,explanation:'Explicación pedagógica verificable.'
})
const valid=(q,opts,key)=>validateQuizAnswerKey([question(q,opts,key)])
function pass(q,opts,key){const r=valid(q,opts,key);assert.equal(r.ok,true,JSON.stringify({q,opts,key,r}))}
function fail(q,opts,key){const r=valid(q,opts,key);assert.equal(r.ok,false,JSON.stringify({q,opts,key,r}))}

// THE OBSERVED USER REGRESSION: event location vs ordinary person location.
pass('La boda ___ en Madrid.',['es','está','somos'],0)
fail('La boda ___ en Madrid.',['es','está','somos'],1)
fail('La boda ___ en Madrid.',['está','estamos','son'],0)
pass('María ___ en casa.',['es','está','son'],1)
fail('María ___ en casa.',['es','está','son'],0)
fail('María ___ en casa.',['ser','estar','es'],1)
fail('María ___ en casa.',['ser','estar','es'],2)
pass('Madrid ___ en España.',['es','está'],1)
fail('Madrid ___ en España.',['es','está'],0)
pass('La fiesta ___ mañana.',['es','está','estamos'],0)
fail('La fiesta ___ mañana.',['es','está','estamos'],1)

// Conjugation, transitory states, origin, events, identity, legitimate infinitives.
pass('María ___ cansada hoy.',['es','está'],1)
fail('María ___ cansada hoy.',['es','está'],0)
pass('Ahora nosotros ___ en casa.',['somos','estamos'],1)
fail('Ahora nosotros ___ en casa.',['somos','estamos'],0)
pass('Hoy mi hermana ___ enferma.',['es','está'],1)
pass('Nosotros ___ de Argentina.',['somos','estamos','son'],0)
fail('Nosotros ___ de Argentina.',['somos','estamos','son'],2)
pass('Él ___ en casa.',['es','está'],1)
fail('Él ___ en casa.',['es','está'],0)
pass('Mi hermano ___ muy simpático.',['estar','es','está'],1)
pass('Yo quiero ___ en casa.',['ser','estar','estoy'],1)
fail('Yo quiero ___ en casa.',['ser','estar','estoy'],0)
pass('La clase ___ mañana.',['es','está'],0)
pass('El cielo ___ azul.',['es','está','somos'],0)
pass('La puerta ___ cerrada.',['es','está'],1)
pass('Las llaves ___ en la caja.',['están','son','está'],0)

// No guessed grading for unverified semantic clozes.
fail('María ___ en casa.',['está','está','es'],0)
fail('La boda ___ en Madrid.',['es','es','está'],0)
fail('El tren ___ rápido.',['es','está','son'],0)
fail('La película ___ interesante.',['es','está','son'],1)
fail('María ___ en Madrid y Ana ___ cansada.',['es','está','son'],1)

// A real Chromium session exposed prefixed model choices ("A) es").
// Labels cannot bypass grammar verification or produce a false green grade.
pass('La boda ___ en Madrid.',['A) es','B) está','C) somos'],0)
fail('La boda ___ en Madrid.',['A) es','B) está','C) somos'],1)
pass('María ___ en casa.',['A) es','B) está','C) son'],1)
fail('María ___ en casa.',['A) es','B) está','C) son'],0)
fail('La boda ___ en Madrid.',['A) está','B) están','C) somos'],0)
fail('La boda ___ en Madrid.',['se celebrará','ocurrirá','será'],0)

// Backward compatibility with other subjects: this contract is expressly scoped.
pass('La capital de Francia es ___',['París','Roma'],0)
pass('En 2020 España ___ un país...',['era','estaba'],0)

// End-to-end boundary: SERVER refuses incorrect composed keys, CLIENT
// checks same pure function for persisted artifacts.
const quiz=(items)=>({
  type:'quiz',trigger:'explicit_user_request',format:'native',subject:'SER/ESTAR',
  content:{title:'Evaluación',questions:items}
})
const eventCorrect=question('La boda ___ en Madrid.',['es','está','somos'],0)
const personCorrect=question('María ___ en casa.',['es','está','son'],1)
assert.equal(materializeNativeArtifact(quiz([eventCorrect,personCorrect]))?.type,'quiz')
// The validator STILL rejects model-authored wrong keys, but now reports
// the one mathematically proven option index for safe runtime correction.
const wrongEventAudit=validateQuizAnswerKey([
  question('La boda ___ en Madrid.',['A) es','B) está','C) somos'],1),
  personCorrect
])
assert.deepEqual(wrongEventAudit,{
  ok:false,reason:'incorrect_model_answer_key:0',questionIndex:0,correctedIndex:0,
})
const wrongPersonAudit=validateQuizAnswerKey([
  eventCorrect,{...personCorrect,correct:0}
])
assert.deepEqual(wrongPersonAudit,{
  ok:false,reason:'incorrect_model_answer_key:1',questionIndex:1,correctedIndex:1,
})
const prefixedCorrected=materializeNativeArtifact(quiz([
  question('La boda ___ en Madrid.',['A) es','B) está','C) somos'],1),
  personCorrect
]))
assert.equal(prefixedCorrected?.type,'quiz')
assert.equal(prefixedCorrected?.content?.questions[0].correct,0,
  'prefixed options must be semantically verified, not trusted by index')
const correctedEvent=materializeNativeArtifact(quiz([
  {...eventCorrect,correct:1},personCorrect
]))
assert.equal(correctedEvent?.content?.questions[0].correct,0,
  'event-location index is proof-corrected, not rejected')
const correctedPerson=materializeNativeArtifact(quiz([
  eventCorrect,{...personCorrect,correct:0}
]))
assert.equal(correctedPerson?.content?.questions[1].correct,1,
  'person-location index is proof-corrected, not rejected')
const unverified = materializeNativeArtifact(quiz([
  eventCorrect,question('El tren ___ rápido.',['es','está'],0)
]))
assert.equal(unverified?.content?.gradingMode,'tutor_review','unverified semantic quiz is tutor-reviewed, never auto-scored')
const client=fs.readFileSync(require.resolve('../app/beta/beta-schema-a.tsx'),'utf8')
assert.ok(client.includes('validateQuizAnswerKey(quiz)'))
console.log('PASS — semantic answer-key proof, event/person location, UI+runtime guards and prior grammar regression')
