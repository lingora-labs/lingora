'use client'

import { useState } from 'react'
import Link from 'next/link'

const NAV_LINKS = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Mentors',      href: '#mentors' },
  { label: 'Programs',     href: '#programs' },
]

const MENTORS = [
  { emoji: '📚', code: 'SR', name: 'Sarah',  color: '#7c3aed', bg: 'rgba(124,58,237,.12)',
    title: 'Academic mentor',
    desc: 'Sarah guides you with pedagogical rigor. Grammar, official exams, and structural clarity — delivered with warmth, never coldness.',
    tags: ['DELE prep', 'CCSE', 'Grammar', 'Structure'] },
  { emoji: '🌍', code: 'AX', name: 'Alex',   color: '#0891b2', bg: 'rgba(8,145,178,.12)',
    title: 'Cultural mentor',
    desc: 'Alex connects language with experience. Real situations, cultural depth, and the kind of confidence that only comes from actually using Spanish.',
    tags: ['Travel Spanish', 'Cultural immersion', 'Conversation', 'Confidence'] },
  { emoji: '💼', code: 'NK', name: 'Nick',   color: '#d97706', bg: 'rgba(217,119,6,.12)',
    title: 'Business mentor',
    desc: 'Nick prepares you for the Spanish-speaking professional world. Emails, meetings, interviews, and negotiations — in the register that delivers results.',
    tags: ['Business emails', 'Job interviews', 'Negotiations', 'Corporate Spanish'] },
]

const ARTIFACTS = [
  { icon: '📋', title: 'Visual schemas',      desc: 'Structured study sheets: conjugation tables, key concepts, 80/20 rules.',  tag: 'Schema' },
  { icon: '🎯', title: 'Interactive quizzes', desc: 'Exam-style questions with instant feedback. UNED, DELE, CCSE format.',      tag: 'Simulacro' },
  { icon: '🖼️', title: 'Educational images',  desc: 'AI-generated visual infographics for cultural and linguistic topics.',       tag: 'Illustration' },
  { icon: '📄', title: 'Study PDFs',          desc: 'Downloadable guides generated from your conversation.',                     tag: 'PDF' },
  { icon: '🎤', title: 'Voice input',          desc: 'Speak to your mentor. Whisper transcribes, the tutor responds.',           tag: 'Audio in' },
  { icon: '🔊', title: 'Audio feedback',       desc: 'The tutor responds with voice. Natural pronunciation, native pace.',       tag: 'TTS' },
  { icon: '📎', title: 'Document analysis',   desc: 'Upload exercises, notes, or PDFs. The tutor reads and corrects them.',     tag: 'OCR' },
  { icon: '💾', title: 'Chat export',          desc: 'Download your full session as TXT or print-to-PDF at any moment.',         tag: 'Export' },
]

const PROGRAMS = [
  { flag: '🇪🇸', dest: 'Spain',    cities: 'Barcelona · Madrid · Seville', color: '#0891b2',
    label: 'First-time immersion · European comfort',
    items: ['Curated hotels and stays', 'Cultural and historical activities', 'Certified local operators', 'Max 12 participants per cohort'] },
  { flag: '🇺🇸', dest: 'Miami',    cities: 'Business track · US-based',    color: '#ff6b6b',
    label: 'Business Spanish · Professionals · Networking',
    items: ['Business conversation labs', 'Real professional scenarios', 'Certified business partners', 'Max 12 participants per cohort'] },
  { flag: '🇨🇴', dest: 'Colombia', cities: 'Medellín · Cartagena',         color: '#f5c842',
    label: 'Latin immersion · Culture · Value',
    items: ['Curated safe regions only', 'Cultural and social activities', 'Certified local operators', 'Max 12 participants per cohort'] },
]

const STATS = [
  { n: '10', label: 'Interface languages' },
  { n: '3',  label: 'Specialist mentors' },
  { n: '7',  label: 'Learning modes' },
  { n: '3',  label: 'Immersion destinations' },
]

function NavLink({ href, label }: { href: string; label: string }) {
  const [hov, setHov] = useState(false)
  return (
    <a href={href}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ fontSize: 14, color: hov ? '#fff' : 'var(--muted)', fontWeight: 500, textDecoration: 'none', transition: 'color .18s' }}>
      {label}
    </a>
  )
}

