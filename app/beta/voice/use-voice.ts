'use client'
// 7.5 P1-A — hands-free voice conversation: the microphone stays open, turns are detected by the VAD, every
// utterance is captured in the browser's own format and sent once. If the student speaks while the Tutor's
// voice is playing, the voice stops at once and the next turn tells the Tutor how far the student heard.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Vad, frameDb, VAD_DEFAULTS } from './vad'
import type { SpeechPlayer } from './speech-player'

export type MicStatus = 'off' | 'requesting' | 'denied' | 'unavailable' | 'listening' | 'hearing'
export interface Utterance { blob: Blob; mime: string; voicedMs: number; durationMs: number; endedAt: number; interruption: { heard: string } | null }

/** The recording format this browser can produce (Safari: mp4; Chrome/Firefox: webm/ogg opus). */
export function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported?.(m)) return m
  return ''
}

export function useVoiceConversation(opts: { player: SpeechPlayer | null; onUtterance: (u: Utterance) => void; onInterrupt?: (heard: string) => void }) {
  const [status, setStatus] = useState<MicStatus>('off')
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(-100)
  const res = useRef<{ stream: MediaStream; ctx: AudioContext; timer: ReturnType<typeof setInterval>; rec: MediaRecorder | null; chunks: Blob[]; vad: Vad; interruption: { heard: string } | null } | null>(null)
  const optsRef = useRef(opts); optsRef.current = opts

  const stop = useCallback(() => {
    const r = res.current
    if (!r) return
    clearInterval(r.timer)
    try { if (r.rec && r.rec.state !== 'inactive') { r.rec.ondataavailable = null; r.rec.onstop = null; r.rec.stop() } } catch { /* already stopped */ }
    r.stream.getTracks().forEach(t => t.stop())
    void r.ctx.close().catch(() => {})
    res.current = null
    setStatus('off'); setLevel(-100)
  }, [])

  const start = useCallback(async () => {
    if (res.current) return
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setStatus('unavailable'); setError('Este navegador no permite usar el micrófono aquí.'); return }
    setStatus('requesting')
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }) }
    catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      setStatus(denied ? 'denied' : 'unavailable')
      setError(denied ? 'Permiso de micrófono denegado. Actívalo en el navegador para conversar por voz.' : 'No se encontró un micrófono disponible.')
      return
    }
    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const an = ctx.createAnalyser(); an.fftSize = 2048
    src.connect(an)
    const buf = new Float32Array(an.fftSize)
    const vad = new Vad(VAD_DEFAULTS)
    const mime = pickRecorderMime()
    const r = { stream, ctx, timer: 0 as unknown as ReturnType<typeof setInterval>, rec: null as MediaRecorder | null, chunks: [] as Blob[], vad, interruption: null as { heard: string } | null }
    res.current = r
    const begin = () => {
      r.chunks = []
      try { r.rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream) } catch { r.rec = new MediaRecorder(stream) }
      r.rec.ondataavailable = e => { if (e.data.size) r.chunks.push(e.data) }
      r.rec.start(250)
    }
    const finish = (keep: boolean, meta?: { voicedMs: number; durationMs: number }) => {
      const rec = r.rec
      r.rec = null
      if (!rec || rec.state === 'inactive') return
      rec.onstop = () => {
        if (!keep || !meta || meta.voicedMs < 300) return
        const blob = new Blob(r.chunks, { type: rec.mimeType || mime || 'audio/webm' })
        const interruption = r.interruption; r.interruption = null
        optsRef.current.onUtterance({ blob, mime: blob.type, voicedMs: meta.voicedMs, durationMs: meta.durationMs, endedAt: performance.now(), interruption })
      }
      rec.stop()
    }
    r.timer = setInterval(() => {
      an.getFloatTimeDomainData(buf)
      const db = frameDb(buf)
      setLevel(db)
      const player = optsRef.current.player
      const ev = vad.push(db, performance.now(), Boolean(player?.speaking))
      if (!ev) return
      if (ev.type === 'onset') { begin(); setStatus('hearing') }
      else if (ev.type === 'discard') { finish(false); setStatus('listening') }
      else if (ev.type === 'speech') {
        // Barge-in: the student speaks over the Tutor. Her voice stops now; the text stays complete.
        if (player?.speaking || player?.current.status === 'paused') {
          const heard = player.heardText()
          player.stop()
          r.interruption = { heard }
          optsRef.current.onInterrupt?.(heard)
        }
      } else if (ev.type === 'end') { finish(true, ev); setStatus('listening') }
    }, 30)
    setStatus('listening')
  }, [])

  useEffect(() => () => stop(), [stop])
  return { status, error, level, start, stop, active: status === 'listening' || status === 'hearing' }
}
