'use client'

// SEEK 5.0 S1 P0 — restore /beta after the page.tsx blob was reduced to a stub.
// Chrome gated (E-07). Chat talks to /api/chat. Full artifact UI lives in
// artifacts/page_e07_chrome_wired.tsx until the large-blob write channel works.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chromeLessonLabel, chromeLevelLabel } from './chrome-gate'

type MK = 'sarah' | 'alex' | 'nick'
type Lang = 'es' | 'en' | 'no' | 'fr' | 'de' | 'it' | 'pt'
type Phase = 'onboarding' | 'chat'
type ActiveMode = 'interact' | 'structured' | 'pdf_course' | 'free'

const BACKEND_LANG = (l: Lang): string => l

const MENTOR_META: Record<MK, { name: string; code: string; color: string; bg: string }> = {
  sarah: { name: 'Sarah', code: 'SR', color: '#7c3aed', bg: 'rgba(124,58,237,.14)' },
  alex:  { name: 'Alex',  code: 'AX', color: '#0891b2', bg: 'rgba(8,145,178,.14)' },
  nick:  { name: 'Nick',  code: 'NK', color: '#d97706', bg: 'rgba(217,119,6,.14)' },
}

interface Msg {
  id: string
  sender: 'user' | MK | 'ln'
  text: string
  artifact?: Record<string, unknown> | null
}

interface SS {
  lang: Lang
  mentor: MK
  topic: string
  level: string
  tokens: number
  samples: string[]
  sessionId: string
  commercialOffers: unknown[]
  lastTask: string | null
  lastArtifact: string | null
  lessonIndex?: number
  activeMode?: ActiveMode
  currentLessonTopic?: string
  currentExercise?: string
  expectedResponseMode?: 'exercise_answer' | 'free' | 'quiz_answer'
  _exerciseAttemptCount?: number
  tutorPhase?: string
}

function trimStateForPayload(state: Record<string, unknown>): Record<string, unknown> {
  const trimmed = { ...state }
  delete trimmed['artifactRegistry']
  return trimmed
}

