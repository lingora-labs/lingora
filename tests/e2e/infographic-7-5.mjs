// E2E (real Chromium, real /beta build): the native infographic of the order's regression case on a phone.
// Narrow layout at 390 px; both nuclei highlighted; SVG download = the drawn content; PNG download = a real
// PNG rasterized from that SVG (signature, size); a PNG that cannot be made is reported, never replaced by SVG.
// Usage: node tests/e2e/infographic-7-5.mjs http://localhost:3078 /path/to/chromium outDir
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const { load } = await import('../_ts-loader.mjs')
const I = load('lib/infographic-contract.ts')

const [base, exe, out = fs.mkdtempSync('/tmp/lingora-info-e2e-')] = process.argv.slice(2)
const downloads = path.join(out, 'downloads'); fs.mkdirSync(downloads, { recursive: true })
const steps = []
const step = (s, x) => { steps.push({ step: s, ...(x ?? {}) }); console.log('✓', s, x ? JSON.stringify(x).slice(0, 240) : '') }
const content = {
  title: 'La importancia de identificar el núcleo del sujeto y del predicado', subtitle: 'Cinco razones para analizar bien las oraciones',
  stats: [], sections: [
    { heading: '1. Comprender mejor', body: 'Saber quién realiza la acción y qué se dice de él aclara el significado de la oración.' },
    { heading: '2. Concordar sin errores', body: 'El núcleo del sujeto y el verbo concuerdan en número y persona.' },
    { heading: '3. Escribir con claridad', body: 'Identificar los núcleos ayuda a construir oraciones ordenadas y precisas.' },
    { heading: '4. Puntuar correctamente', body: 'No se separa con coma el sujeto del predicado.' },
    { heading: '5. Analizar textos', body: 'Es la base del análisis sintáctico de oraciones más complejas.' }],
  examples: [{ caption: 'Ejemplo', parts: [
    { text: 'Los estudiantes atentos', label: 'Sujeto', emphasis: 'estudiantes', emphasisLabel: 'Núcleo del sujeto' },
    { text: 'comprenden la explicación', label: 'Predicado', emphasis: 'comprenden', emphasisLabel: 'Núcleo verbal' }] }],
  takeaway: 'Encuentra primero el verbo (núcleo del predicado) y pregunta quién lo realiza: así llegas al núcleo del sujeto.',
}
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  const cdp = await browser.target().createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
  await page.setRequestInterception(true)
  page.on('request', req => { if (req.url().startsWith('https://fonts.')) return req.abort(); if (req.url().endsWith('/api/chat')) return req.abort(); req.continue() })
  await page.goto(base + '/api/health')
  await page.evaluate((content) => new Promise((resolve, reject) => {
    const r = indexedDB.open('lingora-beta-v1', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('sessions')
    r.onsuccess = () => { const tx = r.result.transaction('sessions', 'readwrite')
      tx.objectStore('sessions').put({ version: 1, phase: 'chat', lang: 'es', mentor: 'sarah', topic: 'conversation', activeMode: 'interact',
        session: { lang: 'es', mentor: 'sarah', topic: 'conversation', level: 'A1', tokens: 2, samples: [], sessionId: 'info-e2e', commercialOffers: [], lastTask: null, lastArtifact: null, activeMode: 'interact' },
        msgs: [{ id: 'u1', sender: 'user', text: 'Dame una imagen con una infografía acerca de la importancia de saber identificar el núcleo del sujeto y del predicado en las oraciones.' },
          { id: 't1', sender: 'sarah', text: 'Aquí tienes la infografía.', complete: true, artifacts: [{ type: 'infographic', content }] }] }, 'current')
      tx.oncomplete = () => { r.result.close(); resolve(true) }; tx.onerror = () => reject(tx.error) }
    r.onerror = () => reject(r.error)
  }), content)
  await page.goto(base + '/beta', { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="infographic-artifact"] svg')
  await page.waitForFunction(() => document.querySelector('[data-testid="infographic-artifact"]').dataset.layout === 'narrow')
  const shown = await page.$eval('[data-testid="infographic-artifact"] svg', s => ({ w: s.getAttribute('data-layout-width'), box: s.getBoundingClientRect().width, text: s.innerHTML.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&'), em: [...s.querySelectorAll('[data-emphasis]')].map(t => t.textContent.trim()) }))
  assert.ok(Number(shown.w) < 400 && Math.abs(Number(shown.w) - shown.box) < 12, 'laid out for the real width'); assert.deepEqual(shown.em, ['estudiantes', 'comprenden'])
  const info = I.validateInfographicContent(content).info
  const words = t => t.normalize('NFC').split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean)
  const inOrder = (hay, needle) => { const h = words(hay), n = words(needle); let i = 0; for (const w of h) if (w === n[i]) i++; return i === n.length }
  for (const t of I.infographicTexts(info)) assert.ok(inOrder(shown.text, t), 'on screen: ' + t)
  step('Infografía visible en 390 px con disposición estrecha; los dos núcleos resaltados; todo el texto del Tutor dibujado', { layout: shown.w, renderedWidthPx: Math.round(shown.box), highlighted: shown.em })
  await page.screenshot({ path: path.join(out, 'infographic-390.png'), fullPage: true })
  const fontPx = await page.$eval('[data-testid="infographic-artifact"] svg', s => { const k = s.getBoundingClientRect().width / Number(s.getAttribute('data-layout-width')); return Math.round(13 * k * 10) / 10 })
  assert.ok(fontPx >= 12.5, 'body text renders at its real size (≥ 12.5 px) on a 390 px phone'); step('Legibilidad móvil: el cuerpo se dibuja a ' + fontPx + ' px')

  const waitFile = async ext => { for (let i = 0; i < 60; i++) { const f = fs.readdirSync(downloads).find(x => x.endsWith(ext) && !x.endsWith('.crdownload')); if (f) return path.join(downloads, f); await new Promise(r => setTimeout(r, 150)) } return null }
  await page.click('[data-testid="infographic-download-svg"]')
  const svgFile = await waitFile('.svg'); assert.ok(svgFile)
  const svg = fs.readFileSync(svgFile, 'utf8')
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 520 \d+" width="520" height="(\d+)"/)
  const svgText = svg.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  for (const t of I.infographicTexts(info)) assert.ok(inOrder(svgText, t), 'in the SVG file: ' + t)
  assert.equal(svg, I.renderInfographicSvg(info, { fixed: true }), 'the file is exactly the deterministic drawing of the content')
  step('SVG descargado = dibujo determinista del contenido, con todo el texto', { file: path.basename(svgFile), bytes: Buffer.byteLength(svg) })
  const H = Number(/ height="(\d+)"/.exec(svg)[1])
  await page.click('[data-testid="infographic-download-png"]')
  await page.waitForFunction(() => document.querySelector('[data-testid="infographic-download-status"]')?.dataset.state === 'done', { timeout: 20000 })
  const pngFile = await waitFile('.png'); assert.ok(pngFile)
  const png = fs.readFileSync(pngFile)
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); assert.equal(png.toString('latin1', 12, 16), 'IHDR')
  assert.equal(png.readUInt32BE(16), 1040); assert.equal(png.readUInt32BE(20), H * 2)
  const status = await page.$eval('[data-testid="infographic-download-status"]', e => e.innerText)
  step('PNG descargado: firma PNG válida y tamaño 2× del SVG', { file: path.basename(pngFile), bytes: png.length, width: 1040, height: H * 2, status })
  // A PNG that cannot be produced: visible reason, no SVG substitute.
  const before = fs.readdirSync(downloads).length
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null) } })
  await page.click('[data-testid="infographic-download-png"]')
  await page.waitForFunction(() => document.querySelector('[data-testid="infographic-download-status"]')?.dataset.state === 'error', { timeout: 10000 })
  const err = await page.$eval('[data-testid="infographic-download-status"]', e => e.innerText)
  await new Promise(r => setTimeout(r, 800))
  assert.equal(fs.readdirSync(downloads).length, before, 'nothing downloaded instead')
  assert.match(err, /No se pudo crear el PNG/)
  step('Fallo controlado de PNG: motivo visible y ninguna descarga sustituta', { visible: err })
  fs.copyFileSync(pngFile, path.join(out, 'infografia.png')); fs.copyFileSync(svgFile, path.join(out, 'infografia.svg'))
} finally {
  fs.writeFileSync(path.join(out, 'infographic-e2e.json'), JSON.stringify(steps, null, 1))
  await browser.close()
}
console.log(`PASS e2e infographic 7.5: ${steps.length} steps → ${out}`)
