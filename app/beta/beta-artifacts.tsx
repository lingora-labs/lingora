'use client'
import React from 'react'
import { useSeedUi } from './seed-locale'
import type { Artifact } from './beta-model'
import type { QuizQ } from './beta-model'
import { renderChartSvg, validateChartContent } from '../../lib/chart-contract'
import { renderFlowchartSvg, validateFlowchartContent } from '../../lib/flowchart-contract'
import { renderInfographicSvg, validateInfographicContent } from '../../lib/infographic-contract'
import { svgToPng, saveBlob } from './svg-export'
import { explainNativeRefusal } from '../../server/core/native-artifact'
import { SchemaBlock, TableArtifactBlock, MatrixTableBlock, SchemaProBlock, QuizBlock } from './beta-schema'
import { renderTutorMarkdown } from '../../lib/content/markdown'
import { fetchVerifiedPdf, pdfFileName, type PdfExpectation } from '../../lib/pdf-download'

/** 7.5: a component that cannot be drawn says so; it never disappears (7.4 returned null). */
export function ArtifactUnavailable({ type, reason }: { type: string; reason: string }) {
  const t = useSeedUi()
  return (
    <div data-testid="artifact-unavailable" role="status" style={{ marginTop:8, padding:'8px 12px', borderRadius:10, fontSize:12.5, background:'rgba(217,119,6,.10)', border:'1px solid rgba(217,119,6,.25)', color:'var(--silver)', maxWidth:420 }}>
      {t('No se puede mostrar este componente')} ({type}): {/^[a-z]+_[a-z_]+(:|$)/.test(reason) ? explainNativeRefusal(reason) : reason}.
    </div>
  )
}

// 7.4 — Chromium blocks top-level navigation to data: URLs, so a plain <a href="data:text/html…">
// never opens. The same bytes are turned into a Blob in the browser and opened (or downloaded)
// from a blob: URL. The HTML stays self-contained: its interactions travel inside the file.
export function dataUrlToHtmlBlob(dataUrl: string): Blob | null {
  const m = /^data:text\/html(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl)
  if (!m) return null
  try {
    if (m[1]) {
      const bin = atob(m[2])
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new Blob([bytes], { type: 'text/html;charset=utf-8' })
    }
    return new Blob([decodeURIComponent(m[2])], { type: 'text/html;charset=utf-8' })
  } catch { return null }
}

function HtmlVersionActions({ webUrl }: { webUrl: string }) {
  const t = useSeedUi()
  const [err, setErr] = React.useState('')
  const make = () => {
    const blob = dataUrlToHtmlBlob(webUrl)
    if (!blob) { setErr(t('No se pudo preparar la versión web.')); return null }
    setErr('')
    return URL.createObjectURL(blob)
  }
  const open = () => {
    const url = make()
    if (!url) return
    const w = window.open(url, '_blank')
    if (!w) setErr(t('El navegador bloqueó la ventana. Usa «Descargar HTML».'))
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000)
  }
  const download = () => {
    const url = make()
    if (!url) return
    const a = document.createElement('a')
    a.href = url; a.download = 'lingora-material-interactivo.html'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60 * 1000)
  }
  const btn: React.CSSProperties = { display:'inline-flex', alignItems:'center', gap:6, padding:'9px 13px', borderRadius:10, background:'rgba(0,201,167,.1)', border:'1px solid rgba(0,201,167,.25)', color:'var(--teal)', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }
  return (
    <>
      <button type="button" data-testid="html-open" onClick={open} style={btn}>🌐 {t('Abrir versión interactiva')}</button>
      <button type="button" data-testid="html-download" onClick={download} style={btn}>⬇ {t('Descargar HTML')}</button>
      {err && <span role="alert" style={{ fontSize:12, color:'var(--gold)', alignSelf:'center' }}>{err}</span>}
    </>
  )
}

