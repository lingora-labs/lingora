// 7.5 — two immersion facts (contract docs/MOTOR_INMERSION.md @202f6171): a result the Tutor recognized,
// and a decline that stays. Real paths: Tutor engine (fake transport) → stream engine (provenance) → `done`
// event → Space (applyLearningFacts, memory backend store, reload) → projection → plan of the next turn.
import assert from 'node:assert/strict'
import Module from 'node:module'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-only'
process.env.OPENAI_MAIN_MODEL = 'gpt-5.6-sol'
let queue = []
class FakeOpenAI { chat = { completions: { create: async () => { assert.ok(queue.length, 'unexpected completion'); return fake(queue.shift()) } } } }
const originalLoad = Module._load
Module._load = function (name, ...rest) { if (name === 'openai') return FakeOpenAI; return originalLoad.call(this, name, ...rest) }
async function* fake({ text = '', calls = [] }) {
  if (text) yield { model: 'gpt-5.6-sol', choices: [{ delta: { content: text } }] }
  for (const [index, c] of calls.entries()) yield { model: 'gpt-5.6-sol', choices: [{ delta: { tool_calls: [{ index, id: 'call_' + index, function: { name: c.name, arguments: JSON.stringify(c.args) } }] } }] }
}
const { load } = await import('./_ts-loader.mjs')
const { executePlanStream } = load('server/core/execution-engine-stream.ts')
const { orchestrateTutorFirst } = load('server/core/tutor-first-orchestrator.ts')
const { buildCommercialContext, formatCommercialFacts } = load('lib/commercial-context.ts')
const { recordedImmersionOfferPatch } = load('server/core/commercial-context.ts')
const Mo = load('lib/space/model.ts')
const St = load('lib/space/store.ts')
const { projectCommercialFacts } = load('lib/space/commercial-projection.ts')
const { buildConversationRequest } = load('lib/space/retrieve.ts')
const { DEFAULT_SESSION_STATE } = load('lib/contracts.ts')
const quiet = { info: console.info, warn: console.warn }
const infoLogs = []
console.info = (...a) => infoLogs.push(a); console.warn = () => {}

const ui = { phase: 'chat', lang: 'es', mentor: 'sarah', topic: 'conversation', activeMode: 'interact' }
const backend = St.memoryBackend()
const store = St.createSpaceStore(backend)
let { space, conversation: A } = await store.open(async () => null, () => ({ session: { ...DEFAULT_SESSION_STATE, sessionId: 'sess-A' }, ui }))
const DAY = 24 * 60 * 60 * 1000

/** One real turn through the engines, exactly as the browser sends it (buildConversationRequest). */
async function turn(conv, message, tutor, extraState = {}) {
  const t = buildConversationRequest(space, conv, message)
  const state = { ...DEFAULT_SESSION_STATE, ...conv.session, interfaceLanguage: 'es', activeMode: 'interact', tokens: 4,
    commercialOffers: t.commercialOffers, immersionInterest: t.immersionInterest, commercialFacts: t.commercialFacts, ...extraState }
  const plan = orchestrateTutorFirst({ message, state, interfaceLanguage: 'es', now: Date.now() })
  queue = [tutor]
  const body = { message, state, conversationHistory: t.conversationHistory, spaceContext: t.spaceContext, conversationId: conv.id }
  const reader = executePlanStream(plan, body, state).getReader()
  let buf = '', done = null, text = ''
  for (;;) { const { done: end, value } = await reader.read(); if (end) break; buf += new TextDecoder().decode(value) }
  for (const ev of buf.split('\n\n')) { if (!ev.startsWith('data: ')) continue; const p = JSON.parse(ev.slice(6)); if (p.delta) text += p.delta; if (p.done) done = p }
  assert.ok(done, 'turn completed')
  // Browser side: commit the turn, then the Space (as use-beta-page absorbTurn does), through the real store.
  conv.msgs = [...conv.msgs, { id: 'u' + conv.msgs.length, sender: 'user', text: message }, { id: 't' + conv.msgs.length, sender: 'sarah', text, complete: true }]
  conv.session = { ...conv.session, ...done.state, sessionId: conv.session.sessionId }
  await store.saveConversation(conv)
  const out = await store.mutate(sp => ({ space: Mo.applyLearningFacts(Mo.mergeOffers(sp, done.state.commercialOffers), (done.learningFacts ?? []).filter(f => f.conversationId === conv.id)), result: true }))
  assert.ok(out.ok, 'Space write succeeded'); space = out.space
  return { plan, done, text }
}
const allowedNow = () => buildCommercialContext({ ...A.session, commercialOffers: space.offers, commercialFacts: projectCommercialFacts(space) }).offerAllowed

// 1. Goal without result → false.
let r = await turn(A, 'Quiero aprobar el DELE B2 en junio', { text: 'Perfecto, prepararemos el DELE B2.', calls: [{ name: 'record_learning_fact', args: { facts: [{ fact: 'goal', text: 'Aprobar el DELE B2 en junio', evidence: 'aprobar el DELE B2 en junio' }] } }] })
assert.equal(r.done.learningFacts.length, 1, 'goal accepted on the student\'s own words')
assert.equal(r.plan.commercial.offerAllowed, false)
assert.equal(allowedNow(), false, '1. goal without result → offerAllowed=false')

