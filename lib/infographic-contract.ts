import { VISUAL_LIMITS } from './native-visual-schema'
// LINGORA 7.4.3 — infographic instrument (Manifesto 7.1 arts. 49–52; Manifesto arts. 28–32 bis).
//
// The Tutor Maestro AUTHORS the infographic (headline figures, titled sections, takeaway) as a typed call.
// The runtime validates (structure; no markup; headline figures must be numbers that occur in the turn,
// so the infographic can never invent a magnitude) and draws it deterministically as colour cards.
// Pure module: no I/O, no model, no regex on the student's intent.
import { esc, wrapLines, TONES, TONE_KEYS } from './svg-text'
import { numbersIn } from './chart-contract'

export interface InfoStat { value: string; label: string; tone?: string }
export interface InfoSection { heading: string; body: string; icon?: string; tone?: string }
export interface InfographicContent { title: string; subtitle?: string; stats: InfoStat[]; sections: InfoSection[]; takeaway?: string }
export type InfoCheck = { ok: true; info: InfographicContent } | { ok: false; reason: string }

type Obj = Record<string, unknown>
const obj = (v: unknown): v is Obj => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/<\s*\/?\s*[a-z][^>]*>/i.test(v)
const tone = (v: unknown): v is string => typeof v === 'string' && TONE_KEYS.includes(v)

export interface InfoSources { text?: string; tables?: { rows: string[][] }[] }

export function validateInfographicContent(raw: unknown, src: InfoSources = {}): InfoCheck {
  if (!obj(raw) || !text(raw.title, VISUAL_LIMITS.infographic.titleMax)) return { ok: false, reason: 'info_title' }
  const sections = raw.sections
  if (!Array.isArray(sections) || sections.length < VISUAL_LIMITS.infographic.sectionsMin || sections.length > VISUAL_LIMITS.infographic.sectionsMax) return { ok: false, reason: 'info_section_count' }
  const secs: InfoSection[] = []
  for (const [i, s] of sections.entries()) {
    if (!obj(s) || !text(s.heading, VISUAL_LIMITS.infographic.headingMax) || !text(s.body, VISUAL_LIMITS.infographic.bodyMax)) return { ok: false, reason: `info_section_shape:${i}` }
    if (s.icon !== undefined && !(typeof s.icon === 'string' && s.icon.length > 0 && s.icon.length <= 8 && !/[<>&]/.test(s.icon))) return { ok: false, reason: `info_icon:${i}` }
    if (s.tone !== undefined && !tone(s.tone)) return { ok: false, reason: `info_tone:${i}` }
    secs.push({ heading: s.heading.trim(), body: s.body.trim(), ...(typeof s.icon === 'string' ? { icon: s.icon } : {}), ...(typeof s.tone === 'string' ? { tone: s.tone } : {}) })
  }
  const stats: InfoStat[] = []
  if (raw.stats !== undefined) {
    if (!Array.isArray(raw.stats) || raw.stats.length > VISUAL_LIMITS.infographic.statsMax) return { ok: false, reason: 'info_stat_count' }
    const pool = new Set<number>()
    for (const n of numbersIn(src.text ?? '')) pool.add(n)
    for (const t of src.tables ?? []) for (const r of t.rows) for (const c of r) for (const n of numbersIn(c)) pool.add(n)
    for (const [i, s] of raw.stats.entries()) {
      if (!obj(s) || !text(s.value, VISUAL_LIMITS.infographic.statValueMax) || !text(s.label, VISUAL_LIMITS.infographic.statLabelMax)) return { ok: false, reason: `info_stat_shape:${i}` }
      if (s.tone !== undefined && !tone(s.tone)) return { ok: false, reason: `info_stat_tone:${i}` }
      const nums = numbersIn(s.value)
      // A headline figure is a magnitude: it must occur in the turn (student text, Tutor reply, same-turn tables).
      if (nums.length && pool.size && !nums.every(n => pool.has(n))) return { ok: false, reason: `info_untraceable_stat:${i}:${s.value}` }
      // Lossless drawing: the label must fit its card without truncation.
      if (wrapLines(s.label, statWrap(raw.stats.length)).length > 3) return { ok: false, reason: `info_stat_label_too_long:${i}` }
      stats.push({ value: s.value.trim(), label: s.label.trim(), ...(typeof s.tone === 'string' ? { tone: s.tone } : {}) })
    }
  }
  if (raw.takeaway !== undefined && !text(raw.takeaway, VISUAL_LIMITS.infographic.takeawayMax)) return { ok: false, reason: 'info_takeaway' }
  return { ok: true, info: { title: (raw.title as string).trim(), ...(text(raw.subtitle, 140) ? { subtitle: (raw.subtitle as string).trim() } : {}), stats, sections: secs, ...(typeof raw.takeaway === 'string' ? { takeaway: raw.takeaway.trim() } : {}) } }
}

