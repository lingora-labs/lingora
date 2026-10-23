// LINGORA 7.5 — the ONE reader of Tutor text.
//
// Every surface that shows what the Tutor wrote (chat bubble, downloaded PDF,
// HTML version, conversation export, tactile quiz extraction) reads it through
// this module. The Markdown is parsed once by a standard, maintained parser
// (marked, GFM) and rendered once to one HTML fragment; surfaces differ only by
// stylesheet (CHAT_CSS / PRINT_CSS / WEB_CSS), never by markup. There is no
// second parser, no regex re-implementation per surface, and no model.
//
// Guarantees:
//  - Raw HTML in the source is shown as text, never interpreted.
//  - Links render only for http(s)/mailto; anything else prints as text.
//    Print CSS appends the address after the link text, because paper has no hover.
//  - Images are never fetched: they become a link to their address.
//  - Code (fenced and inline) and math (\[..\], $$..$$, \(..\), $..$) are kept
//    verbatim, character for character.
//  - Every block element carries an explicit base direction, and runs of the
//    opposite direction inside it are isolated with <bdi> (Arabic glosses in a
//    Spanish line, a Spanish example in an Arabic line). Text is never changed.
import { Marked, type Tokens, type Token, type TokenizerAndRendererExtension } from 'marked'

export const esc = (v: unknown): string => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// ─── Direction ────────────────────────────────────────────────────────────────
const RTL_CH = '֐-ࣿיִ-﷿ﹰ-﻿'
const RTL_LETTER = new RegExp('[' + RTL_CH + ']')
const LTR_LETTER = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/
const RTL_RUN = new RegExp('[' + RTL_CH + '](?:[^' + RTL_CH + '\\n—–|.!?…]*?[' + RTL_CH + '])*[.!?…:;]*', 'gu')
const LTR_RUN = new RegExp('[A-Za-z\\u00C0-\\u024F¿¡](?:[^' + RTL_CH + '\\n—–|]*[A-Za-z\\u00C0-\\u024F0-9])?[.!?…]*', 'gu')

/** Direction of the first strong letter; a ≤2-letter leading label ("أ)", "A)") does not flip the line. */
export function baseDirOf(raw: string): 'rtl' | 'ltr' {
  const dirs: Array<'rtl' | 'ltr'> = []
  for (const ch of raw) {
    if (RTL_LETTER.test(ch)) dirs.push('rtl')
    else if (LTR_LETTER.test(ch)) dirs.push('ltr')
  }
  if (!dirs.length) return 'ltr'
  const first = dirs[0]
  let run = 0
  while (run < dirs.length && dirs[run] === first) run++
  return run <= 2 && run < dirs.length ? dirs[run] : first
}

function isolate(raw: string, base: 'rtl' | 'ltr'): string {
  // Only a run of the opposite direction needs isolating.
  if (base === 'ltr' ? !RTL_LETTER.test(raw) : !/[A-Za-z\u00C0-\u024F]/.test(raw)) return esc(raw)
  const re = base === 'rtl' ? LTR_RUN : RTL_RUN
  const open = base === 'rtl' ? '<bdi dir="ltr">' : '<bdi dir="rtl">'
  let out = '', last = 0
  for (const m of raw.matchAll(re)) {
    const i = m.index ?? 0
    if (base === 'rtl' && !/[A-Za-zÀ-ɏ]/.test(m[0])) continue
    out += esc(raw.slice(last, i)) + open + esc(m[0]) + '</bdi>'
    last = i + m[0].length
  }
  return out + esc(raw.slice(last))
}

