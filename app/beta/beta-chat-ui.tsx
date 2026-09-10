'use client'
import React from 'react'
import type { Msg } from './beta-model'
import { resolveMsgArtifacts } from './beta-model'
import { fmt } from './beta-schema'
import { CopyBlock, isCopyable, SuggestedActionBar } from './beta-actions'
import { ArtifactRender } from './beta-artifacts'

export function Bubble({ msg, mc }: { msg: Msg; mc: string }) {
  const isUser = msg.sender === 'user'
  return (
    <>
      <div style={{ display:'flex', alignItems:'flex-end', gap:8, maxWidth:'88%', ...(isUser?{flexDirection:'row-reverse',marginLeft:'auto'}:{}) }}>
        <div style={{ width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0, background: isUser ? 'var(--teal)' : mc, color:'#fff' }}>
          {isUser ? 'YOU' : msg.sender.toUpperCase().slice(0,2)}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6, maxWidth:'100%' }}>
          {msg.text && (
            !isUser && isCopyable(msg.text) ? (
              <CopyBlock text={msg.text}>
                <div style={{ padding:'10px 14px', paddingTop:34, borderRadius:16, fontSize:14, lineHeight:1.6, background:'var(--navy2)', border:'1px solid var(--border)', color:'var(--silver)', borderBottomLeftRadius:4 }}
                  dangerouslySetInnerHTML={{ __html: fmt(msg.text || '') }} />
              </CopyBlock>
            ) : (
              <div style={{ padding:'10px 14px', borderRadius:16, fontSize:14, lineHeight:1.6, ...(isUser ? { background:'var(--teal)', color:'var(--navy)', fontWeight:500, borderBottomRightRadius:4 } : { background:'var(--navy2)', border:'1px solid var(--border)', color:'var(--silver)', borderBottomLeftRadius:4 }) }}
                dangerouslySetInnerHTML={{ __html: fmt(msg.text || '') }} />
            )
          )}
          {msg.imageUrl && (
            <div style={{ marginTop:4, borderRadius:12, overflow:'hidden', maxWidth:280, border:'1px solid var(--border)' }}>
              <img src={msg.imageUrl} alt="Adjunto" style={{ width:'100%', display:'block', borderRadius:12 }} />
            </div>
          )}
          {msg.audioUrl && (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:10, background:'rgba(0,201,167,.06)', border:'1px solid rgba(0,201,167,.15)', maxWidth:280 }}>
              <span style={{ fontSize:12 }}>🎤</span>
              <audio controls src={msg.audioUrl} style={{ flex:1, height:24, minWidth:0 }} />
            </div>
          )}
          {resolveMsgArtifacts(msg).map((art, i) => (
            <div className="artifact-in" key={`artifact-${msg.id}-${i}`}><ArtifactRender a={art} /></div>
          ))}
          {msg.score !== undefined && <div style={{ fontSize:12, color:'var(--gold)', fontWeight:700 }}>Puntuación: {msg.score}/10</div>}
        </div>
      </div>
      {!isUser && (msg.suggestedActions?.length ?? 0) > 0 && (
        <SuggestedActionBar actions={msg.suggestedActions!}
          onAction={(a) => window.dispatchEvent(new CustomEvent('lingora-suggested-action', { detail: a }))} />
      )}
    </>
  )
}

export function Typing({ mc }: { mc: string }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:8, maxWidth:'88%' }}>
      <div style={{ width:28, height:28, borderRadius:'50%', background:mc, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#fff' }}>LN</div>
      <div style={{ padding:'10px 14px', background:'var(--navy2)', border:'1px solid var(--border)', borderRadius:16, borderBottomLeftRadius:4, display:'flex', gap:4, alignItems:'center' }}>
        {[0,150,300].map(d => <span key={d} style={{ width:5, height:5, borderRadius:'50%', background:'var(--teal)', display:'inline-block', animation:`tdot 1.2s ${d}ms infinite` }} />)}
      </div>
    </div>
  )
}