// 7. The result of THIS turn does not enable an offer in this same turn.
r = await turn(A, 'Ayer fui al mercado y compré pan', { text: '¡Exacto! Has usado bien el pretérito indefinido.', calls: [{ name: 'record_learning_fact', args: { facts: [{ fact: 'result', text: 'Usó correctamente el pretérito indefinido', evidence: 'Ayer fui al mercado y compré pan' }] } }] })
assert.equal(r.done.learningFacts[0].fact, 'result')
assert.equal(r.plan.commercial.offerAllowed, false, '7. the plan of the turn that produced the result was not eligible')
assert.equal(r.plan.commercial.result.count, 0)
assert.deepEqual(recordedImmersionOfferPatch({ ...r.plan, ...A.session, commercialFacts: undefined }, 'mira /immersion'), {}, 'nothing recorded for an ineligible turn')

// 3. Goal and earlier result confirmed, frequency available → true (in the NEXT turn's plan).
assert.equal(allowedNow(), true, '3. goal + earlier result + frequency → offerAllowed=true')
const next = orchestrateTutorFirst({ message: 'Sigamos', state: { ...A.session, commercialOffers: space.offers, commercialFacts: projectCommercialFacts(space) }, interfaceLanguage: 'es', now: Date.now() })
assert.equal(next.commercial.offerAllowed, true)
assert.match(formatCommercialFacts(next.commercial).join('\n'), /immersion\.result: 1 recognized in earlier interactions/)

// Praise or inference cannot become a result: evidence must be the student's own words.
r = await turn(A, 'Gracias', { text: '¡Vas genial!', calls: [{ name: 'record_learning_fact', args: { facts: [{ fact: 'result', text: 'Progresa muy bien', evidence: 'Vas genial' }] } }] })
assert.equal(r.done.learningFacts, undefined); assert.equal(r.done.learningFactRejections[0].reason, 'evidence_not_in_student_words')

// 2. Result without confirmed goal → false (another Space where only a result exists).
const lone = Mo.applyLearningFacts(Mo.createSpace('cv_x'), [{ id: 'lf_result_1', fact: 'result', text: 'Resolvió el ejercicio', evidence: 'x', conversationId: 'cv_x', at: new Date(Date.now() - 1000).toISOString() }])
assert.equal(buildCommercialContext({ sessionId: 's', commercialFacts: projectCommercialFacts(lone), lastUserGoal: 'viajar' }).offerAllowed, false, '2. result without a confirmed goal (lastUserGoal is not one) → false')
// A "result" typed by hand in the panel is not a recognized result.
const typed = Mo.addConfirmedFact(Mo.addConfirmedFact(Mo.createSpace('cv_y'), 'goal', 'DELE'), 'result', 'lo hice')
assert.equal(projectCommercialFacts(typed).results.length, 0)

// 6. A "no" to something else (no invitation in this conversation) does not create a decline.
r = await turn(A, 'No, gracias, no quiero el PDF', { text: 'De acuerdo, sin PDF.', calls: [{ name: 'record_learning_fact', args: { facts: [{ fact: 'immersion_declined', text: 'no', evidence: 'No, gracias' }] } }] })
assert.equal(r.done.learningFactRejections[0].reason, 'no_identified_invitation', '6. a "no" without an identifiable invitation is not a decline')
assert.equal(projectCommercialFacts(space).declinedAt, null)

// The Tutor invites (eligible turn) → the platform records the invitation in this conversation.
r = await turn(A, '¿Qué más puedo hacer?', { text: 'Podrías vivirlo en Salamanca: mira [experiencias](/immersion).' })
assert.equal(r.plan.commercial.offerAllowed, true)
assert.equal(space.offers.filter(o => o.sessionId === 'sess-A').length, 1, 'invitation recorded once')
// 10. Frequency: one per conversation.
assert.equal(allowedNow(), false, '10. 1 per conversation still holds')

// 4. Decline of that invitation → stays; offerAllowed false even with goal and result.
r = await turn(A, 'No, gracias, ahora no me interesa viajar', { text: 'Entendido, seguimos con el español.', calls: [{ name: 'record_learning_fact', args: { facts: [{ fact: 'immersion_declined', text: 'no', evidence: 'No, gracias, ahora no me interesa viajar' }] } }] })
assert.equal(r.done.learningFacts[0].fact, 'immersion_declined')
assert.ok(projectCommercialFacts(space).declinedAt, 'decline stored')
// 9. Retry / re-ask: the same declarations again add nothing.
const before = JSON.stringify(space.memory)
space = Mo.applyLearningFacts(space, r.done.learningFacts)
const again = await turn(A, 'Ayer fui al mercado y compré pan', { text: 'Bien.', calls: [{ name: 'record_learning_fact', args: { facts: [{ fact: 'result', text: 'Usó correctamente el pretérito indefinido', evidence: 'Ayer fui al mercado y compré pan' }] } }] })
assert.equal(again.done.learningFacts[0].id, space.memory.find(f => f.key === 'result').id, 'same words, same conversation → same id')
assert.equal(space.memory.filter(f => f.key === 'result').length, 1, '9. no duplicated result')
assert.equal(space.memory.filter(f => f.key === 'immersion_declined').length, 1, '9. no duplicated decline')
assert.equal(JSON.stringify(space.memory.filter(f => f.key !== 'result')), JSON.stringify(JSON.parse(before).filter(f => f.key !== 'result')))

