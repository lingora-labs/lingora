'use client'
import React, { type ReactNode } from 'react'
import { TableArtifactBlock } from './beta-schema-a'

export function MatrixTableBlock({ content }: { content: Record<string, unknown> }) {
  type RCell = { text: string; icon?: string; tone?: string; bold?: boolean; align?: string }
  const c = content as { title?: string; subtitle?: string; columns: Array<{key:string;label:string;width?:string}>; rows: RCell[][] }
  if (!c.columns?.length || !c.rows?.length) return null
  const toneStyle: Record<string, { color: string; bg: string }> = {
    ok:     { color:'#00c9a7', bg:'rgba(0,201,167,.1)' },
    warn:   { color:'#f5c842', bg:'rgba(245,200,66,.1)' },
    danger: { color:'#ff6b6b', bg:'rgba(255,107,107,.1)' },
    info:   { color:'#38bdf8', bg:'rgba(56,189,248,.1)' },
    neutral:{ color:'var(--silver)', bg:'transparent' },
  }
  return (
    <div style={{ marginTop:10, width:'100%', maxWidth:620, borderRadius:16, overflow:'hidden', border:'1px solid var(--border)', background:'rgba(255,255,255,.02)' }}>
      {(c.title || c.subtitle) && (
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', background:'rgba(255,255,255,.03)' }}>
          {c.title    && <div style={{ fontSize:14, fontWeight:800, color:'#fff' }}>{c.title}</div>}
          {c.subtitle && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{c.subtitle}</div>}
        </div>
      )}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:'rgba(255,255,255,.04)' }}>
              {c.columns.map((col, i) => (
                <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontWeight:700, color:'var(--teal)', fontSize:11, letterSpacing:'.06em', textTransform:'uppercase', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap', width: col.width }}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.rows.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: ri < c.rows.length-1 ? '1px solid rgba(255,255,255,.04)' : 'none', background: ri%2===0?'transparent':'rgba(255,255,255,.015)' }}>
                {row.map((cell, ci) => {
                  const ts = toneStyle[cell.tone ?? 'neutral'] ?? toneStyle.neutral
                  return (
                    <td key={ci} style={{ padding:'9px 12px', color: ts.color, background: ts.bg || 'transparent', fontWeight: cell.bold ? 700 : ci===0 ? 600 : 400, verticalAlign:'top', textAlign: (cell.align as 'left'|'center'|'right') ?? 'left' }}>
                      {cell.icon && <span style={{ marginRight:5 }}>{cell.icon}</span>}
                      {cell.text}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export type SBConcept    = { type: 'concept';    title: string; body: string; tone?: string }
export type SBBullets    = { type: 'bullets';    title: string; items: string[] }
export type SBHighlight  = { type: 'highlight';  text: string;  tone?: string; label?: string }
export type SBFlow       = { type: 'flow';       steps: string[] }
export type SBComparison = { type: 'comparison'; left: string;  right: string; label?: string }
export type SBTable      = { type: 'table';      columns: string[]; rows: string[][] }
export type SBlock = SBConcept | SBBullets | SBHighlight | SBFlow | SBComparison | SBTable

export function renderSBlock(b: SBlock, i: number): ReactNode {
  switch (b.type) {
    case 'concept':
      return (
        <div key={i} style={{ border:'1px solid var(--border)', borderRadius:14, padding:14, background:'rgba(255,255,255,.02)' }}>
          <div style={{ fontSize:13, fontWeight:800, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>{b.title}</div>
          <div style={{ fontSize:14, color:'var(--silver)', lineHeight:1.65 }}>{b.body}</div>
        </div>
      )
    case 'bullets':
      return (
        <div key={i} style={{ border:'1px solid var(--border)', borderRadius:14, padding:14, background:'rgba(255,255,255,.02)' }}>
          <div style={{ fontSize:13, fontWeight:800, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>{b.title}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {b.items.map((item, ii) => (
              <div key={ii} style={{ display:'flex', gap:8, alignItems:'flex-start', fontSize:14, color:'var(--silver)' }}>
                <span style={{ color:'var(--teal)', flexShrink:0, marginTop:1 }}>›</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      )
    case 'highlight': {
      const toneMap: Record<string, { bg: string; border: string; color: string; icon: string }> = {
        ok:        { bg:'rgba(0,201,167,.09)',  border:'rgba(0,201,167,.22)',  color:'var(--teal)',  icon:'🧠' },
        warn:      { bg:'rgba(245,200,66,.09)', border:'rgba(245,200,66,.22)', color:'var(--gold)',  icon:'⚠️' },
        danger:    { bg:'rgba(255,107,107,.09)',border:'rgba(255,107,107,.22)',color:'var(--coral)', icon:'❌' },
        info:      { bg:'rgba(56,189,248,.09)', border:'rgba(56,189,248,.22)', color:'#38bdf8',     icon:'💡' },
        highlight: { bg:'rgba(196,181,253,.09)',border:'rgba(196,181,253,.22)',color:'#c4b5fd',     icon:'🎯' },
      }
      const ts = toneMap[b.tone ?? 'ok'] ?? toneMap.ok
      return (
        <div key={i} style={{ background:`linear-gradient(180deg,${ts.bg},${ts.bg.replace('.09','.04')})`, border:`1px solid ${ts.border}`, borderRadius:14, padding:14 }}>
          {b.label && <div style={{ fontSize:11, fontWeight:800, color:ts.color, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:5 }}>{b.label}</div>}
          <div style={{ fontSize:14, color:'#fff', lineHeight:1.6, fontWeight:600 }}>{ts.icon} {b.text}</div>
        </div>
      )
    }
    case 'comparison':
      return (
        <div key={i} style={{ border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
          {b.label && <div style={{ padding:'7px 12px', background:'rgba(255,255,255,.03)', fontSize:11, fontWeight:800, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid var(--border)' }}>{b.label}</div>}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr' }}>
            <div style={{ padding:12, borderRight:'1px solid var(--border)' }}>
              <div style={{ fontSize:11, fontWeight:800, color:'var(--teal)', marginBottom:5, textTransform:'uppercase' }}>A</div>
              <div style={{ fontSize:14, color:'var(--silver)' }}>{b.left}</div>
            </div>
            <div style={{ padding:12 }}>
              <div style={{ fontSize:11, fontWeight:800, color:'#c4b5fd', marginBottom:5, textTransform:'uppercase' }}>B</div>
              <div style={{ fontSize:14, color:'var(--silver)' }}>{b.right}</div>
            </div>
          </div>
        </div>
      )
    case 'flow':
      return (
        <div key={i} style={{ display:'flex', flexDirection:'column', gap:0 }}>
          {b.steps.map((step, si) => (
            <div key={si} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0 }}>
                <div style={{ width:26, height:26, borderRadius:'50%', background:'rgba(0,201,167,.15)', border:'1px solid var(--teal)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:'var(--teal)' }}>{si+1}</div>
                {si < b.steps.length-1 && <div style={{ width:1, height:16, background:'rgba(0,201,167,.2)', margin:'2px 0' }} />}
              </div>
              <div style={{ paddingTop:4, fontSize:14, color:'var(--silver)', lineHeight:1.5, paddingBottom:si < b.steps.length-1 ? 4 : 0 }}>{step}</div>
            </div>
          ))}
        </div>
      )
    case 'table':
      return <TableArtifactBlock key={i} content={{ columns: b.columns, rows: b.rows, tone: 'vocabulary' }} />
    default:
      return null
  }
}

export function isValidSBlock(raw: unknown): raw is SBlock {
  if (!raw || typeof raw !== 'object') return false
  const b = raw as Record<string, unknown>
  return typeof b.type === 'string' && ['concept','bullets','highlight','flow','comparison','table'].includes(b.type)
}

export function SchemaProBlock({ content }: { content: Record<string, unknown> }) {
  const rawBlocks = Array.isArray(content.blocks) ? content.blocks : []
  const blocks    = rawBlocks.filter(isValidSBlock)
  if (!blocks.length) return null
  const title    = typeof content.title    === 'string' ? content.title    : 'Schema'
  const subtitle = typeof content.subtitle === 'string' ? content.subtitle : undefined
  const level    = typeof content.level    === 'string' ? content.level    : undefined
  return (
    <div style={{ marginTop:10, width:'100%', maxWidth:580, borderRadius:20, overflow:'hidden', background:'linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.018))', border:'1px solid var(--border)', boxShadow:'0 12px 36px rgba(0,0,0,.22)' }}>
      <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', background:'rgba(255,255,255,.02)', display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)' }}>Schema Pro</span>
        {level && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:999, background:'rgba(0,201,167,.1)', border:'1px solid rgba(0,201,167,.2)', color:'var(--teal)', marginLeft:'auto' }}>{level}</span>}
      </div>
      <div style={{ padding:16, display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:'#fff', lineHeight:1.2, fontFamily:'"DM Serif Display",serif' }}>{title}</div>
          {subtitle && <div style={{ fontSize:13, color:'var(--muted)', marginTop:4 }}>{subtitle}</div>}
        </div>
        {blocks.map((b, i) => renderSBlock(b, i))}
      </div>
    </div>
  )
}
