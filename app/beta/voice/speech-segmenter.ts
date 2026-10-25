// 7.5 P1-A — what the Tutor's voice says is exactly what the student sees. Pure.
// The streamed Markdown is cut at safe boundaries (end of line, end of sentence) into segments the voice can
// start on before the answer is finished. Each segment is spoken as its VISIBLE text (no Markdown syntax);
// joined, the spoken segments are the visible text of the whole answer.
import { renderTutorMarkdown, visibleText } from '../../../lib/content/markdown'

export const SEGMENT_MIN_CHARS = 24
export const SEGMENT_MAX_CHARS = 420

/** Visible text of a Markdown fragment, ready for speech. */
export function spokenText(markdown: string): string {
  return visibleText(renderTutorMarkdown(markdown)).replace(/[*_`#>|]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

export class SpeechSegmenter {
  private buf = ''
  private inFence = false
  private carry = ''
  /** Feed streamed text; returns the segments that became complete. */
  push(delta: string): string[] { this.buf += delta; return this.drain(false) }
  /** End of the answer: everything left is spoken. */
  flush(): string[] { return this.drain(true) }

  private drain(final: boolean): string[] {
    const out: string[] = []
    const emit = (spoken: string) => {
      if (!spoken) return
      const s = this.carry ? `${this.carry} ${spoken}` : spoken
      if (s.length < SEGMENT_MIN_CHARS && !final) { this.carry = s; return }
      this.carry = ''
      out.push(s)
    }
    for (let cut = this.nextCut(); cut > 0; cut = this.nextCut()) {
      emit(spokenText(this.buf.slice(0, cut)))
      this.buf = this.buf.slice(cut)
    }
    if (final) {
      emit(spokenText(this.buf)); this.buf = ''
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
