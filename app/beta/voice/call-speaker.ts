// 7.6 R2 — CALL MODE speaker. Same surface as SpeechPlayer, but the voice comes from ONE open realtime socket:
// each segment of the Tutor's visible text is spoken verbatim (out-of-band response, no conversation kept) and the
// PCM is scheduled gaplessly on a Web Audio timeline. The speaker never authors anything: the text is the Tutor's.
import { CALL_SAMPLE_RATE, REALTIME_URL, base64ToPcm16, pcm16ToFloat, speakResponse, wsProtocols } from '../../../lib/voice/call/protocol'
import type { PlayerState } from './speech-player'

export interface SocketLike { send(d: string): void; close(): void; onopen: ((e?: unknown) => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onclose: ((e?: unknown) => void) | null; onerror: ((e?: unknown) => void) | null }
export interface AudioLike {
  currentTime: number; destination: unknown; state?: string; resume?(): Promise<void>; close?(): Promise<void>
  createBuffer(ch: number, len: number, rate: number): { getChannelData(i: number): Float32Array; duration: number }
  createBufferSource(): { buffer: unknown; connect(d: unknown): void; start(t: number): void; stop(): void; onended: (() => void) | null }
}
interface Item { text: string; sent: boolean; startAt?: number; endAt?: number; samples: number }

export class CallSpeaker {
  private ws: SocketLike | null = null
  private ctx: AudioLike | null = null
  private ready = false
  private items: Item[] = []
  private idx = 0               // item currently generating / last item with audio
  private inflight = 0          // responses sent and not yet done (cancelled ones included)
  private active: Item | null = null
  private ignoring = false
  private ended = true
  private msg: string | null = null
  private cursor = 0            // audio timeline position (ctx seconds) where the next chunk starts
  private startedAt = 0
  private sources: { stop(): void }[] = []
  private rate = 1
  private timer: ReturnType<typeof setInterval> | null = null
  private state: PlayerState = { messageId: null, status: 'idle', index: 0, total: 0, ended: true, rate: 1 }
  constructor(private opts: { secret: () => string | null; onState: (s: PlayerState) => void; onLost?: () => void; createSocket?: (url: string, protocols: string[]) => SocketLike; createAudio?: () => AudioLike }) {}

  /** A user gesture creates the audio context once (autoplay policy, iOS). */
  unlock(): void {
    if (!this.ctx) {
      if (this.opts.createAudio) this.ctx = this.opts.createAudio()
      else if (typeof window !== 'undefined') {
        const AC = (window as unknown as { AudioContext?: new (o?: object) => AudioLike; webkitAudioContext?: new (o?: object) => AudioLike }).AudioContext ?? (window as unknown as { webkitAudioContext?: new (o?: object) => AudioLike }).webkitAudioContext
        if (AC) this.ctx = new AC({ sampleRate: CALL_SAMPLE_RATE })
      }
    }
    void this.ctx?.resume?.()
    this.connect()
  }
  /** Open the socket ahead of the first sentence so the first word does not pay for the handshake. */
  connect(): void {
    if (this.ws) return
    const secret = this.opts.secret(); if (!secret) return
    const mk = this.opts.createSocket ?? ((u: string, p: string[]) => new WebSocket(u, p) as unknown as SocketLike)
    const ws = mk(REALTIME_URL.tts, wsProtocols(secret)); this.ws = ws
    ws.onopen = () => { this.ready = true; this.pump() }
    ws.onmessage = e => this.onEvent(e.data)
    ws.onclose = () => { const was = this.ws === ws; this.ws = null; this.ready = false; this.inflight = 0; if (was) this.opts.onLost?.() }
    ws.onerror = () => { /* onclose follows */ }
  }
  disconnect(): void { this.stop(); const w = this.ws; this.ws = null; this.ready = false; try { w?.close() } catch { /* closed */ } }

  get current(): PlayerState { return this.state }
  get speaking(): boolean { return this.state.status === 'playing' || this.state.status === 'loading' }

