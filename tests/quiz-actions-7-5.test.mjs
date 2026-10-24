// 7.5 — «Empezar quiz» activates the quiz on screen; a review carries the identity of ONE quiz.
// Pure logic of app/beta/quiz-actions.ts plus the page wiring it relies on. The browser behaviour
// (0 requests, 0 student bubbles, same component, two quizzes kept apart) is proven in tests/e2e/quiz-pdf-7-5.mjs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
const { load } = await import('./_ts-loader.mjs')
const Q = load('app/beta/quiz-actions.ts')

const quiz = (title, q) => ({ type: 'quiz', title, questions: [{ question: q, options: ['a', 'b'] }] })
const msgs = [
  { id: 'm1', sender: 'sarah', text: 'Primero', artifacts: [{ type: 'table' }, quiz('Ser y estar', '¿Ser o estar?')] },
  { id: 'm2', sender: 'user', text: 'otro' },
  { id: 'm3', sender: 'sarah', text: 'Segundo', artifact: quiz('Pretérito', '¿Fui o iba?') },
  { id: 'm4', sender: 'sarah', text: 'Sin quiz', artifacts: [{ type: 'pdf', url: 'data:' }] },
]
// The action resolves to the quiz of the message that offered it, with the renderer's own id scheme.
assert.equal(Q.findQuizInstance(msgs, 'm1'), 'm1#1')
assert.equal(Q.findQuizInstance(msgs, 'm3'), 'm3#0')
// A message without a quiz (or no source) falls back to the most recent quiz, never to a new one.
assert.equal(Q.findQuizInstance(msgs, 'm4'), 'm3#0')
assert.equal(Q.findQuizInstance(msgs), 'm3#0')
assert.equal(Q.findQuizInstance([{ id: 'x', text: 'nada' }], 'x'), null)

// Identity: instance id + fingerprint are required; garbage is refused.
assert.deepEqual(Q.normalizeQuizIdentity({ instanceId: 'm1#1', key: 'qabc-1', title: 'Ser y estar' }), { instanceId: 'm1#1', key: 'qabc-1', title: 'Ser y estar' })
for (const bad of [null, {}, { instanceId: 'm1', key: 'k' }, { instanceId: 'm1#1' }, { instanceId: 'a b#1', key: 'k' }, { instanceId: 'm1#1', key: '' }]) {
  assert.equal(Q.normalizeQuizIdentity(bad), null, JSON.stringify(bad))
}
// Review message names the quiz, carries every question, option and choice, and asks for no new quiz.
const idA = { instanceId: 'm1#1', key: 'qA-1', title: 'Ser y estar' }
const idB = { instanceId: 'm3#0', key: 'qB-1', title: 'Pretérito' }
const mA = Q.buildQuizReviewMessage(idA, [{ question: '¿Ser o estar?', options: ['es', 'está'], chosen: 'está' }])
const mB = Q.buildQuizReviewMessage(idB, [{ question: '¿Fui o iba?', options: ['fui', 'iba'], chosen: 'fui', verified: 'correct' }])
assert.match(mA, /quiz «Ser y estar» \(componente m1#1, clave qA-1\)/)
assert.match(mA, /¿Ser o estar\?\nOpciones: es \| está\nElegí: está/)
assert.match(mA, /No generes otro quiz/)
assert.ok(!mA.includes('Pretérito') && !mA.includes('m3#0'), 'review A mentions nothing of quiz B')
assert.ok(!mB.includes('Ser y estar') && !mB.includes('m1#1'), 'review B mentions nothing of quiz A')
assert.match(mB, /Comprobación automática con clave independiente: acierto/)
assert.ok(!/\d+\/\d+/.test(mA), 'no score is invented for an unverified key')

// Wiring: start_quiz no longer maps to a generation phrase; it dispatches activation and returns.
const page = fs.readFileSync(new URL('../app/beta/use-beta-page.ts', import.meta.url), 'utf8')
assert.ok(!page.includes("start_quiz: 'Hazme un simulacro"), 'start_quiz is not a generation request')
const startBranch = page.slice(page.indexOf("=== 'start_quiz'"), page.indexOf("if (loading) return", page.indexOf("=== 'start_quiz'")))
assert.ok(startBranch.includes('QUIZ_ACTIVATE_EVENT') && !startBranch.includes('callAPI') && !startBranch.includes("sender: 'user'"))
console.log('PASS 7.5 quiz actions: start resolves to the quiz on screen; review identity per component; two quizzes kept apart; no invented score')