// 7.5 — «Descargar PDF» saves a file only after its bytes were recovered and checked (header, trailer,
// length and SHA-256 recorded at render). Otherwise it says why, visibly. No data: navigation, no print.
function PdfDownloadButton({ url, label, title, expected, pageCount }: { url: string; label: string; title?: string; expected: PdfExpectation; pageCount?: number }) {
  const t = useSeedUi()
  const [st, setSt] = React.useState<{ k: 'idle' | 'checking' | 'done' | 'error'; text?: string }>({ k: 'idle' })
  const run = async () => {
    if (st.k === 'checking') return
    setSt({ k: 'checking', text: t('Comprobando el PDF…') })
    const r = await fetchVerifiedPdf(url, expected)
    if (!r.ok) { setSt({ k: 'error', text: `${t('No se pudo descargar el PDF:')} ${r.reason}.` }); return }
    const name = pdfFileName(title)
    const blobUrl = URL.createObjectURL(new Blob([r.bytes as unknown as BlobPart], { type: 'application/pdf' }))
    const el = document.createElement('a'); el.href = blobUrl; el.download = name
    document.body.appendChild(el); el.click(); el.remove()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60 * 1000)
    const pages = typeof pageCount === 'number' ? `${pageCount} ${pageCount === 1 ? t('página') : t('páginas')}, ` : ''
    setSt({ k: 'done', text: `${t('PDF comprobado')} (${pages}${Math.max(1, Math.round(r.byteLength / 1024))} KB) ${t('y entregado al navegador como')} ${name}.` })
  }
  return (
    <span style={{ display:'inline-flex', flexDirection:'column', gap:4 }}>
      <button type="button" data-testid="pdf-download" onClick={() => { void run() }} disabled={st.k === 'checking'}
        style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'9px 13px', borderRadius:10, background:'rgba(245,200,66,.1)', border:'1px solid rgba(245,200,66,.22)', color:'var(--gold)', fontSize:13, fontWeight:700, cursor: st.k === 'checking' ? 'wait' : 'pointer', fontFamily:'inherit' }}>{label}</button>
      {st.text && <span data-testid="pdf-download-status" data-state={st.k} role={st.k === 'error' ? 'alert' : 'status'}
        style={{ fontSize:12, color: st.k === 'error' ? 'var(--danger,#f87171)' : 'var(--silver)', fontWeight: st.k === 'error' ? 700 : 400, maxWidth:360 }}>{st.text}</span>}
    </span>
  )
}

// 7.4.2/7.4.3 — native SVG instruments (chart, flowchart, infographic): drawn deterministically from the
// Tutor's validated content. Fluid inside a horizontally scrollable box, so nothing is ever clipped.
function SvgInstrumentBlock({ svg, renderAt, fileSvg, kind, file }: { svg: string; renderAt?: (width: number) => string; fileSvg: string; kind: string; file: string }) {
  const t = useSeedUi()
  // 7.5 P1-B: on a narrow screen the same content is laid out for the width it actually has (text at its
  // real size, never shrunk); the files are always the full-width drawing.
  const boxRef = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!renderAt || !boxRef.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => { const w = Math.floor(e.contentRect.width / 10) * 10 - 2; setWidth(w < 500 ? Math.max(260, w) : null) })
    ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [renderAt])
  const narrow = Boolean(renderAt && width)
  const shown = React.useMemo(() => (renderAt && width ? renderAt(width) : svg), [renderAt, width, svg])
  const [status, setStatus] = React.useState<{ k: 'busy' | 'done' | 'error'; text: string } | null>(null)
  const downloadSvg = () => {
    saveBlob(new Blob([fileSvg], { type: 'image/svg+xml;charset=utf-8' }), `${file}.svg`)
    setStatus({ k: 'done', text: `${t('SVG entregado al navegador como')} ${file}.svg.` })
  }
  const downloadPng = async () => {
    setStatus({ k: 'busy', text: t('Preparando el PNG…') })
    const png = await svgToPng(fileSvg, 2)
    if (!png.ok) { setStatus({ k: 'error', text: `${t('No se pudo crear el PNG:')} ${png.reason}. ${t('Puedes descargar el SVG.')}` }); return }
    saveBlob(png.blob, `${file}.png`)
    setStatus({ k: 'done', text: `${t('PNG comprobado')} (${png.width}×${png.height}) ${t('y entregado al navegador como')} ${file}.png.` })
  }
  const btn: React.CSSProperties = { fontSize:12, color:'var(--teal)', fontWeight:700, background:'none', border:'none', cursor:'pointer', padding:0, marginRight:14 }
  return (
    <div ref={boxRef} style={{ marginTop:8, width:'100%', maxWidth:560 }} data-testid={`${kind}-artifact`} data-layout={narrow ? 'narrow' : 'wide'}>
      <div style={{ borderRadius:14, overflowX:'auto', border:'1px solid var(--border)' }} dangerouslySetInnerHTML={{ __html: shown }} />
      <div style={{ marginTop:5 }}>
        <button type="button" data-testid={`${kind}-download-png`} onClick={() => { void downloadPng() }} disabled={status?.k === 'busy'} style={btn}>↓ {t('Descargar PNG')}</button>
        <button type="button" data-testid={`${kind}-download-svg`} onClick={downloadSvg} style={btn}>↓ SVG</button>
      </div>
      {status && <div data-testid={`${kind}-download-status`} data-state={status.k} role={status.k === 'error' ? 'alert' : 'status'}
        style={{ marginTop:4, fontSize:12, color: status.k === 'error' ? 'var(--danger,#f87171)' : 'var(--silver)' }}>{status.text}</div>}
    </div>
  )
}

