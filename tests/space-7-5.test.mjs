// 7.5 — the Space: N independent conversations, sources with provenance, confirmed vs inferred memory,
// retrieval with ids and a 1,500-token budget, Reset vs «borrar espacio», migration of the 7.4 session.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const { load } = await import('./_ts-loader.mjs')
const Mo = load('lib/space/model.ts')
const R = load('lib/space/retrieve.ts')
const St = load('lib/space/store.ts')
const H = load('lib/space/sha256.ts')
const Sv = load('server/space/context.ts')

const ui = { phase: 'chat', lang: 'en', mentor: 'sarah', topic: 'conversation', activeMode: 'interact' }
const session = id => ({ sessionId: id, tokens: 0 })
const backend = St.memoryBackend()
const store = St.createSpaceStore(backend)

// Migration: a 7.4 single session becomes the first conversation of a new Space.
const legacyMsgs = [{ id: '1', sender: 'user', text: 'Hola' }, { id: '2', sender: 'sarah', text: '¡Hola!' }]
const opened = await store.open(async () => ({ session: session('legacy'), ui, msgs: legacyMsgs }), () => ({ session: session('fresh'), ui }))
assert.equal(opened.migrated, true); assert.equal(opened.conversation.msgs.length, 2); assert.equal(opened.space.conversations.length, 1)
const again = await store.open(async () => { throw Error('legacy must not be read twice') }, () => ({ session: session('x'), ui }))
assert.equal(again.space.id, opened.space.id); assert.equal(again.conversation.id, opened.conversation.id, 'reopening returns the same Space and conversation')

// Two conversations. A carries a private word.
let space = opened.space
const A = { ...opened.conversation, msgs: [...legacyMsgs, { id: '3', sender: 'user', text: 'Mi contraseña secreta es ZORROAZUL' }, { id: '4', sender: 'sarah', text: 'No compartas ZORROAZUL.' }] }
assert.equal(await store.saveConversation(A), 'saved')
const created = await store.newConversation(space, { session: session('b'), ui })
space = created.space
const B = { ...created.conversation, msgs: [{ id: 'b1', sender: 'user', text: 'Quiero repasar el subjuntivo' }] }
await store.saveConversation(B)
assert.equal(space.conversations.length, 2); assert.equal(space.activeConversationId, B.id)

// Space material: one source, one confirmed fact, one inferred fact from A.
const text = 'El subjuntivo expresa deseo y duda.\n\nOjalá que llueva mañana.\n\nZORROAZUL no aparece aquí.'
const sha = await H.sha256Hex(text)
assert.equal(sha, createHash('sha256').update(text, 'utf8').digest('hex'), 'SHA-256 of the exact text')
space = Mo.addSource(space, { name: 'apuntes.md', mime: 'text/markdown', text: 'El subjuntivo expresa deseo y duda.\n\nOjalá que llueva mañana.', sha256: await H.sha256Hex('El subjuntivo expresa deseo y duda.\n\nOjalá que llueva mañana.') })
assert.ok(Mo.isRefusal(Mo.addSource(space, { name: 'copia.md', mime: 'text/markdown', text: 'x', sha256: space.sources[0].sha256 })), 'an identical source is refused by hash, visibly')
space = Mo.addConfirmedFact(space, 'objetivo', 'DELE B2 subjuntivo en junio')
space = Mo.mirrorInferredMemory(space, A.id, [{ id: 'm1', kind: 'fact', text: 'Guarda la palabra ZORROAZUL' }])
assert.equal(space.memory.filter(f => f.kind === 'inferred').length, 1)

