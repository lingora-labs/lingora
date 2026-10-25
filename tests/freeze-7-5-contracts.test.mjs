// 7.5 freeze — written contracts: authority, language note, export refusals, prose turns, mode labels.
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-only'
const { load, ROOT } = await import('./_ts-loader.mjs')
const read = p => fs.readFileSync(ROOT + '/' + p, 'utf8')

// 1. Authority: every conversational turn goes to the mentor; no intent classifier anywhere in the turn path.
const O = load('server/core/tutor-first-orchestrator.ts')
for (const message of ['Hola', 'Hazme un PDF', 'Traduce al inglés: ayer fui al mercado', 'Enséñame acupuntura desde cero', '']) {
  const plan = O.orchestrateTutorFirst({ message, state: { tokens: 3, activeMode: 'interact' }, interfaceLanguage: 'es', now: 1 })
  assert.equal(plan.executor, 'mentor'); assert.equal(plan.executionOrder[0].executor, 'mentor')
}
for (const p of ['server/api/chat-entry.ts', 'server/core/tutor-first-plan.ts', 'server/core/tutor-first-orchestrator.ts', 'server/core/execution-engine-stream.ts', 'server/mentors/mentor-engine.ts', 'app/api/chat/route.ts']) {
  assert.doesNotMatch(read(p), /classifyIntent\s*\(|\borchestrate\s*\(/, p + ' calls no intent classifier or legacy orchestrator')
}
assert.ok(read('app/api/chat/route.ts').split('\n').length < 20, 'route.ts stays an adapter')

// 2. complete_tutor_turn: artifacts required, reply optional; a turn without artifacts is prose; no count cap.
const A = load('lib/artifact-signal.ts')
const tool = A.COMPLETE_TUTOR_TURN_TOOL.function.parameters
assert.deepEqual(tool.required, ['artifacts'])
assert.deepEqual(A.parseClosedTutorTurn({ artifacts: [] }, 'Prosa del Tutor.'), { reply: 'Prosa del Tutor.', artifacts: [] })
const six = Array.from({ length: 6 }, (_, i) => ({ type: 'table_matrix', trigger: 'explicit_user_request', subject: 'Tabla ' + (i + 1), format: 'native', content: { columns: ['a', 'b'], rows: [{ cells: ['x' + i, 'y'] }] } }))
const turn = A.parseClosedTutorTurn({ artifacts: six }, 'Seis tablas.')
assert.equal(turn.artifacts.length, 6, 'no cap of 5 artifacts per turn')

// 3. Language: the greeting note exists only while the student has written nothing.
const M = load('server/mentors/mentor-engine.ts')
const greet = M.buildMentorPrompt({ message: '', state: { tokens: 0, interfaceLanguage: 'ar' }, opening: true })
assert.match(greet.languageNote, /first the greeting in Spanish/); assert.match(greet.languageNote, /"ar"/)
for (const tokens of [0, 1, 2, 3, 9]) {
  const t = M.buildMentorPrompt({ message: 'مرحبا، أريد أن أتعلم', state: { tokens, interfaceLanguage: 'ar' }, opening: false })
  assert.doesNotMatch(t.languageNote, /Opening greeting/, `no greeting note once the student wrote (tokens=${tokens})`)
  assert.doesNotMatch(t.system, /targetLanguage=es\. This is the opening greeting/)
}
const C = load('lib/context-pack.ts')
assert.doesNotMatch(C.formatLanguageTurnNote(C.buildContextPack({ interfaceLanguage: 'ar', message: 'x', turnCount: 5 }), { opening: false }), /Opening greeting/, 'absent with tokens > 2')
const es = M.buildMentorPrompt({ message: 'Can you explain in English?', state: { tokens: 4, interfaceLanguage: 'es' }, opening: false })
// 7.5 P1-A: the selection binds; an explicit request changes it through set_explanatory_language with the student's words.
assert.match(es.system, /targetLanguage=es\. Previous explanatoryLanguage=es/, 'Spanish selected is the remembered starting language, not a permanent lock')
assert.match(es.languageNote, /conversation_shift or explicit_request/, 'the tutor may change its language on an explicit request or a contextual shift')
// interfaceLanguage travels in the body state and reaches the plan unchanged.
assert.match(read('app/beta/use-beta-page.ts'), /interfaceLanguage: BACKEND_LANG\(langRef\.current\)/)
assert.match(read('server/api/chat-entry.ts'), /interfaceLanguage:state\.interfaceLanguage \?\? 'en'/)

// Mode labels: one translation per interface language, no silent fallback for a language that has its key.
const model = read('app/beta/beta-model.ts')
const langs = /export type Lang = ([^\n]+)/.exec(model)[1].match(/'([a-z]{2})'/g).map(s => s.slice(1, 3))
const table = model.slice(model.indexOf('const MODE_COPY_RAW'), model.indexOf('export const MODE_UI_COPY'))
for (const l of langs) assert.ok(table.includes(`"${l}": [`), 'MODE_COPY_RAW has ' + l)
assert.match(read('app/beta/beta-page-view.tsx'), /MODE_UI_COPY\[lang\] \?\? MODE_UI_COPY\.en/)

// 4. Export: one preparation; refuses a reduced session, an unfinished turn, and a payload over the limit (real size).
const E = load('app/beta/export-turns.ts')
const ok = [{ id: '1', sender: 'user', text: 'Hola' }, { id: '2', sender: 'sarah', text: 'Hola, ¿qué tal?', complete: true }]
assert.equal(E.prepareConversationExport(ok).ok, true)
const lost = E.prepareConversationExport([...ok, { id: '3', sender: 'sarah', text: 'x', persistLoss: true }])
assert.equal(lost.ok, false); assert.match(lost.message, /se recuperó reducida/)
const open = E.prepareConversationExport([...ok, { id: '3', sender: 'sarah', text: 'escribiendo…', complete: false }])
assert.equal(open.ok, false); assert.match(open.message, /en curso o quedó interrumpida/)
const heavy = E.prepareConversationExport([...ok, { id: '4', sender: 'sarah', text: 'x'.repeat(E.EXPORT_PAYLOAD_LIMIT_BYTES + 10) }])
assert.equal(heavy.ok, false); assert.match(heavy.message, /ocupa 4\.0 MB y supera los 4 MB/)
const page = read('app/beta/use-beta-page.ts'), io = read('app/beta/beta-io.ts')
assert.ok(page.includes('prepareConversationExport(msgsRef.current)') && io.includes('prepareConversationExport(msgs)'), 'menu, chip and conversation_pdf share one preparation')
assert.match(page, /clientDeliveries\.includes\('conversation_pdf'\)\) pendingExportRef\.current = true/)

// 5. Documents: one reader; a lost word aborts with a named refusal the student reads.
const D = load('lib/content/document-page.ts')
const Md = load('lib/content/markdown.ts')
assert.deepEqual(Md.missingWords('hola mundo', '<p>hola</p>'), ['mundo'], 'the loss gate names the missing word')
assert.ok(D.renderDocumentBody({ title: 't', sections: [{ text: 'Hola **mundo** y `código`' }] }).html.includes('mundo'))
assert.match(D.explainDocumentRefusal('export_content_loss:texto:hola'), /habría perdido texto/)
for (const p of ['app/beta/beta-chat-ui.tsx', 'lib/content/document-page.ts', 'server/tools/pdf/conversationExport.ts']) assert.match(read(p), /renderTutorMarkdown|renderDocumentPage/, p + ' reads through the canonical reader')
console.log('PASS 7.5 freeze contracts — authority, language note, export refusals, prose turns, mode labels')
