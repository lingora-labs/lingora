'use client'
import React, { useMemo, useState, type ReactNode } from 'react'
import type { TableRow, QuizQ, Sub, Norm } from './beta-model'

export const ss = (v: unknown): string => typeof v === 'string' ? v : ''
export const sa = (v: unknown): string[] => Array.isArray(v) ? v.map(ss).filter(Boolean) : []

export function normSchema(c?: Record<string, unknown>): Norm {
  const r = c ?? {}
  const rawSubtopics = Array.isArray(r.subtopics) ? r.subtopics
    : Array.isArray(r.sections) ? r.sections : []
  const subtopics: Sub[] = rawSubtopics
    .map((i: unknown) => {
      const o = i as Record<string,unknown>
      return { title: ss(o.title) || ss(o.label), content: ss(o.content) || ss(o.body), keyTakeaway: ss(o.keyTakeaway) }
    })
    .filter(s => s.title || s.content)
  const quiz: QuizQ[] = (Array.isArray(r.quiz) ? r.quiz : [])
    .map((i: unknown) => { const o = i as Record<string,unknown>; return { question: ss(o.question), options: Array.isArray(o.options) ? o.options.map(ss).filter(Boolean) : [], correct: typeof o.correct === 'number' ? o.correct : 0, explanation: ss(o.explanation) || undefined } })
    .filter(q => q.question && q.options.length > 0)
  const rawRows = Array.isArray(r.tableRows) ? r.tableRows : Array.isArray(r.rows) ? r.rows : []
  let tableRows: TableRow[] = rawRows.map((i: unknown) => { const o = i as Record<string,unknown>; return { left: ss(o.left)||ss(o.label)||ss(o.persona)||ss(o.term), right: ss(o.right)||ss(o.value)||ss(o.forma)||ss(o.definition) } }).filter(row => row.left && row.right)
  if (tableRows.length === 0 && subtopics.length >= 3) {
    const inferred = subtopics.filter(s => s.title.length < 40 && s.content.length < 80).map(s => ({ left: s.title, right: s.content }))
    if (inferred.length >= 3) tableRows = inferred
  }
  const errors: string[] = Array.isArray(r.errors) ? r.errors.map(ss).filter(Boolean) : Array.isArray(r.erroresFrecuentes) ? (r.erroresFrecuentes as unknown[]).map(ss).filter(Boolean) : []
  return { title: ss(r.title) || 'LINGORA Schema', objective: ss(r.objective), block: ss(r.block) || 'LINGORA', keyConcepts: sa(r.keyConcepts), subtopics, quiz, tableRows, summary: ss(r.summary) || ss(r.globalTakeaway) || ss(r.keyTakeaway), examples: sa(r.examples), errors }
}

