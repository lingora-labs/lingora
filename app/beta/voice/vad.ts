// 7.5 P1-A — turn detection for the voice conversation. Pure: frames of microphone level in, turn events out.
// The noise floor adapts while nobody speaks; speech must rise clearly above it. While the Tutor is speaking
// the bar is higher (her own voice may leak through the speakers), so only a real interruption counts.
export interface VadOptions {
  marginDb: number          // speech = level above noise floor by this margin
  bargeInMarginDb: number   // extra margin while the Tutor speaks
  minDb: number             // never treat quieter than this as speech
  onsetMs: number           // consecutive loud time that opens a possible utterance
  minSpeechMs: number       // voiced time that confirms it
  endSilenceMs: number      // silence that closes a confirmed utterance (the turn is yours)
  maxUtteranceMs: number    // an utterance never runs longer than this
}
export const VAD_DEFAULTS: VadOptions = { marginDb: 12, bargeInMarginDb: 8, minDb: -52, onsetMs: 90, minSpeechMs: 260, endSilenceMs: 850, maxUtteranceMs: 30_000 }

export type VadEvent =
  | { type: 'onset'; t: number }                         // start capturing (may still be discarded)
  | { type: 'speech'; t: number }                        // confirmed speech: a real turn (or an interruption)
  | { type: 'discard'; t: number }                       // the onset was noise
  | { type: 'end'; t: number; voicedMs: number; durationMs: number; forced: boolean }

export class Vad {
  private floor = -60
  private state: 'idle' | 'onset' | 'speech' = 'idle'
  private loudSince = -1
  private startedAt = 0
  private lastLoud = 0
  private voiced = 0
  private lastT = -1
  constructor(private o: VadOptions = VAD_DEFAULTS) {}
  get noiseFloor() { return this.floor }
  get active() { return this.state !== 'idle' }

  /** One frame: level in dBFS at time t (ms). `tutorSpeaking` raises the bar for interruptions. */
  push(db: number, t: number, tutorSpeaking = false): VadEvent | null {
    const dt = this.lastT < 0 ? 0 : Math.max(0, Math.min(200, t - this.lastT))
    this.lastT = t
    const bar = Math.max(this.o.minDb, this.floor + this.o.marginDb + (tutorSpeaking ? this.o.bargeInMarginDb : 0))
    const loud = db >= bar
    if (this.state === 'idle') {
      if (!loud) { this.floor = this.floor * 0.95 + Math.max(-90, db) * 0.05; this.loudSince = -1; return null }
      if (this.loudSince < 0) this.loudSince = t
      if (t - this.loudSince >= this.o.onsetMs) {
        this.state = 'onset'; this.startedAt = this.loudSince; this.lastLoud = t; this.voiced = t - this.loudSince
        return { type: 'onset', t: this.startedAt }
      }
      return null
    }
    if (loud) { this.voiced += dt; this.lastLoud = t }
    if (this.state === 'onset') {
      if (this.voiced >= this.o.minSpeechMs) { this.state = 'speech'; return { type: 'speech', t } }
      if (t - this.lastLoud > 400) { this.reset(); return { type: 'discard', t } }
      return null
    }
    // confirmed speech
    if (t - this.startedAt >= this.o.maxUtteranceMs) return this.finish(t, true)
    if (!loud && t - this.lastLoud >= this.o.endSilenceMs) return this.finish(t, false)
    return null
  }
  private finish(t: number, forced: boolean): VadEvent {
    const ev: VadEvent = { type: 'end', t, voicedMs: Math.round(this.voiced), durationMs: Math.round(t - this.startedAt), forced }
    this.reset()
    return ev
  }
  private reset() { this.state = 'idle'; this.loudSince = -1; this.voiced = 0 }
}

/** RMS level of a frame of samples in dBFS. */
export function frameDb(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / Math.max(1, samples.length))
  return rms > 0 ? 20 * Math.log10(rms) : -100
}
