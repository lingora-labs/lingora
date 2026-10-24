// QA (not in the build: needs a local Chromium and poppler). Measures whether the PRINT document ends with an
// empty page, sweeping document lengths across page boundaries, for single documents and conversation exports.
// Uses the production page (renderDocumentPage 'print') and the production print stylesheet (preparePrintHtml);
// only the web fonts are replaced by local ones, because this machine cannot reach Google Fonts.
// Usage: node tests/qa/pdf-last-page-7-5.mjs /path/to/chromium [outDir]
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'
const { load } = await import('../_ts-loader.mjs')
const { renderDocumentPage } = load('lib/content/document-page.ts')
const { preparePrintHtml } = load('server/tools/pdf/renderDocumentPdf.ts')

const exe = process.argv[2]
const out = process.argv[3] || fs.mkdtempSync('/tmp/lingora-pdf-qa-')
fs.mkdirSync(out, { recursive: true })
const para = i => `**Punto ${i}.** El subjuntivo aparece después de expresiones de deseo, duda o emoción: *ojalá que vengas*, *dudo que llueva*, *me alegra que estés aquí*. Ejemplo ${i}.`
const cases = []
for (let n = 1; n <= 70; n++) cases.push({ name: `doc-${n}`, page: { title: 'Material', sections: [{ text: '# Subjuntivo\n\n' + Array.from({ length: n }, (_, i) => para(i + 1)).join('\n\n') }] } })
for (let n = 1; n <= 40; n++) cases.push({ name: `conv-${n}`, page: { title: 'Conversación', subtitle: 'Exportación', sections: Array.from({ length: n }, (_, i) => ({ heading: i % 2 ? 'SARAH' : 'Student', text: para(i + 1) })) } })

const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
const results = []
try {
  const tab = await browser.newPage()
  for (const c of cases) {
    const html = preparePrintHtml(renderDocumentPage(c.page, 'print'), { fontCss: '', fontList: '"DejaVu Sans"', monoCss: '' })
    await tab.setContent(html, { waitUntil: 'load' })
    const bytes = await tab.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false })
    const file = path.join(out, c.name + '.pdf')
    fs.writeFileSync(file, bytes)
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file]).toString())[1])
    const last = execFileSync('pdftotext', ['-f', String(pages), '-l', String(pages), file, '-']).toString().trim()
    results.push({ name: c.name, pages, lastPageEmpty: last.length === 0 })
  }
} finally { await browser.close() }
const empty = results.filter(r => r.lastPageEmpty)
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1))
console.log(JSON.stringify({ documents: results.length, pageCounts: [...new Set(results.map(r => r.pages))].sort((a, b) => a - b), emptyLastPage: empty.map(r => r.name), out }))
process.exit(empty.length ? 1 : 0)
