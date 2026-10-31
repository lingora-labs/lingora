// 7.6 R2 — CALL MODE listener. The microphone stays open; the VAD decides when the student speaks; audio streams
// to the live recognizer WHILE they speak, so the transcript is ready right after they stop. The listener only
// transcribes: it never answers. Barge-in is reported at once so the speaker can stop mid-sentence.
import { CALL_SAMPLE_RATE, REALTIME_URL, floatToPcm16, pcm16ToBase64, resampleLinear, wsProtocols } from '../../../lib/voice/call/protocol'
import { Vad, frameDb, VAD_DEFAULTS, type VadOptions } from './vad'
import type { SocketLike } from './call-speaker'

export interface CallUtterance { text: string; voicedMs: number; durationMs: number; asrMs: number; endedAt: number; interruption: { heard: string } | null }
export type ListenStatus = 'off' | 'requesting' | 'denied' | 'unavailable' | 'listening' | 'hearing' | 'transcribing'
export const CALL_VAD: VadOptions = { ...VAD_DEFAULTS, endSilenceMs: 700 }
const PREROLL_FRAMES = 6 // ~ the 400 ms before the VAD confirmed the onset

export class CallListener {
  private ws: SocketLike | null = null
  private ready = false
  private vad = new Vad(CALL_VAD)
  private pre: Float32Array[] = []
  private streaming = false
  private partial = ''
  private awaiting: { voicedMs: number; durationMs: number; commitAt: number; interruption: { heard: string } | null } | null = null
  private interruption: { heard: string } | null = null
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private node: AudioNode | null = null
  private status: ListenStatus = 'off'
  private muted = false
  constructor(private o: {
    secret: () => string | null
    speaking: () => boolean
    heard: () => string
    onStatus: (s: ListenStatus, error?: string) => void
    onLevel?: (db: number) => void
    onPartial?: (text: string) => void
    onBargeIn: (heard: string) => void
    onUtterance: (u: CallUtterance) => void
    onLost?: () => void
    createSocket?: (url: string, protocols: string[]) => SocketLike
  }) {}

