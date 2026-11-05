// 7.7-SOL — the Tutor on gpt-6.1-sol through the Responses API, in the isolated evaluation preview ONLY.
// Real paths: Tutor engine + stream engine; only the provider transport is simulated (Responses stream events).
// Guarantees: the request has no temperature/top_p/none, strict:false tools at top level, store:false; the engine reads the SAME
// chunk shape as for every model (identity gate, tools, continuation, usage); identity is verified, never assumed;
// production and every other environment stay on gpt-5.6-sol and can never be moved by a shared variable.
import assert from 'node:assert/strict'
import Module from 'node:module'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-only'
let queue = [], requests = [], chatCalls = 0
class FakeOpenAI {
  chat = { completions: { create: async () => { chatCalls++; throw new Error('Chat Completions must not be used for gpt-6.1-sol') } } }
  responses = { create: async (req) => { requests.push(JSON.parse(JSON.stringify(req))); const next = queue.shift(); if (next instanceof Error) throw next; return events(next) } }
}
const originalLoad = Module._load
Module._load = function (name, ...rest) { if (name === 'openai') return FakeOpenAI; return originalLoad.call(this, name, ...rest) }
const SOL = 'gpt-6.1-sol'
/** A Responses stream: created → (text deltas | function calls) → completed with usage. */
async function* events({ model = SOL, parts = [], usage = { input_tokens: 1200, output_tokens: 60, input_tokens_details: { cached_tokens: 1000 }, output_tokens_details: { reasoning_tokens: 12 } }, fail = false, completedModel }) {
  yield { type: 'response.created', response: { id: 'resp_1', model } }
  for (const p of parts) {
    if (p.text !== undefined) { yield { type: 'response.output_text.delta', delta: p.text } }
    if (p.call) {
      const id = 'fc_' + p.call.id
      yield { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id, call_id: p.call.id, name: p.call.name, arguments: '' } }
      const a = JSON.stringify(p.call.args), mid = Math.floor(a.length / 2)
      if (p.call.noDeltas) { yield { type: 'response.output_item.done', item: { type: 'function_call', id, call_id: p.call.id, name: p.call.name, arguments: a } } }
      else { yield { type: 'response.function_call_arguments.delta', item_id: id, delta: a.slice(0, mid) }; yield { type: 'response.function_call_arguments.delta', item_id: id, delta: a.slice(mid) }; yield { type: 'response.function_call_arguments.done', item_id: id, arguments: a }; yield { type: 'response.output_item.done', item: { type: 'function_call', id, call_id: p.call.id, name: p.call.name, arguments: a } } }
    }
  }
  if (fail) { yield { type: 'response.failed', response: { error: { message: 'boom' } } }; return }
  yield { type: 'response.completed', response: { id: 'resp_1', model: completedModel ?? model, usage } }
}
const { load } = await import('./_ts-loader.mjs')
const T = load('server/mentors/responses-transport.ts')
const M = load('server/mentors/mentor-engine.ts')
const { executePlanStream } = load('server/core/execution-engine-stream.ts')
const { orchestrateTutorFirst } = load('server/core/tutor-first-orchestrator.ts')
const { DEFAULT_SESSION_STATE } = load('lib/contracts.ts')
const quiet = { warn: console.warn, error: console.error, info: console.info }
const infos = []; console.warn = () => {}; console.error = () => {}; console.info = (...a) => infos.push(a)
const PED = 'Lección: el pretérito indefinido se usa para acciones terminadas.'
const preview = () => { process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'ae/7-7-sol-6-1-evaluation'; process.env.OPENAI_MAIN_MODEL = 'gpt-5.6-sol'; delete process.env.TUTOR_REASONING_EFFORT }
const production = () => { delete process.env.VERCEL_ENV; delete process.env.VERCEL_GIT_COMMIT_REF; process.env.OPENAI_MAIN_MODEL = 'gpt-5.6-sol' }
async function tutor(provider) {
  queue = provider === undefined ? [] : [].concat(provider); requests = []
  const s = await M.getMentorResponseStream({ request: { message: 'Enséñame el pretérito' }, state: { tokens: 3 } })
  let text = ''; for await (const d of s) text += d
  return { s, text }
}

