// LINGORA 7.5 — infographic instrument (Manifesto 7.1 arts. 49–52).
//
// The Tutor Maestro AUTHORS the infographic (headline figures, titled sections, worked examples, takeaway).
// The runtime validates structure (no markup) and FIDELITY — a headline figure must be a number that occurs
// in the turn, an emphasized word must occur in its own segment — and draws all of it. 7.5 removed the count
// and length caps: any number of sections and figures, every text wrapped to fit.
// 7.5 P1-B: worked examples with labelled segments and an emphasized core (e.g. a sentence split into
// subject and predicate with each nucleus highlighted). The renderer draws what the Tutor labelled; it never
// adds a label of its own. Two layouts of the SAME content: wide (520) and narrow (360, phones).
// Pure module: no I/O, no model.
import { esc, wrapLines, visualWidth, TONES, TONE_KEYS } from './svg-text'
import { numbersIn } from './chart-contract'
import { displayText, VISUAL_MINIMUMS } from './native-visual-schema'

export interface InfoStat { value: string; label: string; tone?: string }
export interface InfoSection { heading: string; body: string; icon?: string; tone?: string }
/** One segment of a worked example: its text, what it is, and optionally the core word(s) inside it. */
export interface InfoPart { text: string; label?: string; emphasis?: string; emphasisLabel?: string; tone?: string }
export interface InfoExample { caption?: string; parts: InfoPart[] }
export interface InfographicContent { title: string; subtitle?: string; stats: InfoStat[]; sections: InfoSection[]; examples?: InfoExample[]; takeaway?: string }
export type InfoCheck = { ok: true; info: InfographicContent } | { ok: false; reason: string }

type Obj = Record<string, unknown>
const obj = (v: unknown): v is Obj => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const tone = (v: unknown): v is string => typeof v === 'string' && TONE_KEYS.includes(v)
const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim()
const words = (s: string) => norm(s).split(' ').filter(Boolean)
const bare = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

/** Index range of `emphasis` inside `text`, as whole words (punctuation around a word is ignored). */
export function emphasisRange(text: string, emphasis: string): [number, number] | null {
  const t = words(text).map(bare), e = words(emphasis).map(bare)
  if (!e.length || e.some(w => !w)) return null
  for (let i = 0; i + e.length <= t.length; i++) if (e.every((w, k) => t[i + k] === w)) return [i, i + e.length]
  return null
}

export interface InfoSources { text?: string; tables?: { rows: string[][] }[] }

function validateExamples(raw: unknown): { ok: true; examples: InfoExample[] } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: true, examples: [] }
  if (!Array.isArray(raw)) return { ok: false, reason: 'info_example_shape:0' }
  const out: InfoExample[] = []
  for (const [i, ex] of raw.entries()) {
    const parts = obj(ex) ? (Array.isArray(ex.parts) ? ex.parts : Array.isArray(ex.segments) ? ex.segments : null) : null
    if (!obj(ex) || !parts || parts.length < 1) return { ok: false, reason: `info_example_shape:${i}` }
    if (ex.caption !== undefined && !displayText(ex.caption)) return { ok: false, reason: `info_example_shape:${i}` }
    const ps: InfoPart[] = []
    for (const [j, p] of parts.entries()) {
      if (!obj(p) || !displayText(p.text)) return { ok: false, reason: `info_example_part:${i}:${j}` }
      if (p.label !== undefined && !displayText(p.label)) return { ok: false, reason: `info_example_part:${i}:${j}` }
      if (p.tone !== undefined && !tone(p.tone)) return { ok: false, reason: `info_example_part:${i}:${j}` }
      if (p.emphasisLabel !== undefined && (!displayText(p.emphasisLabel) || p.emphasis === undefined)) return { ok: false, reason: `info_example_part:${i}:${j}` }
      if (p.emphasis !== undefined && (!displayText(p.emphasis) || !emphasisRange(p.text, p.emphasis))) return { ok: false, reason: `info_example_emphasis:${i}:${j}:${String(p.emphasis)}` }
      ps.push({ text: norm(p.text), ...(typeof p.label === 'string' ? { label: p.label.trim() } : {}), ...(typeof p.emphasis === 'string' ? { emphasis: norm(p.emphasis) } : {}),
        ...(typeof p.emphasisLabel === 'string' ? { emphasisLabel: p.emphasisLabel.trim() } : {}), ...(typeof p.tone === 'string' ? { tone: p.tone } : {}) })
    }
    // A sentence given alongside its parts must be exactly those parts, in order.
    if (ex.sentence !== undefined && (!displayText(ex.sentence) || words(ex.sentence).map(bare).join(' ') !== ps.flatMap(p => words(p.text)).map(bare).join(' ')))
      return { ok: false, reason: `info_example_mismatch:${i}` }
    out.push({ ...(typeof ex.caption === 'string' ? { caption: ex.caption.trim() } : {}), parts: ps })
  }
  return { ok: true, examples: out }
}

