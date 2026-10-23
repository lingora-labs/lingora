// LINGORA 7.5 — one page for every document LINGORA hands out.
//
// A document is an ordered list of sections, each = Tutor/student text (rendered by
// the canonical reader) + that turn's native artifacts (printed by artifact-print).
//  - Tutor PDF / HTML delivery: one section, the Tutor's reply.
//  - "Download this material": one section, that message and its artifacts.
//  - Conversation export: one section per turn, headed by the speaker.
// The PDF is Chromium printing surface 'print'; the HTML version is surface 'web'.
// Both contain the SAME section markup; only stylesheet and toolbar differ.
// Before returning, every section passes the loss gate: a word of the source that
// the page does not show aborts the document with a named refusal.
import { createHash } from 'node:crypto'
import { esc, baseDirOf, missingWords, renderTutorMarkdown, tutorHeadings, PRINT_CSS, WEB_CSS } from './markdown'
import { ARTIFACT_PRINT_CSS, printArtifact, type PrintableArtifact } from './artifact-print'

export interface DocumentSection { heading?: string; text: string; artifacts?: PrintableArtifact[] }
export interface DocumentPage { title: string; subtitle?: string; sections: DocumentSection[] }

const PAGE_CSS = `
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.55}
.ln-head{background:#102a40;color:#fff;padding:18px 22px}
.ln-brand{font-weight:800;letter-spacing:.04em;font-size:12px;color:#5eead4}
.ln-title{margin:6px 0 0;font-size:22px;line-height:1.25}
.ln-sub{margin-top:4px;font-size:12.5px;color:#b9c7d6}
.ln-main{padding:16px 22px 28px}
.ln-section{padding:10px 0;border-bottom:1px solid #dae1e9}
.ln-section:last-child{border-bottom:0}
/* flow-root makes Chromium honour keep-with-next for the speaker heading (7.4.6: orphan header measured) */
.ln-section>.ln-md{display:flow-root}
.ln-section-head{font-size:11pt;color:#08777d;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em;break-after:avoid-page}
${ARTIFACT_PRINT_CSS}
`
const PRINT_PAGE_CSS = `@page{size:A4;margin:15mm 14mm}body{background:#fff;color:#152c42}${PRINT_CSS}`
const WEB_PAGE_CSS = `
body{background:#f4f6f9;color:#1f2633}
.ln-wrap{max-width:820px;margin:0 auto;background:#fff;min-height:100vh;box-shadow:0 0 0 1px #e3e7ee}
.ln-main{font-size:calc(16px * var(--ln-zoom,1))}
.ln-ctl{position:sticky;top:0;z-index:2;display:none;flex-wrap:wrap;gap:6px;padding:8px 16px;background:#0c2133}
.js .ln-ctl{display:flex}
.ln-ctl button{font:inherit;font-size:13px;min-height:40px;padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.28);background:transparent;color:#fff;cursor:pointer}
.ln-toc{margin:0 0 14px;padding:10px 14px;border:1px solid #e3e7ee;border-radius:10px;background:#fafbfc}
.ln-toc summary{cursor:pointer;font-weight:800;color:#0e8f88}
.ln-toc ol{margin:6px 0 0;padding-inline-start:1.2em}
.ln-toc li{margin:2px 0}.ln-toc a{color:#1f2633;text-decoration:none}.ln-toc a:hover{text-decoration:underline}
.ln-toc .d3{margin-inline-start:1em}.ln-toc .d4,.ln-toc .d5,.ln-toc .d6{margin-inline-start:2em}
html[data-theme="dark"] body{background:#0b111b}
html[data-theme="dark"] .ln-wrap{background:#121a26;box-shadow:none}
html[data-theme="dark"] .ln-toc{background:#18212f;border-color:#2b3646}
html[data-theme="dark"] .ln-toc a{color:#e3e7ee}
html[data-theme="dark"] .ln-section{border-color:#2b3646}
html[data-theme="dark"] .ln-art-quiz{background:#18212f}
@media (max-width:520px){.ln-main{padding:12px 16px 24px}.ln-head{padding:16px}}
@media print{.ln-ctl{display:none!important}body{background:#fff}.ln-wrap{box-shadow:none;max-width:none}
.ln-md a:not(.ln-bare)::after{content:" (" attr(href) ")";font-size:.85em;color:#52667a}}
${WEB_CSS}
`
// The only script in the HTML version: a constant (no model text ever reaches it), pinned by CSP hash.
// Zoom, dark mode and print. Storage is optional; the page works without it.
const WEB_SCRIPT = `(function(){var d=document,r=d.documentElement;r.classList.add('js');var K='lingora-doc';var s={z:1,dark:0};
try{var p=JSON.parse(localStorage.getItem(K)||'{}');if(p&&typeof p==='object'){if(typeof p.z==='number')s.z=p.z;if(p.dark)s.dark=1}}catch(e){}
function save(){try{localStorage.setItem(K,JSON.stringify(s))}catch(e){}}
function z(v){s.z=Math.max(0.8,Math.min(1.6,Math.round(v*10)/10));r.style.setProperty('--ln-zoom',String(s.z));save()}
function t(on){s.dark=on?1:0;if(on)r.setAttribute('data-theme','dark');else r.removeAttribute('data-theme');var b=d.getElementById('ln-theme');b.setAttribute('aria-pressed',on?'true':'false');b.textContent=on?'Modo claro':'Modo oscuro';save()}
d.getElementById('ln-smaller').addEventListener('click',function(){z(s.z-0.1)});
d.getElementById('ln-bigger').addEventListener('click',function(){z(s.z+0.1)});
d.getElementById('ln-theme').addEventListener('click',function(){t(!s.dark)});
d.getElementById('ln-print').addEventListener('click',function(){window.print()});
if(s.z!==1)z(s.z);if(s.dark)t(true)})();`

