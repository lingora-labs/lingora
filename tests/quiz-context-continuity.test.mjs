// FIELD QA 12 A5 regression: UI correction and subsequent tutor context
// must agree on the exact wrong option. Run:
// node tests/quiz-context-continuity.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import Module from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const filename = fileURLToPath(new URL('../lib/quiz-evidence.ts', import.meta.url))
const js = ts.transpileModule(fs.readFileSync(filename,'utf8'), {
  compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2020 },
}).outputText
const m = new Module(filename)
m.filename = filename
m.paths = Module._nodeModulePaths(path.dirname(filename))
m._compile(js, filename)
const { normalizeQuizEvidence, formatQuizEvidence, disclosedQuizSelections } = m.exports

const quiz = {
  responses: [
    {question:'María ___ cansada hoy.',chosen:'es',expected:'está',
      correct:false,explanation:'Cansada hoy describe un estado físico temporal.'},
    {question:'Nosotros ___ de Argentina.',chosen:'somos',expected:'somos',
      correct:true,explanation:'Ser expresa origen.'},
    {question:'La mesa ___ en la cocina.',chosen:'está',expected:'está',
      correct:true,explanation:'Estar expresa ubicación.'},
  ],
}
const normalized = normalizeQuizEvidence(quiz)
assert.ok(normalized)
assert.equal(normalized.correctCount,2)
assert.equal(normalized.total,3)
const context = formatQuizEvidence(quiz)
assert.ok(context.includes('question="María ___ cansada hoy."'))
assert.ok(context.includes('selected="es"'))
assert.ok(context.includes('correct_answer="está"'))
assert.ok(context.includes('result=INCORRECT'))
assert.ok(context.includes('Cansada hoy describe un estado físico temporal.'))
assert.ok(context.includes('Score: 2/3.'))
const disclosure = disclosedQuizSelections(quiz, 'Explícame por qué mi primera respuesta fue incorrecta.')
assert.ok(disclosure.includes('elegiste «es»'))
assert.ok(disclosure.includes('correcta era «está»'))
assert.ok(disclosure.includes('María ___ cansada hoy.'))
assert.equal(disclosedQuizSelections(quiz,'Ahora, ¿por qué el cielo se ve azul?'),'')
assert.equal(context.includes('identidad o característica'),false,
  'cannot invent a different grammar explanation')
assert.equal(formatQuizEvidence({ responses:[{ question:'X', chosen:'es' }] }), '')
assert.equal(normalizeQuizEvidence({ responses:Array(9).fill(quiz.responses[0]) }),null)

const frontend = fs.readFileSync(fileURLToPath(new URL('../app/beta/use-beta-page.ts',import.meta.url)), 'utf8')
const mentor = fs.readFileSync(fileURLToPath(new URL('../server/mentors/mentor-engine.ts',import.meta.url)), 'utf8')
const quizComponent = fs.readFileSync(fileURLToPath(new URL('../app/beta/beta-schema-a.tsx',import.meta.url)), 'utf8')
assert.ok(frontend.includes('quizEvidence:evidence'))
assert.ok(frontend.includes('pendingQuizFeedbackRef.current = evidence'))
assert.ok(frontend.includes('useEffect(() => { flushStructuredQuizFeedback() }'))
assert.ok(frontend.includes('sessionRef.current = selected'))
assert.ok(!frontend.includes("if (mode !== 'structured' || loading) return"),
  'structured completion must be queued even while another request loads')
assert.ok(mentor.includes('formatQuizEvidence(state.quizEvidence)'))
// 7.4 contract (tests/quiz-dual-7-4.test.mjs): the evidence the Tutor receives carries the answer the SYSTEM verified,
// never the index the model authored; a quiz with any unverifiable item sends no evidence and goes to Tutor review.
assert.ok(quizComponent.includes('expected:q.options[verified[i] as number]'))
assert.ok(!quizComponent.includes('expected:q.options[q.correct]'),'the model-authored index never becomes evidence')
assert.ok(quizComponent.includes('requiresReview || reported.current'),'unverified quizzes report no automatic evidence')
const artifactSource = fs.readFileSync(fileURLToPath(new URL('../server/core/native-artifact.ts',import.meta.url)), 'utf8')
// quiz shape safeguard, 7.4 form: the materializer validates every key and degrades to a real tactile Tutor review
assert.ok(artifactSource.includes('validateQuizAnswerKey'))
assert.ok(artifactSource.includes("gradingMode:'tutor_review'"))
assert.ok(artifactSource.includes('cannot be certified by one answer-key'))
console.log('PASS — exact selection disclosure, structured feedback queue, and quiz shape safeguard')