// 0. Which model, where.
production(); assert.equal(M.expectedProductModel(), 'gpt-5.6-sol'); assert.equal(M.PRODUCT_MODEL, 'gpt-5.6-sol'); assert.equal(M.EVAL_MODEL, SOL)
preview(); assert.equal(M.expectedProductModel(), SOL)
for (const [env, ref] of [['production', 'ae/7-7-sol-6-1-evaluation'], ['preview', 'dae/7-6-call-mode-r1'], ['preview', 'main'], [undefined, 'ae/7-7-sol-6-1-evaluation'], ['development', 'ae/7-7-sol-6-1-evaluation']]) {
  process.env.VERCEL_ENV = env ?? ''; process.env.VERCEL_GIT_COMMIT_REF = ref
  assert.equal(M.expectedProductModel(), 'gpt-5.6-sol', `${env}/${ref} stays on the production pin`)
}
production()

// 1. The exact request: no sampling params, no `none`, strict:false tools at top level, store:false, no Chat Completions.
const tools = [{ type: 'function', function: { name: 'x', description: 'd', parameters: { type: 'object', properties: { a: { type: 'string' } } } } }]
const body = T.buildResponsesBody({ model: SOL, maxOutputTokens: 4096, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], tools, toolChoice: 'auto' })
assert.deepEqual(Object.keys(body).sort(), ['input', 'max_output_tokens', 'model', 'reasoning', 'store', 'stream', 'tool_choice', 'tools'])
assert.equal(body.reasoning.effort, 'low'); assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.max_output_tokens, 4096)
assert.deepEqual(body.tools, [{ type: 'function', name: 'x', description: 'd', parameters: tools[0].function.parameters, strict: false }])
assert.ok(!('temperature' in body) && !('top_p' in body) && !('max_completion_tokens' in body) && !('stream_options' in body))
assert.equal(T.tutorEffort('medium'), 'medium'); assert.equal(T.tutorEffort('none'), 'low'); assert.equal(T.tutorEffort('minimal'), 'low'); assert.equal(T.tutorEffort(undefined), 'low'); assert.equal(T.tutorEffort('high'), 'low')
assert.ok(T.usesResponsesApi('gpt-6.1-sol') && !T.usesResponsesApi('gpt-5.6-sol') && !T.usesResponsesApi('gpt-4o-mini'))
// Messages with a tool round trip → input items correlated by call_id.
const input = T.toResponsesInput([
  { role: 'system', content: 'S' }, { role: 'user', content: 'U' },
  { role: 'assistant', content: 'texto', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'deliver_from_text', arguments: '{"kind":"pdf"}' } }] },
  { role: 'tool', tool_call_id: 'call_1', content: 'ok' }, { role: 'assistant', content: null, tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'y', arguments: '' } }] }])
assert.deepEqual(input, [
  { role: 'system', content: 'S' }, { role: 'user', content: 'U' }, { role: 'assistant', content: 'texto' },
  { type: 'function_call', call_id: 'call_1', name: 'deliver_from_text', arguments: '{"kind":"pdf"}' },
  { type: 'function_call_output', call_id: 'call_1', output: 'ok' }, { type: 'function_call', call_id: 'call_2', name: 'y', arguments: '{}' }])

// 2. A plain turn through the real engine: text arrives intact, identity verified, request is Responses, usage carries reasoning.
preview()
let r = await tutor({ parts: [{ text: 'Lección: ' }, { text: 'el pretérito indefinido se usa para acciones terminadas.' }] })
assert.equal(r.text, PED); assert.equal(r.s.servedModel, SOL); assert.equal(r.s.deliveryFailure, undefined); assert.equal(chatCalls, 0)
assert.equal(requests.length, 1); assert.equal(requests[0].model, SOL); assert.equal(requests[0].reasoning.effort, 'low'); assert.equal(requests[0].store, false)
assert.ok(!('temperature' in requests[0]) && !('top_p' in requests[0]))
assert.ok(requests[0].tools.length >= 2 && requests[0].tools.every(t => t.type === 'function' && t.name && t.strict === false && !t.function), 'tools are Responses-shaped')
assert.ok(requests[0].tools.some(t => t.name === 'complete_tutor_turn'))
assert.deepEqual(r.s.usage, { prompt: 1200, completion: 60, cached: 1000, calls: 1, reasoning: 12, effort: 'low' })
process.env.TUTOR_REASONING_EFFORT = 'medium'
r = await tutor({ parts: [{ text: PED }] }); assert.equal(requests[0].reasoning.effort, 'medium'); assert.equal(r.s.usage.effort, 'medium')
preview()