/** Renders every section or throws `export_*` (named refusal). */
export function renderDocumentBody(page: DocumentPage): { html: string; headings: Array<{ id: string; depth: number; text: string }> } {
  const multi = page.sections.length > 1
  const headings: Array<{ id: string; depth: number; text: string }> = []
  const html = page.sections.map((section, i) => {
    const idPrefix = multi ? `s${i + 1}-h` : 'ln-h'
    const body = renderTutorMarkdown(section.text, { idPrefix })
    const lost = missingWords(section.text, body)
    if (lost.length) throw new Error('export_content_loss:' + (section.heading ?? 'texto') + ':' + lost.slice(0, 3).join(','))
    headings.push(...tutorHeadings(section.text, { idPrefix }))
    const artifacts = (section.artifacts ?? []).map(printArtifact).join('')
    const head = section.heading ? `<h2 class="ln-section-head" dir="${baseDirOf(section.heading)}">${esc(section.heading)}</h2>` : ''
    return `<section class="ln-section">${head}${body}${artifacts}</section>`
  }).join('\n')
  return { html, headings }
}

export function renderDocumentPage(page: DocumentPage, surface: 'print' | 'web'): string {
  const { html, headings } = renderDocumentBody(page)
  const title = page.title.trim() || 'LINGORA'
  const head = `<header class="ln-head"><div class="ln-brand">LINGORA</div><h1 class="ln-title" dir="${baseDirOf(title)}">${esc(title)}</h1>${page.subtitle ? `<div class="ln-sub" dir="auto">${esc(page.subtitle)}</div>` : ''}</header>`
  if (surface === 'print') {
    return `<!DOCTYPE html><html lang="und"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">` +
      `<title>${esc(title)}</title><style>${PAGE_CSS}${PRINT_PAGE_CSS}</style></head><body>${head}<main class="ln-main">${html}</main></body></html>`
  }
  const toc = headings.length >= 2
    ? `<details class="ln-toc" open><summary>Contenido (${headings.length})</summary><ol>${headings.map((h) => `<li class="d${h.depth}" dir="${baseDirOf(h.text)}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></details>`
    : ''
  const scriptHash = createHash('sha256').update(WEB_SCRIPT).digest('base64')
  return `<!DOCTYPE html><html lang="und"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'sha256-${scriptHash}'">` +
    `<title>${esc(title)}</title><style>${PAGE_CSS}${WEB_PAGE_CSS}</style></head><body><div class="ln-wrap">${head}` +
    `<nav class="ln-ctl" aria-label="Controles del documento"><button type="button" id="ln-smaller" aria-label="Texto más pequeño">A−</button><button type="button" id="ln-bigger" aria-label="Texto más grande">A+</button><button type="button" id="ln-theme" aria-pressed="false">Modo oscuro</button><button type="button" id="ln-print">Imprimir</button></nav>` +
    `<main class="ln-main">${toc}${html}</main></div><script>${WEB_SCRIPT}</script></body></html>`
}

const EXPLAIN: Record<string, string> = {
  export_unsupported_artifact_type: 'contiene un tipo de material que aún no se puede imprimir',
  export_missing_artifact_content: 'un material llegó sin contenido',
  export_content_loss: 'el documento habría perdido texto',
  export_external_image_not_embedded: 'una ilustración externa no puede imprimirse de forma fiel y segura',
}
/** Turns a refusal code into the sentence the student sees. Null for non-document errors. */
export function explainDocumentRefusal(message?: string): string | null {
  const m = /^(export_[a-z_]+)(?::(.*))?$/.exec((message ?? '').trim())
  if (!m) return null
  const why = EXPLAIN[m[1]] ?? (m[1].startsWith('export_invalid_') ? 'contiene un material inválido que no se puede imprimir sin perder información' : 'no se pudo imprimir de forma íntegra')
  return 'No se generó el documento: ' + why + (m[2] ? ' (' + m[2] + ')' : '') + '. No se entrega un documento incompleto.'
}
