// 7.5 P1-A — voice conversation instruments (order "P1 DOBLE", points 3–4). Code-level evidence only:
// turn detection, speech segmentation fidelity, recognition facts, the player's queue/stop/retry/heard-text,
// the route's recognition path and progressive speech. A physical PASS needs a real microphone (see delivery).
import assert from 'node:assert/strict'
import Module from 'node:module'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-only'
process.env.OPENAI_MAIN_MODEL = 'gpt-5.6-sol'
let asrCalls = [], asrQueue = [], ttsCalls = [], chatQueue = [], chatReqs = []
class FakeOpenAI {
  audio = {
    transcriptions: { create: async (req) => { asrCalls.push({ model: req.model, language: req.language, prompt: req.prompt, name: req.file?.name, type: req.file?.type, include: req.include, format: req.response_format }); const n = asrQueue.shift(); if (n instanceof Error) throw n; return n } },
    speech: { create: async (req) => { ttsCalls.push(req); return new Response(new Uint8Array([0xff, 0xf3, 1, 2, 3])) } },
  }
  chat = { completions: { create: async (req) => { chatReqs.push(req); const next = chatQueue.shift(); return (async function* () { for (const c of next) yield { model: 'gpt-5.6-sol', ...c } })() } } }
}
const originalLoad = Module._load
Module._load = function (name, ...rest) { if (name === 'openai') return Object.assign(FakeOpenAI, { toFile: async (buf, name, o) => ({ name, type: o?.type, size: buf.length }) }); return originalLoad.call(this, name, ...rest) }
const { load } = await import('./_ts-loader.mjs')
const quiet = { warn: console.warn, info: console.info, error: console.error }
console.warn = () => {}; console.info = () => {}; console.error = () => {}

// 1. Turn detection.
const { Vad, VAD_DEFAULTS } = load('app/beta/voice/vad.ts')
const run = (frames, tutorSpeaking = false) => { const v = new Vad(VAD_DEFAULTS); const ev = []; frames.forEach((db, i) => { const e = v.push(db, i * 30, tutorSpeaking); if (e) ev.push(e) }); return ev }
const sil = n => Array(n).fill(-70), talk = (n, db = -25) => Array(n).fill(db)
let ev = run([...sil(40), ...talk(40), ...sil(40)])
assert.deepEqual(ev.map(e => e.type), ['onset', 'speech', 'end'])
assert.ok(ev[2].voicedMs >= 1000 && ev[2].voicedMs <= 1300 && !ev[2].forced, 'one utterance of ~1.2 s, closed by the silence')
ev = run([...sil(40), ...talk(5), ...sil(40)]); assert.deepEqual(ev.map(e => e.type), ['onset', 'discard'], 'a short noise is not a turn')
ev = run([...sil(40), ...talk(30), ...sil(15), ...talk(30), ...sil(40)]); assert.deepEqual(ev.map(e => e.type), ['onset', 'speech', 'end'], 'a pause shorter than the end silence keeps the same turn')
ev = run([...sil(40), ...talk(40, -50), ...sil(10)], true); assert.deepEqual(ev, [], 'while the Tutor speaks, her echo-level sound is not an interruption')
ev = run([...sil(40), ...talk(40, -20), ...sil(40)], true); assert.equal(ev[1].type, 'speech', 'a clear voice over the Tutor is an interruption')
ev = run([...sil(40), ...talk(1100)]); assert.equal(ev.find(e => e.type === 'end').forced, true, 'an utterance is closed at the maximum length')

