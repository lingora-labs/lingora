// LINGORA 7.5 — infographic instrument (Manifesto 7.1 arts. 49–52).
//
// The Tutor Maestro AUTHORS the infographic (headline figures, titled sections, takeaway). The runtime
// validates structure (no markup) and FIDELITY — a headline figure must be a number that occurs in the
// turn, so the infographic can never invent a magnitude — and draws all of it as colour cards. 7.5 removed
// the count and length caps (2–6 sections, 4 stats, 14-character values, 60-character headings): any
// number of sections and figures, every text wrapped to fit. Pure module: no I/O, no model.
import { esc, wrapLines, TONES, TONE_KEYS } from './svg-text'
import { numbersIn } from './chart-contract'
import { displayText, VISUAL_MINIMUMS } from './native-visual-schema'

export interface InfoStat { value: string; label: string; tone?: string }
export interface InfoSection { heading: string; body: string; icon?: string; tone?: string }
export interface InfographicContent { title: string; subtitle?: string; stats: InfoStat[]; sections: InfoSection[]; takeaway?: string }
export type InfoCheck = { ok: true; info: InfographicContent } | { ok: false; reason: string }

type Obj = Record<string, unknown>
const obj = (v: unknown): v is Obj => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const tone = (v: unknown): v is string => typeof v === 'string' && TONE_KEYS.includes(v)

export interface InfoSources { text?: string; tables?: { rows: string[][] }[] }

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
  if (raw.takeaway !== undefined && !displayText(raw.takeaway)) return { ok: false, reason: 'info_takeaway' }
  return { ok: true, info: { title: (raw.title as string).trim(), ...(displayText(raw.subtitle) ? { subtitle: (raw.subtitle as string).trim() } : {}), stats, sections: secs, ...(typeof raw.takeaway === 'string' ? { takeaway: raw.takeaway.trim() } : {}) } }
}

const W = 520, PAD = 18, STATS_PER_ROW = 4, GAP = 10
const ROTATE = ['info', 'ok', 'warn', 'highlight', 'danger', 'neutral']

/** Deterministic SVG. Same input, same bytes; every figure, heading and body line is drawn in full. */
export function renderInfographicSvg(info: InfographicContent, opts: { fixed?: boolean } = {}): string {
  const body: string[] = []
  let y = 30
  const title = wrapLines(info.title, 44)
  title.forEach((ln, k) => body.push(`<text x="${W / 2}" y="${y + k * 24}" text-anchor="middle" font-size="20" font-weight="800" fill="#111827" style="unicode-bidi:plaintext">${esc(ln)}</text>`))
  y += (title.length - 1) * 24
  if (info.subtitle) { y += 22; for (const ln of wrapLines(info.subtitle, 70)) { body.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="12.5" fill="#4b5563" style="unicode-bidi:plaintext">${esc(ln)}</text>`); y += 16 } y -= 16 }
  y += 18
  // Figures in rows of up to four cards; values and labels wrap inside their card.
  for (let r = 0; r < info.stats.length; r += STATS_PER_ROW) {
    const row = info.stats.slice(r, r + STATS_PER_ROW)
    const n = row.length, w = (W - 2 * PAD - GAP * (n - 1)) / n
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
    const head = wrapLines((s.icon ? s.icon + ' ' : '') + s.heading, 52)
    const lines = wrapLines(s.body, 62)
    const h = 20 + head.length * 19 + lines.length * 17 + 12
    body.push(`<rect data-section="${i}" x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="${h}" rx="12" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>`,
      `<rect x="${PAD}" y="${y}" width="8" height="${h}" rx="4" fill="${t.stroke}"/>`,
      `<text font-size="15" font-weight="800" fill="${t.ink}" style="unicode-bidi:plaintext">${head.map((ln, k) => `<tspan x="${PAD + 22}" y="${y + 25 + k * 19}">${esc(ln)}</tspan>`).join('')}</text>`,
      `<text font-size="13" fill="#1f2937" style="unicode-bidi:plaintext">${lines.map((ln, k) => `<tspan x="${PAD + 22}" y="${y + 25 + head.length * 19 + 3 + k * 17}">${esc(ln)}</tspan>`).join('')}</text>`)
    y += h + 12
  })
  if (info.takeaway) {
    const lines = wrapLines(info.takeaway, 64), h = 24 + lines.length * 18
    body.push(`<rect data-takeaway="1" x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="${h}" rx="12" fill="#111827"/>`,
      `<text font-size="13.5" font-weight="700" fill="#ffffff" style="unicode-bidi:plaintext">${lines.map((ln, k) => `<tspan x="${PAD + 16}" y="${y + 24 + k * 18}">${esc(ln)}</tspan>`).join('')}</text>`)
    y += h + 12
  }
  const H = y + 6
  return [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${opts.fixed ? `width="${W}" height="${H}"` : `preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;min-width:440px;height:auto"`} role="img" aria-label="${esc(info.title)}" font-family="system-ui,-apple-system,Segoe UI,Noto Sans,Noto Naskh Arabic,sans-serif">`,
    `<rect width="${W}" height="${H}" rx="14" fill="#ffffff"/>`, ...body, '</svg>'].join('')
}
