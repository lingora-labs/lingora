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
const { normalizeQuizEvidence, formatQuizEvidence } = m.exports

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
assert.equal(context.includes('identidad o característica'),false,
  'cannot invent a different grammar explanation')
assert.equal(formatQuizEvidence({ responses:[{ question:'X', chosen:'es' }] }), '')
assert.equal(normalizeQuizEvidence({ responses:Array(9).fill(quiz.responses[0]) }),null)

const frontend = fs.readFileSync(fileURLToPath(new URL('../app/beta/use-beta-page.ts',import.meta.url)), 'utf8')
const mentor = fs.readFileSync(fileURLToPath(new URL('../server/mentors/mentor-engine.ts',import.meta.url)), 'utf8')
const quizComponent = fs.readFileSync(fileURLToPath(new URL('../app/beta/beta-schema-a.tsx',import.meta.url)), 'utf8')
assert.ok(frontend.includes('quizEvidence: evidence'))
assert.ok(frontend.indexOf('quizEvidence: evidence') < frontend.indexOf("if (mode !== 'structured' || loading) return"),
  'all modes save quiz evidence BEFORE the optional structured feedback')
assert.ok(mentor.includes('formatQuizEvidence(state.quizEvidence)'))
assert.ok(quizComponent.includes('expected:q.options[q.correct]'))
console.log('PASS — A5 quiz evidence retained across modes and grounded in the exact wrong answer')
