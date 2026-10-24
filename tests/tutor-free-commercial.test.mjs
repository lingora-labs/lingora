// 7.5 — immersion is CONTEXT: facts in the ContextPack, frequency enforced by the runtime, no template,
// no appended sentence, no prohibition in the identity. The server lead channel stays behind the DAE gate.
import assert from 'node:assert/strict'
import fs from 'node:fs'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-only'
const { load, ROOT } = await import('./_ts-loader.mjs')
const read = p => fs.readFileSync(ROOT + '/' + p, 'utf8')
const C = load('lib/commercial-context.ts')
const S = load('server/core/commercial-context.ts')
const P = load('server/core/tutor-first-plan.ts')
const M = load('server/mentors/mentor-engine.ts')
const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 24, 12)
const base = { activeMode: 'interact', tokens: 6, sessionId: 'cv_a', commercialOffers: [], interfaceLanguage: 'es', confirmedLevel: 'B1', lastUserGoal: 'viajar a Medellín' }

// 1. buildCommercialContext → { level, goal, interest, offerAllowed }
const c0 = C.buildCommercialContext(base, now)
assert.equal(c0.level, 'B1'); assert.equal(c0.goal, 'viajar a Medellín'); assert.equal(c0.interest.recorded, false); assert.equal(c0.offerAllowed, true)
const withInterest = C.buildCommercialContext({ ...base, immersionInterest: [{ at: '2026-10-20T10:00:00.000Z', note: 'Me interesa Cartagena' }] }, now)
assert.equal(withInterest.interest.recorded, true); assert.equal(withInterest.interest.lastNote, 'Me interesa Cartagena')

// 2. Frequency: 1 per conversation, 2 per rolling 7 days across the Space (a new conversation does not reset the window).
assert.equal(C.buildCommercialContext({ ...base, commercialOffers: [{ timestamp: now - DAY, sessionId: 'cv_a' }] }, now).offerAllowed, false, 'one per conversation')
assert.equal(C.buildCommercialContext({ ...base, sessionId: 'cv_b', commercialOffers: [{ timestamp: now - DAY, sessionId: 'cv_a' }] }, now).offerAllowed, true, 'another conversation may still invite once')
assert.equal(C.buildCommercialContext({ ...base, sessionId: 'cv_c', commercialOffers: [{ timestamp: now - DAY, sessionId: 'cv_a' }, { timestamp: now - 2 * DAY, sessionId: 'cv_b' }] }, now).offerAllowed, false, 'two in 7 days across the Space')
assert.equal(C.buildCommercialContext({ ...base, sessionId: 'cv_c', commercialOffers: [{ timestamp: now - 8 * DAY, sessionId: 'cv_a' }, { timestamp: now - 2 * DAY, sessionId: 'cv_b' }] }, now).offerAllowed, true, 'the window is rolling')

// 3. Rendered as facts: no template sentence, no imperative, no appended offer.
const lines = C.formatCommercialFacts(c0)
assert.ok(lines.length >= 4 && lines.every(l => /^immersion\.[a-zA-Z]+: /.test(l)), 'key: value facts')
assert.doesNotMatch(lines.join('\n'), /\b(MAY|must|should|Do not|Don't|never sell|invite them|mention)\b/i, 'no instruction inside the facts')
const plan = P.buildTutorFirstPlan('Quiero practicar el pretérito', base, 'es', now)
assert.ok(plan.commercial && plan.commercial.offerAllowed === true, 'the plan carries the immersion facts (no longer undefined)')
assert.equal(plan.executionOrder[0].params.contextPack.commercial.level, 'B1', 'the same object is in the ContextPack')
const built = M.buildMentorPrompt({ message: 'Quiero practicar el pretérito', state: base, plan, opening: false })
assert.match(built.system, /immersion\.offerAllowed: true/)
assert.doesNotMatch(built.system, /IMMERSION CONTEXT|MAY naturally mention|Do not initiate a new immersion invitation/, 'the 7.4 order-style block is gone')
assert.doesNotMatch(read('server/mentors/profiles.ts'), /Solo menciona información comercial/, 'no prohibition of unsolicited offers in the identity')
assert.doesNotMatch(read('server/core/execution-engine-stream.ts'), /fullText\s*\+=\s*[^;]*(?:immersion|commercial)/i, 'nothing is appended to the Tutor reply')
assert.ok(!fs.existsSync(ROOT + '/server/core/commercial-engine.ts'), 'no template engine')

// 4. Only an invitation the Tutor actually sent, and only when the rule allowed it, is recorded.
assert.deepEqual(S.recordedImmersionOfferPatch(base, 'Respuesta pedagógica', now), {})
const rec = S.recordedImmersionOfferPatch(base, 'Si te apetece, mira [experiencias](/immersion).', now)
assert.equal(rec.commercialOffers.length, 1); assert.equal(rec.commercialOffers[0].sessionId, 'cv_a')
assert.deepEqual(S.recordedImmersionOfferPatch({ ...base, commercialOffers: rec.commercialOffers }, 'Otra vez /immersion', now + 1000), {}, 'over the limit nothing is recorded')

// 5. Server lead capture (email to LINGORA) stays behind the DAE privacy gate.
assert.equal(S.LEAD_CAPTURE_RELEASED, false)
assert.ok(read('app/api/immersion-interest/route.ts').includes('!LEAD_CAPTURE_RELEASED'))
assert.ok(read('app/immersion/page.tsx').includes('recordInterest('), 'with the server channel closed, interest is recorded in the Space')

// Unchanged 7.2 guarantees.
assert.match(read('server/mentors/mentor-engine.ts'), /tool_choice:wantsVisualReview\?'none':'auto'/)
assert.doesNotMatch(read('server/core/execution-engine-stream.ts'), /evaluateCommercial\(/)
assert.match(read('server/core/execution-engine-stream.ts'), /if\(request.uiAction==='create_visual_review'\)/, 'visual materialization is authorized only by Article 27 tactile action')
console.info('PASS 7.5 — immersion as context: facts, frequency 1/conversation + 2/7 days per Space, no template, no append, server gate closed')
