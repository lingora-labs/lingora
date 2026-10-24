// 7.5 — the product model is a verified identity (order "TRES CORRECCIONES", point 3).
// Configuration: OPENAI_MAIN_MODEL must be exactly gpt-5.6-sol, or the turn is refused BEFORE any provider call.
// Serving: the model the provider REPORTS must be exactly gpt-5.6-sol BEFORE any pedagogical content is published;
// a different, dated or missing identity, or a provider refusing the model, rejects the turn with no fallback.
// Real paths: Tutor engine + stream engine, provider transport simulated.
import assert from 'node:assert/strict'
import Module from 'node:module'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-only'
let queue = [], requests = []
class FakeOpenAI { chat = { completions: { create: async (req) => { requests.push(req); const next = queue.shift(); if (next instanceof Error) throw next; return fake(next) } } } }
const originalLoad = Module._load
Module._load = function (name, ...rest) { if (name === 'openai') return FakeOpenAI; return originalLoad.call(this, name, ...rest) }
async function* fake({ model, chunks }) { for (const c of chunks) yield model === undefined ? c : { model, ...c } }
const content = t => ({ choices: [{ delta: { content: t } }] })
const PEDAGOGY = 'Lección: el pretérito indefinido se usa para acciones terminadas.'
const { load } = await import('./_ts-loader.mjs')
const M = load('server/mentors/mentor-engine.ts')
const { executePlanStream } = load('server/core/execution-engine-stream.ts')
const { orchestrateTutorFirst } = load('server/core/tutor-first-orchestrator.ts')
const { DEFAULT_SESSION_STATE } = load('lib/contracts.ts')
const quiet = { warn: console.warn, error: console.error, info: console.info }
console.warn = () => {}; console.error = () => {}; console.info = () => {}

assert.equal(M.PRODUCT_MODEL, 'gpt-5.6-sol')
async function tutor(env, provider) {
  if (env === undefined) delete process.env.OPENAI_MAIN_MODEL; else process.env.OPENAI_MAIN_MODEL = env
  queue = provider === undefined ? [] : [provider]; requests = []
  const s = await M.getMentorResponseStream({ request: { message: 'Enséñame el pretérito' }, state: { tokens: 3 } })
  let text = ''
  for await (const d of s) text += d
  return { s, text }
}

// Configuration: unset or different → refused before the provider, described as configuration.
for (const env of [undefined, 'gpt-4o-mini', 'gpt-5.6-sol-mini', '']) {
  const { s, text } = await tutor(env, { model: 'gpt-5.6-sol', chunks: [content(PEDAGOGY)] })
  assert.equal(requests.length, 0, `config ${JSON.stringify(env)}: the provider is not called`)
  assert.match(text, /^Error de configuración: OPENAI_MAIN_MODEL=.+; el producto es gpt-5\.6-sol\. El turno no se envió al proveedor\.$/)
  assert.equal(s.deliveryFailure, 'model_config_invalid'); assert.equal(s.servedModel, undefined, 'nothing was served')
}

// Correct configuration: the request asks the provider for exactly gpt-5.6-sol.
let r = await tutor('gpt-5.6-sol', { model: 'gpt-5.6-sol', chunks: [content('Lección: '), content('el pretérito indefinido se usa para acciones terminadas.')] })
assert.equal(requests[0].model, 'gpt-5.6-sol')
assert.equal(r.text, PEDAGOGY); assert.equal(r.s.servedModel, 'gpt-5.6-sol'); assert.equal(r.s.deliveryFailure, undefined)