export default function Home() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        :root {
          --navy:#080f1f; --navy2:#0c1626; --navy3:#112039;
          --teal:#00c9a7; --coral:#ff6b6b; --gold:#f5c842;
          --silver:rgba(255,255,255,.88); --muted:rgba(255,255,255,.48);
          --dim:rgba(255,255,255,.22); --border:rgba(255,255,255,.08);
          --card:rgba(255,255,255,.04);
        }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
        html { font-size: 16px; scroll-behavior: smooth }
        body { font-family: 'DM Sans', system-ui, sans-serif; background: var(--navy); color: var(--silver); overflow-x: hidden; line-height: 1.6 }
        ::-webkit-scrollbar { width: 5px }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 999px }
        a { text-decoration: none; color: inherit }
        @keyframes fadeUp { from { opacity:0; transform:translateY(22px) } to { opacity:1; transform:translateY(0) } }
        @keyframes glow { 0%,100%{opacity:.55} 50%{opacity:1} }
        .fu { animation: fadeUp .65s cubic-bezier(.22,1,.36,1) both }
        .d1{animation-delay:.1s} .d2{animation-delay:.2s} .d3{animation-delay:.3s} .d4{animation-delay:.4s}
      `}</style>

      <div style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -5%,rgba(0,201,167,.11) 0%,transparent 60%),radial-gradient(ellipse 50% 35% at 85% 85%,rgba(245,200,66,.05) 0%,transparent 55%),var(--navy)', minHeight: '100vh' }}>

        {/* ── NAV ─────────────────────────────────── */}
        <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200, background: 'rgba(8,15,31,.85)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ maxWidth: 1120, margin: '0 auto', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
            <span style={{ fontFamily: '"DM Serif Display",serif', fontSize: 22, fontWeight: 400, background: 'linear-gradient(135deg,#fff 35%,var(--teal))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              LINGORA
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              {NAV_LINKS.map(l => <NavLink key={l.label} {...l} />)}
              <Link href="/beta" style={{ background: 'var(--teal)', color: 'var(--navy)', fontWeight: 700, fontSize: 13, padding: '8px 20px', borderRadius: 999, letterSpacing: '.02em' }}>
                Try free
              </Link>
            </div>
          </div>
        </nav>

        {/* ── HERO ─────────────────────────────────── */}
        <section style={{ paddingTop: 148, paddingBottom: 112, textAlign: 'center', position: 'relative' }}>
          <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 24px' }}>
            <div className="fu" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderRadius: 999, background: 'rgba(0,201,167,.1)', border: '1px solid rgba(0,201,167,.22)', fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: '.09em', textTransform: 'uppercase', marginBottom: 36 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)', flexShrink: 0, animation: 'glow 2.2s infinite' }} />
              Cultural Institute · AI-Powered Spanish
            </div>

            <h1 className="fu d1" style={{ fontFamily: '"DM Serif Display",serif', fontSize: 'clamp(3.2rem,7.5vw,5.8rem)', fontWeight: 400, letterSpacing: '-.035em', lineHeight: 1.04, color: '#fff', marginBottom: 28 }}>
              Learn Spanish.<br />
              <span style={{ fontStyle: 'italic', background: 'linear-gradient(130deg,var(--teal) 20%,#38bdf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Live the culture.
              </span>
            </h1>

            <p className="fu d2" style={{ fontSize: 'clamp(15px,2.2vw,19px)', color: 'var(--muted)', lineHeight: 1.75, maxWidth: 560, margin: '0 auto 44px', fontWeight: 300 }}>
              Conversational AI that turns progress into real-world cultural immersion. Three specialist mentors, adaptive visual schemas, and a direct path to Spain, Miami, and Colombia.
            </p>

            <div className="fu d3" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 64 }}>
              <Link href="/beta" style={{ background: 'var(--teal)', color: 'var(--navy)', fontWeight: 800, fontSize: 16, padding: '15px 38px', borderRadius: 999, display: 'inline-block', letterSpacing: '.01em', boxShadow: '0 0 32px rgba(0,201,167,.22)' }}>
                Start learning free →
              </Link>
              <a href="#how-it-works" style={{ background: 'transparent', color: 'var(--silver)', fontWeight: 600, fontSize: 16, padding: '15px 28px', borderRadius: 999, border: '1px solid var(--border)', display: 'inline-block' }}>
                See how it works
              </a>
            </div>

            {/* Stats row */}
            <div className="fu d4" style={{ display: 'flex', gap: 32, justifyContent: 'center', flexWrap: 'wrap' }}>
              {STATS.map(s => (
                <div key={s.n} style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: '"DM Serif Display",serif', fontSize: 26, color: 'var(--teal)', marginBottom: 2 }}>{s.n}</div>
                  <div style={{ fontSize: 11, color: 'var(--dim)', letterSpacing: '.05em', textTransform: 'uppercase' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ─────────────────────────── */}
        <section id="how-it-works" style={{ padding: '100px 24px', borderTop: '1px solid var(--border)' }}>
          <div style={{ maxWidth: 1120, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 60 }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 12 }}>The LINGORA way</p>
              <h2 style={{ fontFamily: '"DM Serif Display",serif', fontSize: 'clamp(2.2rem,4vw,3.2rem)', color: '#fff', fontWeight: 400 }}>Three layers. One journey.</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18 }}>
              {[
                { num:'01', icon:'🤖', title:'Learn',      color:'var(--teal)', desc:'Adaptive AI conversation that adjusts to your level in real time. Your mentor corrects, explains, and challenges you — in your language, at your pace.', items:['Adaptive difficulty','Grammar feedback','Cultural context','9 interface languages'] },
                { num:'02', icon:'🌐', title:'Connect',    color:'#38bdf8',    desc:'Visual schemas, quizzes, and structured study material that deepen your understanding before you travel. The language becomes intuitive, not memorized.', items:['Visual schemas','Interactive quizzes','DELE/CCSE prep','Level diagnostics'] },
                { num:'03', icon:'✈️', title:'Experience', color:'var(--gold)', desc:'Curated immersion programs in Spain, Miami, and Colombia. Certified operators, mandatory insurance, small cohorts of max 12 participants.', items:['Spain · Miami · Colombia','Certified operators','From $1,500 / program','Max 12 participants'] },
              ].map(s => (
                <div key={s.num} style={{ background: 'var(--navy2)', border: '1px solid var(--border)', borderRadius: 22, padding: '30px 26px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 16, right: 20, fontFamily: '"DM Serif Display",serif', fontSize: 68, color: 'rgba(255,255,255,.025)', lineHeight: 1 }}>{s.num}</div>
                  <div style={{ fontSize: 30, marginBottom: 16 }}>{s.icon}</div>
                  <h3 style={{ fontFamily: '"DM Serif Display",serif', fontSize: 26, color: s.color, fontWeight: 400, marginBottom: 12 }}>{s.title}</h3>
                  <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 20 }}>{s.desc}</p>
                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {s.items.map(i => (
                      <li key={i} style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.color, flexShrink: 0 }} />{i}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── MENTORS ──────────────────────────────── */}
        <section id="mentors" style={{ padding: '100px 24px', background: 'var(--navy2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ maxWidth: 1120, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 60 }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 12 }}>Your guide</p>
              <h2 style={{ fontFamily: '"DM Serif Display",serif', fontSize: 'clamp(2.2rem,4vw,3.2rem)', color: '#fff', fontWeight: 400 }}>Three specialists. One platform.</h2>
              <p style={{ fontSize: 15, color: 'var(--muted)', maxWidth: 460, margin: '14px auto 0' }}>Each mentor is designed for a different goal. All respond in your language.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18 }}>
              {MENTORS.map(m => (
                <div key={m.name} style={{ background: 'var(--navy3)', border: '1px solid var(--border)', borderRadius: 22, padding: '30px 26px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                    <div style={{ width: 54, height: 54, borderRadius: '50%', background: m.bg, border: `1.5px solid ${m.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{m.emoji}</div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: m.color, marginBottom: 2 }}>{m.code} · LINGORA</div>
                      <div style={{ fontFamily: '"DM Serif Display",serif', fontSize: 22, color: '#fff', fontWeight: 400 }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.title}</div>
                    </div>
                  </div>
                  <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 18, flex: 1 }}>{m.desc}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {m.tags.map(t => (
                      <span key={t} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: m.bg, color: m.color, fontWeight: 700 }}>{t}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── ARTIFACTS ────────────────────────────── */}
        <section style={{ padding: '100px 24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ maxWidth: 1120, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 60 }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 12 }}>What the tutor produces</p>
              <h2 style={{ fontFamily: '"DM Serif Display",serif', fontSize: 'clamp(2.2rem,4vw,3.2rem)', color: '#fff', fontWeight: 400 }}>Not just chat. Real learning material.</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 14 }}>
              {ARTIFACTS.map(a => (
                <div key={a.title} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: 24 }}>{a.icon}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, background: 'rgba(0,201,167,.1)', color: 'var(--teal)', border: '1px solid rgba(0,201,167,.2)' }}>{a.tag}</span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 6 }}>{a.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>{a.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PROGRAMS ─────────────────────────────── */}
        <section id="programs" style={{ padding: '100px 24px', background: 'var(--navy2)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ maxWidth: 1120, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 60 }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 12 }}>Immersion programs</p>
              <h2 style={{ fontFamily: '"DM Serif Display",serif', fontSize: 'clamp(2.2rem,4vw,3.2rem)', color: '#fff', fontWeight: 400 }}>Progress becomes a passport.</h2>
              <p style={{ fontSize: 15, color: 'var(--muted)', maxWidth: 460, margin: '14px auto 0' }}>The AI tutor is the first step. The destination is real.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18, marginBottom: 28 }}>
              {PROGRAMS.map(p => (
                <div key={p.dest} style={{ background: 'var(--navy3)', border: '1px solid var(--border)', borderRadius: 22, overflow: 'hidden' }}>
                  <div style={{ height: 96, background: `linear-gradient(135deg,var(--navy) 0%,${p.color}3a 100%)`, display: 'flex', alignItems: 'flex-end', padding: '0 22px 16px', position: 'relative' }}>
                    <span style={{ position: 'absolute', top: 14, right: 18, fontSize: 30, opacity: .75 }}>{p.flag}</span>
                    <div>
                      <div style={{ fontFamily: '"DM Serif Display",serif', fontSize: 24, color: '#fff', fontWeight: 400 }}>{p.dest}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.cities}</div>
                    </div>
                  </div>
                  <div style={{ padding: '18px 22px 24px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: p.color, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 12 }}>{p.label}</div>
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 18 }}>
                      {p.items.map(i => (
                        <li key={i} style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <span style={{ color: 'var(--teal)', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>{i}
                        </li>
                      ))}
                    </ul>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: '"DM Serif Display",serif', fontSize: 20, color: '#fff' }}>from $1,500</span>
                      <Link href="/beta" style={{ background: 'var(--teal)', color: 'var(--navy)', fontWeight: 700, fontSize: 13, padding: '9px 18px', borderRadius: 999 }}>Reserve</Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {/* Safety disclaimer */}
            <div style={{ background: 'rgba(255,255,255,.025)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>🛡️</span>
              <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.65 }}>
                All programs are executed by <strong style={{ color: 'var(--silver)' }}>certified operators</strong>. Mandatory travel insurance is required. We apply a <strong style={{ color: 'var(--silver)' }}>safety-first policy</strong> for partner and region selection. Pre-seed — first cohorts forming now.
              </p>
            </div>
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────── */}
        <section style={{ padding: '124px 24px', textAlign: 'center' }}>
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            <h2 style={{ fontFamily: '"DM Serif Display",serif', fontSize: 'clamp(2.8rem,5.5vw,4.2rem)', color: '#fff', fontWeight: 400, letterSpacing: '-.03em', lineHeight: 1.06, marginBottom: 22 }}>
              Speak Spanish like<br />
              <span style={{ fontStyle: 'italic', color: 'var(--teal)' }}>you belong there.</span>
            </h2>
            <p style={{ fontSize: 17, color: 'var(--muted)', marginBottom: 42, lineHeight: 1.75, fontWeight: 300 }}>
              Not just words — confidence, tone, and cultural intuition. Start with the AI tutor. End with an experience.
            </p>
            <Link href="/beta" style={{ background: 'var(--teal)', color: 'var(--navy)', fontWeight: 800, fontSize: 17, padding: '17px 46px', borderRadius: 999, display: 'inline-block', letterSpacing: '.01em', boxShadow: '0 0 40px rgba(0,201,167,.24)' }}>
              Start learning free →
            </Link>
            <div style={{ marginTop: 18, fontSize: 13, color: 'var(--dim)' }}>No credit card. 10 languages. 3 mentors. Free forever.</div>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────── */}
        <footer style={{ borderTop: '1px solid var(--border)', padding: '36px 24px', background: '#050b15' }}>
          <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <span style={{ fontFamily: '"DM Serif Display",serif', fontSize: 18, background: 'linear-gradient(135deg,#fff 35%,var(--teal))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>LINGORA</span>
            <p style={{ fontSize: 12, color: 'var(--dim)' }}>© 2026 LINGORA · Pre-seed · First cohorts forming · Learn Spanish. Live the culture.</p>
            <div style={{ display: 'flex', gap: 20 }}>
              {['Privacy', 'Terms', 'Safety'].map(l => <a key={l} href="#" style={{ fontSize: 12, color: 'var(--dim)' }}>{l}</a>)}
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}