export function validateInfographicContent(raw: unknown, src: InfoSources = {}): InfoCheck {
  if (!obj(raw) || !displayText(raw.title)) return { ok: false, reason: 'info_title' }
  // Read equivalent section arrays supplied by the Tutor. Never synthesize missing sections.
  const sections = Array.isArray(raw.sections) ? raw.sections : Array.isArray(raw.cards) ? raw.cards : raw.blocks
  if (!Array.isArray(sections) || sections.length < VISUAL_MINIMUMS.infographic.sections) return { ok: false, reason: 'info_section_count' }
  const secs: InfoSection[] = []
  for (const [i, section] of sections.entries()) {
    if (!obj(section)) return { ok: false, reason: `info_section_shape:${i}` }
    const heading = section.heading ?? section.title
    const body = section.body ?? section.text
    if (!displayText(heading) || !displayText(body)) return { ok: false, reason: `info_section_shape:${i}` }
    if (section.icon !== undefined && !(typeof section.icon === 'string' && section.icon.length > 0 && section.icon.length <= 16 && !/[<>&]/.test(section.icon)))
      return { ok: false, reason: `info_icon:${i}` }
    if (section.tone !== undefined && !tone(section.tone)) return { ok: false, reason: `info_tone:${i}` }
    secs.push({ heading: heading.trim(), body: body.trim(), ...(typeof section.icon === 'string' ? { icon: section.icon } : {}), ...(typeof section.tone === 'string' ? { tone: section.tone } : {}) })
  }
  const stats: InfoStat[] = []
  if (raw.stats !== undefined) {
    if (!Array.isArray(raw.stats)) return { ok: false, reason: 'info_stat_count' }
    const pool = new Set<number>()
    for (const n of numbersIn(src.text ?? '')) pool.add(n)
    for (const t of src.tables ?? []) for (const r of t.rows) for (const c of r) for (const n of numbersIn(c)) pool.add(n)
    for (const [i, s] of raw.stats.entries()) {
      if (!obj(s) || !displayText(s.value) || !displayText(s.label)) return { ok: false, reason: `info_stat_shape:${i}` }
      if (s.tone !== undefined && !tone(s.tone)) return { ok: false, reason: `info_stat_tone:${i}` }
      const nums = numbersIn(s.value)
      // A headline figure is a magnitude: it must occur in the turn (student text, Tutor reply, same-turn tables).
      if (nums.length && pool.size && !nums.every(n => pool.has(n))) return { ok: false, reason: `info_untraceable_stat:${i}:${s.value}` }
      stats.push({ value: s.value.trim(), label: s.label.trim(), ...(typeof s.tone === 'string' ? { tone: s.tone } : {}) })
    }
  }
  const ex = validateExamples(raw.examples)
  if (!ex.ok) return ex
  if (raw.takeaway !== undefined && !displayText(raw.takeaway)) return { ok: false, reason: 'info_takeaway' }
  return { ok: true, info: { title: (raw.title as string).trim(), ...(displayText(raw.subtitle) ? { subtitle: (raw.subtitle as string).trim() } : {}), stats, sections: secs,
    ...(ex.examples.length ? { examples: ex.examples } : {}), ...(typeof raw.takeaway === 'string' ? { takeaway: raw.takeaway.trim() } : {}) } }
}