// 3. Identity: verified on every response, never assumed, never relaxed for a dated snapshot or another model.
for (const served of ['gpt-5.6-sol', 'gpt-6.1-sol-2026-11-01', 'gpt-6-sol', 'gpt-4o-mini']) {
  r = await tutor({ model: served, parts: [{ text: PED }] })
  assert.equal(r.text, `Modelo incorrecto: se sirvió ${served}, el producto es ${SOL}.`); assert.ok(!r.text.includes('pretérito'))
  assert.equal(r.s.deliveryFailure, 'model_mismatch'); assert.equal(r.s.servedModel, served)
}
r = await tutor({ model: '', parts: [{ text: PED }], completedModel: '' })
assert.equal(r.text, `El proveedor no informó el modelo servido; el producto es ${SOL}. El turno se rechaza.`); assert.equal(r.s.deliveryFailure, 'model_unreported')
// Configuration: refused before the provider.
for (const env of [undefined, '', 'gpt-4o-mini', 'gpt-6.1-sol-mini']) {
  if (env === undefined) delete process.env.OPENAI_MAIN_MODEL; else process.env.OPENAI_MAIN_MODEL = env
  r = await tutor({ parts: [{ text: PED }] })
  assert.equal(requests.length, 0); assert.match(r.text, new RegExp(`el producto es ${SOL.replace(/\./g, '\\.')}\\. El turno no se envió al proveedor\\.$`)); assert.equal(r.s.deliveryFailure, 'model_config_invalid')
}
preview(); process.env.OPENAI_MAIN_MODEL = SOL; r = await tutor({ parts: [{ text: PED }] }); assert.equal(r.text, PED, 'the pin may also name the model explicitly'); preview()
// Production: gpt-6.1-sol can never be selected by a variable; the old transport is used.
production(); process.env.OPENAI_MAIN_MODEL = SOL
r = await tutor({ parts: [{ text: PED }] })
assert.equal(requests.length, 0); assert.equal(r.text, 'Error de configuración: OPENAI_MAIN_MODEL=gpt-6.1-sol; el producto es gpt-5.6-sol. El turno no se envió al proveedor.')
production()

// 4. Provider refuses the model: stops, one request, no fallback model.
preview()
r = await tutor(Object.assign(new Error('The model `gpt-6.1-sol` does not exist'), { status: 404, code: 'model_not_found' }))
assert.equal(requests.length, 1); assert.equal(r.text, `El proveedor rechazó el modelo ${SOL}; el turno no se ejecutó.`); assert.equal(r.s.deliveryFailure, 'model_rejected')
// A failed stream is an interrupted delivery, never invented text.
r = await tutor({ parts: [{ text: 'Parcial. ' }], fail: true })
assert.equal(r.text, 'Parcial. '); assert.equal(r.s.deliveryFailure, 'provider_stream_interrupted')