// 2. Speech segments are the visible answer, available before it ends.
const { SpeechSegmenter, spokenText } = load('app/beta/voice/speech-segmenter.ts')
const answer = '¡Claro! **Buenos días** se usa por la mañana. **Buenas noches** se dice al despedirse.\n\n- *Buenos días, ¿cómo está usted?*\n- Buenas noches, que descanses.\n\n| Saludo | Momento |\n|---|---|\n| Buenos días | mañana |\n\nAhora tú: ¿cómo saludas a las nueve de la mañana?'
const seg = new SpeechSegmenter(); const pieces = []; let firstAt = -1
for (let i = 0; i < answer.length; i += 7) { const got = seg.push(answer.slice(i, i + 7)); if (got.length && firstAt < 0) firstAt = i; pieces.push(...got) }
pieces.push(...seg.flush())
assert.ok(firstAt > 0 && firstAt < 60, `the voice can start after the first sentence (at char ${firstAt})`)
const norm = t => t.replace(/[*_`#>|«»]/g, ' ').replace(/[-:]{3,}/g, ' ').replace(/\s+/g, ' ').trim()
assert.equal(norm(pieces.join(' ')), norm(spokenText(answer)), 'spoken segments == visible text of the whole answer')
assert.ok(pieces.every(p => !/\*\*|^- /.test(p)), 'no Markdown syntax is read aloud')
assert.ok(pieces.length >= 4)

// 3. Recognition facts.
const F = load('lib/voice/asr-facts.ts')
assert.deepEqual(F.audioFileName('audio/mp4'), { name: 'recording.mp4', type: 'audio/mp4' }, 'Safari recordings are labelled mp4 (7.4 called everything webm)')
assert.equal(F.audioFileName('audio/webm;codecs=opus').name, 'recording.webm'); assert.equal(F.audioFileName(undefined).name, 'recording.webm')
assert.deepEqual(F.uncertainFromLogprobs([{ token: 'Yo', logprob: -0.01 }, { token: ' fui', logprob: -0.02 }, { token: ' a', logprob: -0.01 }, { token: ' Va', logprob: -1.6 }, { token: 'lla', logprob: -0.9 }, { token: 'dolid', logprob: -2 }, { token: ' ayer', logprob: -0.05 }]), ['Valladolid'])
assert.ok(F.looksLikeAsrArtefact('Subtítulos realizados por la comunidad de Amara.org') && F.looksLikeAsrArtefact('  ') && !F.looksLikeAsrArtefact('Gracias por la clase de hoy'))
assert.deepEqual(F.factsFromSegments([{ text: ' hola', avg_logprob: -0.2, no_speech_prob: 0.01 }, { text: ' mmm', avg_logprob: -1.3, no_speech_prob: 0.2 }]), { uncertain: ['mmm'], noSpeech: false })
assert.equal(F.factsFromSegments([{ text: ' Gracias.', avg_logprob: -0.9, no_speech_prob: 0.9 }]).noSpeech, true)

// 4. The player: order, prefetch, stop, heard text, retry without repeating.
const { SpeechPlayer } = load('app/beta/voice/speech-player.ts')
globalThis.performance ??= { now: () => Date.now() }
globalThis.URL.createObjectURL = () => 'blob:x'; globalThis.URL.revokeObjectURL = () => {}
class FakeAudio { src = ''; playbackRate = 1; currentTime = 0; duration = 2; paused = true; onended = null; onerror = null; preload = ''
  async play() { this.paused = false } pause() { this.paused = true } removeAttribute() { this.src = '' } }
let fetches = [], failNext = 0
const fakeFetch = async (_u, init) => { const body = JSON.parse(init.body); fetches.push(body.text); if (failNext > 0) { failNext--; return new Response('{}', { status: 502 }) } return new Response(new Blob([new Uint8Array([1, 2, 3])]), { headers: { 'X-Lingora-Speech-Model': 'gpt-4o-mini-tts' } }) }
let states = []
const audio = new FakeAudio()
const p = new SpeechPlayer({ mentor: () => 'sarah', onState: s => states.push(s), fetchImpl: fakeFetch, createAudio: () => audio })
p.begin('m1', 0); p.enqueue('Primera frase del Tutor.'); p.enqueue('Segunda frase.'); p.enqueue('Tercera.')
await new Promise(r => setTimeout(r, 20))
assert.equal(p.current.status, 'playing'); assert.equal(p.current.speechModel, 'gpt-4o-mini-tts'); assert.equal(typeof p.current.firstAudioMs, 'number')
assert.deepEqual(fetches, ['Primera frase del Tutor.', 'Segunda frase.', 'Tercera.'], 'segments are synthesized in order, ahead of playback')
audio.currentTime = 1; assert.equal(p.heardText(), 'Primera frase', 'heard = half of the first segment')
audio.onended(); await new Promise(r => setTimeout(r, 10)); assert.equal(p.current.index, 1)
p.pause(); assert.equal(p.current.status, 'paused'); p.resume(); assert.equal(p.current.status, 'playing')
p.setRate(1.2); assert.equal(audio.playbackRate, 1.2)
p.stop(); assert.equal(p.current.status, 'idle'); p.enqueue('no debe sonar'); assert.equal(fetches.length, 3, 'after stop nothing is synthesized for that answer')
// A failure keeps the place: retry fetches only the failed segment, and nothing already heard is repeated.
fetches = []; failNext = 1
p.begin('m2', 0); p.enqueue('Uno, la primera parte.'); await new Promise(r => setTimeout(r, 20))
assert.equal(p.current.status, 'error'); p.retry(); await new Promise(r => setTimeout(r, 20))
assert.deepEqual(fetches, ['Uno, la primera parte.', 'Uno, la primera parte.']); assert.equal(p.current.status, 'playing')
p.end(); audio.onended(); assert.equal(p.current.status, 'idle')

// 5. The route: recognition with the selection's hint, honest "not understood", facts to the Tutor, no double speech.
const { POST } = load('server/api/chat-entry.ts')
const { POST: SPEAK } = load('server/api/speech-entry.ts')
const call = async (body) => { const res = await POST(new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })); return { res, text: await res.text() } }
const audioB64 = 'data:audio/mp4;base64,' + Buffer.alloc(4000, 1).toString('base64')
const state = { tokens: 3, interfaceLanguage: 'es', activeMode: 'interact', mentorProfile: 'Sarah', sessionId: 's' }
asrQueue = [{ text: 'Subtítulos realizados por la comunidad de Amara.org' }]
let r = await call({ message: '', audioDataUrl: audioB64, audioMimeType: 'audio/mp4', clientSpeech: true, state })
let j = JSON.parse(r.text)
assert.equal(asrCalls[0].model, 'gpt-4o-transcribe'); assert.equal(asrCalls[0].language, 'es'); assert.equal(asrCalls[0].name, 'recording.mp4'); assert.deepEqual(asrCalls[0].include, ['logprobs'])
assert.equal(j.voice.understood, false); assert.equal(j.voice.reason, 'nothing_heard'); assert.match(j.message, /^No he oído nada claro/); assert.equal(chatReqs.length, 0, 'no Tutor turn on an invented transcript')
// The transcription model is refused by the provider: the next recognizer serves, and says so.
asrQueue = [Object.assign(new Error('model not found'), { status: 404, code: 'model_not_found' }), { text: 'Yo fui a Valladolid ayer', segments: [{ text: 'Yo fui a Valladolid ayer', avg_logprob: -0.3, no_speech_prob: 0.01 }] }]
chatQueue = [[{ choices: [{ delta: { content: '¡Qué bien! ¿Qué hiciste allí?' } }] }]]
r = await call({ message: '', audioDataUrl: audioB64, audioMimeType: 'audio/mp4', clientSpeech: true, voiceInterruption: { heard: 'Primera frase' }, state, conversationId: 'cv1' })
const events = r.text.split('\n\n').filter(e => e.startsWith('data: ')).map(e => JSON.parse(e.slice(6)))
assert.equal(events[0].voice.transcript, 'Yo fui a Valladolid ayer', 'the transcript reaches the browser first'); assert.equal(events[0].voice.asrModel, 'whisper-1')
const done = events.find(e => e.done)
assert.equal(done.voice.asrModel, 'whisper-1'); assert.equal(done.servedModel, 'gpt-5.6-sol')
assert.ok(!(done.artifacts ?? []).some(a => a.type === 'audio') && ttsCalls.length === 0, 'the browser speaks progressively: no second synthesis of the whole reply')
const note = chatReqs[0].messages.at(-1).content
assert.match(note, /\[SPOKEN TURN\]/); assert.match(note, /interrupted your previous spoken answer; they had heard up to: «Primera frase»/)
assert.equal(chatReqs[0].messages.findLast(m => m.role === 'user').content, 'Yo fui a Valladolid ayer')
// The speech route speaks exactly the text it is given, reports its model, and hides provider errors.
let sres = await SPEAK(new Request('http://x/api/speech', { method: 'POST', body: JSON.stringify({ text: 'Buenos días.', mentor: 'sarah' }) }))
assert.equal(sres.status, 200); assert.equal(sres.headers.get('content-type'), 'audio/mpeg'); assert.equal(sres.headers.get('x-lingora-speech-model'), 'gpt-4o-mini-tts')
assert.equal(ttsCalls[0].input, 'Buenos días.'); assert.equal(ttsCalls[0].voice, 'shimmer'); assert.ok(ttsCalls[0].instructions)
sres = await SPEAK(new Request('http://x/api/speech', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(2000) }) }))
assert.equal(sres.status, 400); assert.deepEqual(await sres.json(), { error: 'speech_too_long' })

Object.assign(console, quiet)
console.log('PASS 7.5 P1-A voice: turn detection (onset/confirm/end, noise, pauses, barge-in bar, max), segments == visible text and start early, recognition facts (mp4, confidence, artefacts), player queue/stop/heard/retry/rate, route hint + honest not-understood + model identity + no double speech, speech route')
