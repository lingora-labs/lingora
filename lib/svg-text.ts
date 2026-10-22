// LINGORA 7.4.3 — shared deterministic text helpers for native SVG instruments.
// Pure: no I/O, no model.
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Visual width of a character in "latin units": CJK/full-width count double. */
const cw = (ch: string) => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/u.test(ch) ? 2 : 1
export const visualWidth = (s: string) => Array.from(s).reduce((n, ch) => n + cw(ch), 0)

/**
 * Wrap text into lines of at most `max` latin units. Words are kept whole; a word longer than
 * `max` (or text without spaces, e.g. Chinese) is split by characters. Never drops a character:
 * join(lines) always contains every non-space character of the input, in order.
 */
export function wrapLines(text: string, max: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  const push = () => { if (cur) { lines.push(cur); cur = '' } }
  for (const w of words) {
    let piece = w
    while (visualWidth(piece) > max) {
      let head = '', used = 0
      for (const ch of Array.from(piece)) { if (used + cw(ch) > max) break; head += ch; used += cw(ch) }
      if (!head) head = Array.from(piece)[0]
      push(); lines.push(head); piece = piece.slice(head.length)
    }
    if (!piece) continue
    if (!cur) cur = piece
    else if (visualWidth(cur) + 1 + visualWidth(piece) <= max) cur += ' ' + piece
    else { push(); cur = piece }
  }
  push()
  return lines
}

export const TONES: Record<string, { fill: string; stroke: string; ink: string }> = {
  ok:        { fill: '#dcfce7', stroke: '#16a34a', ink: '#14532d' },
  warn:      { fill: '#fef3c7', stroke: '#d97706', ink: '#78350f' },
  danger:    { fill: '#fee2e2', stroke: '#dc2626', ink: '#7f1d1d' },
  info:      { fill: '#dbeafe', stroke: '#2563eb', ink: '#1e3a8a' },
  neutral:   { fill: '#f3f4f6', stroke: '#6b7280', ink: '#111827' },
  highlight: { fill: '#ede9fe', stroke: '#7c3aed', ink: '#4c1d95' },
}
export const TONE_KEYS = Object.keys(TONES)