function ChartBlock({ content }: { content: Record<string, unknown> }) {
  const checked = validateChartContent(content)
  if (!checked.ok) return <ArtifactUnavailable type="gráfico" reason={checked.reason} />
  return <SvgInstrumentBlock kind="chart" file="lingora-grafico" svg={renderChartSvg(checked.chart)} fileSvg={renderChartSvg(checked.chart, { fixed: true })} />
}
function FlowchartBlock({ content }: { content: Record<string, unknown> }) {
  const checked = validateFlowchartContent(content)
  if (!checked.ok) return <ArtifactUnavailable type="diagrama" reason={checked.reason} />
  return <SvgInstrumentBlock kind="flowchart" file="lingora-diagrama" svg={renderFlowchartSvg(checked.flow)} fileSvg={renderFlowchartSvg(checked.flow, { fixed: true })} />
}
function InfographicBlock({ content }: { content: Record<string, unknown> }) {
  const checked = validateInfographicContent(content)
  if (!checked.ok) return <ArtifactUnavailable type="infografía" reason={checked.reason} />
  const info = checked.info
  return <SvgInstrumentBlock kind="infographic" file="lingora-infografia" svg={renderInfographicSvg(info)} renderAt={w => renderInfographicSvg(info, { width: w })} fileSvg={renderInfographicSvg(info, { fixed: true })} />
}

