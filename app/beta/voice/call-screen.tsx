'use client'
// 7.6 R2 — the call, as the student sees it: who is on the line, what is happening, and the way to hang up.
// Mentor-agnostic (the name comes from the active mentor). The chat stays visible and usable above it.
import type { CallPhase } from './use-call'
import type { ListenStatus } from './call-listener'
import type { PlayerState } from './speech-player'

export function CallScreen({ phase, listen, partial, level, muted, loading, state, mentorName, error, onHangUp, onMute, report, onDismissReport, t }: {
  phase: CallPhase; listen: ListenStatus; partial: string; level: number; muted: boolean; loading: boolean
  state: PlayerState | null; mentorName: string; error: string | null; onHangUp: () => void; onMute: () => void; report?: string | null; onDismissReport?: () => void; t: (s: string) => string
}) {
  if (phase === 'idle' && report) return <ReportPanel report={report} onClose={onDismissReport ?? (() => {})} t={t} />
  if (phase === 'idle') return null
  const speaking = state?.status === 'playing' || state?.status === 'paused'
  const label = phase === 'connecting' ? t('Llamando…')
    : phase === 'reconnecting' ? t('Reconectando…')
    : phase === 'error' ? (error ?? t('La llamada no está disponible'))
    : muted ? t('Micrófono silenciado')
    : speaking ? `${mentorName} ${t('habla — habla tú para interrumpirla')}`
    : loading ? `${mentorName} ${t('está pensando…')}`
    : listen === 'hearing' ? t('Te escucho…')
    : listen === 'transcribing' ? t('Un momento…')
    : t('Habla cuando quieras')
  const bars = Math.max(0, Math.min(5, Math.round((level + 60) / 8)))
  return (
    <div role="region" aria-label={t('Llamada')} data-testid="call-screen" data-phase={phase}
      style={{ position:'fixed', left:0, right:0, bottom:0, zIndex:50, padding:'12px 16px calc(12px + env(safe-area-inset-bottom))', background:'var(--bg-elevated, #0f172a)', borderTop:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12 }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }} aria-live="polite" data-testid="call-status">{label}</div>
        <div style={{ fontSize:12, color:'var(--muted)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }} data-testid="call-partial">{partial || ' '}</div>
      </div>
      <span aria-hidden style={{ display:'inline-flex', gap:2, alignItems:'flex-end', height:18 }}>{[0, 1, 2, 3, 4].map(i => <span key={i} style={{ width:3, height:4 + i * 3, borderRadius:2, background: i < bars ? 'var(--teal)' : 'var(--border)' }} />)}</span>
      <button type="button" data-testid="call-mute" aria-pressed={muted} onClick={onMute} style={{ height:44, padding:'0 14px', borderRadius:22, border:'1px solid var(--border)', background:'transparent', color:'var(--text)', cursor:'pointer', fontSize:12, fontWeight:700 }}>{muted ? t('Activar mic') : t('Silenciar')}</button>
      <button type="button" data-testid="call-hangup" onClick={onHangUp} style={{ height:44, padding:'0 18px', borderRadius:22, border:'none', background:'#dc2626', color:'#fff', cursor:'pointer', fontSize:13, fontWeight:800 }}>{t('Colgar')}</button>
    </div>
  )
}

/** R4-M: the numbers of the call that just ended, selectable and copyable, so they can be handed over as they are. */
function ReportPanel({ report, onClose, t }: { report: string; onClose: () => void; t: (s: string) => string }) {
  const copy = () => { try { void navigator.clipboard?.writeText(report) } catch { /* the text stays selectable below */ } }
  return (
    <div role="region" aria-label={t('Mediciones de la llamada')} data-testid="call-report"
      style={{ position:'fixed', left:0, right:0, bottom:0, zIndex:50, padding:'12px 16px calc(12px + env(safe-area-inset-bottom))', background:'var(--bg-elevated, #0f172a)', borderTop:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:8, maxHeight:'60vh' }}>
      <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{t('Mediciones de la llamada')}</div>
      <textarea readOnly value={report} data-testid="call-report-text" onFocus={e => e.currentTarget.select()}
        style={{ flex:1, minHeight:120, fontFamily:'ui-monospace, monospace', fontSize:11, whiteSpace:'pre', overflow:'auto', color:'var(--text)', background:'transparent', border:'1px solid var(--border)', borderRadius:8, padding:8 }} />
      <div style={{ display:'flex', gap:8 }}>
        <button type="button" data-testid="call-report-copy" onClick={copy} style={{ height:44, padding:'0 14px', borderRadius:22, border:'1px solid var(--teal)', background:'transparent', color:'var(--teal)', cursor:'pointer', fontSize:12, fontWeight:800 }}>{t('Copiar')}</button>
        <button type="button" data-testid="call-report-close" onClick={onClose} style={{ height:44, padding:'0 14px', borderRadius:22, border:'1px solid var(--border)', background:'transparent', color:'var(--text)', cursor:'pointer', fontSize:12, fontWeight:700 }}>{t('Cerrar')}</button>
      </div>
    </div>
  )
}
