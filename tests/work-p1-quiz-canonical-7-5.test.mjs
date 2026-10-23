// Work 7.5 P1 regression — native quiz signal with malformed typed copy.
// The visible Tutor text is the source; recover an interactive component using
// the existing canonical reader without a second model or a new quiz parser.
import assert from 'node:assert/strict'
import { load } from './_ts-loader.mjs'

const { fulfillArtifactSignals } = load('server/core/artifact-side-effect.ts')
const text = [
  'Quiz: ser y estar',
  '',
  '1. Mi hermana ___ médica y trabaja en un hospital.',
  '',
  'A) está',
  'B) es',
  'C) son',
  'D) estoy',
  '',
  '2. Las llaves ___ encima de la mesa.',
  '',
  'A) son',
  'B) eres',
  'C) están',
  'D) está',
  '',
  '3. La sopa ___ muy caliente ahora; espera un poco.',
  '',
  'A) es',
  'B) somos',
  'C) están',
  'D) está',
].join('\n')

const brokenSignal = {
  type:'quiz', trigger:'explicit_user_request',
  subject:'Quiz interactivo de tres preguntas sobre el uso de ser y estar, con cuatro opciones por pregunta.',
  format:'native',
  content:{title:'Quiz: ser y estar',questions:[
    {prompt:'Mi hermana ___ médica',answers:['está','es','son','estoy']},
  ]},
}
const state = {mentorProfile:'alex',activeMode:'free'}
const result = await fulfillArtifactSignals([brokenSignal],text,state,'Quiero tocar las opciones. No quiero PDF.')
assert.equal(result.failures.length,0,'do not reject correct Tutor-authored quiz over malformed duplicate JSON')
assert.equal(result.artifacts.length,1,'only one tactile quiz')
const quiz = result.artifacts[0]
assert.equal(quiz.type,'quiz')
assert.equal(quiz.content.questions.length,3)
assert.deepEqual(quiz.content.questions.map(q=>q.options.length),[4,4,4])
assert.equal(quiz.content.questions[0].question,'Mi hermana ___ médica y trabaja en un hospital.')
assert.equal(quiz.content.questions[1].options[2],'están')
assert.equal(quiz.content.gradingMode,'tutor_review')
assert.ok(quiz.content.questions.every(q=>q.correct===-1),'never invent answer key')

const bad = await fulfillArtifactSignals([brokenSignal],'Hola, ¿cómo estás?',state)
assert.equal(bad.artifacts.length,0,'cannot invent quiz questions absent from text/typed data')
assert.match(bad.failures[0]?.subject??'',/la pregunta 1 no tiene enunciado/)

const goodTyped = { ...brokenSignal, content:{
  title:'Otra evaluación',questions:[{question:'Yo ___ estudiante.',options:['soy','estoy'],correct:-1}],
  gradingMode:'tutor_review',
} }
const typedOnly = await fulfillArtifactSignals([goodTyped],'Breve introducción.',state)
assert.equal(typedOnly.artifacts[0]?.type,'quiz','valid typed-only quiz still works')
assert.equal(typedOnly.failures.length,0)
console.log('PASS Work 7.5 P1: canonical visible quiz survives malformed typed copy, no invented content/key')