export default function BetaPage() {
  const [phase, setPhase] = useState<Phase>('onboarding')
  const [lang, setLang] = useState<Lang>('es')
  const [mentor, setMentor] = useState<MK>('alex')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [session, setSession] = useState<SS>({
    lang: 'es', mentor: 'alex', topic: 'conversation',
    level: 'A0', tokens: 0, samples: [],
    sessionId: 's' + Math.random().toString(36).slice(2),
    commercialOffers: [], lastTask: null, lastArtifact: null,
    activeMode: 'interact',
  })

  const sessionRef = useRef(session)
  const mentorRef = useRef(mentor)
  const langRef = useRef(lang)
  const msgsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { mentorRef.current = mentor }, [mentor])
  useEffect(() => { langRef.current = lang }, [lang])
  useEffect(() => { msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, loading])

  const mm = useMemo(() => MENTOR_META[mentor], [mentor])

  const addMsg = useCallback((msg: Omit<Msg, 'id'>) => {
    setMsgs(prev => [...prev, { ...msg, id: Date.now() + '-' + prev.length }])
  }, [])

  const callAPI = useCallback(async (payload: Record<string, unknown>) => {
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          state: {
            ...trimStateForPayload(sessionRef.current as unknown as Record<string, unknown>),
            mentor: mentorRef.current,
            lang: langRef.current,
            topic: sessionRef.current.topic,
            activeMentor: mentorRef.current,
            activeMode: sessionRef.current.activeMode,
            mentorProfile: mentorRef.current[0].toUpperCase() + mentorRef.current.slice(1),
            interfaceLanguage: BACKEND_LANG(langRef.current),
            currentLessonTopic: sessionRef.current.currentLessonTopic,
            currentExercise: sessionRef.current.currentExercise,
            expectedResponseMode: sessionRef.current.expectedResponseMode,
            _exerciseAttemptCount: sessionRef.current._exerciseAttemptCount,
          },
        }),
      })
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        const streamId = Date.now() + '-stream'
        setMsgs(prev => [...prev, { id: streamId, sender: mentorRef.current, text: '', artifact: null }])
        let accumulated = ''
        let sseBuffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          sseBuffer += decoder.decode(value, { stream: true })
          const sseLines = sseBuffer.split('\n')
          sseBuffer = sseLines.pop() ?? ''
          for (const line of sseLines) {
            if (!line.startsWith('data: ')) continue
            try {
              const parsed = JSON.parse(line.slice(6))
              if (parsed.delta) {
                accumulated += parsed.delta
                setMsgs(prev => prev.map(m => m.id === streamId ? { ...m, text: accumulated } : m))
              }
              if (parsed.done && parsed.state) {
                setSession(s => {
                  const n = { ...s, ...parsed.state, sessionId: s.sessionId }
                  sessionRef.current = n
                  return n
                })
              }
            } catch { /* partial */ }
          }
        }
        return
      }
      if (!res.ok) throw new Error('HTTP_ERROR_' + res.status)
      const data = await res.json()
      if (data.state) {
        setSession(s => {
          const n = { ...s, ...data.state, sessionId: s.sessionId }
          sessionRef.current = n
          return n
        })
      }
      const text: string = data.reply ?? data.message ?? data.content ?? ''
      addMsg({ sender: mentorRef.current, text: text || 'No se recibió respuesta.', artifact: data.artifact ?? null })
    } catch {
      addMsg({ sender: mentorRef.current, text: 'No se pudo completar el turno. El tutor sigue activo.' })
    } finally {
      setLoading(false)
    }
  }, [addMsg])

  const send = useCallback(() => {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    addMsg({ sender: 'user', text: msg })
    void callAPI({ message: msg })
  }, [input, loading, addMsg, callAPI])

  const start = () => {
    setSession(s => {
      const n = { ...s, lang, mentor, tokens: 0, level: 'A0' }
      sessionRef.current = n
      return n
    })
    setPhase('chat')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#07101f', color: '#e8eef6', fontFamily: 'system-ui, sans-serif' }}>
      {phase === 'onboarding' && (
        <div style={{ maxWidth: 520, margin: '0 auto', padding: 32 }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>LINGORA</h1>
          <p style={{ color: '#9aa7b8', marginBottom: 24 }}>Instituto cultural · elige idioma y mentor</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {(['es', 'en', 'no'] as Lang[]).map(l => (
              <button key={l} onClick={() => setLang(l)} style={{ padding: '8px 12px', borderRadius: 999, border: '1px solid #2a3b55', background: lang === l ? '#00c9a7' : 'transparent', color: lang === l ? '#07101f' : '#e8eef6' }}>{l.toUpperCase()}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            {(['sarah', 'alex', 'nick'] as MK[]).map(m => (
              <button key={m} onClick={() => setMentor(m)} style={{ padding: '8px 12px', borderRadius: 999, border: '1px solid #2a3b55', background: mentor === m ? MENTOR_META[m].bg : 'transparent', color: MENTOR_META[m].color }}>{MENTOR_META[m].name}</button>
            ))}
          </div>
          <button onClick={start} style={{ padding: '10px 18px', borderRadius: 12, border: 'none', background: '#00c9a7', color: '#07101f', fontWeight: 700 }}>Comenzar</button>
        </div>
      )}
      {phase === 'chat' && (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
          <div style={{ padding: '13px 18px', borderBottom: '1px solid #1c2a3f', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', background: mm.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{mm.code}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800 }}>{mm.name}</div>
              <div style={{ fontSize: 10, color: '#9aa7b8' }}>{chromeLessonLabel(session.tokens, session.lessonIndex)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#00c9a7' }}>{chromeLevelLabel(session.tokens, session.level)}</div>
              <div style={{ fontSize: 9, color: '#6b7c90' }}>nivel</div>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            {msgs.map(m => (
              <div key={m.id} style={{ marginBottom: 12, textAlign: m.sender === 'user' ? 'right' : 'left' }}>
                <div style={{ display: 'inline-block', maxWidth: '80%', padding: '10px 12px', borderRadius: 12, background: m.sender === 'user' ? '#123' : '#0e1a2c', whiteSpace: 'pre-wrap' }}>{m.text}</div>
              </div>
            ))}
            {loading && <div style={{ color: '#6b7c90', fontSize: 12 }}>…</div>}
            <div ref={msgsEndRef} />
          </div>
          <div style={{ padding: 12, borderTop: '1px solid #1c2a3f', display: 'flex', gap: 8 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send() } }}
              placeholder="Escribe en tu idioma…"
              rows={1}
              style={{ flex: 1, background: '#0e1a2c', border: '1px solid #1c2a3f', borderRadius: 12, padding: '10px 12px', color: '#e8eef6' }}
            />
            <button onClick={send} disabled={loading || !input.trim()} style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: loading || !input.trim() ? '#1c2a3f' : '#00c9a7' }}>▶</button>
          </div>
        </div>
      )}
    </div>
  )
}
