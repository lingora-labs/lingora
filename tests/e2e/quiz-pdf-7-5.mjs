// E2E (real Chromium, real /beta build). Not in the build chain. Order "TRES CORRECCIONES", points 1 and 2.
// BOTÓN: «Empezar quiz» on a quiz already on screen → 0 requests, 0 student bubbles, same component active;
//        two quizzes answered → each review request carries ONLY its own quiz (id, fingerprint, questions, choices).
// DESCARGA: «Descargar PDF» → (1) the REAL local server refuses (it cannot reach the fonts) → visible reason;
//        (2) HTTP 504 → visible reason; (3) bytes whose SHA-256 differs from the recorded one → visible reason, no card;
//        (4) a real PDF → the button saves a file whose bytes equal the generated ones and whose text is the material;
//        (5) a card holding a corrupt file → the button shows an alert and saves nothing.
// Tutor turns are intercepted (no model call). With FIXTURE=<json of a real preview download_pdf response>,
// step (4) uses the deployed server's own bytes instead of a locally rendered PDF.
// Usage: node tests/e2e/quiz-pdf-7-5.mjs http://localhost:3077 /path/to/chromium outDir
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { PDFDocument } from 'pdf-lib'
const { load } = await import('../_ts-loader.mjs')
const { renderDocumentPage } = load('lib/content/document-page.ts')
const { preparePrintHtml } = load('server/tools/pdf/renderDocumentPdf.ts')

const [base, exe, out = fs.mkdtempSync('/tmp/lingora-quiz-pdf-e2e-')] = process.argv.slice(2)
const downloads = path.join(out, 'downloads'); fs.mkdirSync(downloads, { recursive: true })
const log = []
const step = (s, extra) => { log.push({ step: s, ...(extra ?? {}) }); console.log('✓', s) }
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
const sha = b => createHash('sha256').update(b).digest('hex')

async function renderRealPdf(text) {
  const tab = await browser.newPage()
  const html = preparePrintHtml(renderDocumentPage({ title: 'Material de estudio', sections: [{ text }] }, 'print'), { fontCss: '', fontList: '"DejaVu Sans"', monoCss: '' })
  await tab.setContent(html, { waitUntil: 'load' })
  const bytes = Buffer.from(await tab.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }))
  await tab.close()
  const pages = (await PDFDocument.load(bytes)).getPageCount()
  return { bytes, pages }
}
const quizA = { type: 'quiz', title: 'Ser y estar', content: { gradingMode: 'tutor_review', questions: [
  { question: 'María ___ médica.', options: ['es', 'está'], correct: 0 }, { question: 'Hoy ___ cansada.', options: ['es', 'está'], correct: 1 }] } }
const quizB = { type: 'quiz', title: 'Pretérito', content: { gradingMode: 'tutor_review', questions: [
  { question: 'Ayer ___ al mercado.', options: ['fui', 'iba'], correct: 0 }] } }
const startAction = { type: 'start_quiz', action: 'start_quiz', label: 'Empezar quiz' }
const pdfAction = { type: 'download_pdf', action: 'download_pdf', label: 'Descargar PDF' }
const MATERIAL = '# Pretérito indefinido\n\nSe usa para acciones terminadas en el pasado: *ayer fui al mercado*, *en 2020 viví en Sevilla*.'
const fixture = process.env.FIXTURE ? JSON.parse(fs.readFileSync(process.env.FIXTURE, 'utf8')) : null

