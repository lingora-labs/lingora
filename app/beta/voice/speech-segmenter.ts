// 7.5 P1-A — what the Tutor's voice says is exactly what the student sees. Pure.
// The streamed Markdown is cut at safe boundaries (end of line, end of sentence) into segments the voice can
// start on before the answer is finished. Each segment is spoken as its VISIBLE text (no Markdown syntax);
// joined, the spoken segments are the visible text of the whole answer.
// 7.6 R3: during a call the same segments are spoken in their ORAL projection (see oral.ts); the screen is unchanged.
import { renderTutorMarkdown, visibleText } from '../../../lib/content/markdown'
import { oralize, tableNotice } from './oral'

export const SEGMENT_MIN_CHARS = 24
export const SEGMENT_MAX_CHARS = 420
/** In a call, after the first segment (which starts the voice early) sentences are joined up to this size: fewer seams, fewer pauses. */
export const CALL_SEGMENT_MIN_CHARS = 90

/** Visible text of a Markdown fragment, ready for speech. */
export function spokenText(markdown: string): string {
  return visibleText(renderTutorMarkdown(markdown)).replace(/[*_`#>|]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

/** While a call lasts the whole page speaks the oral projection (set by the call, cleared on hang-up); otherwise the literal visible text. */
export const speechMode: { oral: { lang: string } | null } = { oral: null }

export class SpeechSegmenter {
  private buf = ''
  private inFence = false
  private carry = ''
  private sent = 0
  private atLineStart = true
  private lineIsTable = false
  private inTable = false
  /** `oral`: speak the oral projection of the text (call mode) instead of the literal visible text. */
  constructor(private opts: { oral?: { lang: string } } = {}) {}
  private get mode() { return this.opts.oral ?? speechMode.oral }
  /** Feed streamed text; returns the segments that became complete. */
  push(delta: string): string[] { this.buf += delta; return this.drain(false) }
  /** End of the answer: everything left is spoken. */
  flush(): string[] { return this.drain(true) }

  private drain(final: boolean): string[] {
    const out: string[] = []
    const oral = this.mode
    const emit = (spoken: string) => {
      if (!spoken) return
      const s = this.carry ? `${this.carry}${oral && !/[.!?…:;,]$/.test(this.carry) ? '.' : ''} ${spoken}` : spoken
      const min = oral && this.sent > 0 ? CALL_SEGMENT_MIN_CHARS : SEGMENT_MIN_CHARS
      if (s.length < min && !final) { this.carry = s; return }
      this.carry = ''
      this.sent++
      out.push(s)
    }
    // A table is announced once and never read cell by cell: its rows stay on screen.
    const speak = (raw: string) => {
      if (!oral) return emit(spokenText(raw))
      if (this.atLineStart) this.lineIsTable = /^\s*\|/.test(raw)
      this.atLineStart = raw.endsWith('\n')
      if (this.lineIsTable) { if (!this.inTable) { this.inTable = true; emit(tableNotice(oral.lang)) }; return }
      if (raw.trim()) this.inTable = false
      emit(oralize(spokenText(raw), oral.lang))
    }
    for (let cut = this.nextCut(); cut > 0; cut = this.nextCut()) {
      speak(this.buf.slice(0, cut))
      this.buf = this.buf.slice(cut)
    }
    if (final) {
      speak(this.buf); this.buf = ''
      if (this.carry) { out.push(this.carry); this.carry = '' }
    }
    return out
  }

  /** Index just after the first safe boundary in the buffer, or 0 when none is complete yet. */
  private nextCut(): number {
    const b = this.buf
    let from = 0
    for (;;) {
      const nl = b.indexOf('\n', from)
      if (nl < 0) break
      const line = b.slice(from, nl)
      if (/^\s*(```|~~~)/.test(line)) { this.inFence = !this.inFence; if (!this.inFence) return nl + 1; from = nl + 1; continue }
      if (this.inFence) { from = nl + 1; continue }
      return nl + 1
    }
    if (this.inFence) return 0
    // An unfinished line: the end of a sentence followed by a space is a safe place to start speaking.
    const re = /[.!?…](?=\s)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(b))) if (m.index + 1 >= SEGMENT_MIN_CHARS) return m.index + 1
    if (b.length > SEGMENT_MAX_CHARS) { const sp = b.lastIndexOf(' ', SEGMENT_MAX_CHARS); return sp > 0 ? sp + 1 : SEGMENT_MAX_CHARS }
    return 0
  }
}
