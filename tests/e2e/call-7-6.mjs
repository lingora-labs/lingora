// E2E 7.6 — CALL MODE in real Chromium: fake microphone (WAV), realtime sockets and /api/chat simulated.
// Technical evidence of AUDIO OWNERSHIP, not a physical PASS: during a call exactly one voice path exists
// (one TTS socket, no legacy /api/speech request, no <audio> element playing) and scheduled sound never overlaps,
// across a full turn, an interruption and several consecutive turns.
// Usage: node tests/e2e/call-7-6.mjs http://localhost:3078 /path/to/chromium mic.wav outDir
import fs from 'node:fs'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const [base, exe, micWav, out = fs.mkdtempSync('/tmp/lingora-call-e2e-')] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const log = []; const step = (s, x) => { log.push({ step: s, ...(x ?? {}) }); console.log('✓', s, x ? JSON.stringify(x).slice(0, 300) : '') }
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${micWav}`, '--autoplay-policy=no-user-gesture-required'] })
const chats = [], speeches = [], sessions = []
const ANSWERS = [
  '¡Claro! Practicamos solo por voz.\n\nPrimero, dime cómo te llamas en una frase completa.\n\nDespués hablamos de tu día en Barcelona.',
  '| Estructura | Ejemplo |\n|---|---|\n| ir a + lugar | Quiero ir a España. |\n\nEsa es la tabla. ✅ Ahora tú: ¿adónde quieres ir?',
  'Muy bien. Una frase más larga, por favor. Cuéntame qué te gusta de tu ciudad y por qué.',
]
try {
  const page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 })
  page.on('pageerror', e => console.log('pageerror', String(e).slice(0, 200)))
  await page.evaluateOnNewDocument(() => {
    const W = window; W.__sock = []; W.__src = []; W.__media = []; W.__responses = { active: 0, overlapCreates: 0, created: 0, texts: [] }
    const RealWS = W.WebSocket
    class FakeWS {
      constructor(url, protocols) {
        this.url = url; this.protocols = protocols; this.readyState = 0; this.kind = url.includes('intent=transcription') ? 'stt' : 'tts'
        W.__sock.push({ kind: this.kind, at: performance.now(), open: true }); this.rec = W.__sock[W.__sock.length - 1]
        this.busy = false
        setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}) }, 30)
      }
      emit(o) { setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(o) }), 0) }
      send(d) {
        const m = JSON.parse(d)
        if (this.kind === 'tts' && m.type === 'response.create') {
          const text = m.response.input[0].content[0].text; W.__responses.texts.push(text); W.__responses.created++
          if (this.busy) W.__responses.overlapCreates++
          this.busy = true; W.__responses.active++
          const chunks = Math.max(2, Math.ceil(text.length / 6)); let i = 0
          const pcm = btoa(String.fromCharCode(...new Uint8Array(2400 * 2).map((_, k) => (k % 2 ? 8 : 0)))) // 100 ms
          const tick = () => { if (i++ < chunks) { this.emit({ type: 'response.output_audio.delta', delta: pcm }); setTimeout(tick, 45) } else { this.busy = false; W.__responses.active--; this.emit({ type: 'response.done' }) } }
          setTimeout(tick, 120)
        }
        if (this.kind === 'stt' && m.type === 'input_audio_buffer.commit') { W.__stt = (W.__stt || 0) + 1; const n = W.__stt; setTimeout(() => this.emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: `Frase número ${n} del alumno.` }), 250) }
      }
      close() { this.readyState = 3; this.onclose && this.onclose({}) }
    }
    W.WebSocket = function (url, protocols) { return String(url).includes('api.openai.com') ? new FakeWS(url, protocols) : new RealWS(url, protocols) }
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop
    AudioBufferSourceNode.prototype.start = function (t = 0) { const r = { t, end: t + (this.buffer?.duration ?? 0), ctx: this.context }; this.__r = r; W.__src.push(r); return start.apply(this, arguments) }
    AudioBufferSourceNode.prototype.stop = function () { if (this.__r) this.__r.end = Math.min(this.__r.end, this.context.currentTime); return stop.apply(this, arguments) }
    const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { W.__media.push(performance.now()); return play.apply(this, arguments) }
  })
  await page.setRequestInterception(true)
  page.on('request', req => {
    const u = req.url()
    if (u.startsWith('https://fonts.')) return req.abort()
    if (u.endsWith('/api/call/session')) { sessions.push(Date.now()); return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ stt: 'ek_stt', tts: 'ek_tts', voice: 'marin', expiresInSeconds: 60 }) }) }
    if (u.endsWith('/api/speech') && req.method() === 'POST') { speeches.push(Date.now()); return req.respond({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(10) }) }
    if (u.endsWith('/api/chat') && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}'); chats.push({ at: Date.now(), callTurn: body.callTurn === true, message: body.message })
      const text = ANSWERS[(chats.length - 1) % ANSWERS.length]
      const ev = [...text.match(/.{1,9}/gs).map(d => ({ delta: d })), { done: true, servedModel: 'gpt-5.6-sol', turnState: 'complete', state: { tokens: 3 + chats.length } }]
      return req.respond({ status: 200, contentType: 'text/event-stream', body: ev.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') })
    }
    req.continue()
  })
  await page.goto(base + '/api/health')
  await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('lingora-beta-v1', 1); r.onupgradeneeded = () => r.result.createObjectStore('sessions')
    r.onsuccess = () => { const tx = r.result.transaction('sessions', 'readwrite')
      tx.objectStore('sessions').put({ version: 1, phase: 'chat', lang: 'es', mentor: 'sarah', topic: 'conversation', activeMode: 'interact',
        session: { lang: 'es', mentor: 'sarah', topic: 'conversation', level: 'A1', tokens: 2, samples: [], sessionId: 'call-e2e', commercialOffers: [], lastTask: null, lastArtifact: null, activeMode: 'interact' },
        msgs: [{ id: 'g1', sender: 'sarah', text: '¡Hola! Cuéntame algo de tu día.', complete: true }] }, 'current')
      tx.oncomplete = () => { r.result.close(); resolve(true) }; tx.onerror = () => reject(tx.error) }
    r.onerror = () => reject(r.error)
  }))
  await page.goto(base + '/beta', { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="call-start"]')
  // Before the call the legacy voice ('Escuchar') speaks; once the call starts it must stay silent for good.
  await page.click('[data-testid="speak-message"]'); await new Promise(r => setTimeout(r, 1200))
  const legacyBefore = { speeches: speeches.length, media: await page.evaluate(() => window.__media.length) }
  step('Antes de llamar: la voz antigua habla con «Escuchar»', legacyBefore)
  await page.click('[data-testid="call-start"]')
  await page.waitForSelector('[data-testid="call-screen"]', { timeout: 10000 }); step('Llamada iniciada')
  // 1. A complete turn: the student speaks, the answer is AUDIBLE without asking for it.
  for (let i = 0; i < 400 && chats.length < 1; i++) await new Promise(r => setTimeout(r, 50))
  assert.equal(chats.length, 1); assert.ok(chats[0].callTurn)
  for (let i = 0; i < 100 && !(await page.evaluate(() => window.__src.length > 0)); i++) await new Promise(r => setTimeout(r, 50))
  assert.ok(await page.evaluate(() => window.__src.length > 0), 'the first answer must be spoken without asking')
  step('Primer turno hablado: la respuesta suena sin pedirlo', { chat: chats[0].message })
  // 2. Let several turns (and interruptions, the fake mic loops) happen.
  for (let i = 0; i < 700 && chats.length < 4; i++) await new Promise(r => setTimeout(r, 50))
  await new Promise(r => setTimeout(r, 2500))
  const snap = await page.evaluate(() => ({ sock: window.__sock, media: window.__media.length, resp: window.__responses, src: window.__src.map(s => [s.t, s.end, s.ctx.currentTime]) }))
  const ivs = snap.src.filter(s => s[1] > s[0]).map(s => [s[0], s[1]]).sort((a, b) => a[0] - b[0])
  let overlap = 0; for (let i = 1; i < ivs.length; i++) overlap = Math.max(overlap, ivs[i - 1][1] - ivs[i][0])
  assert.equal(snap.sock.filter(s => s.kind === 'tts').length, 1, 'ONE voice socket for the whole call')
  assert.equal(snap.sock.filter(s => s.kind === 'stt').length, 1, 'ONE recognition socket for the whole call')
  await page.click('[data-testid="speak-message"]'); await new Promise(r => setTimeout(r, 1500))
  const snap2 = await page.evaluate(() => ({ media: window.__media.length, created: window.__responses.created, overlap: window.__responses.overlapCreates }))
  assert.equal(speeches.length, legacyBefore.speeches, 'no legacy /api/speech request during a call'); assert.equal(snap.media, legacyBefore.media, 'no <audio> element played during a call'); assert.equal(snap2.media, legacyBefore.media, '«Escuchar» during a call does not wake the old voice'); assert.equal(snap2.overlap, 0)
  assert.equal(snap.resp.overlapCreates, 0, 'never two speech responses at once')
  assert.ok(overlap < 0.03, 'scheduled sound never overlaps (max overlap s: ' + overlap.toFixed(3) + ')')
  assert.ok(chats.length >= 3, 'several consecutive turns'); assert.ok(chats.every(c => c.callTurn))
  const spoken = snap.resp.texts.join(' ¶ ')
  assert.ok(!/[+→|✅]/u.test(spoken), "symbols reach the voice: " + JSON.stringify(spoken))
  step('Varios turnos/interrupciones: una sola voz, sin solape ni ruta antigua', { turns: chats.length, ttsSockets: 1, sttSockets: 1, legacySpeechDuringCall: speeches.length - legacyBefore.speeches, audioElementsDuringCall: snap.media - legacyBefore.media, maxOverlapSeconds: Number(overlap.toFixed(3)), speechResponses: snap.resp.created })
  // 3. Hang up: nothing sounds afterwards, nothing is sent.
  const nChats = chats.length, nSrc = (await page.evaluate(() => window.__src.length))
  await page.click('[data-testid="call-hangup"]'); await new Promise(r => setTimeout(r, 4000))
  const after = await page.evaluate(() => ({ src: window.__src.length, active: window.__responses.active }))
  assert.ok(chats.length <= nChats + 0 && after.src <= nSrc + 1, 'nothing new after hang-up'); step('Colgar: no se envía ni suena nada más')
  await page.screenshot({ path: `${out}/call-390.png` })
} finally {
  fs.writeFileSync(`${out}/call-e2e.json`, JSON.stringify({ log, chats }, null, 1)); await browser.close()
}
console.log(`PASS e2e call 7.6 (technical, fake microphone/sockets): ${log.length} steps → ${out}`)