const requests = []
const pdfModes = ['real-server', 'http-504', 'sha-mismatch', 'success']
let expectedPdf = null
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
  const cdp = await browser.target().createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
  await page.setRequestInterception(true)
  page.on('request', async req => {
    if (req.url().startsWith('https://fonts.')) return req.abort()
    if (!(req.url().endsWith('/api/chat') && req.method() === 'POST')) return req.continue()
    const body = JSON.parse(req.postData() || '{}')
    requests.push({ message: body.message, uiAction: body.uiAction ?? null })
    if (body.uiAction === 'download_pdf') {
      const mode = pdfModes.shift()
      if (mode === 'real-server') return req.continue()
      if (mode === 'http-504') return req.respond({ status: 504, contentType: 'text/plain', body: 'FUNCTION_INVOCATION_TIMEOUT' })
      let artifact
      if (mode === 'success' && fixture) artifact = fixture.artifact
      else {
        const { bytes, pages } = await renderRealPdf(String(body.materialText ?? ''))
        artifact = { type: 'pdf', title: 'Material de estudio', url: 'data:application/pdf;base64,' + bytes.toString('base64'), pdfByteLength: bytes.length, pdfSha256: sha(bytes), pageCount: pages }
        if (mode === 'sha-mismatch') artifact.pdfSha256 = '0'.repeat(64)
      }
      expectedPdf = artifact
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'Material generado en PDF.', state: body.state, suggestedActions: [], artifact }) })
    }
    const text = String(body.message ?? '')
    let delta = 'De acuerdo.', extra = {}
    if (text.startsWith('Dame el segundo')) { delta = 'Aquí tienes otro quiz.'; extra = { artifacts: [quizB], suggestedActions: [startAction] } }
    else if (text.startsWith('He respondido')) { delta = 'Revisión: ' + text.slice(0, 60); extra = { suggestedActions: [pdfAction] } }
    else if (text.startsWith('Repasemos')) { delta = MATERIAL; extra = { suggestedActions: [pdfAction] } }
    const done = { done: true, turnState: 'complete', state: { tokens: (body.state?.tokens ?? 0) + 1 }, ...extra }
    return req.respond({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ delta })}\n\ndata: ${JSON.stringify(done)}\n\n` })
  })
  // A conversation whose last Tutor message carries quiz A (stored, as after a reload), plus a card holding a corrupt PDF.
  const corrupt = Buffer.from('%PDF-1.7\n' + 'x'.repeat(900) + '\n%%EOF')
  await page.goto(base + '/api/health')
  await page.evaluate((quizA, startAction, corruptUrl, corruptSha) => new Promise((resolve, reject) => {
    const r = indexedDB.open('lingora-beta-v1', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('sessions')
    r.onsuccess = () => {
      const tx = r.result.transaction('sessions', 'readwrite')
      tx.objectStore('sessions').put({ version: 1, phase: 'chat', lang: 'es', mentor: 'sarah', topic: 'conversation', activeMode: 'interact',
        session: { lang: 'es', mentor: 'sarah', topic: 'conversation', level: 'A1', tokens: 2, samples: [], sessionId: 'e2e-1', commercialOffers: [], lastTask: null, lastArtifact: null, activeMode: 'interact' },
        msgs: [{ id: 'u1', sender: 'user', text: 'Quiero practicar ser y estar' },
          { id: 'pdfbad', sender: 'sarah', text: 'Material anterior', complete: true, artifact: { type: 'pdf', title: 'Material anterior', url: corruptUrl, pdfByteLength: 999999, pdfSha256: corruptSha } },
          { id: 'tA', sender: 'sarah', text: 'Aquí tienes un quiz.', complete: true, artifacts: [quizA], suggestedActions: [startAction] }] }, 'current')
      tx.oncomplete = () => { r.result.close(); resolve(true) }
      tx.onerror = () => reject(tx.error)
    }
    r.onerror = () => reject(r.error)
  }), quizA, startAction, 'data:application/pdf;base64,' + corrupt.toString('base64'), sha(corrupt))
  await page.goto(base + '/beta', { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.body.innerText.includes('Aquí tienes un quiz.'), { timeout: 15000 })
  const send = async t => {
    await page.type('textarea', t)
    await page.$$eval('button', bs => bs.find(b => b.textContent.trim() === 'Go').click())
  }
  await send('Dame el segundo quiz, sobre el pretérito')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="quiz-block"]').length === 2, { timeout: 10000 })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Empezar quiz').length === 2)
  const snap = () => page.evaluate(() => ({
    users: document.querySelectorAll('.ln-user').length, blocks: [...document.querySelectorAll('[data-testid="quiz-block"]')].map(b => ({ id: b.dataset.instance, key: b.dataset.quizKey, active: b.dataset.active === 'true' })),
    focused: document.activeElement?.closest('[data-testid="quiz-block"]')?.dataset.instance ?? null }))
  const before = await snap(); const reqBefore = requests.length

  // 1. «Empezar quiz» on quiz A. Behaviour first (requests, student bubbles, components), identity after.
  await page.$$eval('button', bs => bs.filter(b => b.textContent.trim() === 'Empezar quiz')[0].click())
  await new Promise(r => setTimeout(r, 1500))
  let after = await snap()
  fs.writeFileSync(path.join(out, 'start-quiz-measure.json'), JSON.stringify({ requests: requests.slice(reqBefore), studentBubbles: after.users - before.users, quizBlocks: [before.blocks.length, after.blocks.length] }, null, 1))
  assert.equal(requests.length - reqBefore, 0, '0 requests'); assert.equal(after.users, before.users, '0 student bubbles')
  assert.equal(after.blocks.length, before.blocks.length, 'no new quiz component')
  const [idA, idB] = before.blocks.map(b => b.id)
  assert.ok(idA?.startsWith('tA#') && idB && idA !== idB)
  assert.deepEqual(after.blocks.map(b => [b.id, b.key]), before.blocks.map(b => [b.id, b.key]), 'same components, same quiz keys')
  assert.deepEqual(after.blocks.map(b => b.active), [true, false]); assert.equal(after.focused, idA)
  step('BOTÓN: «Empezar quiz» on quiz A → 0 requests, 0 student bubbles, quiz A active and focused, quiz B untouched', { idA, keyA: after.blocks[0].key, requests: 0 })
  await page.screenshot({ path: path.join(out, 'quiz-A-active-390.png') })
  await page.$$eval('button', bs => bs.filter(b => b.textContent.trim() === 'Empezar quiz')[1].click())
  await page.waitForFunction(id => document.querySelector(`[data-instance="${id}"]`)?.dataset.active === 'true', {}, idB)
  after = await snap()
  assert.equal(requests.length - reqBefore, 0); assert.equal(after.users, before.users); assert.equal(after.focused, idB)
  step('BOTÓN: «Empezar quiz» on quiz B → 0 requests, quiz B active', { idB })

  // 2. Answer both quizzes; each review carries only its own quiz.
  const answer = async (id, picks) => {
    for (const [q, o] of picks) await page.click(`[data-instance="${id}"] [data-testid="quiz-opt-${q}-${o}"]`)
    const n = requests.length
    await page.click(`[data-instance="${id}"] [data-testid="quiz-review-send"]`)
    await page.waitForFunction((id) => !!document.querySelector(`[data-instance="${id}"] [data-testid="quiz-sent"]`), {}, id)
    await page.waitForFunction(n => document.body.innerText.split('Revisión: ').length - 1 >= n, {}, requests.filter(r => String(r.message).startsWith('He respondido')).length)
    return requests[n]
  }
  const rA = await answer(idA, [[0, 0], [1, 0]])
  const rB = await answer(idB, [[0, 1]])
  for (const [r, own, other] of [[rA, { id: idA, qs: ['María ___ médica.', 'Hoy ___ cansada.'] }, { id: idB, qs: ['Ayer ___ al mercado.'] }], [rB, { id: idB, qs: ['Ayer ___ al mercado.'] }, { id: idA, qs: ['María ___ médica.', 'Hoy ___ cansada.'] }]]) {
    assert.ok(r.message.includes(`componente ${own.id}`), 'review names its own component')
    for (const q of own.qs) assert.ok(r.message.includes(q))
    assert.ok(!r.message.includes(other.id) && other.qs.every(q => !r.message.includes(q)), 'review carries nothing of the other quiz')
    assert.match(r.message, /No generes otro quiz/); assert.equal(r.uiAction, null)
  }
  assert.match(rA.message, /María ___ médica\.\nOpciones: es \| está\nElegí: es/); assert.match(rA.message, /Hoy ___ cansada\.\nOpciones: es \| está\nElegí: es/)
  assert.match(rB.message, /Elegí: iba/)
  const finalBlocks = await snap()
  assert.equal(finalBlocks.blocks.length, 2, 'no quiz was generated by any of these actions')
  step('BOTÓN: two quizzes answered → review A carries only quiz A, review B only quiz B; still 2 quizzes', { reviewA: rA.message.split('\n')[0], reviewB: rB.message.split('\n')[0] })

  // 3. DESCARGA on the material message.
  await send('Repasemos el pretérito indefinido')
  await page.waitForFunction(() => document.body.innerText.includes('acciones terminadas en el pasado'))
  const clickDownloadAction = async () => {
    await page.waitForFunction(() => !document.querySelector('textarea')?.disabled && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Descargar PDF'))
    await page.$$eval('button', bs => bs.filter(b => b.textContent.trim() === 'Descargar PDF').at(-1).click())
  }
  const cards = () => page.$$eval('[data-testid="pdf-download"]', bs => bs.length)
  const cards0 = await cards()
  // (1) real local server: it cannot reach the fonts and says so.
  await clickDownloadAction()
  await page.waitForFunction(() => /No se pudo entregar el PDF|el PDF no se pudo generar/.test(document.body.innerText), { timeout: 60000 })
  const realRefusal = await page.evaluate(() => [...document.querySelectorAll('[data-testid="artifact-failure"]')].at(-1)?.innerText)
  assert.match(realRefusal, /PDF del material: el PDF no se pudo generar/); assert.equal(await cards(), cards0)
  step('DESCARGA fallo (servidor real local, sin acceso a las fuentes) → motivo visible, ningún enlace', { visible: realRefusal })
  // (2) 504.
  await clickDownloadAction()
  await page.waitForFunction(() => /\(504\)/.test(document.body.innerText), { timeout: 15000 })
  const t504 = await page.evaluate(() => [...document.querySelectorAll('[data-testid="artifact-failure"]')].at(-1)?.innerText)
  assert.match(t504, /504/); assert.equal(await cards(), cards0)
  step('DESCARGA fallo (HTTP 504) → motivo visible, ningún enlace', { visible: t504 })
  // (3) bytes that are not the generated ones.
  await clickDownloadAction()
  await page.waitForFunction(() => /huella SHA-256/.test(document.body.innerText), { timeout: 60000 })
  const tSha = await page.evaluate(() => [...document.querySelectorAll('[data-testid="artifact-failure"]')].at(-1)?.innerText)
  assert.equal(await cards(), cards0, 'no card for unverified bytes')
  step('DESCARGA fallo (copia no íntegra) → motivo visible, ningún enlace', { visible: tSha })
  await page.screenshot({ path: path.join(out, 'pdf-failures-390.png') })
  // (4) real PDF.
  await clickDownloadAction()
  await page.waitForFunction(() => /PDF comprobado: /.test(document.body.innerText), { timeout: 60000 })
  assert.equal(await cards(), cards0 + 1)
  const announced = await page.evaluate(() => document.body.innerText.match(/PDF comprobado: [^\n]+/)[0])
  await page.$$eval('[data-testid="pdf-download"]', bs => bs.at(-1).click())
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="pdf-download-status"]')].some(s => s.dataset.state === 'done'), { timeout: 30000 })
  const status = await page.evaluate(() => [...document.querySelectorAll('[data-testid="pdf-download-status"]')].find(s => s.dataset.state === 'done').innerText)
  let file = null
  for (let i = 0; i < 50 && !file; i++) { file = fs.readdirSync(downloads).find(f => f.endsWith('.pdf')); if (!file) await new Promise(r => setTimeout(r, 200)) }
  assert.ok(file, 'a file was saved')
  const saved = fs.readFileSync(path.join(downloads, file))
  const expectedBytes = Buffer.from(expectedPdf.url.split(',')[1], 'base64')
  assert.equal(saved.subarray(0, 5).toString(), '%PDF-'); assert.equal(sha(saved), expectedPdf.pdfSha256); assert.ok(saved.equals(expectedBytes))
  const text = execFileSync('pdftotext', [path.join(downloads, file), '-']).toString()
  const visible = fixture ? 'acciones terminadas' : 'acciones terminadas en el pasado'
  assert.ok(text.replace(/\s+/g, ' ').includes(visible), 'PDF text is the visible material')
  step('DESCARGA éxito → archivo guardado, bytes = generados, cabecera %PDF-, texto = material visible', { announced, status, file, bytes: saved.length, sha256: sha(saved), source: fixture ? 'preview deployment' : 'local Chromium render of the production page', textSample: text.replace(/\s+/g, ' ').trim().slice(0, 160) })
  await page.screenshot({ path: path.join(out, 'pdf-success-390.png') })
  // (5) the stored card holding a corrupt file.
  const nFiles = fs.readdirSync(downloads).length
  await page.$$eval('[data-testid="pdf-download"]', bs => bs[0].click())
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="pdf-download-status"]')].some(s => s.dataset.state === 'error'), { timeout: 15000 })
  const alert = await page.evaluate(() => [...document.querySelectorAll('[data-testid="pdf-download-status"]')].find(s => s.dataset.state === 'error').innerText)
  await new Promise(r => setTimeout(r, 800))
  assert.equal(fs.readdirSync(downloads).length, nFiles, 'nothing saved')
  step('DESCARGA fallo (tarjeta con archivo corrupto) → alerta visible, nada guardado', { visible: alert })
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  assert.ok(noOverflow); step('390 px sin scroll horizontal')
  fs.writeFileSync(path.join(out, 'requests.json'), JSON.stringify(requests, null, 1))
} finally {
  fs.writeFileSync(path.join(out, 'e2e-log.json'), JSON.stringify(log, null, 1))
  await browser.close()
}
console.log(`PASS e2e quiz+pdf 7.5: ${log.length} steps → ${out}`)
