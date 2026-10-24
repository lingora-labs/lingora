// E2E (real Chromium, real /beta build, /api/chat intercepted — no model call). Not in the build chain.
// Proves in the browser: 7.4 session migrates into the Space; a source and a confirmed fact enter the turn
// with provenance; a new conversation does not carry the other conversation's messages; the Tutor's notes
// appear as INFERRED memory; Reset empties only the open conversation; no horizontal scroll at 390 px.
// Usage: node tests/e2e/space-ui-7-5.mjs http://localhost:3075 /path/to/chromium outDir
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const [base, exe, out = fs.mkdtempSync('/tmp/lingora-space-e2e-')] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const log = []
const step = (s, extra) => { log.push({ step: s, ...(extra ?? {}) }); console.log('✓', s) }
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
const bodies = []
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await page.setRequestInterception(true)
  page.on('request', req => {
    if (req.url().endsWith('/api/chat') && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}')
      bodies.push(body)
      const opening = !String(body.message ?? '').trim()
      const delta = opening ? '¡Hola! Escríbeme una frase sobre tu día.' : 'Se usa en Argentina y Uruguay [source].'
      const done = { done: true, turnState: 'complete', state: { tokens: (body.state?.tokens ?? 0) + 1,
        tutorMemory: opening ? [] : [{ id: 'm1', kind: 'goal', text: 'Le interesa viajar a Argentina', learnedTurn: 1, updatedTurn: 1, at: '2026-10-24T00:00:00.000Z' }] } }
      return req.respond({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ delta })}\n\ndata: ${JSON.stringify(done)}\n\n` })
    }
    if (req.url().startsWith('https://fonts.')) return req.abort()
    req.continue()
  })
  // 1. A 7.4 session exists in the old store.
  await page.goto(base + '/api/health')
  await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('lingora-beta-v1', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('sessions')
    r.onsuccess = () => {
      const tx = r.result.transaction('sessions', 'readwrite')
      tx.objectStore('sessions').put({ version: 1, phase: 'chat', lang: 'es', mentor: 'sarah', topic: 'conversation', activeMode: 'interact',
        session: { lang: 'es', mentor: 'sarah', topic: 'conversation', level: 'A0', tokens: 2, samples: [], sessionId: 'legacy-1', commercialOffers: [], lastTask: null, lastArtifact: null, activeMode: 'interact' },
        msgs: [{ id: 'l1', sender: 'user', text: 'Hola, soy del legado PALABRALEGADA' }, { id: 'l2', sender: 'sarah', text: 'Respuesta legada', complete: true }] }, 'current')
      tx.oncomplete = () => { r.result.close(); resolve(true) }
      tx.onerror = () => reject(tx.error)
    }
    r.onerror = () => reject(r.error)
  }))
  await page.goto(base + '/beta', { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.body.innerText.includes('Respuesta legada'), { timeout: 15000 })
  const stored = await page.evaluate(() => new Promise(resolve => {
    const r = indexedDB.open('lingora-space-v1')
    r.onsuccess = () => { const g = r.result.transaction('spaces').objectStore('spaces').get('current'); g.onsuccess = () => resolve(g.result) }
  }))
  assert.equal(stored.conversations.length, 1)
  step('7.4 session migrated into the first conversation of lingora-space-v1', { spaceId: stored.id })
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  assert.ok(noOverflow, 'no horizontal scroll in chat at 390 px'); step('chat header fits 390 px')

  // 2. Space panel: source + confirmed fact.
  await page.$$eval('button', bs => bs.find(b => b.textContent.trim() === 'Espacio').click())
  await page.waitForFunction(() => document.body.innerText.includes('Tu espacio'))
  const src = path.join(out, 'voseo.txt')
  fs.writeFileSync(src, 'El voseo se usa en Argentina, Uruguay y partes de Centroamérica.\n\nEjemplo: vos tenés, vos sabés.')
  const input = await page.$('div[role=dialog] input[type=file]')
  await input.uploadFile(src)
  await page.waitForFunction(() => /Fuente «voseo\.txt» añadida/.test(document.body.innerText), { timeout: 10000 })
  step('text source added with SHA-256 shown')
  await page.type('input[placeholder^="Dato"]', 'destino')
  await page.type('input[placeholder^="Valor"]', 'Argentina en marzo, voseo')
  await page.$$eval('div[role=dialog] button', bs => bs.find(b => b.textContent.trim() === 'Añadir').click())
  await page.waitForFunction(() => document.body.innerText.includes('Argentina en marzo, voseo'))
  step('confirmed fact added')
  await page.screenshot({ path: path.join(out, 'space-panel-390.png'), fullPage: false })
  await page.$$eval('div[role=dialog] button', bs => bs.find(b => b.textContent.trim() === 'Cerrar').click())

  // 3. A turn in conversation 1: retrieval with provenance.
  await page.type('textarea', '¿Dónde se usa el voseo?')
  await page.$$eval('button', bs => bs.find(b => b.textContent.trim() === 'Go').click())
  await page.waitForFunction(() => document.body.innerText.includes('Se usa en Argentina y Uruguay'), { timeout: 10000 })
  const t1 = bodies[bodies.length - 1]
  const ids = (t1.spaceContext?.blocks ?? []).map(b => b.id)
  assert.ok(ids.some(i => /^source:src_[a-z0-9]+#1$/.test(i)), 'source passage with id'); assert.ok(ids.some(i => /^memory:mf_/.test(i)), 'confirmed fact with id')
  assert.ok(t1.conversationHistory.some(h => h.content.includes('PALABRALEGADA')), 'its own history travels')
  step('turn carries source and confirmed memory with provenance ids', { ids })

  // 4. New conversation: empty thread, same Space; the first conversation's words do not travel.
  await page.$$eval('button', bs => bs.find(b => b.textContent.trim() === 'Espacio').click())
  await page.waitForFunction(() => document.body.innerText.includes('Le interesa viajar a Argentina'))
  step("the Tutor's note is shown as INFERRED memory, not confirmed")
  await page.$$eval('div[role=dialog] button', bs => bs.find(b => b.textContent.includes('Nueva conversación')).click())
  await page.waitForFunction(() => document.body.innerText.includes('¿Cómo quieres aprender?'), { timeout: 10000 })
  const before = bodies.length
  await page.$$eval('button', bs => bs.find(b => b.textContent.includes('Interacción inteligente')).click())
  await page.waitForFunction(() => document.body.innerText.includes('Escríbeme una frase'), { timeout: 10000 })
  const t2 = bodies[bodies.length - 1]
  const wire2 = JSON.stringify(t2)
  assert.equal(t2.conversationHistory.length, 0)
  assert.ok(!wire2.includes('PALABRALEGADA') && !wire2.includes('Respuesta legada') && !wire2.includes('Le interesa viajar'), 'no message or inference of conversation 1 in conversation 2')
  step('new conversation request contains nothing from conversation 1')
  await page.type('textarea', 'Quiero practicar el voseo')
  await page.$$eval('button', bs => bs.find(b => b.textContent.trim() === 'Go').click())
  for (let i = 0; i < 100 && bodies.length < before + 2; i++) await new Promise(r => setTimeout(r, 100))
  await page.waitForFunction(() => document.body.innerText.split('Se usa en Argentina y Uruguay').length > 1, { timeout: 10000 })
  const t3 = bodies[bodies.length - 1]
  const wire3 = JSON.stringify(t3)
  assert.ok(!wire3.includes('PALABRALEGADA') && !wire3.includes('Le interesa viajar'), 'still isolated'); assert.ok(wire3.includes('voseo se usa'), 'the Space source is shared')
  step('second conversation receives the Space source, not the first conversation')

  // 5. Reset empties only this conversation; the Space keeps both conversations and the source.
  await page.$$eval('button', bs => bs.find(b => b.textContent.trim() === 'Reset').click())
  await page.waitForFunction(() => document.body.innerText.includes('LINGORA') && !document.body.innerText.includes('Quiero practicar el voseo'), { timeout: 10000 })
  const after = await page.evaluate(() => new Promise(resolve => {
    const r = indexedDB.open('lingora-space-v1')
    r.onsuccess = () => { const g = r.result.transaction('spaces').objectStore('spaces').get('current'); g.onsuccess = () => resolve(g.result) }
  }))
  assert.equal(after.conversations.length, 2); assert.equal(after.sources.length, 1); assert.equal(after.memory.filter(f => f.kind === 'confirmed').length, 1)
  step('Reset emptied only the open conversation; Space intact', { conversations: after.conversations.map(c => c.title) })
  await page.screenshot({ path: path.join(out, 'after-reset-390.png') })
  fs.writeFileSync(path.join(out, 'requests.json'), JSON.stringify(bodies.map(b => ({ message: b.message, history: b.conversationHistory?.length, spaceContext: b.spaceContext, offers: b.state?.commercialOffers?.length, interest: b.state?.immersionInterest?.length })), null, 1))
  fs.writeFileSync(path.join(out, 'steps.json'), JSON.stringify(log, null, 1))
  console.log('PASS space UI E2E —', log.length, 'steps; evidence in', out)
} finally { await browser.close() }