const W = 520, PAD = 18
const statWrap = (n: number) => Math.max(8, Math.floor(((W - 2 * PAD - 10 * (n - 1)) / n) / 6.4))
const ROTATE = ['info', 'ok', 'warn', 'highlight', 'danger', 'neutral']

/** Deterministic SVG. Same input, same bytes; every headline figure, heading and body line is drawn. */
export function renderInfographicSvg(info: InfographicContent, opts: { fixed?: boolean } = {}): string {
  const body: string[] = []
  let y = 30
  body.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="20" font-weight="800" fill="#111827" style="unicode-bidi:plaintext">${esc(info.title)}</text>`)
  if (info.subtitle) { y += 22; for (const ln of wrapLines(info.subtitle, 70)) { body.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="12.5" fill="#4b5563" style="unicode-bidi:plaintext">${esc(ln)}</text>`); y += 16 } y -= 16 }
  y += 18
  if (info.stats.length) {
    const n = info.stats.length, gap = 10, w = (W - 2 * PAD - gap * (n - 1)) / n
    info.stats.forEach((s, i) => {
      const t = TONES[s.tone ?? ROTATE[i % ROTATE.length]], x = PAD + i * (w + gap)
      const lab = wrapLines(s.label, statWrap(n))
      body.push(`<rect data-stat="${i}" x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="86" rx="12" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>`,
        `<text x="${(x + w / 2).toFixed(1)}" y="${y + 36}" text-anchor="middle" font-size="26" font-weight="800" fill="${t.ink}" style="unicode-bidi:plaintext">${esc(s.value)}</text>`,
        `<text text-anchor="middle" font-size="11.5" fill="${t.ink}" style="unicode-bidi:plaintext">${lab.map((ln, k) => `<tspan x="${(x + w / 2).toFixed(1)}" y="${y + 56 + k * 13}">${esc(ln)}</tspan>`).join('')}</text>`)
    })
    y += 86 + 16
  }
  info.sections.forEach((s, i) => {
    const t = TONES[s.tone ?? ROTATE[(i + info.stats.length) % ROTATE.length]]
    const lines = wrapLines(s.body, 62)
    const h = 38 + lines.length * 17 + 10
    body.push(`<rect data-section="${i}" x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="${h}" rx="12" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>`,
      `<rect x="${PAD}" y="${y}" width="8" height="${h}" rx="4" fill="${t.stroke}"/>`,
      `<text x="${PAD + 22}" y="${y + 25}" font-size="15" font-weight="800" fill="${t.ink}" style="unicode-bidi:plaintext">${s.icon ? esc(s.icon) + ' ' : ''}${esc(s.heading)}</text>`,
      `<text font-size="13" fill="#1f2937" style="unicode-bidi:plaintext">${lines.map((ln, k) => `<tspan x="${PAD + 22}" y="${y + 47 + k * 17}">${esc(ln)}</tspan>`).join('')}</text>`)
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
