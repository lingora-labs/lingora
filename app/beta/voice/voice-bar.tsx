'use client'
// 7.5 P1-A — the visible state and controls of the voice conversation: listening / hearing / thinking /
// speaking, and the Tutor's voice controls (pause, resume, stop, speed, retry). Visible text, no internals.
import React from 'react'
import type { PlayerState, SpeechPlayer } from './speech-player'
import { SPEECH_RATES } from './speech-player'
import type { MicStatus } from './use-voice'

export function VoiceBar({ voiceMode, micStatus, micError, level, loading, player, state, mentorName }: {
  voiceMode: boolean; micStatus: MicStatus; micError: string | null; level: number; loading: boolean
  player: SpeechPlayer | null; state: PlayerState | null; mentorName: string
}) {
  const speaking = state && (state.status === 'playing' || state.status === 'paused' || (state.status === 'loading' && !state.ended) || state.status === 'error')
  if (!voiceMode && !speaking && !micError) return null
  const label = micError ? micError
    : state?.status === 'error' ? `No se pudo reproducir la voz: ${state.error ?? 'error'}.`
    : state?.status === 'playing' ? `${mentorName} habla${voiceMode ? ' — habla tú para interrumpirla' : ''}`
    : state?.status === 'paused' ? 'Voz en pausa'
    : speaking ? `${mentorName} prepara la voz…`
    : loading ? `${mentorName} está pensando…`
    : micStatus === 'hearing' ? 'Te escucho…'
    : micStatus === 'listening' ? 'Conversación por voz activa: habla cuando quieras'
    : micStatus === 'requesting' ? 'Pidiendo permiso para el micrófono…' : 'Micrófono apagado'
  const bars = Math.max(0, Math.min(5, Math.round((level + 60) / 9)))
  const btn: React.CSSProperties = { minHeight:36, padding:'6px 12px', borderRadius:999, border:'1px solid var(--border)', background:'transparent', color:'var(--silver)', fontSize:12, cursor:'pointer' }
  return (
    <div data-testid="voice-bar" data-mic={micStatus} data-player={state?.status ?? 'idle'} role="status" aria-live="polite"
      style={{ borderTop:'1px solid var(--border)', padding:'8px 12px', display:'flex', flexWrap:'wrap', alignItems:'center', gap:8 }}>
      {voiceMode && <span aria-hidden style={{ display:'inline-flex', gap:2, alignItems:'flex-end', height:16 }}>{[0, 1, 2, 3, 4].map(i => <span key={i} style={{ width:3, height:4 + i * 3, borderRadius:2, background: i < bars ? 'var(--teal)' : 'var(--border)' }} />)}</span>}
      <span data-testid="voice-status" style={{ fontSize:12, color: micError || state?.status === 'error' ? 'var(--danger,#f87171)' : 'var(--silver)', flex:1, minWidth:160 }}>{label}</span>
      {state?.status === 'playing' && <button type="button" data-testid="voice-pause" style={btn} onClick={() => player?.pause()}>Pausa</button>}
      {state?.status === 'paused' && <button type="button" data-testid="voice-resume" style={btn} onClick={() => player?.resume()}>Reanudar</button>}
      {state?.status === 'error' && <button type="button" data-testid="voice-retry" style={btn} onClick={() => player?.retry()}>Reintentar voz</button>}
      {speaking && <button type="button" data-testid="voice-stop" style={btn} onClick={() => player?.stop()}>Detener</button>}
      {speaking && (
        <label style={{ fontSize:12, color:'var(--muted)', display:'inline-flex', alignItems:'center', gap:4 }}>Velocidad
          <select data-testid="voice-rate" value={state?.rate ?? 1} onChange={e => player?.setRate(Number(e.target.value))}
            style={{ background:'var(--navy2)', color:'var(--silver)', border:'1px solid var(--border)', borderRadius:8, fontSize:12, padding:'4px 6px' }}>
            {SPEECH_RATES.map(r => <option key={r} value={r}>{r}×</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