export function ArtifactRender({ a, instanceId }: { a: Artifact; instanceId?: string }) {
  const t = useSeedUi()
  if (a.type === 'schema') return <SchemaBlock content={a as unknown as Record<string, unknown>} instanceId={instanceId} />
  if (a.type === 'schema_pro') return <SchemaProBlock content={(a.content ?? a) as Record<string, unknown>} />
  if (a.type === 'table') return <TableArtifactBlock content={a as unknown as Record<string, unknown>} />
  if (a.type === 'chart') return <ChartBlock content={(a.content ?? a) as Record<string, unknown>} />
  if (a.type === 'flowchart') return <FlowchartBlock content={(a.content ?? a) as Record<string, unknown>} />
  if (a.type === 'infographic') return <InfographicBlock content={(a.content ?? a) as Record<string, unknown>} />
  if (a.type === 'table_matrix') return <MatrixTableBlock content={(a.content ?? a) as Record<string, unknown>} />
  if (a.type === 'quiz') {
    type QuizOption = string | { text: string; correct?: boolean }
    type QuizQuestion = { question: string; options: QuizOption[]; correct?: number; explanation?: string }
    const qa = a as unknown as { title?: string; questions?: QuizQuestion[]; content?: Record<string, unknown> }
    const contentObj = qa.content && typeof qa.content === 'object' ? qa.content : undefined
    const raw = qa.questions ?? (Array.isArray(contentObj?.questions) ? contentObj?.questions as QuizQuestion[] : [])
    const questions: QuizQ[] = raw.map(q => ({
      question: typeof q.question === 'string' ? q.question : '',
      options: Array.isArray(q.options) ? q.options.map((o) => typeof o === 'object' && o && 'text' in o ? String((o as {text:string}).text) : String(o)) : [],
      correct: typeof q.correct === 'number' ? q.correct : Array.isArray(q.options) ? q.options.findIndex((o) => typeof o === 'object' && o && 'correct' in o && Boolean((o as {correct?: boolean}).correct)) : 0,
      explanation: typeof q.explanation === 'string' ? q.explanation : undefined,
    }))
    const title = typeof qa.title === 'string' ? qa.title : typeof contentObj?.title === 'string' ? contentObj.title : 'Simulacro'
    return (
      <div style={{ marginTop:10, width:'100%', maxWidth:540, borderRadius:16, border:'1px solid rgba(0,201,167,.25)', background:'rgba(0,201,167,.05)', overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(0,201,167,.15)', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)' }}>{t('Simulacro')}</span>
          <span style={{ fontSize:12, color:'var(--muted)', marginLeft:'auto' }}>{title}</span>
        </div>
        <div style={{ padding:14 }}><QuizBlock quiz={questions} reviewMode={contentObj?.gradingMode === 'tutor_review'} initial={a.progress} instanceId={instanceId} title={title} /></div>
      </div>
    )
  }
  if (a.type === 'illustration' && a.url) {
    return (
      <div style={{ marginTop:8 }}>
        <img src={a.url} alt="LINGORA visual" style={{ maxWidth:'100%', borderRadius:14, display:'block', border:'1px solid var(--border)' }} />
        <a href={a.url} download target="_blank" rel="noopener" style={{ display:'inline-block', marginTop:5, fontSize:12, color:'var(--teal)', fontWeight:700 }}>↓ {t('Descargar imagen')}</a>
      </div>
    )
  }
  if ((a.type === 'pdf' || a.type === 'pdf_chat' || a.type === 'course_pdf') && a.url) {
    const label = a.type === 'course_pdf' ? '📄 ' + t('Descargar curso PDF') : a.type === 'pdf_chat' ? '📋 ' + t('Descargar historial PDF') : '📄 ' + t('Descargar PDF')
    const webUrl = (a as { webUrl?: string }).webUrl
    return (
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:6 }}>
        {webUrl && <HtmlVersionActions webUrl={webUrl} />}
        <PdfDownloadButton url={a.url} label={label} title={(a as { title?: string }).title}
          expected={{ byteLength: (a as { pdfByteLength?: number }).pdfByteLength, sha256: (a as { pdfSha256?: string }).pdfSha256 }}
          pageCount={(a as { pageCount?: number }).pageCount} />
      </div>
    )
  }
  if (a.type === 'audio' && (a.dataUrl || a.url || (a.content as Record<string, unknown> | undefined)?.dataUrl)) {
    const src = String(a.dataUrl ?? a.url ?? (a.content as Record<string, unknown>)?.dataUrl ?? '')
    return (
      <div style={{ marginTop:8 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--teal)', letterSpacing:'.06em', textTransform:'uppercase' }}>🔊 {t('Respuesta de audio')}</div>
        {/* P16 — voice-turn replies autoplay: the mic tap that started this
            exchange is the user gesture: most browsers permit the audio
            response from that same interaction chain to play without a
            second tap. Controls remain visible so the user can pause/replay
            regardless of autoplay policy in their specific browser. */}
        <audio controls autoPlay src={src} style={{ marginTop:6, width:'100%', height:28 }} />
      </div>
    )
  }
  if (a.type === 'roadmap') {
    const r = (a.content ?? a) as { title?: string; topic?: string; mentor?: string; level?: string; modules?: Array<{ index: number; title: string; focus: string; completed: boolean; current: boolean }>; steps?: string[]; first?: string }
    const mods = Array.isArray(r.modules) ? r.modules : []
    const steps = Array.isArray(r.steps) ? r.steps : []
    if (!mods.length && !steps.length) return <ArtifactUnavailable type="ruta" reason="no tiene módulos ni pasos" />
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
            <div style={{ fontSize:13, fontWeight:800, color:'#fff' }}>{t('Nivel estimado CEFR')}</div>
            <div style={{ fontSize:11, color:'var(--muted)' }}>{t('Confianza:')} {conf} · {count} {t('muestras')}</div>
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
    if (!body) return <ArtifactUnavailable type="contenido" reason="llegó vacío" />
    return (
      <div style={{ marginTop:10, maxWidth:560, borderRadius:14, border:'1px solid var(--border)', background:'rgba(255,255,255,.02)', padding:'14px 16px' }}>
        {title && <div style={{ fontSize:14, fontWeight:800, color:'#fff', marginBottom:8 }}>{title}</div>}
        <div style={{ fontSize:14, color:'var(--silver)', lineHeight:1.65 }} dangerouslySetInnerHTML={{ __html: renderTutorMarkdown(body) }} />
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
  // Link-only and unknown types: say what arrived instead of rendering nothing.
  return <ArtifactUnavailable type={String(a.type)} reason="este tipo de componente no tiene vista en el chat" />
}
