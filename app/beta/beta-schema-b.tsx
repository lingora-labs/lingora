'use client'
import React, { useRef, useState, type ReactNode } from 'react'
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
    neutral:{ color:'var(--silver)', bg:'rgba(148,163,184,.06)' },
    highlight:{color:'#c4b5fd',bg:'rgba(196,181,253,.18)'},
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
        <table style={{ minWidth:Math.max(520,c.columns.length*145), width:'100%', borderCollapse:'collapse', fontSize:13 }}>
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
                  const columnPalette = ['ok','info','highlight','warn','danger','neutral'] as const
                  const ts = toneStyle[cell.tone ?? columnPalette[ci % columnPalette.length]] ?? toneStyle.neutral
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
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState('')
  const exportRef = useRef<HTMLDivElement>(null)
  const rawBlocks = Array.isArray(content.blocks) ? content.blocks : []
  const blocks    = rawBlocks.filter(isValidSBlock)
  if (!blocks.length) return null
  const title    = typeof content.title    === 'string' ? content.title    : 'Schema'
  const subtitle = typeof content.subtitle === 'string' ? content.subtitle : undefined
  const level    = typeof content.level    === 'string' ? content.level    : undefined
  // Art. 27: actual color-rich visual document from the rendered schema,
  // not an LLM-produced promise or a plain-text PDF masquerading as a graphic.
  async function exportVisual(format:'png'|'pdf') {
    if (!exportRef.current || exportBusy) return
    setExportBusy(true)
    setExportError('')
    const previous = collapsed
    try {
      setCollapsed({})
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      if (!exportRef.current) throw new Error('Visual schema missing')
      // Capture the VISIBLE, populated React component, without an offscreen
      // clone (which can render only background through SVG foreignObject).
      // Export at a stable document width independently of chat-bubble width.
      const captureWidth = 580
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(exportRef.current,{
        backgroundColor:'#0b1728',
        width:captureWidth,
        pixelRatio:2,
        style:{width:captureWidth+'px',minWidth:captureWidth+'px',maxWidth:'none'},
        cacheBust:true,
        skipFonts:true,
        filter:(node) => !(node instanceof HTMLElement && node.hasAttribute('data-export-ignore')),
      })
      const slug = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48) || 'esquema'
      if(format==='png') {
        const a=document.createElement('a'); a.href=dataUrl
        a.download='lingora-'+slug+'.png';a.click()
      } else {
        const { PDFDocument } = await import('pdf-lib')
        const pdf=await PDFDocument.create()
        const image=new Image(); image.src=dataUrl; await image.decode()
        const pw=595.28, ph=841.89, margin=32, scale=(pw-2*margin)/image.width
        const chunkSize=Math.max(1,Math.floor((ph-2*margin)/scale))
        for(let offset=0;offset<image.height;offset+=chunkSize){
          const chunkHeight=Math.min(chunkSize,image.height-offset)
          const canvas=document.createElement('canvas')
          canvas.width=image.width;canvas.height=chunkHeight
          const ctx=canvas.getContext('2d')
          if(!ctx) throw new Error('Visual export canvas unavailable')
          ctx.drawImage(image,0,offset,image.width,chunkHeight,0,0,image.width,chunkHeight)
          const imageBytes=await pdf.embedPng(canvas.toDataURL('image/png'))
          const page=pdf.addPage([pw,ph])
          page.drawImage(imageBytes,{x:margin,y:ph-margin-chunkHeight*scale,width:image.width*scale,height:chunkHeight*scale})
        }
        const bytes=await pdf.save()
        const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/pdf'}))
        const a=document.createElement('a');a.href=url;a.download='lingora-'+slug+'.pdf';a.click()
        window.setTimeout(()=>URL.revokeObjectURL(url),30_000)
      }
    } catch(e) {
      console.error('[schema export]', e)
      setExportError('No se pudo exportar este esquema. Vuelve a intentarlo.')
    } finally {
      setCollapsed(previous)
      setExportBusy(false)
    }
  }
  return (
    <div ref={exportRef} style={{ marginTop:10, width:'100%', maxWidth:580, borderRadius:20, overflow:'hidden', background:'linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.018))', border:'1px solid var(--border)', boxShadow:'0 12px 36px rgba(0,0,0,.22)' }}>
      <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', background:'rgba(255,255,255,.02)', display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)' }}>Schema Pro</span>
        {level && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:999, background:'rgba(0,201,167,.1)', border:'1px solid rgba(0,201,167,.2)', color:'var(--teal)', marginLeft:'auto' }}>{level}</span>}
      </div>
      <div style={{ padding:16, display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:'#fff', lineHeight:1.2, fontFamily:'"DM Serif Display",serif' }}>{title}</div>
          {subtitle && <div style={{ fontSize:13, color:'var(--muted)', marginTop:4 }}>{subtitle}</div>}
        </div>
        <div data-export-ignore="true" style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          <button type="button" onClick={() => setCollapsed(Object.fromEntries(blocks.map((_,i) => [i,true])))}
            style={{minHeight:44, padding:'9px 12px', borderRadius:10, border:'1px solid var(--border)', background:'var(--navy2)', color:'var(--silver)', cursor:'pointer'}}>Contraer todo</button>
          <button type="button" onClick={() => setCollapsed({})}
            style={{minHeight:44, padding:'9px 12px', borderRadius:10, border:'1px solid var(--border)', background:'var(--navy2)', color:'var(--silver)', cursor:'pointer'}}>Expandir todo</button>
        </div>
        <div data-export-ignore="true" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button type="button" disabled={exportBusy} onClick={()=>void exportVisual('png')}
            style={{minHeight:44,padding:'9px 12px',borderRadius:10,border:'1px solid var(--border)',background:'rgba(0,201,167,.08)',color:'var(--teal)',cursor:'pointer'}}>↓ Descargar PNG</button>
          <button type="button" disabled={exportBusy} onClick={()=>void exportVisual('pdf')}
            style={{minHeight:44,padding:'9px 12px',borderRadius:10,border:'1px solid var(--border)',background:'rgba(245,200,66,.08)',color:'var(--gold)',cursor:'pointer'}}>↓ Descargar PDF</button>
          {exportBusy && <span role="status">Preparando archivo visual…</span>}
        </div>
        {exportError && <div role="alert" data-export-ignore="true" style={{color:'var(--coral)',fontSize:12}}>{exportError}</div>}
        {blocks.map((b, i) => (
          <div key={i}>
            <button type="button" aria-expanded={!collapsed[i]} onClick={() => setCollapsed(p => ({...p,[i]:!p[i]}))}
              style={{width:'100%', textAlign:'left', minHeight:44, padding:'10px 12px', borderRadius:10, border:'1px solid rgba(0,201,167,.20)', background:'rgba(0,201,167,.06)', color:'var(--teal)', fontWeight:700, cursor:'pointer'}}>
              {collapsed[i] ? '▸' : '▾'} {b.type === 'concept' || b.type === 'bullets' ? b.title : b.type === 'highlight' ? (b.label || 'Idea esencial') : b.type === 'flow' ? 'Secuencia' : b.type === 'comparison' ? 'Comparación' : 'Tabla visual'}
            </button>
            {!collapsed[i] && renderSBlock(b, i)}
          </div>
        ))}
      </div>
    </div>
  )
}
