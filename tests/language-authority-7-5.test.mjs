// 7.5 P1-A — the language of the Tutor's explanations is a state contract (order "P1 DOBLE", point 2).
// Precedence: explicit student request (proven by their words) > picker selection > (OTROS only) Tutor-settled.
// A Spanish exercise, an Italian expression, a mixed sentence or an ASR hypothesis never changes it.
// Real paths: lib/explanatory-language + Tutor engine + stream engine; provider transport simulated.
import assert from 'node:assert/strict'
import Module from 'node:module'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-only'
process.env.OPENAI_MAIN_MODEL = 'gpt-5.6-sol'
let queue = [], requests = []
class FakeOpenAI { chat = { completions: { create: async (req) => { requests.push(JSON.parse(JSON.stringify(req))); const next = queue.shift(); return (async function* () { for (const c of next) yield { model: 'gpt-5.6-sol', ...c } })() } } } }
const originalLoad = Module._load
Module._load = function (name, ...rest) { if (name === 'openai') return FakeOpenAI; return originalLoad.call(this, name, ...rest) }
const { load } = await import('./_ts-loader.mjs')
const L = load('lib/explanatory-language.ts')
const M = load('server/mentors/mentor-engine.ts')
const { executePlanStream } = load('server/core/execution-engine-stream.ts')
const { orchestrateTutorFirst } = load('server/core/tutor-first-orchestrator.ts')
const { DEFAULT_SESSION_STATE } = load('lib/contracts.ts')
const quiet = { warn: console.warn, info: console.info, error: console.error }
console.warn = () => {}; console.info = () => {}; console.error = () => {}

// 1. Precedence (pure).
assert.deepEqual(L.resolveExplanatoryLanguage({ interfaceLanguage: 'es' }), { language: 'es', source: 'selection' })
assert.deepEqual(L.resolveExplanatoryLanguage({ interfaceLanguage: 'es', explanatoryLanguage: 'en' }), { language: 'es', source: 'selection' }, 'a 7.4 value without the student request never overrides the selection')
assert.deepEqual(L.resolveExplanatoryLanguage({ interfaceLanguage: 'es', explanatoryLanguage: 'en', explanatoryLanguageSource: 'tutor_detected' }), { language: 'es', source: 'selection' })
assert.deepEqual(L.resolveExplanatoryLanguage({ interfaceLanguage: 'es', explanatoryLanguage: 'en', explanatoryLanguageSource: 'student_request' }), { language: 'en', source: 'student_request' })
assert.deepEqual(L.resolveExplanatoryLanguage({ interfaceLanguage: 'en', uiLanguageChoice: 'other' }), { language: null, source: null })
assert.deepEqual(L.resolveExplanatoryLanguage({ interfaceLanguage: 'en', uiLanguageChoice: 'other', explanatoryLanguage: 'ar' }), { language: 'ar', source: 'tutor_detected' })

// 2. Decisions (pure): only the student's own words can change a selected language.
const es = { interfaceLanguage: 'es' }
assert.equal(L.decideLanguageDeclaration({ declared: 'en', state: es, studentWords: 'I go to the beach yesterday' }).reason, 'language_change_not_requested')
assert.equal(L.decideLanguageDeclaration({ declared: 'it', evidence: 'explain in Italian', state: es, studentWords: 'In bocca al lupo, ¿qué significa?' }).reason, 'evidence_not_in_student_words')
assert.deepEqual(L.decideLanguageDeclaration({ declared: 'en', evidence: 'explícamelo en inglés', state: es, studentWords: 'Por favor, explícamelo en inglés.' }), { outcome: 'accepted', language: 'en', source: 'student_request' })
assert.equal(L.decideLanguageDeclaration({ declared: 'en', evidence: 'en inglés', state: es, studentWords: 'háblame en inglés', uncertain: ['en inglés'] }).reason, 'evidence_uncertain', 'an ASR doubt never proves a request')
assert.equal(L.decideLanguageDeclaration({ declared: 'es-ES', state: es, studentWords: 'x' }).outcome, 'unchanged')
assert.deepEqual(L.decideLanguageDeclaration({ declared: 'ar', state: { interfaceLanguage: 'en', uiLanguageChoice: 'other' }, studentWords: 'مرحبا' }), { outcome: 'accepted', language: 'ar', source: 'tutor_detected' })
assert.equal(L.decideLanguageDeclaration({ declared: 'en', state: { interfaceLanguage: 'en', uiLanguageChoice: 'other', explanatoryLanguage: 'ar', explanatoryLanguageSource: 'tutor_detected' }, studentWords: 'hello' }).reason, 'language_change_not_requested', 'OTROS: once settled, a change also needs the student request')