// 5. Tools through the real engine: fragmented arguments, arguments without deltas, a delivery that continues in the same turn.
const done = async (provider) => {
  preview(); queue = [].concat(provider); requests = []
  const state = { ...DEFAULT_SESSION_STATE, sessionId: 's1', tokens: 3, interfaceLanguage: 'es', activeMode: 'interact' }
  const plan = orchestrateTutorFirst({ message: 'Enséñame el pretérito', state, interfaceLanguage: 'es', now: Date.now() })
  const reader = executePlanStream(plan, { message: 'Enséñame el pretérito', state, conversationId: 'cv_1' }, state).getReader()
  let buf = ''; for (;;) { const { done: d, value } = await reader.read(); if (d) break; buf += new TextDecoder().decode(value) }
  const ev = buf.split('\n\n').filter(e => e.startsWith('data: ')).map(e => JSON.parse(e.slice(6)))
  return { text: ev.filter(e => e.delta).map(e => e.delta).join(''), done: ev.find(e => e.done) }
}
const fact = { name: 'record_learning_fact', args: { facts: [{ fact: 'goal', text: 'x', evidence: 'pretérito' }] } }
let t = await done({ parts: [{ text: PED }, { call: { id: 'call_f1', ...fact } }] })
assert.equal(t.text, PED); assert.equal(t.done.servedModel, SOL); assert.equal(t.done.turnState, 'complete')
t = await done({ parts: [{ text: PED }, { call: { id: 'call_f2', ...fact, noDeltas: true } }] })
assert.equal(t.text, PED); assert.equal(t.done.turnState, 'complete')
// Identity not proven → no tool call of that response is executed, nothing published, no progress.
t = await done({ model: 'gpt-5.6-sol', parts: [{ text: PED }, { call: { id: 'call_f3', ...fact } }] })
assert.equal(t.text, `Modelo incorrecto: se sirvió gpt-5.6-sol, el producto es ${SOL}.`); assert.equal(t.done.turnState, 'failed'); assert.equal(t.done.state.tokens, 3); assert.equal(t.done.learningFacts, undefined)

// Continuation: the Tutor declared a delivery but wrote almost nothing → the SAME Tutor writes the material; the tool result travels as function_call_output.
preview(); queue = [
  { parts: [{ text: 'Va.' }, { call: { id: 'call_d1', name: 'deliver_from_text', args: { kind: 'pdf', title: 'Pretérito indefinido' } } }] },
  { parts: [{ text: '# Pretérito indefinido\n\nContenido completo del material.' }], usage: { input_tokens: 1500, output_tokens: 40, input_tokens_details: { cached_tokens: 1200 }, output_tokens_details: { reasoning_tokens: 5 } } }]
requests = []
const s2 = await M.getMentorResponseStream({ request: { message: 'Hazme un PDF del pretérito' }, state: { tokens: 3 } })
let text2 = ''; for await (const d of s2) text2 += d
assert.equal(requests.length, 2); assert.equal(text2, 'Va.\n\n# Pretérito indefinido\n\nContenido completo del material.')
const cont = requests[1]
assert.equal(cont.tool_choice, 'none'); assert.equal(cont.reasoning.effort, 'low'); assert.equal(chatCalls, 0)
assert.ok(cont.input.some(i => i.type === 'function_call' && i.call_id === 'call_d1' && i.name === 'deliver_from_text'))
assert.ok(cont.input.some(i => i.type === 'function_call_output' && i.call_id === 'call_d1' && /Delivery registered/.test(i.output)))
assert.ok(!cont.input.some(i => i.role === 'tool'), 'no Chat-style tool role in a Responses request')
assert.deepEqual(s2.textDeliveries, [{ kind: 'pdf', title: 'Pretérito indefinido' }])
assert.deepEqual(s2.usage, { prompt: 2700, completion: 100, cached: 2200, calls: 2, reasoning: 17, effort: 'low' }, 'both provider calls of the turn are counted')

// 6. The Chat Completions path of other models is untouched (same body as before 7.7).
const { buildModelParams } = M
assert.deepEqual(buildModelParams('gpt-5.6-sol', 100, 0.7, 0.88), { model: 'gpt-5.6-sol', max_completion_tokens: 100, reasoning_effort: 'none', temperature: 0.7 })

delete process.env.VERCEL_ENV; delete process.env.VERCEL_GIT_COMMIT_REF; delete process.env.OPENAI_MAIN_MODEL; delete process.env.TUTOR_REASONING_EFFORT
Object.assign(console, quiet)
console.log('PASS 7.7-SOL: gpt-6.1-sol via Responses (no sampling params, strict:false tools, store:false); same chunk shape for the engine; identity verified; production pinned to gpt-5.6-sol; tool round trip by call_id')
