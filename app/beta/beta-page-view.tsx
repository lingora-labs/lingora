'use client'
import React from 'react'
import { chromeLessonLabel, chromeLevelLabel } from './chrome-gate'
import { MENTOR_META, TOPIC_META, LANG_GRID, TOPIC_KEYS, MENTOR_KEYS, type ActiveMode } from './beta-model'
import { Bubble, Typing } from './beta-chat-ui'
import { doExportTxt, doExportPdfBackend } from './beta-io'
import { useBetaPage } from './use-beta-page'

export default function BetaPageView() {
  const {
    phase, setPhase, splashMsg, splashRev, lang, setLang, mentor, setMentor, topic, setTopic,
    msgs, input, setInput, loading, recording, showExport, setShowExport, activeMode, setActiveMode,
    pendingAudioBlob, pendingAudioUrl, pendingFiles, setPendingFiles, setPendingAudioUrl, setPendingAudioBlob,
    fileInputRef, session, msgsEndRef, taRef, mm, copy, sendComposer, startChat, selectMode, toggleRec, handleFile,
  } = useBetaPage()
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700;800&display=swap');
        :root { --navy:#080f1f; --navy2:#0d1828; --navy3:#132035; --teal:#00c9a7; --coral:#ff6b6b; --gold:#f5c842; --silver:rgba(255,255,255,.88); --muted:rgba(255,255,255,.50); --dim:rgba(255,255,255,.22); --border:rgba(255,255,255,.08); --card:rgba(255,255,255,.04); }
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0 }
        html, body { height:100%; overflow:hidden }
        body { font-family:'DM Sans',system-ui,sans-serif; background:radial-gradient(circle at top,#0a1730 0%,#081120 55%,#050b15 100%); color:var(--silver); }
        @keyframes tdot { 0%,60%,100%{opacity:.3;transform:translateY(0)} 30%{opacity:1;transform:translateY(-4px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
        @keyframes artifactIn { from{opacity:0;transform:translateY(12px) scale(.98)} to{opacity:1;transform:translateY(0) scale(1)} }
        .fade-up { animation: fadeUp .5s cubic-bezier(.22,1,.36,1) both }
        .artifact-in { animation: artifactIn .4s cubic-bezier(.22,1,.36,1) both }
        ::-webkit-scrollbar { width:5px } ::-webkit-scrollbar-thumb { background:var(--border); border-radius:999px }
        textarea:focus, button:focus, input:focus, select:focus { outline:none }
      `}</style>
      {phase === 'mode' && (
        <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 20px', gap:24 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:42, height:42, borderRadius:'50%', background:mm.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:800, color:'#fff' }}>{mm.code}</div>
            <div>
              <div style={{ fontSize:16, fontWeight:800, color:'#fff' }}>{mm.name}</div>
              <div style={{ fontSize:12, color:'var(--muted)' }}>{mm.spec}</div>
            </div>
          </div>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:20, fontWeight:800, color:'#fff', marginBottom:6 }}>¿Cómo quieres aprender?</div>
            <div style={{ fontSize:13, color:'var(--muted)' }}>Elige el modo. El tutor se adapta desde el primer mensaje.</div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10, width:'100%', maxWidth:420 }}>
            {([
              { key:'interact' as ActiveMode, emoji:'\u{1F9E0}', title:'Interacción inteligente', desc:'Respuestas ricas con tablas, esquemas y explicación accionable.' },
              { key:'structured' as ActiveMode, emoji:'\u{1F393}', title:'Curso estructurado', desc:'Esquema, ejemplos, simulacro y puntuación.' },
              { key:'pdf_course' as ActiveMode, emoji:'\u{1F4C4}', title:'Curso PDF con entregas', desc:'Material descargable. Entregas y corrección por el tutor.' },
              { key:'free' as ActiveMode, emoji:'\u{1F4AC}', title:'Conversación libre', desc:'Habla con naturalidad. Correcciones oportunistas.' },
            ] as Array<{key:ActiveMode;emoji:string;title:string;desc:string}>).map(({ key, emoji, title, desc }) => (
              <button key={key} onClick={() => selectMode(key)}
                style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', borderRadius:16, border: activeMode === key ? '1px solid rgba(0,201,167,.4)' : '1px solid var(--border)', background: activeMode === key ? 'rgba(0,201,167,.1)' : 'rgba(255,255,255,.02)', cursor:'pointer', textAlign:'left', width:'100%' }}>
                <span style={{ fontSize:22 }}>{emoji}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>{title}</div>
                  <div style={{ fontSize:12, color:'var(--muted)' }}>{desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {phase === 'onboarding' && (
        <div style={{ position:'fixed', inset:0, overflowY:'auto', display:'flex', justifyContent:'center', padding:'32px 20px 48px' }}>
          <div style={{ width:'100%', maxWidth:620 }}>
            <div style={{ textAlign:'center', marginBottom:32 }}>
              <div style={{ fontFamily:'"DM Serif Display",serif', fontSize:'clamp(2.5rem,6vw,3.8rem)', background:'linear-gradient(135deg,#fff 38%,var(--teal))', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>LINGORA</div>
              <div style={{ fontSize:13, color:'var(--muted)' }}>{copy.tg}</div>
            </div>
            <div style={{ background:'rgba(255,255,255,.03)', border:'1px solid var(--border)', borderRadius:24, padding:'28px 24px', display:'flex', flexDirection:'column', gap:28 }}>
              <div>
                <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)', marginBottom:14 }}>{copy.l1}</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(100px,1fr))', gap:8 }}>
                  {LANG_GRID.map(l => (
                    <button key={l.value} onClick={() => setLang(l.value)}
                      style={{ background: lang === l.value ? 'rgba(0,201,167,.12)' : 'var(--card)', border:`1px solid ${lang===l.value?'var(--teal)':'var(--border)'}`, borderRadius:12, padding:'12px 8px', cursor:'pointer' }}>
                      <div style={{ fontSize:22 }}>{l.flag}</div>
                      <div style={{ fontSize:12, fontWeight:700, color: lang===l.value ? 'var(--teal)' : '#fff' }}>{l.label}</div>
                      <div style={{ fontSize:10, color:'var(--dim)' }}>{l.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)', marginBottom:14 }}>{copy.l2}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {TOPIC_KEYS.map((tk, i) => (
                    <button key={tk} onClick={() => setTopic(tk)}
                      style={{ background: topic===tk ? 'rgba(0,201,167,.08)' : 'var(--card)', border:`1px solid ${topic===tk?'var(--teal)':'var(--border)'}`, borderRadius:14, padding:'14px 16px', cursor:'pointer', display:'flex', alignItems:'center', gap:14, textAlign:'left' }}>
                      <span style={{ fontSize:22 }}>{TOPIC_META[tk].emoji}</span>
                      <div>
                        <div style={{ fontWeight:700, fontSize:14, color: topic===tk ? 'var(--teal)' : '#fff' }}>{copy.tn[i]}</div>
                        <div style={{ fontSize:12, color:'var(--muted)' }}>{copy.td[i]}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)', marginBottom:14 }}>{copy.l3}</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
                  {MENTOR_KEYS.map((mk, i) => {
                    const m = MENTOR_META[mk]; const sel = mentor === mk
                    return (
                      <button key={mk} onClick={() => setMentor(mk)}
                        style={{ background: sel ? m.bg : 'var(--card)', border:`2px solid ${sel?m.color:'var(--border)'}`, borderRadius:18, padding:'18px 12px', cursor:'pointer', textAlign:'left' }}>
                        <div style={{ fontSize:26 }}>{m.emoji}</div>
                        <div style={{ fontSize:10, fontWeight:800, color: sel ? m.color : 'var(--dim)' }}>{m.code}</div>
                        <div style={{ fontWeight:800, fontSize:14, color:'#fff' }}>{m.name}</div>
                        <div style={{ fontSize:11, color:'var(--muted)' }}>{copy.md[i]}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
              <button onClick={() => startChat(mentor, topic, lang)} disabled={!lang || !topic || !mentor}
                style={{ background:'var(--teal)', color:'var(--navy)', fontWeight:800, fontSize:16, padding:15, borderRadius:999, border:'none', cursor:'pointer', opacity: (!lang||!topic||!mentor) ? .5 : 1 }}>
                {copy.sb}
              </button>
            </div>
          </div>
        </div>
      )}
      {phase === 'splash' && (
        <div style={{ position:'fixed', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'2rem' }}>
          <div style={{ marginBottom:28, textAlign:'center' }}>
            <div style={{ fontFamily:'"DM Serif Display",serif', fontSize:22, color:'#fff' }}>LINGORA</div>
          </div>
          <p style={{ fontSize:16, color:'var(--muted)', textAlign:'center', maxWidth:400 }}>{splashMsg}</p>
          {splashRev && (
            <div style={{ textAlign:'center', marginTop:24 }}>
              <div style={{ fontSize:28 }}>{mm.emoji}</div>
              <div style={{ color:mm.color, fontSize:11, fontWeight:800 }}>{mm.code}</div>
              <div style={{ fontFamily:'"DM Serif Display",serif', fontSize:24, color:'#fff' }}>{mm.name}</div>
              <div style={{ fontSize:13, color:'var(--muted)' }}>{copy.bio[MENTOR_KEYS.indexOf(mentor)] ?? mm.spec}</div>
            </div>
          )}
        </div>
      )}
      {phase === 'chat' && (
        <div style={{ display:'flex', flexDirection:'column', height:'100dvh', maxWidth:760, margin:'0 auto' }}>
          <div style={{ padding:'13px 18px', background:'rgba(8,17,32,.86)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:42, height:42, borderRadius:'50%', background:mm.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>{mm.emoji}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:15, color:'#fff' }}>{mm.name} <span style={{ fontSize:10, color:mm.color }}>{mm.code}</span></div>
              <div style={{ fontSize:10, color:'var(--muted)' }}>{chromeLessonLabel(session.tokens, session.lessonIndex)}</div>
            </div>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:12, fontWeight:800, color:'var(--teal)' }}>{chromeLevelLabel(session.tokens, session.level)}</div>
              <div style={{ fontSize:9, color:'var(--dim)' }}>nivel</div>
            </div>
            <div style={{ position:'relative' }}>
              <button onClick={() => setShowExport(v => !v)} style={{ fontSize:11, padding:'5px 10px', borderRadius:999, border:'1px solid var(--border)', background:'none', color:'var(--muted)', cursor:'pointer' }}>Export</button>
              {showExport && (
                <div style={{ position:'absolute', top:'115%', right:0, background:'var(--navy2)', border:'1px solid var(--border)', borderRadius:12, padding:'5px 0', zIndex:50, minWidth:160 }}>
                  <button onClick={() => { doExportTxt(msgs); setShowExport(false) }} style={{ display:'block', width:'100%', textAlign:'left', padding:'9px 16px', background:'none', border:'none', color:'var(--silver)', fontSize:13, cursor:'pointer' }}>Exportar TXT</button>
                  <button onClick={() => { void doExportPdfBackend(msgs, session); setShowExport(false) }} style={{ display:'block', width:'100%', textAlign:'left', padding:'9px 16px', background:'none', border:'none', color:'var(--silver)', fontSize:13, cursor:'pointer' }}>Exportar PDF</button>
                </div>
              )}
            </div>
            <button onClick={() => { setActiveMode('interact'); setPhase('onboarding') }} style={{ fontSize:11, padding:'5px 10px', borderRadius:999, border:'1px solid var(--border)', background:'none', color:'var(--muted)', cursor:'pointer' }}>Reset</button>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'20px 16px', display:'flex', flexDirection:'column', gap:14 }}>
            {msgs.map(m => <Bubble key={m.id} msg={m} mc={mm.color} />)}
            {loading && <Typing mc={mm.color} />}
            <div ref={msgsEndRef} />
          </div>
          <div style={{ textAlign:'center', fontSize:11, color:'var(--dim)' }}>{copy.hint}</div>
          <div style={{ borderTop:'1px solid var(--border)', padding:'9px 12px 13px', display:'flex', alignItems:'flex-end', gap:8 }}>
            <button onClick={toggleRec} style={{ width:38, height:38, borderRadius:'50%', border:`1px solid ${recording ? 'var(--coral)' : 'var(--border)'}`, background: recording ? 'rgba(255,107,107,.1)' : 'transparent', color: recording ? 'var(--coral)' : 'var(--muted)', cursor:'pointer' }}>{recording ? 'Stop' : 'Mic'}</button>
            <label style={{ width:38, height:38, borderRadius:'50%', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--muted)' }}>
              +
              <input ref={fileInputRef} type="file" accept="image/*,application/pdf,text/*,audio/*" onChange={handleFile} style={{ display:'none' }} />
            </label>
            <textarea ref={taRef} value={input}
              onChange={e => { setInput(e.target.value); e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,120)+'px' }}
              onKeyDown={e => { if ((e.ctrlKey||e.metaKey) && e.key==='Enter') { e.preventDefault(); void sendComposer() } }}
              placeholder={copy.ph} rows={1}
              style={{ flex:1, background:'var(--navy2)', border:'1px solid var(--border)', borderRadius:14, padding:'10px 14px', fontSize:14, color:'var(--silver)', resize:'none', maxHeight:120, fontFamily:'inherit' }}
            />
            <button onClick={() => void sendComposer()} disabled={loading || (!input.trim() && !pendingAudioBlob && pendingFiles.length === 0)}
              style={{ width:38, height:38, borderRadius:'50%', border:'none', background: loading || (!input.trim() && !pendingAudioBlob && pendingFiles.length === 0) ? 'var(--navy3)' : 'var(--teal)', color: loading || (!input.trim() && !pendingAudioBlob && pendingFiles.length === 0) ? 'var(--muted)' : 'var(--navy)', cursor:'pointer' }}>Go</button>
          </div>
          {pendingAudioUrl && <audio controls src={pendingAudioUrl} style={{ margin:'0 12px 8px', height:28 }} />}
        </div>
      )}
    </>
  )
}