// Served identity different (including a dated snapshot or a mini): rejected, no pedagogical content published.
for (const served of ['gpt-4o-mini', 'gpt-5.6-sol-2026-06-01', 'gpt-5.6-mini']) {
  r = await tutor('gpt-5.6-sol', { model: served, chunks: [content(PEDAGOGY)] })
  assert.equal(r.text, `Modelo incorrecto: se sirvió ${served}, el producto es gpt-5.6-sol.`)
  assert.ok(!r.text.includes('pretérito'), 'no pedagogical content before the identity is proven')
  assert.equal(r.s.servedModel, served); assert.equal(r.s.deliveryFailure, 'model_mismatch')
}
// Identity reported only AFTER content chunks: content is held, then discarded on mismatch.
r = await tutor('gpt-5.6-sol', { model: undefined, chunks: [content(PEDAGOGY), { model: 'gpt-4o-mini', choices: [] }] })
assert.equal(r.text, 'Modelo incorrecto: se sirvió gpt-4o-mini, el producto es gpt-5.6-sol.')
// Held content is released once the identity is proven.
r = await tutor('gpt-5.6-sol', { model: undefined, chunks: [content(PEDAGOGY), { model: 'gpt-5.6-sol', choices: [] }] })
assert.equal(r.text, PEDAGOGY)

// Provider does not report the model: rejected (identity is never assumed).
r = await tutor('gpt-5.6-sol', { model: undefined, chunks: [content(PEDAGOGY)] })
assert.equal(r.text, 'El proveedor no informó el modelo servido; el producto es gpt-5.6-sol. El turno se rechaza.')
assert.equal(r.s.deliveryFailure, 'model_unreported'); assert.equal(r.s.servedModel, undefined)

// Provider refuses the model: the run stops; exactly one request, no fallback model tried.
const refused = Object.assign(new Error('The model `gpt-5.6-sol` does not exist'), { status: 404, code: 'model_not_found' })
r = await tutor('gpt-5.6-sol', refused)
assert.equal(requests.length, 1); assert.equal(requests[0].model, 'gpt-5.6-sol')
assert.equal(r.text, 'El proveedor rechazó el modelo gpt-5.6-sol; el turno no se ejecutó.'); assert.equal(r.s.deliveryFailure, 'model_rejected')

// Stream engine: a rejected turn ends as failed with servedModel in done, and changes no state.
async function turn(provider) {
  process.env.OPENAI_MAIN_MODEL = 'gpt-5.6-sol'; queue = [provider]
  const state = { ...DEFAULT_SESSION_STATE, sessionId: 's1', tokens: 3, interfaceLanguage: 'es', activeMode: 'interact' }
  const plan = orchestrateTutorFirst({ message: 'Enséñame el pretérito', state, interfaceLanguage: 'es', now: Date.now() })
  const reader = executePlanStream(plan, { message: 'Enséñame el pretérito', state, conversationId: 'cv_1' }, state).getReader()
  let buf = ''
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += new TextDecoder().decode(value) }
  const events = buf.split('\n\n').filter(e => e.startsWith('data: ')).map(e => JSON.parse(e.slice(6)))
  return { text: events.filter(e => e.delta).map(e => e.delta).join(''), done: events.find(e => e.done) }
}
let t = await turn({ model: 'gpt-4o-mini', chunks: [content(PEDAGOGY), { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c0', function: { name: 'record_learning_fact', arguments: JSON.stringify({ facts: [{ fact: 'goal', text: 'x', evidence: 'pretérito' }] }) } }] } }] }] })
assert.equal(t.text, 'Modelo incorrecto: se sirvió gpt-4o-mini, el producto es gpt-5.6-sol.')
assert.equal(t.done.turnState, 'failed'); assert.equal(t.done.servedModel, 'gpt-4o-mini')
assert.equal(t.done.state.tokens, 3, 'a rejected turn credits no progress'); assert.equal(t.done.learningFacts, undefined, 'no tool call of an unproven model is executed')
t = await turn({ model: 'gpt-5.6-sol', chunks: [content(PEDAGOGY)] })
assert.equal(t.text, PEDAGOGY); assert.equal(t.done.servedModel, 'gpt-5.6-sol'); assert.equal(t.done.turnState, 'complete')

delete process.env.OPENAI_MAIN_MODEL
Object.assign(console, quiet)
console.log('PASS product model gpt-5.6-sol: config refused before the provider; served identity verified before publishing; mismatch/unreported/refused reject the turn; done carries servedModel')