/** Every text the Tutor authored, in order: what any layout (screen, file, print) must show. */
export function infographicTexts(info: InfographicContent): string[] {
  return [info.title, info.subtitle ?? '', ...info.stats.flatMap(s => [s.value, s.label]), ...info.sections.flatMap(s => [s.heading, s.body]),
    ...(info.examples ?? []).flatMap(e => [e.caption ?? '', ...e.parts.flatMap(p => [p.text, p.label ?? '', p.emphasis ?? '', p.emphasisLabel ?? ''])]), info.takeaway ?? ''].filter(Boolean)
}

const PAD = 18, GAP = 10
const ROTATE = ['info', 'ok', 'warn', 'highlight', 'danger', 'neutral']
const PART_TONES = ['info', 'ok', 'highlight', 'warn', 'danger', 'neutral']
/** Characters per line for a font size in a width (≈ average glyph advance of system sans). */
const fit = (px: number, font: number) => Math.max(8, Math.floor(px / (font * 0.56)))

export const INFOGRAPHIC_WIDTHS = { wide: 520, narrow: 360 } as const

/** Deterministic SVG. Same input, same bytes; every figure, heading, example and body line is drawn in full. */
export function renderInfographicSvg(info: InfographicContent, opts: { fixed?: boolean; width?: number } = {}): string {
  const W = opts.width ?? INFOGRAPHIC_WIDTHS.wide
  const inner = W - 2 * PAD
  const body: string[] = []
  let y = 30
  const title = wrapLines(info.title, fit(inner, 20))
  title.forEach((ln, k) => body.push(`<text x="${W / 2}" y="${y + k * 24}" text-anchor="middle" font-size="20" font-weight="800" fill="#111827" style="unicode-bidi:plaintext">${esc(ln)}</text>`))
  y += (title.length - 1) * 24
  if (info.subtitle) { y += 22; for (const ln of wrapLines(info.subtitle, fit(inner, 12.5))) { body.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="12.5" fill="#4b5563" style="unicode-bidi:plaintext">${esc(ln)}</text>`); y += 16 } y -= 16 }
  y += 18
  // Figures in rows (four on wide, two on narrow); values and labels wrap inside their card.
  const perRow = W < 420 ? 2 : 4
  for (let r = 0; r < info.stats.length; r += perRow) {
    const row = info.stats.slice(r, r + perRow)
    const n = row.length, w = (inner - GAP * (n - 1)) / n
    const valueWrap = Math.max(4, Math.floor(w / 15)), labelWrap = Math.max(8, Math.floor(w / 6.4))
    const laid = row.map(s => ({ s, v: wrapLines(s.value, valueWrap), l: wrapLines(s.label, labelWrap) }))
    const h = Math.max(...laid.map(x => 20 + x.v.length * 28 + x.l.length * 13 + 12), 86)
    laid.forEach(({ s, v, l }, i) => {
      const t = TONES[s.tone ?? ROTATE[(r + i) % ROTATE.length]], x = PAD + i * (w + GAP), cx = (x + w / 2).toFixed(1)
      body.push(`<rect data-stat="${r + i}" x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${h}" rx="12" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>`,
        `<text text-anchor="middle" font-size="24" font-weight="800" fill="${t.ink}" style="unicode-bidi:plaintext">${v.map((ln, k) => `<tspan x="${cx}" y="${y + 36 + k * 28}">${esc(ln)}</tspan>`).join('')}</text>`,
        `<text text-anchor="middle" font-size="11.5" fill="${t.ink}" style="unicode-bidi:plaintext">${l.map((ln, k) => `<tspan x="${cx}" y="${y + 36 + (v.length - 1) * 28 + 20 + k * 13}">${esc(ln)}</tspan>`).join('')}</text>`)
    })
    y += h + 12
  }
  if (info.stats.length) y += 4
  info.sections.forEach((s, i) => {
    const t = TONES[s.tone ?? ROTATE[(i + info.stats.length) % ROTATE.length]]
    const head = wrapLines((s.icon ? s.icon + ' ' : '') + s.heading, fit(inner - 30, 15))
    const lines = wrapLines(s.body, fit(inner - 30, 13))
    const h = 20 + head.length * 19 + lines.length * 17 + 12
    body.push(`<rect data-section="${i}" x="${PAD}" y="${y}" width="${inner}" height="${h}" rx="12" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>`,
      `<rect x="${PAD}" y="${y}" width="8" height="${h}" rx="4" fill="${t.stroke}"/>`,
      `<text font-size="15" font-weight="800" fill="${t.ink}" style="unicode-bidi:plaintext">${head.map((ln, k) => `<tspan x="${PAD + 22}" y="${y + 25 + k * 19}">${esc(ln)}</tspan>`).join('')}</text>`,
      `<text font-size="13" fill="#1f2937" style="unicode-bidi:plaintext">${lines.map((ln, k) => `<tspan x="${PAD + 22}" y="${y + 25 + head.length * 19 + 3 + k * 17}">${esc(ln)}</tspan>`).join('')}</text>`)
    y += h + 12
  })
  for (const [ei, ex] of (info.examples ?? []).entries()) y = renderExample(body, ex, ei, y, W)
  if (info.takeaway) {
    const lines = wrapLines(info.takeaway, fit(inner - 24, 13.5)), h = 24 + lines.length * 18
    body.push(`<rect data-takeaway="1" x="${PAD}" y="${y}" width="${inner}" height="${h}" rx="12" fill="#111827"/>`,
      `<text font-size="13.5" font-weight="700" fill="#ffffff" style="unicode-bidi:plaintext">${lines.map((ln, k) => `<tspan x="${PAD + 16}" y="${y + 24 + k * 18}">${esc(ln)}</tspan>`).join('')}</text>`)
    y += h + 12
  }
  const H = y + 6
  return [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${opts.fixed ? `width="${W}" height="${H}"` : `preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto"`} role="img" aria-label="${esc(info.title)}" data-layout-width="${W}" font-family="system-ui,-apple-system,Segoe UI,Noto Sans,Noto Naskh Arabic,sans-serif">`,
    `<rect width="${W}" height="${H}" rx="14" fill="#ffffff"/>`, ...body, '</svg>'].join('')
}

/** A worked example: the whole sentence (each segment in its colour, each core bold and underlined), then one
 *  legend row per segment with the Tutor's own labels. Returns the next y. */
function renderExample(body: string[], ex: InfoExample, ei: number, y0: number, W: number): number {
  const inner = W - 2 * PAD, x0 = PAD + 16, textW = inner - 32
  const tones = ex.parts.map((p, j) => TONES[p.tone ?? PART_TONES[j % PART_TONES.length]])
  // Tokens of the sentence with their segment and whether they are the emphasized core.
  const toks: Array<{ w: string; part: number; em: boolean }> = []
  ex.parts.forEach((p, j) => {
    const ws = words(p.text), range = p.emphasis ? emphasisRange(p.text, p.emphasis) : null
    ws.forEach((w, k) => toks.push({ w, part: j, em: Boolean(range && k >= range[0] && k < range[1]) }))
  })
  const maxUnits = fit(textW, 17)
  const lines: Array<typeof toks> = []
  let cur: typeof toks = [], used = 0
  for (const t of toks) {
    const u = visualWidth(t.w) + (cur.length ? 1 : 0)
    if (cur.length && used + u > maxUnits) { lines.push(cur); cur = []; used = 0 }
    used += visualWidth(t.w) + (cur.length ? 1 : 0)
    cur.push(t)
  }
  if (cur.length) lines.push(cur)
  const cap = ex.caption ? wrapLines(ex.caption, fit(textW, 14)) : []
  // Legend rows: the Tutor's label (chip), the segment, and its core with the Tutor's core label.
  const rows = ex.parts.map((p, j) => {
    const chip = p.label ?? ''
    const chipW = chip ? Math.min(textW * 0.5, visualWidth(chip) * 7.2 + 18) : 0
    const textLines = wrapLines(`«${p.text}»`, fit(textW - chipW - 8, 13))
    const emLines = p.emphasis ? wrapLines(`${p.emphasisLabel ? p.emphasisLabel + ': ' : ''}${p.emphasis}`, fit(textW - chipW - 22, 13)) : []
    return { j, chip, chipW, textLines, emLines, h: Math.max(22, (textLines.length + emLines.length) * 17 + 6) }
  })
  const h = 18 + cap.length * 18 + (cap.length ? 6 : 0) + 4 + lines.length * 26 + 6 + rows.reduce((n, r) => n + r.h + 6, 0) + 8
  body.push(`<rect data-example="${ei}" x="${PAD}" y="${y0}" width="${inner}" height="${h}" rx="12" fill="#f8fafc" stroke="#94a3b8" stroke-width="2"/>`)
  let y = y0 + 22
  if (cap.length) { body.push(`<text font-size="14" font-weight="800" fill="#0f172a" style="unicode-bidi:plaintext">${cap.map((ln, k) => `<tspan x="${x0}" y="${y + k * 18}">${esc(ln)}</tspan>`).join('')}</text>`); y += cap.length * 18 + 6 }
  y += 4
  for (const line of lines) {
    const spans = line.map((t, k) => {
      const c = tones[t.part]
      const st = t.em ? ` font-weight="900" fill="${c.stroke}" text-decoration="underline" data-emphasis="${t.part}"` : ` font-weight="600" fill="${c.ink}"`
      return `${k ? '<tspan> </tspan>' : ''}<tspan data-part="${t.part}"${st}>${esc(t.w)}</tspan>`
    }).join('')
    body.push(`<text x="${x0}" y="${y + 14}" font-size="17" style="unicode-bidi:plaintext;white-space:pre">${spans}</text>`)
    y += 26
  }
  y += 6
  for (const r of rows) {
    const c = tones[r.j]
    if (r.chip) body.push(`<rect x="${x0}" y="${y}" width="${r.chipW.toFixed(1)}" height="20" rx="10" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`,
      `<text x="${(x0 + r.chipW / 2).toFixed(1)}" y="${y + 14}" text-anchor="middle" font-size="11.5" font-weight="800" fill="${c.ink}" style="unicode-bidi:plaintext">${esc(r.chip)}</text>`)
    const tx = (x0 + (r.chip ? r.chipW + 8 : 0)).toFixed(1)
    const ly = y + 14
    body.push(`<text font-size="13" fill="#1f2937" style="unicode-bidi:plaintext">${r.textLines.map((ln, k) => `<tspan x="${tx}" y="${ly + k * 17}">${esc(ln)}</tspan>`).join('')}</text>`)
    if (r.emLines.length) body.push(`<text font-size="13" font-weight="800" fill="${c.stroke}" style="unicode-bidi:plaintext" data-emphasis-label="${r.j}">${r.emLines.map((ln, k) => `<tspan x="${tx}" y="${ly + (r.textLines.length + k) * 17}">${k === 0 ? '▸ ' : ''}${esc(ln)}</tspan>`).join('')}</text>`)
    y += r.h + 6
  }
  return y0 + h + 12
}
