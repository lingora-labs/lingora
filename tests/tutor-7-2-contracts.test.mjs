import assert from 'node:assert/strict'
import fs from 'node:fs'
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8')
const mentor=read('server/mentors/mentor-engine.ts')
const ui=read('app/beta/beta-schema-a.tsx')
const stream=read('server/core/execution-engine-stream.ts')
const profile=read('server/mentors/profiles.ts')
assert.match(mentor,/tool_choice:wantsVisualReview\?'none':'auto'/)
assert.doesNotMatch(mentor,/const needsArtifact =/)
// 7.5: the streamed text is the reply; a differing closure reply no longer drops the artifacts.
assert.doesNotMatch(mentor,/fail\('tool_reply_mismatch'\)/)
assert.ok(stream.includes("action:'retry_delivery'"))
assert.ok(ui.includes('const requiresReview = reviewMode || !validity.ok'))
assert.ok(mentor.includes("params.request.uiAction==='create_visual_review'"))
assert.ok(stream.includes("const review=groundedMilestoneReview(fullText,[]"))
assert.ok(stream.includes("const quiz = quizFromTutorText(fullText, quizDelivery.title)"),'7.5: the quiz is read from the Tutor text by the canonical reader')
assert.ok(read('server/api/chat-entry.ts').includes("'create_visual_review'] as string[]"))
assert.ok(ui.includes('lingora-quiz-review-request'))
assert.doesNotMatch(ui,/Este quiz contiene una clave que no permite/)
assert.doesNotMatch(ui,/export function fmt\(/)
assert.ok(read('app/beta/use-beta-page.ts').includes("window.addEventListener('lingora-quiz-review-request'"))
assert.doesNotMatch(profile,/No menciones URLs, precios ni programas/)
assert.ok(read('app/api/immersion-interest/route.ts').includes('!LEAD_CAPTURE_RELEASED'))
console.log('PASS — Tutor First 7.2 static source contracts')

// The SSE closure must commit its complete artifact snapshot before UI completion.
const pageSource=read('app/beta/use-beta-page.ts')
// 7.5: the commit goes to the active conversation of the Space.
const commit='const result = await saveActive(conversationRef.current, completedMsgs, nextSession, phaseRef.current)'
assert.ok(pageSource.includes(commit))
assert.ok(pageSource.indexOf(commit) < pageSource.indexOf('msgsRef.current = completedMsgs'))

// Regression: SSE/exports cannot reuse the initial onboarding/interact closure.
const beta=read('app/beta/use-beta-page.ts')
assert.match(beta,/const phaseRef = useRef<Phase>\(phase\)/)
assert.match(beta,/const activeModeRef = useRef<ActiveMode>\(activeMode\)/)
assert.match(beta,/saveActive\(conversationRef\.current, [a-zA-Z]+, [a-zA-Z.]+, phaseRef\.current\)/,'saves read the phase from the ref, never a first-render closure')
assert.match(beta,/activeMode: activeModeRef\.current/)
assert.match(beta,/phaseRef\.current = 'chat'; setPhase\('chat'\)/)
assert.match(beta,/activeModeRef\.current = mode; setActiveMode\(mode\)/)
assert.doesNotMatch(beta,/phase: phase === 'chat' \? 'chat' : 'onboarding'/)