// No contamination: B's request carries B's history and the Space, never A's messages or A's inferences.
const req = R.buildConversationRequest(space, B, 'Explícame el subjuntivo con ZORROAZUL')
const wire = JSON.stringify(req)
assert.ok(!wire.includes('Mi contraseña secreta'), "B never receives A's messages")
assert.ok(!wire.includes('No compartas ZORROAZUL'), "B never receives A's Tutor replies")
assert.ok(!wire.includes('Guarda la palabra'), 'an inferred fact of A is not retrieved into B')
assert.deepEqual(req.conversationHistory.map(h => h.content), ['Quiero repasar el subjuntivo'])
const ids = req.spaceContext.blocks.map(b => b.id)
assert.ok(ids.some(id => /^source:src_[a-z0-9]+#1$/.test(id)), 'source passage with provenance id')
assert.ok(ids.some(id => /^memory:mf_[a-z0-9]+$/.test(id)), 'confirmed fact retrieved with its id')
// Once the student confirms the inference, it may travel.
const inferredId = space.memory.find(f => f.kind === 'inferred').id
const confirmedSpace = Mo.confirmFact(space, inferredId)
assert.ok(JSON.stringify(R.buildConversationRequest(confirmedSpace, B, 'ZORROAZUL').spaceContext).includes('Guarda la palabra ZORROAZUL'))

// Instructions always; passages only on lexical overlap; budget enforced with an omitted count.
space = Mo.setInstructions(space, 'Explícame en inglés.')
const none = R.retrieveForTurn(space, 'Buenos días')
assert.equal(none.instructions, 'Explícame en inglés.'); assert.equal(none.blocks.length, 0)
const big = Array.from({ length: 40 }, (_, i) => `Párrafo ${i} sobre el subjuntivo y sus usos en oraciones de deseo número ${i}. `.repeat(6)).join('\n\n')
let bigSpace = Mo.addSource(space, { name: 'libro.txt', mime: 'text/plain', text: big, sha256: await H.sha256Hex(big) })
const r = R.retrieveForTurn(bigSpace, 'subjuntivo deseo')
assert.ok(r.usedTokens <= R.RETRIEVAL_TOKEN_BUDGET, 'within 1,500 tokens'); assert.ok(r.omitted > 0, 'what did not fit is counted, not hidden')

// Server: shape and budget re-checked; bad ids and over-budget blocks are dropped; output names every id.
const forged = { spaceId: space.id, instructions: 'x', blocks: [...r.blocks, { id: 'conversation:' + A.id, kind: 'source', label: 'A', text: 'ZORROAZUL' }, ...r.blocks], omitted: 0 }
const clean = Sv.sanitizeSpaceContext(forged)
assert.ok(!JSON.stringify(clean).includes('conversation:'), 'only source:/memory: provenance ids are accepted')
assert.ok(clean.usedTokens <= R.RETRIEVAL_TOKEN_BUDGET); assert.equal(clean.blocks.length, r.blocks.length, 'duplicated ids are dropped'); assert.equal(new Set(clean.blocks.map(b => b.id)).size, clean.blocks.length)
const rendered = Sv.formatSpaceContext(clean)
for (const b of clean.blocks) assert.ok(rendered.includes('[' + b.id + ' · '), 'every block is rendered with its id')
assert.equal(Sv.sanitizeSpaceContext({ spaceId: '../../etc', blocks: [] }), null)

// Reset empties only the active conversation; the Space and the other conversation stay.
await store.saveSpace(bigSpace)
const cleared = await store.resetConversation(B, { session: session('b2'), ui })
assert.equal(cleared.id, B.id); assert.equal(cleared.msgs.length, 0)
assert.equal((await store.loadConversation(A.id)).msgs.length, 4, 'other conversation untouched')
assert.equal((await backend.get(St.SPACE_STORE, 'current')).sources.length, 2, 'sources untouched by Reset')

// Deleting a conversation removes its inferred memory, not the confirmed memory.
const del = await store.deleteConversation(confirmedSpace, A.id, { session: session('n'), ui })
assert.ok(!del.space.conversations.some(c => c.id === A.id))
assert.ok(del.space.memory.every(f => f.kind === 'confirmed'))
assert.equal(await store.loadConversation(A.id), null)

// «Borrar espacio» removes everything.
assert.equal(await store.deleteSpace(del.space), true)
assert.equal(await backend.get(St.SPACE_STORE, 'current'), undefined)
for (const c of del.space.conversations) assert.equal(await store.loadConversation(c.id), null)

// Oversized conversation: saved reduced and marked, never silently cropped.
const reducing = St.createSpaceStore(St.memoryBackend(), { reduceMessage: m => ({ ...m, artifact: null, persistLoss: true }) })
const o = await reducing.open(async () => null, () => ({ session: session('z'), ui }))
const huge = { ...o.conversation, msgs: [{ id: 'h', sender: 'sarah', text: 'pdf', artifact: { type: 'pdf', url: 'data:application/pdf;base64,' + 'A'.repeat(St.MAX_CONVERSATION_CHARS) } }] }
assert.equal(await reducing.saveConversation(huge), 'reduced')
const back = await reducing.loadConversation(huge.id)
assert.equal(back.reduced, true); assert.equal(back.msgs[0].persistLoss, true)
console.log('PASS 7.5 — Space: isolated conversations, provenance, confirmed≠inferred, 1,500-token retrieval, Reset≠borrar espacio, migration')