// 3. Real engine: what the Tutor is told, and what the session keeps.
const text = t => ({ choices: [{ delta: { content: t } }] })
const langCall = args => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'set_explanatory_language', arguments: JSON.stringify(args) } }] } }] })
async function turn(message, stateExtra, provider, voice) {
  queue = provider.map(x => x); requests = []
  const state = { ...DEFAULT_SESSION_STATE, sessionId: 's', tokens: 4, activeMode: 'interact', mentorProfile: 'Sarah', ...stateExtra }
  const plan = orchestrateTutorFirst({ message, state, interfaceLanguage: state.interfaceLanguage, now: Date.now() })
  const reader = executePlanStream(plan, { message, state, conversationId: 'cv', ...(voice ? { voice } : {}) }, state).getReader()
  let buf = ''
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += new TextDecoder().decode(value) }
  const events = buf.split('\n\n').filter(e => e.startsWith('data: ')).map(e => JSON.parse(e.slice(6)))
  const first = requests[0].messages, note = first[first.length - 1].content
  const toolResult = requests[1]?.messages.find(m => m.role === 'tool')?.content ?? null
  return { done: events.find(e => e.done), text: events.filter(e => typeof e.delta === 'string').map(e => e.delta).join(''), note, toolResult, system: first[0].content }
}
// 3a. Spanish selected; an English-looking transcription and a Tutor that declares English without a request.
let r = await turn('I want to go to the beach today', { interfaceLanguage: 'es' }, [[langCall({ language: 'en' })], [text('¿Qué quieres hacer en la playa?')]])
assert.match(r.note, /explanatoryLanguage = "es" \(the student selected it\)/)
assert.match(r.system, /explanatoryLanguage=es; targetLanguage=es/)
assert.match(r.toolResult, /Language NOT changed: it stays es/)
assert.equal(r.done.state.explanatoryLanguage, undefined, 'nothing recorded'); assert.equal(r.done.state.explanatoryLanguageSource, undefined)
// 3b. A session poisoned by 7.4 (explanatoryLanguage 'en' recorded without the student's request) is repaired.
r = await turn('Hola, ¿qué tal?', { interfaceLanguage: 'es', explanatoryLanguage: 'en' }, [[text('¡Muy bien!')]])
assert.match(r.note, /explanatoryLanguage = "es"/)
// 3c. An Italian expression is content, not a language request.
r = await turn('¿Qué significa «in bocca al lupo»?', { interfaceLanguage: 'es' }, [[text('Es una expresión italiana. '), langCall({ language: 'it', evidence: 'in bocca al lupo' })], [text('Significa «buena suerte».')]])
assert.equal(r.done.state.explanatoryLanguage, 'it', 'the quote is in the student words: the contract cannot judge meaning (documented limit)')
// …but without a quote it is refused.
r = await turn('¿Qué significa «in bocca al lupo»?', { interfaceLanguage: 'es' }, [[text('Es italiano. '), langCall({ language: 'it' })], [text('Significa «buena suerte».')]])
assert.equal(r.done.state.explanatoryLanguage, undefined)
// 3d. An explicit request is recorded with its source and binds the next turns.
r = await turn('Por favor, explícamelo en inglés.', { interfaceLanguage: 'es' }, [[langCall({ language: 'en', evidence: 'explícamelo en inglés' })], [text('Sure: «ser» is for…')]])
assert.equal(r.done.state.explanatoryLanguage, 'en'); assert.equal(r.done.state.explanatoryLanguageSource, 'student_request')
// The continuation after the declaration arrives in chunks and reads as written (no break inside it).
let r2 = await turn('Por favor, explícamelo en inglés.', { interfaceLanguage: 'es' }, [[langCall({ language: 'en', evidence: 'explícamelo en inglés' })], [text('Of'), text(' course. '), text('From now on, English.')]])
assert.equal(r2.text, 'Of course. From now on, English.')
r = await turn('Yo soy cansado', { ...r.done.state }, [[text('We say «estoy cansado».')]])
assert.match(r.note, /explanatoryLanguage = "en" \(the student asked for it\)/)
// 3e. A spoken turn: the recognizer's doubts are facts; a request inside a doubtful fragment does not count.
r = await turn('háblame en inglés', { interfaceLanguage: 'es' }, [[langCall({ language: 'en', evidence: 'en inglés' })], [text('¿Me lo repites?')]],
  { transcript: 'háblame en inglés', uncertain: ['en inglés'], asrModel: 'test', asrMs: 1 })
assert.equal(r.done.state.explanatoryLanguage, undefined)
assert.match(r.note, /\[SPOKEN TURN\]/); assert.match(r.note, /not sure about: «en inglés»/); assert.match(r.note, /Do not treat these as the student's mistakes/)
// 3f. OTROS: the first language the Tutor settles on is recorded as detected.
r = await turn('مرحبا، أريد أن أتعلم', { interfaceLanguage: 'en', uiLanguageChoice: 'other' }, [[langCall({ language: 'ar' })], [text('أهلاً!')]])
assert.equal(r.done.state.explanatoryLanguage, 'ar'); assert.equal(r.done.state.explanatoryLanguageSource, 'tutor_detected')
// 3g. Opening greeting with Spanish selected keeps its own format.
queue = [[text('¡Hola!')]]; requests = []
const s0 = { ...DEFAULT_SESSION_STATE, interfaceLanguage: 'es', tokens: 0 }
const st = await M.getMentorResponseStream({ request: { message: '' }, state: s0 }); for await (const _ of st) {}
assert.match(requests[0].messages.at(-1).content, /Opening greeting: the student has not written yet and selected Spanish/)

Object.assign(console, quiet)
console.log('PASS 7.5 language authority: selection binds; change only by the student\'s own words; ASR doubts and examples never switch; legacy sessions repaired; OTROS settles once')
