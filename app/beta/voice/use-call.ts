'use client'
// 7.6 R2 — CALL MODE as one coherent unit: secrets → speaker + listener → turns in the SAME chat → hang up.
// Hanging up is final: the microphone closes, the speaker disconnects, the turn in flight is aborted, nothing
// pending is sent afterwards, and no late answer is spoken (D-1, D-2). The screen is kept awake (D-5).
import { useCallback, useEffect, useRef, useState } from 'react'
import { CallListener, type CallUtterance, type ListenStatus } from './call-listener'
import { CallSpeaker } from './call-speaker'
import type { PlayerState } from './speech-player'

export type CallPhase = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error'
interface Secrets { stt: string; tts: string }
export interface CallDeps {
  mentor: () => string
  language: () => string | undefined
  isLoading: () => boolean
  /** Send one transcribed spoken turn into the active chat. Must honour `signal` (hang up aborts it). */
  sendTurn: (u: CallUtterance, signal: AbortSignal) => Promise<void>
  /** The call's speaker replaces the chat's player while the call lasts; null restores the original. */
  useSpeaker: (s: CallSpeaker | null) => void
  onPlayerState: (s: PlayerState) => void
  onBargeIn: (heard: string) => void
}

export function useCall(deps: CallDeps) {
  const [phase, setPhase] = useState<CallPhase>('idle')
  const [listen, setListen] = useState<ListenStatus>('off')
  const [partial, setPartial] = useState('')
  const [level, setLevel] = useState(-100)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const d = useRef(deps); d.current = deps
  const r = useRef<{ speaker: CallSpeaker; listener: CallListener; ctl: AbortController; secrets: Secrets; pending: CallUtterance | null; turn: AbortController | null; lock: { release(): Promise<void> } | null; retries: number } | null>(null)

  const mint = useCallback(async (): Promise<Secrets | null> => {
    try {
      const res = await fetch('/api/call/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mentor: d.current.mentor(), language: d.current.language() }) })
      if (!res.ok) return null
      const j = await res.json() as Partial<Secrets>
      return typeof j.stt === 'string' && typeof j.tts === 'string' ? { stt: j.stt, tts: j.tts } : null
    } catch { return null }
  }, [])

  const hangUp = useCallback(() => {
    const c = r.current; if (!c) return
    r.current = null
    c.ctl.abort(); c.turn?.abort(); c.pending = null
    c.listener.stop(); c.speaker.disconnect()
    void c.lock?.release().catch(() => {})
    d.current.useSpeaker(null)
    setPhase('idle'); setListen('off'); setPartial(''); setLevel(-100); setMuted(false)
  }, [])

  const send = useCallback((u: CallUtterance) => {
    const c = r.current; if (!c) return
    // One controller per turn, tied to the call's: hanging up aborts every turn; a new utterance aborts only the one in flight.
    const turn = new AbortController(); c.turn = turn
    const onCall = () => turn.abort(); c.ctl.signal.addEventListener('abort', onCall, { once: true })
    void d.current.sendTurn(u, turn.signal).finally(() => { c.ctl.signal.removeEventListener('abort', onCall); if (c.turn === turn) c.turn = null })
  }, [])

  const start = useCallback(async () => {
    if (r.current) return
    setError(null); setPhase('connecting')
    // Everything that needs a user gesture happens before the first await.
    let secrets: Secrets | null = null
    const ctl = new AbortController()
    const speaker = new CallSpeaker({ secret: () => secrets?.tts ?? null, onState: s => d.current.onPlayerState(s), onLost: () => void reconnect() })
    speaker.unlock()
    const listener = new CallListener({
      secret: () => secrets?.stt ?? null,
      speaking: () => speaker.speaking || speaker.current.status === 'paused',
      heard: () => speaker.heardText(),
      onStatus: (s, e) => { setListen(s); if (e) setError(e) },
      onLevel: setLevel, onPartial: setPartial,
      onBargeIn: heard => { speaker.stop(); d.current.onBargeIn(heard) },
      onUtterance: u => { const c = r.current; if (!c) return; if (d.current.isLoading()) { c.pending = u; c.turn?.abort() } else send(u) },
      onLost: () => void reconnect(),
    })
    const reconnect = async () => {
      const c = r.current; if (!c || c.retries >= 3) { if (c) { setError('Se perdió la conexión de voz. Vuelve a llamar.'); setPhase('error'); hangUp() } return }
      c.retries++; setPhase('reconnecting')
      const s = await mint(); if (!r.current) return
      if (!s) { setError('Se perdió la conexión de voz. Vuelve a llamar.'); setPhase('error'); hangUp(); return }
      c.secrets = s; secrets = s
      c.speaker.connect(); c.listener.resume()
      setPhase('live')
    }
    secrets = await mint()
    if (!secrets) { setError('La llamada no está disponible ahora. Puedes seguir escribiendo.'); setPhase('error'); return }
    r.current = { speaker, listener, ctl, secrets, pending: null, turn: null, lock: null, retries: 0 }
    d.current.useSpeaker(speaker)
    speaker.connect()
    await listener.start()
    if (listener.state === 'denied' || listener.state === 'unavailable') { hangUp(); setPhase('error'); return }
    try { const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock; if (wl && r.current) r.current.lock = await wl.request('screen') } catch { /* optional */ }
    setPhase('live')
  }, [hangUp, mint, send])

  /** The page calls this when a Tutor turn closes: a sentence said meanwhile goes out now (one per utterance). */
  const turnClosed = useCallback(() => {
    const c = r.current; if (!c || !c.pending) return
    const u = c.pending; c.pending = null; send(u)
  }, [send])
  const toggleMute = useCallback(() => { const c = r.current; if (!c) return; setMuted(m => { c.listener.setMuted(!m); return !m }) }, [])

  // The wake lock is released when the tab is hidden; take it again when the student comes back.
  useEffect(() => {
    const onVis = async () => {
      const c = r.current; if (!c || document.visibilityState !== 'visible') return
      try { const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock; if (wl) c.lock = await wl.request('screen') } catch { /* optional */ }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  useEffect(() => () => hangUp(), [hangUp])
  return { phase, active: phase !== 'idle' && phase !== 'error', listen, partial, level, error, muted, start, hangUp, turnClosed, toggleMute }
}
