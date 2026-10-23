// LINGORA 7.4.2 — chart instrument (Manifesto 7.1 arts. 49–52).
//
// The Tutor Maestro decides WHETHER a chart helps and AUTHORS its data as a
// typed call. The runtime only (a) validates that the data is structurally
// sound and faithful to what the conversation contains, and (b) renders it
// deterministically. A chart is never painted by an image model: a generative
// model cannot guarantee that six data points stay six data points.
//
// Pure module: no I/O, no model, no regex on the student's intent.

export type ChartKind = 'bar' | 'line'
export interface ChartPanel { kind: ChartKind; title: string; unit?: string; values: number[] }
export interface ChartContent { title: string; subtitle?: string; categories: string[]; panels: ChartPanel[] }
export type ChartCheck = { ok: true; chart: ChartContent } | { ok: false; reason: string }

import { displayText as text, VISUAL_MINIMUMS } from './native-visual-schema'
import { wrapLines } from './svg-text'

type Obj = Record<string, unknown>
const obj = (v: unknown): v is Obj => Boolean(v && typeof v === 'object' && !Array.isArray(v))

const NUM = /-?\d+(?:[.,]\d+)?/g
export const numbersIn = (s: string): number[] =>
  (s.match(NUM) ?? []).map(t => Number(t.replace(',', '.'))).filter(Number.isFinite)
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim()

export interface ChartSources {
  /** Free text of the conversation turn (student message + Tutor reply). */
  text?: string
  /** Native tables materialised in the SAME turn: header labels + cell texts. */
  tables?: { rows: string[][] }[]
}

/**
 * Faithfulness contract, in order:
 *  1. structure: unique categories, at least one panel, one finite value per
 *     category per panel (no missing, no extra, no NaN). No count caps (7.5):
 *     the canvas widens with the categories;
 *  2. traceability: every plotted value occurs as a number in the turn's text
 *     or tables (the chart can never invent magnitudes);
 *  3. association: when the text interleaves each category with its numbers
 *     ("Enero 120 4%, Febrero 180 5%…"), every plotted value must belong to
 *     ITS category's segment, so swapped values are rejected even without a table;
 *  4. coverage: when a same-turn table exists, its category column and a
 *     value column must equal the panel exactly, in order (no lost month, no
 *     shifted conversion).
 */