export function fmt(t: string): string {
  if (!t) return ''
  let s = t.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')
  s = s.replace(
    /\|(.+)\|\n\|([-| :]+)\|\n((?:\|.+\|\n?)+)/g,
    (_match, header, _sep, body) => {
      const ths = header.split('|').filter((c: string) => c.trim())
        .map((h: string) => `<th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:800;color:var(--teal);letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid rgba(0,201,167,.2);white-space:nowrap">${h.trim()}</th>`).join('')
      const trs = body.trim().split('\n').map((row: string) => {
        const cells = row.split('|').filter((c: string) => c !== undefined && row.includes('|'))
          .filter((_: string, i: number, arr: string[]) => i > 0 && i < arr.length)
          .map((c: string) => `<td style="padding:7px 10px;color:var(--silver);border-bottom:1px solid rgba(255,255,255,.04)">${c.trim()}</td>`).join('')
        return `<tr>${cells}</tr>`
      }).join('')
      return `<div style="overflow-x:auto;margin:8px 0"><table style="width:100%;border-collapse:collapse;font-size:13px;background:rgba(255,255,255,.02);border-radius:10px;overflow:hidden"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`
    }
  )
  s = s.replace(/^### (.+)$/gm, '<div style="font-size:13px;font-weight:800;color:var(--teal);margin:10px 0 4px;letter-spacing:.04em;text-transform:uppercase">$1</div>')
  s = s.replace(/^## (.+)$/gm,  '<div style="font-size:15px;font-weight:800;color:#fff;margin:12px 0 6px">$1</div>')
  s = s.replace(/^# (.+)$/gm,   '<div style="font-size:17px;font-weight:800;color:#fff;margin:14px 0 8px">$1</div>')
  s = s.replace(/((?:^- .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map((line: string) => `<li style="margin:3px 0;color:var(--silver)">${line.replace(/^- /, '')}</li>`).join('')
    return `<ul style="margin:6px 0 6px 16px;padding:0;list-style:none">${items}</ul>`
  })
  s = s.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    let n = 0
    const items = block.trim().split('\n').map((line: string) => { n++; return `<li style="margin:3px 0;color:var(--silver)"><span style="color:var(--teal);font-weight:700;margin-right:6px">${n}.</span>${line.replace(/^\d+\. /, '')}</li>` }).join('')
    return `<ol style="margin:6px 0 6px 8px;padding:0;list-style:none">${items}</ol>`
  })
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;font-weight:700">$1</strong>')
  s = s.replace(/\*(.+?)\*/g,     '<em style="color:var(--silver);font-style:italic">$1</em>')
  s = s.replace(/`(.+?)`/g,       '<code style="background:rgba(0,0,0,.4);padding:1px 6px;border-radius:4px;font-family:monospace;font-size:.86em;color:#7dd3fc">$1</code>')
  s = s.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:10px 0">')
  s = s.replace(/\n/g, '<br>')
  return s
}

export function Badge({ children, t = 'd' }: { children: ReactNode; t?: 'd'|'teal'|'gold'|'purple'|'coral' }) {
  const s = { d:{ color:'var(--muted)',bg:'var(--card)',br:'1px solid var(--border)'}, teal:{color:'var(--teal)',bg:'rgba(0,201,167,.1)',br:'1px solid rgba(0,201,167,.22)'}, gold:{color:'var(--gold)',bg:'rgba(245,200,66,.1)',br:'1px solid rgba(245,200,66,.22)'}, purple:{color:'#c4b5fd',bg:'rgba(124,58,237,.14)',br:'1px solid rgba(124,58,237,.24)'}, coral:{color:'var(--coral)',bg:'rgba(255,107,107,.1)',br:'1px solid rgba(255,107,107,.22)'} }[t]
  return <span style={{ fontSize:11, padding:'4px 10px', borderRadius:999, fontWeight:700, color:s.color, background:s.bg, border:s.br }}>{children}</span>
}

export function SL({ children }: { children: ReactNode }) {
  return <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--muted)', marginBottom:10 }}>{children}</div>
}

export function TableBlock({ rows }: { rows: TableRow[] }) {
  if (!rows.length) return null
  const content = { columns: ['Forma', 'Valor'], rows: rows.map(r => [r.left, r.right]), tone: 'comparison' as const }
  return <TableArtifactBlock content={content} />
}

export function QuizBlock({ quiz }: { quiz: QuizQ[] }) {
  const [ans, setAns] = useState<Record<number, number|null>>({})
  if (!quiz.length) return null
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {quiz.map((q, qi) => {
        const sel = ans[qi] ?? null; const done = sel !== null
        return (
          <div key={qi} style={{ border:'1px solid var(--border)', borderRadius:14, padding:14, background:'rgba(255,255,255,.02)' }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#fff', marginBottom:10, lineHeight:1.5 }}>{qi+1}. {q.question}</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {q.options.map((opt, oi) => {
                const isSel = oi === sel
                let bg='transparent', bc='var(--border)', col='var(--silver)'
                if (done) {
                  const isOk = oi === q.correct
                  if (isOk)           { bg='rgba(0,201,167,.12)'; bc='var(--teal)'; col='var(--teal)' }
                  if (isSel && !isOk) { bg='rgba(255,107,107,.1)'; bc='var(--coral)'; col='var(--coral)' }
                }
                return <button key={oi} disabled={done} onClick={() => setAns(p => ({...p,[qi]:oi}))} style={{ textAlign:'left', padding:'9px 12px', borderRadius:10, border:`1px solid ${bc}`, background:bg, color:col, cursor:done?'default':'pointer', fontSize:13, fontWeight:600 }}>{'ABCD'[oi]}) {opt}</button>
              })}
            </div>
            {done && (
              <div style={{ marginTop:8, fontSize:12, fontWeight:700, display:'flex', flexDirection:'column', gap:4 }}>
                {sel === q.correct
                  ? <span style={{ color:'var(--teal)' }}>✅ Correcto</span>
                  : <span style={{ color:'var(--coral)' }}>❌ Incorrecto — la respuesta correcta es: <strong style={{ color:'#fff' }}>{q.options[q.correct]}</strong></span>}
                {q.explanation && <span style={{ color:'var(--muted)', fontWeight:400, fontSize:11 }}>{q.explanation}</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function SchemaBlock({ content }: { content: Record<string, unknown> }) {
  const s = useMemo(() => normSchema(content), [content])
  const exportTxt = () => {
    const lines = ['LINGORA Schema', s.title, '', s.objective, '', s.keyConcepts.length ? 'Conceptos: ' + s.keyConcepts.join(', ') : '', '', ...s.tableRows.map(r => `${r.left}: ${r.right}`), '', ...s.subtopics.map(sub => `${sub.title}\n${sub.content}${sub.keyTakeaway ? '\n80/20: ' + sub.keyTakeaway : ''}`), '', ...s.examples, '', s.summary ? '80/20: ' + s.summary : '', '', '--- SIMULACRO ---', ...s.quiz.map((q,i) => `${i+1}. ${q.question}\n${q.options.map((o,oi) => `  ${'ABCD'[oi]}) ${o}${oi===q.correct?' ✓':''}`).join('\n')}`)].filter(Boolean)
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain'})); a.download = 'lingora-schema.txt'; a.click()
  }
  return (
    <div style={{ marginTop:10, width:'100%', maxWidth:580, borderRadius:20, overflow:'hidden', background:'linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.018))', border:'1px solid var(--border)', boxShadow:'0 12px 36px rgba(0,0,0,.22)' }}>
      <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, background:'rgba(255,255,255,.02)' }}>
        <Badge t="purple">{s.block}</Badge>
        <div style={{ display:'flex', gap:5 }}>
          {s.tableRows.length > 0 && <Badge t="gold">Tabla</Badge>}
          {s.quiz.length > 0      && <Badge t="teal">Simulacro</Badge>}
          {s.examples.length > 0  && <Badge t="d">Ejemplos</Badge>}
        </div>
      </div>
      <div style={{ padding:16, display:'flex', flexDirection:'column', gap:16 }}>
        <div>
          <div style={{ fontSize:21, fontWeight:800, color:'#fff', marginBottom:6, lineHeight:1.15, fontFamily:'"DM Serif Display",serif' }}>{s.title}</div>
          {s.objective && <div style={{ fontSize:14, lineHeight:1.65, color:'var(--muted)' }}>{s.objective}</div>}
        </div>
        {s.keyConcepts.length > 0 && <div><SL>Conceptos clave</SL><div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>{s.keyConcepts.map((c,i) => <Badge key={i} t="teal">{c}</Badge>)}</div></div>}
        {s.tableRows.length > 0 && <div><SL>Cuadro visual</SL><TableBlock rows={s.tableRows} /></div>}
        {s.subtopics.length > 0 && (
          <div><SL>Desarrollo</SL>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {s.subtopics.map((sub, i) => (
                <div key={i} style={{ border:'1px solid var(--border)', borderRadius:14, padding:14, background:'rgba(255,255,255,.02)' }}>
                  <div style={{ fontSize:14, fontWeight:800, color:'#fff', marginBottom:5 }}>{sub.title}</div>
                  <div style={{ fontSize:14, lineHeight:1.65, color:'var(--silver)' }}>{sub.content}</div>
                  {sub.keyTakeaway && <div style={{ marginTop:7, fontSize:12, color:'var(--teal)', fontWeight:700 }}>🎯 80/20: {sub.keyTakeaway}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        {s.examples.length > 0 && (
          <div><SL>Ejemplos</SL>
            <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
              {s.examples.map((ex, i) => <div key={i} style={{ fontSize:14, lineHeight:1.6, color:'#fff', padding:'9px 12px', borderRadius:12, background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.05)' }}>{ex}</div>)}
            </div>
          </div>
        )}
        {s.errors?.length > 0 && (
          <div style={{ background:'linear-gradient(180deg,rgba(255,107,107,.09),rgba(255,107,107,.04))', border:'1px solid rgba(255,107,107,.22)', borderRadius:14, padding:14 }}>
            <SL>⚠️ Errores frecuentes</SL>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {s.errors.map((e, i) => (
                <div key={i} style={{ fontSize:13, color:'var(--coral)', display:'flex', gap:6, alignItems:'flex-start' }}>
                  <span style={{ flexShrink:0 }}>❌</span><span>{e}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {s.summary && (
          <div style={{ background:'linear-gradient(180deg,rgba(0,201,167,.09),rgba(0,201,167,.04))', border:'1px solid rgba(0,201,167,.22)', borderRadius:14, padding:14 }}>
            <SL>Regla 80/20</SL>
            <div style={{ fontSize:14, lineHeight:1.6, color:'#fff' }}>🧠 {s.summary}</div>
          </div>
        )}
        {s.quiz.length > 0 && <div><SL>Simulacro interactivo</SL><QuizBlock quiz={s.quiz} /></div>}
        <div style={{ paddingTop:4, borderTop:'1px solid rgba(255,255,255,.05)' }}>
          <button onClick={exportTxt} style={{ background:'none', border:'none', color:'var(--teal)', fontWeight:700, fontSize:13, cursor:'pointer', padding:0 }}>↓ Exportar esquema (.txt)</button>
        </div>
      </div>
    </div>
  )
}

export function TableArtifactBlock({ content }: { content: Record<string, unknown> }) {
  const c = content as { title?: string; subtitle?: string; columns: string[]; rows: string[][]; tone?: string }
  if (!c.columns?.length || !c.rows?.length) return null
  const toneColors: Record<string, string> = { comparison:'#0891b2', conjugation:'#7c3aed', vocabulary:'#00c9a7', exam:'#d97706' }
  const accentColor = toneColors[c.tone ?? 'comparison'] ?? 'var(--teal)'
  return (
    <div style={{ marginTop:10, width:'100%', maxWidth:580, borderRadius:16, overflow:'hidden', border:`1px solid ${accentColor}33`, background:'rgba(255,255,255,.03)' }}>
      {(c.title || c.subtitle) && (
        <div style={{ padding:'10px 14px', borderBottom:`1px solid ${accentColor}22`, background:`${accentColor}0d` }}>
          {c.title   && <div style={{ fontSize:14, fontWeight:800, color:'#fff' }}>{c.title}</div>}
          {c.subtitle && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{c.subtitle}</div>}
        </div>
      )}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:`${accentColor}15` }}>
              {c.columns.map((col, i) => (
                <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontWeight:700, color:accentColor, fontSize:11, letterSpacing:'.06em', textTransform:'uppercase', borderBottom:`1px solid ${accentColor}22`, whiteSpace:'nowrap' }}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.rows.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: ri < c.rows.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none', background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)' }}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ padding:'9px 12px', color: ci === 0 ? 'var(--silver)' : 'var(--muted)', fontWeight: ci === 0 ? 600 : 400, verticalAlign:'top' }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
