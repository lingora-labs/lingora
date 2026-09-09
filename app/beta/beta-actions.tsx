'use client'
import React from 'react'
import type { SuggestedAction } from './beta-model'

export function SuggestedActionBar({ actions, onAction }: { actions: SuggestedAction[]; onAction: (action: SuggestedAction) => void }) {
  if (!actions?.length) return null
  const toneStyle = (tone?: string) => {
    if (tone === 'primary') return { bg: 'rgba(0,201,167,.15)', border: 'rgba(0,201,167,.35)', color: 'var(--teal)' }
    if (tone === 'warning') return { bg: 'rgba(255,107,107,.1)', border: 'rgba(255,107,107,.3)', color: 'var(--coral)' }
    return { bg: 'rgba(255,255,255,.05)', border: 'var(--border)', color: 'var(--muted)' }
  }
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8, paddingLeft:36 }}>
      {actions.map((a, idx) => {
        const s = toneStyle(a.tone)
        return (
          <button key={a.id ?? idx} onClick={() => onAction(a)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 11px', borderRadius:20, border:`1px solid ${s.border}`, background:s.bg, color:s.color, fontSize:12, fontWeight:600, cursor:'pointer', transition:'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}>
            {a.emoji && <span style={{ fontSize:13 }}>{a.emoji}</span>}
            {a.label}
          </button>
        )
      })}
    </div>
  )
}

export function CopyBlock({ text, children }: { text: string; children: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  }
  return (
    <div style={{ position:'relative', width:'100%' }}>
      {children}
      <button onClick={copy} title="Copiar"
        style={{ position:'absolute', top:6, right:6, padding:'3px 8px', borderRadius:6, border:'1px solid rgba(0,201,167,.3)', background:'rgba(0,201,167,.08)', color:'var(--teal)', fontSize:11, fontWeight:700, cursor:'pointer', lineHeight:1.4, transition:'all .15s', opacity: copied ? 1 : 0.7 }}>
        {copied ? '✓ Copiado' : '⎘ Copiar'}
      </button>
    </div>
  )
}

export function isCopyable(text: string): boolean {
  const t = text.toLowerCase()
  return (
    text.includes('|---') ||
    (text.match(/^\|/m) !== null && text.includes('|')) ||
    (text.match(/^#{1,3} /m) !== null && text.length > 200) ||
    (text.match(/^\d+\. /gm) ?? []).length >= 3 ||
    (text.match(/^- /gm) ?? []).length >= 3 ||
    t.includes('yo ') && t.includes('tú ') ||
    t.includes('conjugac') ||
    t.includes('vocabulario') ||
    text.length > 400
  )
}