// ─── Safe addresses ───────────────────────────────────────────────────────────
const SAFE_URL = /^(?:https?:\/\/|mailto:)[^\s<>"'`]+$/i
export const safeUrl = (href: string | null | undefined): string | null => {
  const h = String(href ?? '').trim()
  return SAFE_URL.test(h) ? h : null
}

// ─── Math kept verbatim ───────────────────────────────────────────────────────
// Without this, Markdown treats "\[" as an escaped bracket and silently drops the
// backslash, and "*" inside a formula becomes emphasis.
const mathBlock: TokenizerAndRendererExtension = {
  name: 'lnMathBlock',
  level: 'block',
  start(src) {
    const m = /(?:^|\n)[ \t]*(?:\\\[|\$\$)/.exec(src)
    return m ? m.index + (m[0].startsWith('\n') ? 1 : 0) : undefined
  },
  tokenizer(src) {
    const m = /^[ \t]*(\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$)[ \t]*(?:\n|$)/.exec(src)
    if (m) return { type: 'lnMathBlock', raw: m[0], text: m[1] }
    return undefined
  },
  renderer(t) { return `<div class="ln-math" dir="ltr">${esc((t as unknown as { text: string }).text)}</div>\n` },
}
const mathInline: TokenizerAndRendererExtension = {
  name: 'lnMathInline',
  level: 'inline',
  start(src) {
    const i = src.search(/\\\(|\\\[|\$/)
    return i < 0 ? undefined : i
  },
  tokenizer(src) {
    const m = /^\\\([\s\S]+?\\\)/.exec(src) || /^\\\[[\s\S]+?\\\]/.exec(src)
      || /^\$\$[^\n]+?\$\$/.exec(src) || /^\$(?=\S)[^$\n]*?\S\$(?!\d)|^\$\S\$(?!\d)/.exec(src)
    if (m) return { type: 'lnMathInline', raw: m[0], text: m[0] }
    return undefined
  },
  renderer(t) { return `<span class="ln-math" dir="ltr">${esc((t as unknown as { text: string }).text)}</span>` },
}

// ─── Renderer ─────────────────────────────────────────────────────────────────
interface RenderContext { base: Array<'rtl' | 'ltr'>; headings: number; idPrefix: string }

/** Plain text of inline tokens (what the reader sees), used to decide direction. */
function inlineText(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  return tokens.map((t) => {
    const x = t as Token & { tokens?: Token[]; text?: string }
    if (x.type === 'codespan' || x.type === 'lnMathInline') return ''
    if (x.tokens?.length) return inlineText(x.tokens)
    return typeof x.text === 'string' ? x.text : ''
  }).join('')
}

function createParser(ctx: RenderContext) {
  const marked = new Marked({ gfm: true, breaks: true, async: false })
  const withBase = (raw: string, render: () => string): [string, string] => {
    const dir = baseDirOf(raw)
    ctx.base.push(dir)
    try { return [dir, render()] } finally { ctx.base.pop() }
  }
  const current = () => ctx.base[ctx.base.length - 1] ?? 'ltr'
  marked.use({
    extensions: [mathBlock, mathInline],
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag) {
        // Raw HTML from a model is data, never markup.
        const text = token.text
        return 'block' in token && token.block ? `<p dir="${baseDirOf(text)}">${isolate(text.replace(/\n$/, ''), baseDirOf(text))}</p>\n` : isolate(text, current())
      },
      heading(this: { parser: { parseInline(t: Token[]): string } }, { tokens, depth }: Tokens.Heading) {
        const [dir, html] = withBase(inlineText(tokens), () => this.parser.parseInline(tokens))
        ctx.headings += 1
        return `<h${depth} id="${ctx.idPrefix}${ctx.headings}" dir="${dir}">${html}</h${depth}>\n`
      },
      paragraph(this: { parser: { parseInline(t: Token[]): string } }, { tokens }: Tokens.Paragraph) {
        const [dir, html] = withBase(inlineText(tokens), () => this.parser.parseInline(tokens))
        return `<p dir="${dir}">${html}</p>\n`
      },
      listitem(this: { parser: { parse(t: Token[]): string } }, item: Tokens.ListItem) {
        const [dir, html] = withBase(item.text, () => this.parser.parse(item.tokens))
        return `<li dir="${dir}">${html}</li>\n`
      },
      tablecell(this: { parser: { parseInline(t: Token[]): string } }, cell: Tokens.TableCell) {
        const tag = cell.header ? 'th' : 'td'
        const [dir, html] = withBase(inlineText(cell.tokens), () => this.parser.parseInline(cell.tokens))
        return `<${tag} dir="${dir}"${cell.align ? ` style="text-align:${cell.align}"` : ''}>${html}</${tag}>\n`
      },
      table(this: { tablecell(c: Tokens.TableCell): string; tablerow(r: { text: string }): string }, token: Tokens.Table) {
        const head = this.tablerow({ text: token.header.map((c) => this.tablecell(c)).join('') })
        const body = token.rows.map((r) => this.tablerow({ text: r.map((c) => this.tablecell(c)).join('') })).join('')
        return `<div class="ln-table-wrap"><table>\n<thead>\n${head}</thead>\n${body ? `<tbody>\n${body}</tbody>\n` : ''}</table></div>\n`
      },
      blockquote(this: { parser: { parse(t: Token[]): string } }, { tokens, text }: Tokens.Blockquote) {
        const [dir, html] = withBase(text, () => this.parser.parse(tokens))
        return `<blockquote dir="${dir}">\n${html}</blockquote>\n`
      },
      code({ text, lang }: Tokens.Code) {
        const language = (lang || '').match(/^\S*/)?.[0] ?? ''
        return `<pre class="ln-code" dir="ltr"><code${language ? ` class="language-${esc(language)}"` : ''}>${esc(text.replace(/\n$/, ''))}</code></pre>\n`
      },
      codespan({ text }: Tokens.Codespan) { return `<code dir="ltr">${esc(text)}</code>` },
      link(this: { parser: { parseInline(t: Token[]): string } }, { href, title, text, tokens }: Tokens.Link) {
        const label = tokens?.length ? this.parser.parseInline(tokens) : isolate(text, current())
        const url = safeUrl(href)
        if (!url) return label + (href && href !== text ? ` (${esc(href)})` : '')
        const bare = text.trim() === href.trim() || text.trim() === href.replace(/^mailto:/i, '').trim()
        return `<a href="${esc(url)}"${bare ? ' class="ln-bare"' : ''}${title ? ` title="${esc(title)}"` : ''} rel="noopener noreferrer" target="_blank">${label}</a>`
      },
      image({ href, text }: Tokens.Image) {
        const url = safeUrl(href)
        const label = esc(text || href)
        return url ? `<a class="ln-image" href="${esc(url)}" rel="noopener noreferrer" target="_blank">🖼 ${label}</a>` : `🖼 ${label}`
      },
      text(this: { parser: { parseInline(t: Token[]): string } }, token: Tokens.Text | Tokens.Escape) {
        const t = token as Tokens.Text
        if (t.tokens?.length) return this.parser.parseInline(t.tokens)
        return isolate(token.text, current())
      },
    },
  })
  return marked
}

/** The tokens of a Tutor text, exactly as every surface reads them. */
export function lexTutorText(source: string): Token[] {
  const marked = createParser({ base: [], headings: 0, idPrefix: 'ln-h' })
  return marked.lexer(String(source ?? '').replace(/\r\n?/g, '\n'))
}

/** The ONE HTML rendering of a Tutor text. Same bytes on every surface. */
export function renderTutorMarkdown(source: string, options: { idPrefix?: string } = {}): string {
  const src = String(source ?? '').replace(/\r\n?/g, '\n')
  if (!src.trim()) return ''
  const marked = createParser({ base: [], headings: 0, idPrefix: options.idPrefix ?? 'ln-h' })
  return `<div class="ln-md">${marked.parse(src) as string}</div>`
}

/** Headings in reading order, with the ids renderTutorMarkdown gives them. */
export function tutorHeadings(source: string, options: { idPrefix?: string } = {}): Array<{ id: string; depth: number; text: string }> {
  const out: Array<{ id: string; depth: number; text: string }> = []
  let n = 0
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === 'heading') { n += 1; out.push({ id: `${options.idPrefix ?? 'ln-h'}${n}`, depth: (t as Tokens.Heading).depth, text: inlineText((t as Tokens.Heading).tokens).trim() }) }
      const nested = t as Token & { tokens?: Token[]; items?: Array<{ tokens: Token[] }> }
      if (t.type === 'blockquote' && nested.tokens) walk(nested.tokens)
      if (t.type === 'list' && nested.items) for (const it of nested.items) walk(it.tokens)
    }
  }
  walk(lexTutorText(source))
  return out
}

