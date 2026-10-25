// E2E (real Chromium, real /beta build, FAKE microphone from a WAV file, /api/chat and /api/speech intercepted).
// Technical evidence of the voice pipeline in a browser — NOT a physical PASS (no human, no real microphone):
// hands-free turn detection, one request per utterance in the browser's own format, transcript shown, answer
// spoken progressively segment by segment, pause/resume/speed/stop, interruption by speaking, interruption
// context in the next turn, «Escuchar» on an existing message, measured times.
// Usage: node tests/e2e/voice-7-5.mjs http://localhost:3078 /path/to/chromium mic.wav tts.mp3 outDir
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const [base, exe, micWav, ttsMp3, out = fs.mkdtempSync('/tmp/lingora-voice-e2e-')] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const steps = []
const step = (s, x) => { steps.push({ step: s, ...(x ?? {}) }); console.log('✓', s, x ? JSON.stringify(x).slice(0, 240) : '') }
const tts = fs.readFileSync(ttsMp3)
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${micWav}`, '--autoplay-policy=no-user-gesture-required'] })
const chats = [], speeches = []
const ANSWER = '¡Muy bien! Has dicho que quieres practicar.\n\nPrimero, dime cómo te llamas en una frase completa.\n\nDespués hablaremos de tu día.'
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844 })
  await page.setRequestInterception(true)
  page.on('request', req => {
    const u = req.url()
    if (u.startsWith('https://fonts.')) return req.abort()
    if (u.endsWith('/api/speech') && req.method() === 'POST') {
      speeches.push({ at: Date.now(), text: JSON.parse(req.postData() || '{}').text })
      return req.respond({ status: 200, contentType: 'audio/mpeg', headers: { 'X-Lingora-Speech-Model': 'fixture-tts', 'Access-Control-Expose-Headers': 'X-Lingora-Speech-Model' }, body: tts })
    }
    if (u.endsWith('/api/chat') && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}')
      chats.push({ at: Date.now(), hasAudio: Boolean(body.audioDataUrl), mime: body.audioMimeType ?? null, bytes: body.audioDataUrl ? Math.round(body.audioDataUrl.length * 0.75) : 0, clientSpeech: body.clientSpeech ?? null, interruption: body.voiceInterruption ?? null, message: body.message ?? null })
      const n = chats.length
      const voice = { transcript: n === 1 ? 'Hola, quiero practicar' : 'Perdona, una pregunta', uncertain: n === 1 ? [] : ['una pregunta'], asrModel: 'fixture-asr', asrMs: 420 }
      const deltas = (n === 1 ? ANSWER : 'Claro, dime tu pregunta.').match(/.{1,9}/gs)
      const ev = [{ voice }, ...deltas.map(d => ({ delta: d })), { done: true, servedModel: 'gpt-5.6-sol', voice, turnState: 'complete', state: { tokens: 3 + n } }]
      return req.respond({ status: 200, contentType: 'text/event-stream', body: ev.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') })
    }
    req.continue()
  })
  await page.goto(base + '/api/health')
  await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('lingora-beta-v1', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('sessions')
    r.onsuccess = () => { const tx = r.result.transaction('sessions', 'readwrite')
      tx.objectStore('sessions').put({ version: 1, phase: 'chat', lang: 'es', mentor: 'sarah', topic: 'conversation', activeMode: 'interact',
        session: { lang: 'es', mentor: 'sarah', topic: 'conversation', level: 'A1', tokens: 2, samples: [], sessionId: 'voice-e2e', commercialOffers: [], lastTask: null, lastArtifact: null, activeMode: 'interact', interfaceLanguage: 'es' },
        msgs: [{ id: 'g1', sender: 'sarah', text: '¡Hola! Cuéntame algo de tu día.', complete: true }] }, 'current')
      tx.oncomplete = () => { r.result.close(); resolve(true) }; tx.onerror = () => reject(tx.error) }
    r.onerror = () => reject(r.error)
  }))
  await page.goto(base + '/beta', { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="voice-mode"]')
  // 1. «Escuchar» on an existing message speaks it without any Tutor request.
  await page.click('[data-msg-id="g1"] ~ * [data-testid="speak-message"], [data-testid="speak-message"]')
  await page.waitForFunction(() => document.querySelector('[data-testid="voice-bar"]')?.dataset.player === 'playing', { timeout: 10000 })
  assert.equal(chats.length, 0); assert.equal(speeches.length, 1); assert.equal(speeches[0].text, '¡Hola! Cuéntame algo de tu día.')
  step('«Escuchar» sobre un mensaje existente → voz del texto visible, 0 peticiones al Tutor', { spoken: speeches[0].text })
  await page.click('[data-testid="voice-stop"]')
  await page.waitForFunction(() => !document.querySelector('[data-testid="voice-bar"]') || document.querySelector('[data-testid="voice-bar"]').dataset.player === 'idle')
  // 2. Hands-free conversation: the fake microphone speaks 1.2 s after 1.5 s of silence.
  const tOn = Date.now()
  await page.click('[data-testid="voice-mode"]')
  await page.waitForFunction(() => document.querySelector('[data-testid="voice-bar"]')?.dataset.mic === 'listening', { timeout: 10000 })
  step('Conversación por voz activada → micrófono escuchando (permiso concedido)')
  await page.waitForFunction(() => document.querySelector('[data-testid="voice-bar"]')?.dataset.mic === 'hearing', { timeout: 15000 })
  step('Turno detectado: «Te escucho…»')
  await page.waitForFunction(n => window.__chats === undefined, {}, 0)
  for (let i = 0; i < 200 && chats.length < 1; i++) await new Promise(r => setTimeout(r, 50))
  assert.equal(chats.length, 1, 'one request for one utterance')
  assert.ok(chats[0].hasAudio && /^audio\/webm/.test(chats[0].mime) && chats[0].clientSpeech === true && chats[0].bytes > 3000)
  step('Una petición por enunciado, en el formato del navegador, con voz progresiva en el cliente', { mime: chats[0].mime, bytes: chats[0].bytes, sentAfterMs: chats[0].at - tOn })
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="bubble-user"]')].some(b => b.innerText.includes('Hola, quiero practicar')), { timeout: 10000 })
  const users = await page.$$eval('[data-testid="bubble-user"]', bs => bs.map(b => b.innerText))
  assert.equal(users.filter(t => t.includes('Hola, quiero practicar')).length, 1, 'one student bubble, with what was understood')
  step('La transcripción aparece en la burbuja del alumno', { bubble: users.at(-1).replace(/\s+/g, ' ').slice(0, 80) })
  await page.waitForFunction(() => document.querySelector('[data-testid="voice-bar"]')?.dataset.player === 'playing', { timeout: 10000 })
  const firstSpeech = speeches.find(s => s.at >= chats[0].at)
  step('Sarah habla: la voz empieza con el primer segmento', { firstSegment: firstSpeech?.text, segmentRequestAfterChatMs: firstSpeech ? firstSpeech.at - chats[0].at : null })
  // 3. Controls while she speaks.
  await page.click('[data-testid="voice-pause"]'); await page.waitForFunction(() => document.querySelector('[data-testid="voice-bar"]').dataset.player === 'paused')
  await page.click('[data-testid="voice-resume"]'); await page.waitForFunction(() => document.querySelector('[data-testid="voice-bar"]').dataset.player === 'playing')
  await page.select('[data-testid="voice-rate"]', '1.2')
  const rate = await page.$eval('[data-testid="voice-rate"]', s => s.value)
  assert.equal(rate, '1.2')
  step('Pausa, reanudación y velocidad 1.2× durante la voz')
  // 4. The microphone speaks again while she is still speaking: interruption.
  await page.waitForFunction(() => document.querySelector('[data-testid="voice-interrupted"]'), { timeout: 20000 })
  for (let i = 0; i < 200 && chats.length < 2; i++) await new Promise(r => setTimeout(r, 50))
  assert.equal(chats.length, 2)
  assert.ok(chats[1].interruption && typeof chats[1].interruption.heard === 'string' && chats[1].interruption.heard.length > 0, 'the next turn says how far the student heard')
  const allText = await page.$$eval('[data-testid="bubble-mentor"]', bs => bs.map(b => b.innerText).join('\n'))
  assert.ok(allText.includes('Después hablaremos de tu día.'), 'the written answer stays complete after the interruption')
  step('Interrupción hablando: la voz se detiene, el texto queda completo y el turno siguiente lleva lo escuchado', { heard: chats[1].interruption.heard.slice(0, 80) })
  await page.waitForFunction(() => document.querySelector('[data-testid="voice-uncertain"]'), { timeout: 10000 })
  const unc = await page.$eval('[data-testid="voice-uncertain"]', e => e.innerText)
  assert.match(unc, /«una pregunta»/)
  step('Lo que el reconocedor no entendió con seguridad se muestra al alumno', { shown: unc })
  const timing = await page.$$eval('[data-testid="bubble-mentor"][data-voice-first-audio-ms]', bs => bs.map(b => ({ firstTextMs: Number(b.dataset.voiceFirstTextMs), firstAudioMs: Number(b.dataset.voiceFirstAudioMs) })))
  assert.ok(timing.length >= 1 && timing[0].firstAudioMs > 0)
  step('Tiempos medidos desde el fin del habla (respuestas simuladas: no son latencias del proveedor)', { timing })
  await page.screenshot({ path: path.join(out, 'voice-390.png') })
  await page.click('[data-testid="voice-mode"]')
  await page.waitForFunction(() => !document.querySelector('[data-testid="voice-bar"]') || document.querySelector('[data-testid="voice-bar"]').dataset.mic === 'off')
  step('Conversación por voz desactivada → micrófono apagado')
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  assert.ok(noOverflow); step('390 px sin scroll horizontal')
} finally {
  fs.writeFileSync(path.join(out, 'voice-e2e.json'), JSON.stringify({ steps, chats, speeches }, null, 1))
  await browser.close()
}
console.log(`PASS e2e voice 7.5 (technical, fake microphone): ${steps.length} steps → ${out}`)