export function validateChartContent(raw: unknown, src: ChartSources = {}): ChartCheck {
  if (!obj(raw) || !text(raw.title)) return { ok: false, reason: 'chart_title' }
  const cats = raw.categories
  if (!Array.isArray(cats) || cats.length < VISUAL_MINIMUMS.chart.categories || !cats.every(c => text(c)))
    return { ok: false, reason: 'chart_categories' }
  const categories = (cats as string[]).map(c => c.trim())
  if (new Set(categories.map(fold)).size !== categories.length) return { ok: false, reason: 'chart_duplicate_category' }
  const ps = raw.panels
  if (!Array.isArray(ps) || ps.length < VISUAL_MINIMUMS.chart.panels) return { ok: false, reason: 'chart_panels' }
  const panels: ChartPanel[] = []
  for (const [i, p] of ps.entries()) {
    if (!obj(p) || (p.kind !== 'bar' && p.kind !== 'line') || !text(p.title)) return { ok: false, reason: `chart_panel_shape:${i}` }
    if (p.unit !== undefined && !text(p.unit)) return { ok: false, reason: `chart_unit:${i}` }
    const v = p.values
    if (!Array.isArray(v) || v.length !== categories.length) return { ok: false, reason: `chart_value_count:${i}:${Array.isArray(v) ? v.length : 'none'}/${categories.length}` }
    if (!v.every(n => typeof n === 'number' && Number.isFinite(n))) return { ok: false, reason: `chart_value_nan:${i}` }
    panels.push({ kind: p.kind, title: p.title.trim(), ...(p.unit ? { unit: p.unit.trim() } : {}), values: v as number[] })
  }

  const pool = new Set<number>()
  for (const n of numbersIn(src.text ?? '')) pool.add(n)
  for (const t of src.tables ?? []) for (const r of t.rows) for (const c of r) for (const n of numbersIn(c)) pool.add(n)
  if (pool.size) {
    for (const [i, p] of panels.entries())
      for (const [j, n] of p.values.entries())
        if (!pool.has(n)) return { ok: false, reason: `chart_untraceable_value:${i}:${j}:${n}` }
  }

  const assoc = categorySegments(categories, src.text ?? '')
  if (assoc) {
    for (const [i, p] of panels.entries())
      for (const [j, n] of p.values.entries())
        if (!assoc[j].has(n)) return { ok: false, reason: `chart_value_category:${i}:${j}:${n}` }
  }

  for (const t of src.tables ?? []) {
    const body = t.rows.filter(r => r.length >= 2)
    if (body.length === 0) continue
    // Only a table that talks about the same categories constrains the chart.
    const first = body.map(r => fold(r[0]))
    const overlap = categories.filter(c => first.includes(fold(c))).length
    if (overlap === 0) continue
    if (first.length !== categories.length || categories.some((c, k) => fold(c) !== first[k]))
      return { ok: false, reason: `chart_table_categories:${first.length}/${categories.length}` }
    for (const [i, p] of panels.entries()) {
      const cols = body[0].length
      let match = false
      for (let c = 1; c < cols && !match; c++) {
        const col = body.map(r => numbersIn(r[c] ?? '')[0])
        match = col.length === p.values.length && col.every((n, k) => n === p.values[k])
      }
      if (!match) return { ok: false, reason: `chart_table_values:${i}` }
    }
  }
  return { ok: true, chart: { title: (raw.title as string).trim(), ...(text(raw.subtitle) ? { subtitle: (raw.subtitle as string).trim() } : {}), categories, panels } }
}

/**
 * Numbers that follow each category label in the turn's text, up to the next
 * category label. Returns null (check not applicable) unless EVERY category
 * occurs in the text AND every category owns at least one number, i.e. the
 * author interleaved labels and figures. Prose that lists labels first and
 * numbers afterwards is left to the traceability and table checks.
 */
