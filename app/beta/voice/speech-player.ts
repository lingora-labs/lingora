// 7.5 P1-A — the Tutor's voice in the browser: segments of the visible answer are synthesized one by one
// (/api/speech) and played in order while the answer is still being written. Pause, resume, stop, speed.
// Stopping (or the student interrupting) cancels what was not yet played; the written answer is untouched.
// A failed segment can be retried from where it failed: the answer is never asked for again.
export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
export interface PlayerState {
  messageId: string | null; status: PlayerStatus; index: number; total: number; ended: boolean
  rate: number; error?: string; speechModel?: string; firstAudioMs?: number
}
interface Item { text: string; blob?: Promise<Blob | null>; ctrl?: AbortController; failed?: boolean }

export const SPEECH_RATES = [0.8, 1, 1.2] as const

export class SpeechPlayer {
  private items: Item[] = []
  private idx = 0
  private ended = true
  private audio: HTMLAudioElement | null = null
  private url: string | null = null
  private msg: string | null = null
  private paused = false
  private rate = 1
  private startedAt = 0
  private state: PlayerState = { messageId: null, status: 'idle', index: 0, total: 0, ended: true, rate: 1 }
  constructor(private opts: { mentor: () => string; onState: (s: PlayerState) => void; fetchImpl?: typeof fetch; createAudio?: () => HTMLAudioElement }) {}

  /** A user gesture must create the element once (autoplay policies, iOS). */
  unlock(): void {
    if (this.audio || (typeof window === 'undefined' && !this.opts.createAudio)) return
    this.audio = this.opts.createAudio ? this.opts.createAudio() : new Audio()
    this.audio.preload = 'auto'
    ;(this.audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true
    this.audio.onended = () => this.next()
    this.audio.onerror = () => this.fail('el navegador no pudo reproducir el audio')
  }
  get current(): PlayerState { return this.state }
  get speaking(): boolean { return this.state.status === 'playing' || this.state.status === 'loading' }

  begin(messageId: string, startedAt = performance.now()): void {
    this.stop(); this.unlock()
    this.msg = messageId; this.items = []; this.idx = 0; this.ended = false; this.paused = false; this.startedAt = startedAt
    this.set({ messageId, status: 'loading', index: 0, total: 0, ended: false, error: undefined, firstAudioMs: undefined })
  }
  enqueue(text: string): void {
    if (!this.msg || !text.trim()) return
    this.items.push({ text })
    this.prefetch()
    this.set({ total: this.items.length })
    if (this.state.status === 'loading' && this.idx === this.items.length - 1 && !this.paused) void this.playCurrent()
  }
  end(): void { this.ended = true; this.set({ ended: true }); if (this.idx >= this.items.length && this.state.status !== 'playing') this.finish() }

  pause(): void { if (this.audio && this.state.status === 'playing') { this.audio.pause(); this.paused = true; this.set({ status: 'paused' }) } }
  resume(): void { if (this.audio && this.state.status === 'paused') { this.paused = false; void this.audio.play(); this.set({ status: 'playing' }) } }
  stop(): void {
    for (const it of this.items) it.ctrl?.abort()
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src') }
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null }
    this.items = []; this.idx = 0; this.ended = true; this.paused = false; this.msg = null
    if (this.state.status !== 'idle') this.set({ status: 'idle', ended: true })
  }
  setRate(r: number): void { this.rate = r; if (this.audio) this.audio.playbackRate = r; this.set({ rate: r }) }
  /** Retry the segment that failed and continue; nothing already heard is repeated. */
  retry(): void {
    const it = this.items[this.idx]
    if (!it || this.state.status !== 'error') return
    it.blob = undefined; it.failed = false
    this.prefetch(); this.set({ status: 'loading', error: undefined }); void this.playCurrent()
  }
  /** What the student has heard of this answer (whole segments plus the played part of the current one). */
  heardText(): string {
    const done = this.items.slice(0, this.idx).map(i => i.text)
    const cur = this.items[this.idx]
    if (cur && this.audio && this.audio.duration > 0 && (this.state.status === 'playing' || this.state.status === 'paused')) {
      const words = cur.text.split(/\s+/), n = Math.round(words.length * Math.min(1, this.audio.currentTime / this.audio.duration))
      if (n > 0) done.push(words.slice(0, n).join(' '))
    }
    return done.join(' ')
  }

  private set(p: Partial<PlayerState>) { this.state = { ...this.state, ...p, rate: this.rate }; this.opts.onState(this.state) }
  private prefetch() {
    for (let k = this.idx; k < Math.min(this.items.length, this.idx + 3); k++) {
      const it = this.items[k]
      if (it.blob) continue
      it.ctrl = new AbortController()
      it.blob = (this.opts.fetchImpl ?? fetch)('/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: it.ctrl.signal,
        body: JSON.stringify({ text: it.text, mentor: this.opts.mentor() }) })
        .then(async r => {
          if (!r.ok) return null
          const model = r.headers.get('X-Lingora-Speech-Model'); if (model) this.set({ speechModel: model })
          const b = await r.blob()
          return b.size > 0 ? b : null
        })
        .catch(() => null)
    }
  }
  private async playCurrent(): Promise<void> {
    const msg = this.msg, it = this.items[this.idx]
    if (!it || !this.audio) return
    const blob = await it.blob
    if (msg !== this.msg || this.items[this.idx] !== it) return // stopped or moved on meanwhile
    if (!blob) { it.failed = true; this.fail('no se pudo generar la voz de esta parte'); return }
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = URL.createObjectURL(blob)
    this.audio.src = this.url
    this.audio.playbackRate = this.rate
    try {
      await this.audio.play()
      if (this.state.firstAudioMs === undefined) this.set({ firstAudioMs: Math.round(performance.now() - this.startedAt) })
      this.set({ status: this.paused ? 'paused' : 'playing', index: this.idx })
    } catch { this.fail('el navegador bloqueó la reproducción; pulsa «Escuchar»') }
  }
  private next() {
    this.idx++
    this.prefetch()
    if (this.idx < this.items.length) { this.set({ status: 'loading', index: this.idx }); void this.playCurrent(); return }
    if (this.ended) this.finish()
    else this.set({ status: 'loading', index: this.idx }) // waiting for the next segment of the answer
  }
  private finish() { if (this.url) { URL.revokeObjectURL(this.url); this.url = null } this.set({ status: 'idle', ended: true, index: this.items.length }) }
  private fail(why: string) { this.set({ status: 'error', error: why }) }
}