  begin(messageId: string, startedAt = performance.now()): void {
    this.stop(); this.unlock()
    this.msg = messageId; this.items = []; this.idx = 0; this.ended = false; this.startedAt = startedAt; this.cursor = 0
    this.set({ messageId, status: 'loading', index: 0, total: 0, ended: false, error: undefined, firstAudioMs: undefined })
  }
  enqueue(text: string): void {
    if (!this.msg || !text.trim()) return
    this.items.push({ text, sent: false, samples: 0 }); this.set({ total: this.items.length }); this.pump()
  }
  end(): void { this.ended = true; this.set({ ended: true }); this.maybeFinish() }
  stop(): void {
    for (const s of this.sources) { try { s.stop() } catch { /* already stopped */ } }
    this.sources = []
    if (this.inflight > 0) { this.ignoring = true; try { this.ws?.send(JSON.stringify({ type: 'response.cancel' })) } catch { /* best effort */ } }
    this.items = []; this.idx = 0; this.active = null; this.msg = null; this.ended = true; this.cursor = 0
    this.clearTimer()
    if (this.state.status !== 'idle') this.set({ status: 'idle', ended: true })
  }
  pause(): void { if (this.ctx && this.state.status === 'playing') { void (this.ctx as unknown as { suspend?(): Promise<void> }).suspend?.(); this.set({ status: 'paused' }) } }
  resume(): void { if (this.ctx && this.state.status === 'paused') { void this.ctx.resume?.(); this.set({ status: 'playing' }) } }
  setRate(r: number): void { this.rate = r; this.set({ rate: r }) }
  retry(): void { if (this.state.status === 'error') { this.set({ status: 'loading', error: undefined }); this.connect(); this.pump() } }

  /** What the student has heard: whole segments already played plus the played share of the one sounding now. */
  heardText(): string {
    if (!this.ctx) return ''
    const now = this.ctx.currentTime, out: string[] = []
    for (const it of this.items) {
      if (it.startAt === undefined || it.endAt === undefined) break
      if (now >= it.endAt) out.push(it.text)
      else if (now > it.startAt) { const w = it.text.split(/\s+/), n = Math.round(w.length * (now - it.startAt) / Math.max(0.001, it.endAt - it.startAt)); if (n > 0) out.push(w.slice(0, n).join(' ')); break }
      else break
    }
    return out.join(' ')
  }

  private pump(): void {
    if (!this.ready || !this.ws || this.inflight > 0 || this.active) return
    const it = this.items[this.idx]; if (!it || it.sent) return
    it.sent = true; this.active = it; this.inflight++; this.ignoring = false
    try { this.ws.send(JSON.stringify(speakResponse(it.text))) } catch { this.inflight--; this.active = null; this.fail('no se pudo enviar el texto a la voz') }
  }
  private onEvent(raw: unknown): void {
    let ev: { type?: string; delta?: string; error?: unknown }
    try { ev = JSON.parse(String(raw)) } catch { return }
    if (ev.type === 'response.output_audio.delta' && typeof ev.delta === 'string') { if (!this.ignoring && this.active) this.play(this.active, ev.delta); return }
    if (ev.type === 'response.done') {
      this.inflight = Math.max(0, this.inflight - 1)
      if (this.inflight === 0) this.ignoring = false
      if (this.active) { this.active = null; this.idx++ }
      this.pump(); this.maybeFinish(); return
    }
    if (ev.type === 'error' && this.active) { this.inflight = Math.max(0, this.inflight - 1); this.active = null; this.fail('la voz no pudo generar esta parte') }
  }
  private play(it: Item, b64: string): void {
    if (!this.ctx) return
    const pcm = base64ToPcm16(b64); if (!pcm.length) return
    const f = pcm16ToFloat(pcm), buf = this.ctx.createBuffer(1, f.length, CALL_SAMPLE_RATE)
    buf.getChannelData(0).set(f)
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.ctx.destination)
    const t = Math.max(this.ctx.currentTime + 0.02, this.cursor)
    if (it.startAt === undefined) it.startAt = t
    src.start(t); this.cursor = t + buf.duration / this.rate; it.endAt = this.cursor; it.samples += f.length
    this.sources.push(src); src.onended = () => { this.sources = this.sources.filter(s => s !== src) }
    if (this.state.firstAudioMs === undefined) this.set({ firstAudioMs: Math.round(performance.now() - this.startedAt) })
    if (this.state.status !== 'playing' && this.state.status !== 'paused') this.set({ status: 'playing', index: this.idx })
    this.watch()
  }
  private watch(): void { if (!this.timer) this.timer = setInterval(() => this.maybeFinish(), 80) }
  private clearTimer(): void { if (this.timer) { clearInterval(this.timer); this.timer = null } }
  private maybeFinish(): void {
    if (!this.ended || !this.ctx) return
    if (this.idx < this.items.length || this.inflight > 0) return
    if (this.ctx.currentTime < this.cursor - 0.01) return
    this.clearTimer(); this.msg = null
    if (this.state.status !== 'idle') this.set({ status: 'idle', ended: true, index: this.items.length })
  }
  private set(p: Partial<PlayerState>) { this.state = { ...this.state, ...p, rate: this.rate }; this.opts.onState(this.state) }
  private fail(why: string) { this.clearTimer(); this.set({ status: 'error', error: why }) }
}