function categorySegments(categories: string[], raw: string): Set<number>[] | null {
  const text = fold(raw)
  const marks: { pos: number; len: number; cat: number }[] = []
  for (const [k, c] of categories.entries()) {
    const f = fold(c)
    if (!f) return null
    let at = text.indexOf(f), found = false
    while (at !== -1) {
      const before = text[at - 1], after = text[at + f.length]
      if (!(before && /\p{L}/u.test(before)) && !(after && /\p{L}/u.test(after))) { marks.push({ pos: at, len: f.length, cat: k }); found = true }
      at = text.indexOf(f, at + f.length)
    }
    if (!found) return null
  }
  marks.sort((a, b) => a.pos - b.pos)
  const sets = categories.map(() => new Set<number>())
  marks.forEach((m, idx) => {
    const end = idx + 1 < marks.length ? marks[idx + 1].pos : text.length
    for (const n of numbersIn(text.slice(m.pos + m.len, end))) sets[m.cat].add(n)
  })
  return sets.every(s => s.size > 0) ? sets : null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export function niceMax(max: number): number {
  if (max <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= max) return m * pow
  return 10 * pow
}
const fmt = (n: number, unit?: string) => `${Number.isInteger(n) ? n : Number(n.toFixed(2))}${unit === '%' ? '%' : ''}`

/** Deterministic SVG. Same input, same bytes; every category and value drawn.
 *  The canvas widens with the number of categories and category labels wrap, so nothing is clipped;
 *  negative values are drawn below a zero line (7.4 clamped them to zero).
 *  Inline use is fluid inside a scrollable box; `fixed` gives explicit pixel size for file export. */
export function renderChartSvg(chart: ChartContent, opts: { fixed?: boolean } = {}): string {
  const n = chart.categories.length
  const L = 56, R = 20, TOP = 52, MIN_STEP = 52
  const W = Math.max(520, L + R + n * MIN_STEP)
  const plotW = W - L - R
  const step = plotW / n
  const catWrap = Math.max(6, Math.floor(step / 6.6))
  const catLines = chart.categories.map(c => wrapLines(c, catWrap))
  const B = 30 + Math.max(...catLines.map(l => l.length)) * 14
  const PH = 220 + B
  const H = TOP + chart.panels.length * PH
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${opts.fixed ? `width="${W}" height="${H}"` : `preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;min-width:${W > 520 ? Math.min(W, 1040) : 440}px;height:auto"`} role="img" aria-label="${esc(chart.title)}" font-family="system-ui,-apple-system,Segoe UI,Noto Sans,Noto Naskh Arabic,sans-serif">`,
    `<rect width="${W}" height="${H}" rx="14" fill="#ffffff"/>`,
    `<text x="${W / 2}" y="30" text-anchor="middle" font-size="18" font-weight="700" fill="#111827" style="unicode-bidi:plaintext">${esc(chart.title)}</text>`,
  ]
  chart.panels.forEach((p, i) => {
    const y0 = TOP + i * PH
    const plotTop = y0 + 30, plotBottom = y0 + PH - B
    const plotH = plotBottom - plotTop
    const minV = Math.min(...p.values, 0), hi = niceMax(Math.max(...p.values, 0)), lo = minV < 0 ? -niceMax(-minV) : 0
    const span = hi - lo || 1
    const ys = (v: number) => plotBottom - ((v - lo) / span) * plotH
    const zeroY = ys(0)
    const cx = (k: number) => L + step * (k + 0.5)
    parts.push(`<text x="${W / 2}" y="${y0 + 14}" text-anchor="middle" font-size="14" font-weight="600" fill="#1f2937" style="unicode-bidi:plaintext">${esc(p.title)}</text>`)
    for (let t = 0; t <= 4; t++) {
      const v = lo + (span / 4) * t, y = ys(v)
      parts.push(`<line x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}" stroke="#e5e7eb"/>`,
        `<text x="${L - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#4b5563">${esc(fmt(v, p.unit))}</text>`)
    }
    if (p.kind === 'bar') {
      const bw = Math.min(56, step * 0.62)
      p.values.forEach((v, k) => {
        const y = ys(v), top = Math.min(y, zeroY), h = Math.abs(zeroY - y)
        parts.push(`<rect data-cat="${k}" x="${(cx(k) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${v < 0 ? '#ef6b6b' : '#4c8dff'}"/>`,
          `<text x="${cx(k).toFixed(1)}" y="${(v < 0 ? y + 14 : y - 6).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="#111827">${esc(fmt(v, p.unit))}</text>`)
      })
    } else {
      const pts = p.values.map((v, k) => `${cx(k).toFixed(1)},${ys(v).toFixed(1)}`)
      parts.push(`<polyline fill="none" stroke="#f59e0b" stroke-width="3" stroke-linejoin="round" points="${pts.join(' ')}"/>`)
      p.values.forEach((v, k) => parts.push(
        `<circle data-cat="${k}" cx="${cx(k).toFixed(1)}" cy="${ys(v).toFixed(1)}" r="4.5" fill="#f59e0b"/>`,
        `<text x="${cx(k).toFixed(1)}" y="${(ys(v) - 10).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="#111827">${esc(fmt(v, p.unit))}</text>`))
    }
    parts.push(`<line x1="${L}" y1="${zeroY.toFixed(1)}" x2="${W - R}" y2="${zeroY.toFixed(1)}" stroke="#9ca3af"/>`)
    catLines.forEach((lines, k) => parts.push(
      `<text text-anchor="middle" font-size="12" fill="#374151" style="unicode-bidi:plaintext">${lines.map((ln, j) => `<tspan x="${cx(k).toFixed(1)}" y="${plotBottom + 18 + j * 14}">${esc(ln)}</tspan>`).join('')}</text>`))
  })
  parts.push('</svg>')
  return parts.join('')
}