// 8. Reload and a NEW conversation keep result and decline; the decline blocks spontaneous offers there too.
const reopened = await store.open(async () => { throw Error('no legacy') }, () => ({ session: {}, ui }))
assert.ok(projectCommercialFacts(reopened.space).results.length === 1 && projectCommercialFacts(reopened.space).declinedAt, '8. reload keeps both facts')
const created = await store.newConversation(reopened.space, { session: { ...DEFAULT_SESSION_STATE, sessionId: 'sess-B' }, ui })
space = created.space; const B = created.conversation
const inB = orchestrateTutorFirst({ message: 'Hola', state: { ...B.session, commercialOffers: space.offers, commercialFacts: buildConversationRequest(space, B, 'Hola').commercialFacts }, interfaceLanguage: 'es', now: Date.now() })
assert.equal(inB.commercial.result.count, 1, '8. a new conversation sees the result')
assert.equal(inB.commercial.declined.standing, true); assert.equal(inB.commercial.offerAllowed, false, '4. decline blocks the spontaneous offer across conversations')
assert.ok(!JSON.stringify(buildConversationRequest(space, B, 'Hola').conversationHistory).includes('mercado'), 'no other conversation\'s messages travel')

// 5. An explicit request is answered whatever the decline and the frequency say: nothing filters the reply.
r = await turn(B, '¿Me cuentas cómo funcionan las inmersiones?', { text: 'Claro: puedes ver opciones en /immersion. Te explico cómo funcionan.' })
assert.equal(r.plan.commercial.offerAllowed, false)
assert.equal(r.text, 'Claro: puedes ver opciones en /immersion. Te explico cómo funcionan.', '5. the Tutor\'s answer reaches the student untouched')
assert.match(formatCommercialFacts(r.plan.commercial).join('\n'), /immersion\.scope: a question the student asks about immersion is outside offerAllowed/)
assert.equal(space.offers.filter(o => o.sessionId === 'sess-B').length, 0, 'answering a direct question is not counted as an invitation')

// Only the student reopens: a reopening on the student's words removes the decline.
r = await turn(B, 'Oye, ahora sí me interesa la inmersión', { text: 'Genial, hablemos de ello.', calls: [{ name: 'record_learning_fact', args: { facts: [{ fact: 'immersion_reopened', text: 'reabre', evidence: 'ahora sí me interesa la inmersión' }] } }] })
assert.equal(projectCommercialFacts(space).declinedAt, null, 'reopened by the student')

// 10. Existing frequency limits: 2 per rolling 7 days across the Space.
const now = Date.now()
const facts = projectCommercialFacts(space)
assert.equal(buildCommercialContext({ sessionId: 'sess-C', commercialFacts: facts, commercialOffers: [{ timestamp: now - DAY, sessionId: 'sess-A' }, { timestamp: now - 2 * DAY, sessionId: 'sess-B' }] }, now).offerAllowed, false, '10. two in 7 days')
assert.equal(buildCommercialContext({ sessionId: 'sess-C', commercialFacts: facts, commercialOffers: [{ timestamp: now - 8 * DAY, sessionId: 'sess-A' }, { timestamp: now - 2 * DAY, sessionId: 'sess-B' }] }, now).offerAllowed, true, '10. rolling window')
// Facts stamped after the request clock are ignored (never eligible on a fact from the turn being generated).
assert.equal(buildCommercialContext({ sessionId: 'sess-C', commercialFacts: facts }, Date.parse(facts.results[0].at) - 1).offerAllowed, false)

// A failed Space write is reported, not presented as saved.
const broken = St.createSpaceStore({ get: backend.get, put: async () => { throw Error('quota') }, delete: backend.delete })
const failed = await broken.mutate(sp => ({ space: Mo.applyLearningFacts(sp, [{ id: 'lf_goal_z', fact: 'goal', text: 'z', evidence: 'z', conversationId: B.id, at: new Date().toISOString() }]), result: true }))
assert.equal(failed.ok, false)
// No student text in the learning-fact logs.
const logged = JSON.stringify(infoLogs.filter(l => l[0] === '[learning-facts]'))
for (const secret of ['DELE', 'mercado', 'gracias', 'inmersión']) assert.ok(!logged.includes(secret), 'no student words in logs: ' + secret)
assert.equal(queue.length, 0)
console.info = quiet.info; console.warn = quiet.warn
console.log('PASS 7.5 immersion facts — result recognized on the student\'s words, decline that stays, eligibility from the Space projection, 10/10 cases')