// ─── Loss gate ────────────────────────────────────────────────────────────────
/** Letters and digits only; formatting characters are not content. */
export function fidelityTokens(value: string): string[] {
  return value.replace(/[*_\x60]/g, '').toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []
}
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }
/** Visible text of rendered HTML (tags removed, entities decoded). */
export function visibleText(html: string): string {
  return html.replace(/<\/?(?:em|strong|code|del|bdi|a|span)\b[^>]*>/g, '').replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_m, e: string) => ENTITIES[e] ?? ' ')
}
/** Words of the source that the rendering does not show. Empty = nothing lost. */
export function missingWords(source: string, html: string): string[] {
  // Compare in sequence: repeated words and numerical associations must survive.
  const printed = fidelityTokens(visibleText(html))
  const body = String(source ?? '').split('\n').filter((l) => !/^\s*(?:\x60{3,}|~{3,})\s*[\w+#.-]*\s*$/.test(l)).join('\n')
  // A Markdown link/image destination is syntax around the visible label; print CSS shows it, the HTML keeps it in href.
  // Ordered-list numbers are drawn by the list itself (<ol start>), not as text.
  const visibleSource = body.replace(/^(\s*(?:>\s*)*)\d{1,9}[.)](?=\s)/gm, '$1').replace(/^ {0,3}\[[^\]\n]+\]:\s*\S+.*$/gm, '').replace(/(!?\[[^\]\n]*\])\((?:[^()\s]|\([^()\s]*\))+(?:\s+"[^"]*")?\)/g, '$1')
  const expected = fidelityTokens(visibleSource)
  let cursor = 0
  const missing: string[] = []
  for (const token of expected) {
    while (cursor < printed.length && printed[cursor] !== token) cursor++
    if (cursor === printed.length) missing.push(token)
    else cursor++
  }
  return missing
}

// ─── Surfaces: the same markup, three stylesheets ─────────────────────────────
const SHARED = `
.ln-md{overflow-wrap:anywhere}
.ln-md>:first-child{margin-top:0}.ln-md>:last-child{margin-bottom:0}
.ln-md p{margin:.45em 0}
.ln-md h1,.ln-md h2,.ln-md h3,.ln-md h4,.ln-md h5,.ln-md h6{line-height:1.3;margin:1em 0 .4em;font-weight:800}
.ln-md ul,.ln-md ol{margin:.4em 0;padding-inline-start:1.5em}
.ln-md li{margin:.2em 0}
.ln-md li>p{margin:.2em 0}
.ln-md blockquote{margin:.6em 0;padding:.2em .9em;border-inline-start:3px solid var(--ln-accent)}
.ln-md hr{border:0;border-top:1px solid var(--ln-rule);margin:1em 0}
.ln-md .ln-table-wrap{overflow-x:auto;margin:.6em 0}
.ln-md table{border-collapse:collapse;width:100%}
.ln-md th,.ln-md td{border:1px solid var(--ln-rule);padding:.35em .55em;text-align:start;vertical-align:top}
.ln-md pre{margin:.6em 0;padding:.7em .9em;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.88em;line-height:1.45}
.ln-md code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em}
.ln-md :not(pre)>code{padding:.05em .35em;border-radius:4px}
.ln-md .ln-math{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em;unicode-bidi:isolate}
.ln-md div.ln-math{margin:.6em 0;padding:.5em .8em;border-radius:8px;white-space:pre-wrap}
.ln-md bdi{unicode-bidi:isolate}
`
/** Dark chat bubble. Uses the chat page's own CSS variables. */
export const CHAT_CSS = `
.ln-md{--ln-accent:var(--teal);--ln-rule:rgba(255,255,255,.12)}
${SHARED}
.ln-md h1{font-size:17px;color:#fff}.ln-md h2{font-size:15px;color:#fff}
.ln-md h3,.ln-md h4,.ln-md h5,.ln-md h6{font-size:13px;color:var(--teal);letter-spacing:.03em}
.ln-md strong{color:#fff}
.ln-md a{color:#7dd3fc;text-decoration:underline}
.ln-md th{color:var(--teal);font-size:12px;background:rgba(0,201,167,.06)}
.ln-md td{color:var(--silver)}
.ln-md table{font-size:13px}
.ln-md pre,.ln-md div.ln-math{background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.08)}
.ln-md :not(pre)>code,.ln-md span.ln-math{background:rgba(0,0,0,.35);color:#7dd3fc}
`
/** Paper (PDF and print). Links show their address; tables and code never overflow the page. */
export const PRINT_CSS = `
.ln-md{--ln-accent:#08777d;--ln-rule:#bdc9d3;color:#152c42}
${SHARED}
.ln-md h1{font-size:16pt}.ln-md h2{font-size:13.5pt}.ln-md h3{font-size:12pt}.ln-md h4,.ln-md h5,.ln-md h6{font-size:11pt}
.ln-md h1,.ln-md h2,.ln-md h3,.ln-md h4,.ln-md h5,.ln-md h6{color:#0f3550;break-after:avoid-page}
.ln-md a{color:#075985}
.ln-md a:not(.ln-bare)::after{content:" (" attr(href) ")";font-size:.85em;color:#52667a;overflow-wrap:anywhere}
.ln-md table{table-layout:auto;font-size:9pt;break-inside:auto}
.ln-md tr{break-inside:avoid-page}
.ln-md th{background:#d5f5ee}
.ln-md pre,.ln-md div.ln-math{background:#f0f4f8;break-inside:avoid-page}
.ln-md :not(pre)>code,.ln-md span.ln-math{background:#eef2f6}
.ln-md .ln-table-wrap{overflow:visible}
`
/** Screen version of a document (HTML delivery). Light, readable, phone-width safe. */
export const WEB_CSS = `
.ln-md{--ln-accent:#0e8f88;--ln-rule:#dfe3ea;color:#1f2633;font-size:16px;line-height:1.65}
${SHARED}
.ln-md h1{font-size:1.5em;color:#102a40}.ln-md h2{font-size:1.25em;color:#102a40;padding-bottom:.2em;border-bottom:2px solid #c8efe8}
.ln-md h3{font-size:1.08em;color:#23415c}.ln-md h4,.ln-md h5,.ln-md h6{font-size:1em;color:#23415c}
.ln-md a{color:#0b6aa2}
.ln-md th{background:#102a40;color:#fff}
.ln-md tr:nth-child(even) td{background:#f6f8fa}
.ln-md pre,.ln-md div.ln-math{background:#f3f5f8;border:1px solid #e3e7ee}
.ln-md :not(pre)>code,.ln-md span.ln-math{background:#eef1f5}
html[data-theme="dark"] .ln-md{color:#e3e7ee;--ln-rule:#334155}
html[data-theme="dark"] .ln-md h1,html[data-theme="dark"] .ln-md h2,html[data-theme="dark"] .ln-md h3,html[data-theme="dark"] .ln-md h4{color:#f1f5f9}
html[data-theme="dark"] .ln-md tr:nth-child(even) td{background:#1b2230}
html[data-theme="dark"] .ln-md pre,html[data-theme="dark"] .ln-md div.ln-math,html[data-theme="dark"] .ln-md :not(pre)>code{background:#1b2230;border-color:#334155}
html[data-theme="dark"] .ln-md a{color:#7dd3fc}
`