  async start(): Promise<void> {
    if (this.stream) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) { this.set('unavailable', 'Este navegador no permite usar el micrófono aquí.'); return }
    this.set('requesting')
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }) }
    catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      this.set(denied ? 'denied' : 'unavailable', denied ? 'Permiso de micrófono denegado. Actívalo en el navegador para hablar por llamada.' : 'No se encontró un micrófono disponible.')
      return
    }
    this.openSocket()
    try { await this.openCapture() } catch { this.stop(); this.set('unavailable', 'No se pudo abrir el audio del micrófono.'); return }
    this.set('listening')
  }
  stop(): void {
    this.node?.disconnect(); this.node = null
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null
    void this.ctx?.close().catch(() => {}); this.ctx = null
    const w = this.ws; this.ws = null; this.ready = false; try { w?.close() } catch { /* closed */ }
    this.pre = []; this.streaming = false; this.awaiting = null; this.interruption = null; this.partial = ''
    this.set('off')
  }
  get state(): ListenStatus { return this.status }
  setMuted(m: boolean): void { this.muted = m; if (m && this.streaming) { this.streaming = false; this.send({ type: 'input_audio_buffer.clear' }) } if (m) this.set('listening') }

  private set(s: ListenStatus, error?: string) { this.status = s; this.o.onStatus(s, error) }

  openSocket(): void {
    const secret = this.o.secret(); if (!secret) return
    const mk = this.o.createSocket ?? ((u: string, p: string[]) => new WebSocket(u, p) as unknown as SocketLike)
    const ws = mk(REALTIME_URL.stt, wsProtocols(secret)); this.ws = ws
    ws.onopen = () => { this.ready = true }
    ws.onmessage = e => this.onEvent(e.data)
    ws.onclose = () => { const was = this.ws === ws; this.ws = null; this.ready = false; if (was && this.stream) this.o.onLost?.() }
    ws.onerror = () => { /* onclose follows */ }
  }
  private send(o: object): void { try { this.ws?.send(JSON.stringify(o)) } catch { /* socket gone: onclose reports it */ } }

  private async openCapture(): Promise<void> {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
    const Ctor = AC.AudioContext ?? AC.webkitAudioContext!
    let ctx: AudioContext
    try { ctx = new Ctor({ sampleRate: CALL_SAMPLE_RATE }) } catch { ctx = new Ctor() }
    this.ctx = ctx
    void ctx.resume?.()
    const src = ctx.createMediaStreamSource(this.stream!)
    const code = `class C extends AudioWorkletProcessor{constructor(){super();this.b=[];this.n=0}process(i){const c=i[0]&&i[0][0];if(c){this.b.push(new Float32Array(c));this.n+=c.length;if(this.n>=2400){const o=new Float32Array(this.n);let k=0;for(const x of this.b){o.set(x,k);k+=x.length}this.port.postMessage(o,[o.buffer]);this.b=[];this.n=0}}return true}}registerProcessor('call-capture',C)`
    const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
    try { await ctx.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
    const node = new AudioWorkletNode(ctx, 'call-capture')
    node.port.onmessage = e => this.frame(resampleLinear(e.data as Float32Array, ctx.sampleRate, CALL_SAMPLE_RATE))
    const mute = ctx.createGain(); mute.gain.value = 0
    src.connect(node); node.connect(mute); mute.connect(ctx.destination)
    this.node = node
  }

  /** One ~100 ms frame of 24 kHz mono. Public so tests can drive the listener without a microphone. */
  frame(f: Float32Array, now = performance.now()): void {
    if (this.muted) { this.o.onLevel?.(-100); return }
    const db = frameDb(f); this.o.onLevel?.(db)
    const ev = this.vad.push(db, now, this.o.speaking())
    if (this.streaming) this.append(f); else { this.pre.push(f); if (this.pre.length > PREROLL_FRAMES) this.pre.shift() }
    if (!ev) return
    if (ev.type === 'onset') {
      this.streaming = true; this.partial = ''
      for (const p of this.pre) this.append(p); this.pre = []
      if (this.status !== 'transcribing') this.set('hearing')
    } else if (ev.type === 'discard') {
      this.streaming = false; this.send({ type: 'input_audio_buffer.clear' }); this.set(this.awaiting ? 'transcribing' : 'listening')
    } else if (ev.type === 'speech') {
      if (this.o.speaking()) { const heard = this.o.heard(); this.interruption = { heard }; this.o.onBargeIn(heard) }
    } else if (ev.type === 'end') {
      this.streaming = false
      const interruption = this.interruption; this.interruption = null
      if (ev.voicedMs < 300) { this.send({ type: 'input_audio_buffer.clear' }); this.set('listening'); return }
      this.awaiting = { voicedMs: ev.voicedMs, durationMs: ev.durationMs, commitAt: now, interruption }
      this.send({ type: 'input_audio_buffer.commit' }); this.set('transcribing')
    }
  }
  private append(f: Float32Array): void { if (this.ready) this.send({ type: 'input_audio_buffer.append', audio: pcm16ToBase64(floatToPcm16(f)) }) }

  private onEvent(raw: unknown): void {
    let ev: { type?: string; delta?: string; transcript?: string }
    try { ev = JSON.parse(String(raw)) } catch { return }
    if (ev.type === 'conversation.item.input_audio_transcription.delta' && typeof ev.delta === 'string') { this.partial += ev.delta; this.o.onPartial?.(this.partial); return }
    if (ev.type === 'conversation.item.input_audio_transcription.completed') {
      const a = this.awaiting; this.awaiting = null
      const text = String(ev.transcript ?? '').trim()
      this.o.onPartial?.('')
      if (this.status === 'transcribing') this.set(this.streaming ? 'hearing' : 'listening')
      if (!a || !text) return
      this.o.onUtterance({ text, voicedMs: a.voicedMs, durationMs: a.durationMs, asrMs: Math.max(0, Math.round(performance.now() - a.commitAt)), endedAt: performance.now(), interruption: a.interruption })
    }
  }
}
