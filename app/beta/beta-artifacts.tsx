'use client'
import React from 'react'
import type { Artifact } from './beta-model'
import type { QuizQ } from './beta-model'
import { SchemaBlock, TableArtifactBlock, MatrixTableBlock, SchemaProBlock, QuizBlock, fmt } from './beta-schema'

export function ArtifactRender({ a }: { a: Artifact }) {
  if (a.type === 'schema') return <SchemaBlock content={a as unknown as Record<string, unknown>} />
  if (a.type === 'schema_pro') return <SchemaProBlock content={(a.content ?? a) as Record<string, unknown>} />
  if (a.type === 'table') return <TableArtifactBlock content={a as unknown as Record<string, unknown>} />
  if (a.type === 'table_matrix') return <MatrixTableBlock content={a as unknown as Record<string, unknown>} />
  if (a.type === 'quiz') {
    type QuizOption = string | { text: string; correct?: boolean }
    type QuizQuestion = { question: string; options: QuizOption[]; correct?: number }
    const qa = a as unknown as { title?: string; questions?: QuizQuestion[]; content?: Record<string, unknown> }
    const contentObj = qa.content && typeof qa.content === 'object' ? qa.content : undefined
    const raw = qa.questions ?? (Array.isArray(contentObj?.questions) ? contentObj?.questions as QuizQuestion[] : [])
    const questions: QuizQ[] = raw.map(q => ({
      question: typeof q.question === 'string' ? q.question : '',
      options: Array.isArray(q.options) ? q.options.map((o) => typeof o === 'object' && o && 'text' in o ? String((o as {text:string}).text) : String(o)) : [],
      correct: typeof q.correct === 'number' ? q.correct : Array.isArray(q.options) ? q.options.findIndex((o) => typeof o === 'object' && o && 'correct' in o && Boolean((o as {correct?: boolean}).correct)) : 0,
    }))
    const title = typeof qa.title === 'string' ? qa.title : typeof contentObj?.title === 'string' ? contentObj.title : 'Simulacro'
    return (
      <div style={{ marginTop:10, width:'100%', maxWidth:540, borderRadius:16, border:'1px solid rgba(0,201,167,.25)', background:'rgba(0,201,167,.05)', overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(0,201,167,.15)', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)' }}>Simulacro</span>
          <span style={{ fontSize:12, color:'var(--muted)', marginLeft:'auto' }}>{title}</span>
        </div>
        <div style={{ padding:14 }}><QuizBlock quiz={questions} /></div>
      </div>
    )
  }
  if (a.type === 'illustration' && a.url) {
    return (
      <div style={{ marginTop:8 }}>
        <img src={a.url} alt="LINGORA visual" style={{ maxWidth:'100%', borderRadius:14, display:'block', border:'1px solid var(--border)' }} />
        <a href={a.url} download target="_blank" rel="noopener" style={{ display:'inline-block', marginTop:5, fontSize:12, color:'var(--teal)', fontWeight:700 }}>↓ Descargar imagen</a>
      </div>
    )
  }
  if ((a.type === 'pdf' || a.type === 'pdf_chat' || a.type === 'course_pdf') && a.url) {
    const label = a.type === 'course_pdf' ? '📄 Descargar curso PDF' : a.type === 'pdf_chat' ? '📋 Descargar historial PDF' : '📄 Descargar PDF'
    return <a href={a.url} download target="_blank" rel="noopener" style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:6, padding:'9px 13px', borderRadius:10, textDecoration:'none', background:'rgba(245,200,66,.1)', border:'1px solid rgba(245,200,66,.22)', color:'var(--gold)', fontSize:13, fontWeight:700 }}>{label}</a>
  }
  if (a.type === 'audio' && (a.dataUrl || a.url || (a.content as Record<string, unknown> | undefined)?.dataUrl)) {
    const src = String(a.dataUrl ?? a.url ?? (a.content as Record<string, unknown>)?.dataUrl ?? '')
    return (
      <div style={{ marginTop:8 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--teal)', letterSpacing:'.06em', textTransform:'uppercase' }}>🔊 Respuesta de audio</div>
        <audio controls src={src} style={{ marginTop:6, width:'100%', height:28 }} />
      </div>
    )
  }
  if (a.type === 'roadmap') {
    const r = (a.content ?? a) as { title?: string; topic?: string; mentor?: string; level?: string; modules?: Array<{ index: number; title: string; focus: string; completed: boolean; current: boolean }>; steps?: string[]; first?: string }
    const mods = Array.isArray(r.modules) ? r.modules : []
    const steps = Array.isArray(r.steps) ? r.steps : []
    if (!mods.length && !steps.length) return null
    return (
      <div style={{ marginTop:10, maxWidth:480, borderRadius:16, overflow:'hidden', border:'1px solid rgba(0,201,167,.25)', background:'rgba(0,201,167,.05)' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(0,201,167,.15)' }}>
          <div style={{ fontSize:13, fontWeight:800, color:'#fff' }}>{r.title ?? r.topic ?? 'Ruta de aprendizaje'}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>{mods.length ? `${mods.length} módulos` : `${steps.length} pasos`}{r.level ? ` · ${r.level}` : ''}</div>
        </div>
        <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:5 }}>
          {mods.length
            ? mods.map((mod, i) => (
                <button key={i} onClick={() => window.dispatchEvent(new CustomEvent('lingora-step-select', { detail: { step: mod.title, index: mod.index } }))} style={{ display:'flex', gap:8, alignItems:'center', fontSize:13, color: mod.current ? 'var(--teal)' : 'var(--silver)', background:'transparent', border:'none', cursor:'pointer', textAlign:'left', padding:'4px 0' }}>
                  <span>{mod.completed ? '✓' : mod.index + 1}</span><span>{mod.title}</span>
                </button>
              ))
            : steps.map((step, i) => (
                <button key={i} onClick={() => window.dispatchEvent(new CustomEvent('lingora-step-select', { detail: { step, index: i } }))} style={{ display:'flex', gap:8, alignItems:'center', fontSize:13, color:'var(--silver)', background:'transparent', border:'none', cursor:'pointer', textAlign:'left', padding:'4px 0' }}>
                  <span>{i + 1}</span><span>{step}</span>
                </button>
              ))}
          {r.first && <div style={{ marginTop:8, fontSize:13, color:'var(--teal)', fontWeight:700 }}>→ {r.first}</div>}
        </div>
      </div>
    )
  }
  if (a.type === 'diagnostic_report') {
    const raw = (a.content ?? a) as Record<string, unknown>
    const level = String(raw.estimatedLevel ?? raw.level ?? '?')
    const conf = String(raw.confidence ?? 'low')
    const count = Number(raw.sampleCount ?? 0)
    const obs = Array.isArray(raw.observations) ? raw.observations as string[] : []
    return (
      <div style={{ marginTop:10, maxWidth:440, borderRadius:16, border:'1px solid rgba(0,201,167,.25)', background:'rgba(0,201,167,.05)', overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:28, fontWeight:800, color:'var(--teal)' }}>{level}</span>
          <div>
            <div style={{ fontSize:13, fontWeight:800, color:'#fff' }}>Nivel estimado CEFR</div>
            <div style={{ fontSize:11, color:'var(--muted)' }}>Confianza: {conf} · {count} muestras</div>
          </div>
        </div>
        {obs.map((o, i) => <div key={i} style={{ padding:'0 14px 8px', fontSize:12, color:'var(--silver)' }}>• {o}</div>)}
      </div>
    )
  }
  if (a.type === 'rich_content') {
    const raw = (a.content ?? a) as Record<string, unknown>
    const title = String(raw.title ?? '')
    const body = String(raw.body ?? '')
    if (!body) return null
    return (
      <div style={{ marginTop:10, maxWidth:560, borderRadius:14, border:'1px solid var(--border)', background:'rgba(255,255,255,.02)', padding:'14px 16px' }}>
        {title && <div style={{ fontSize:14, fontWeight:800, color:'#fff', marginBottom:8 }}>{title}</div>}
        <div style={{ fontSize:14, color:'var(--silver)', lineHeight:1.65 }} dangerouslySetInnerHTML={{ __html: fmt(body) }} />
      </div>
    )
  }
  if (a.type === 'lesson_module') {
    const raw = (a.content ?? a) as Record<string, unknown>
    const moduleNum = Number(raw.moduleIndex ?? raw.module ?? 0)
    const title = String(raw.title ?? '')
    const content = String(raw.content ?? '')
    return (
      <div style={{ marginTop:8, borderRadius:14, border:'1px solid rgba(0,201,167,.2)', background:'rgba(0,201,167,.04)', padding:'8px 12px' }}>
        <div style={{ fontSize:11, fontWeight:800, color:'var(--teal)' }}>Módulo {moduleNum + 1} · {title}</div>
        {content && <div style={{ fontSize:13, color:'var(--silver)', marginTop:6 }}>{content}</div>}
      </div>
    )
  }
  if (a.type === 'pronunciation_report' || a.type === 'simulacro_result' || a.type === 'score_report' || a.type === 'audio_transcript' || a.type === 'pdf_assignment' || a.type === 'submission_feedback') {
    const raw = (a.content ?? a) as Record<string, unknown>
    return (
      <div style={{ marginTop:10, maxWidth:480, borderRadius:14, border:'1px solid var(--border)', background:'rgba(255,255,255,.02)', padding:'12px 14px' }}>
        <div style={{ fontSize:11, fontWeight:800, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'.08em' }}>{a.type}</div>
        {typeof raw.feedback === 'string' && <div style={{ fontSize:13, color:'var(--silver)', marginTop:8 }}>{raw.feedback}</div>}
        {typeof raw.text === 'string' && <div style={{ fontSize:13, color:'var(--silver)', marginTop:8 }}>{raw.text}</div>}
        {typeof raw.title === 'string' && <div style={{ fontSize:13, color:'#fff', marginTop:6 }}>{raw.title}</div>}
      </div>
    )
  }
  return null
}
