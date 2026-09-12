'use client'
import React, { useState, useRef, useEffect, useCallback, useMemo, type ChangeEvent } from 'react'
import {
  BACKEND_LANG, MENTOR_META, COPY, TSYS,
  type MK, type TK, type Lang, type Phase, type ActiveMode, type Msg, type SS,
} from './beta-model'
import { trimStateForPayload } from './beta-io'

export function useBetaPage() {
  const [phase, setPhase] = useState<Phase>('onboarding')
  const [splashMsg, setSplashMsg] = useState('')
  const [splashRev, setSplashRev] = useState(false)
  const [lang, setLang] = useState<Lang>('en')
  const [mentor, setMentor] = useState<MK>('sarah')
  const [topic, setTopic] = useState<TK>('conversation')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [activeMode, setActiveMode] = useState<ActiveMode>('interact')
  const [pendingAudioBlob, setPendingAudioBlob] = useState<Blob | null>(null)
  const [pendingAudioUrl, setPendingAudioUrl] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<Array<{ name: string; type: string; base64: string; size: number }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [session, setSession] = useState<SS>({
    lang: 'en', mentor: 'sarah', topic: 'conversation',
    level: 'A0', tokens: 0, samples: [],
    sessionId: 's'+Math.random().toString(36).slice(2),
    commercialOffers: [], lastTask: null, lastArtifact: null,
  })
  const sessionRef = useRef<SS>(session)
  const mentorRef = useRef<MK>(mentor)
  const langRef = useRef<Lang>(lang)
  const topicRef = useRef<TK>(topic)
  const msgsEndRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const mrRef = useRef<MediaRecorder|null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mm = useMemo(() => MENTOR_META[mentor], [mentor])
  const copy = useMemo(() => COPY[lang] ?? COPY.en, [lang])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { mentorRef.current = mentor }, [mentor])
  useEffect(() => { langRef.current = lang }, [lang])
  useEffect(() => { topicRef.current = topic }, [topic])
  useEffect(() => { msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, loading])
  useEffect(() => {
    try {
      const sv = localStorage.getItem('lng1010')
      if (sv) {
        const p = JSON.parse(sv) as Partial<SS>
        if (p.lang) setLang(p.lang)
        if (p.mentor) setMentor(p.mentor as MK)
        if (p.topic) setTopic(p.topic as TK)
        if (p.activeMode) setActiveMode(p.activeMode as ActiveMode)
        setSession(s => ({
          ...s,
          lang: p.lang ?? s.lang,
          mentor: p.mentor ?? s.mentor,
          topic: p.topic ?? s.topic,
          activeMode: (p.activeMode ?? s.activeMode) as ActiveMode | undefined,
          tokens: 0, level: 'A0', samples: [], tutorPhase: 'guide', tutorMode: undefined,
          lessonIndex: undefined, courseActive: false, lastAction: null, awaitingQuizAnswer: false,
          learningStage: undefined, currentModule: 0, score: undefined, pdfCourseActive: false,
          currentLessonTopic: undefined, currentExercise: undefined, expectedResponseMode: undefined,
          _exerciseAttemptCount: undefined, lastTask: null, lastArtifact: null, commercialOffers: [],
          sessionId: 's'+Math.random().toString(36).slice(2),
        }))
      }
    } catch {}
  }, [])
  useEffect(() => { try { localStorage.setItem('lng1010', JSON.stringify(session)) } catch {} }, [session])
  const addMsg = useCallback((m: Omit<Msg,'id'>) => {
    setMsgs(prev => [...prev, { ...m, id: Date.now()+'-'+Math.random().toString(36).slice(2) }])
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
            topic: topicRef.current,
            activeMentor: mentorRef.current,
            topicSystemPrompt: TSYS[topicRef.current],
            activeMode: sessionRef.current.activeMode,
            mentorProfile: mentorRef.current,
            interfaceLanguage: BACKEND_LANG(langRef.current),
            currentLessonTopic: sessionRef.current.currentLessonTopic,
            currentExercise: sessionRef.current.currentExercise,
            expectedResponseMode: sessionRef.current.expectedResponseMode,
            _exerciseAttemptCount: sessionRef.current._exerciseAttemptCount,
          }
        }),
      })
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream')) {
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        const streamId = Date.now()+'-stream'
        setMsgs(prev => [...prev, { id: streamId, sender: mentorRef.current, text: '', artifact: null, artifacts: null, artifactFailures: null }])
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
              if (parsed.done) {
                if (parsed.state) {
                  setSession(s => {
                    const n = { ...s, ...parsed.state, samples: [...(s.samples ?? []), ...((parsed.state?.samples ?? []).filter((x: string) => !(s.samples ?? []).includes(x)))], sessionId: s.sessionId }
                    sessionRef.current = n
                    return n
                  })
                }
                const defaultActions = [{ type: 'export_chat_pdf', action: 'export_chat_pdf', label: 'Exportar PDF', tone: 'secondary' as const }]
                const finalActions = (parsed.suggestedActions && parsed.suggestedActions.length > 0) ? parsed.suggestedActions : defaultActions
                setMsgs(prev => prev.map(m => m.id === streamId ? {
                  ...m,
                  artifact: parsed.artifact ?? m.artifact ?? null,
                  artifacts: (Array.isArray(parsed.artifacts) && parsed.artifacts.length > 0) ? parsed.artifacts : (m.artifacts ?? null),
                  artifactFailures: (Array.isArray(parsed.artifactFailures) && parsed.artifactFailures.length > 0) ? parsed.artifactFailures : (m.artifactFailures ?? null),
                  suggestedActions: finalActions,
                } : m))
              }
            } catch {}
          }
        }
        return
      }
      if (!res.ok) {
        if (res.status === 413) {
          const langNow = langRef.current ?? 'en'
          addMsg({ sender: mentorRef.current ?? 'ln', text: langNow === 'es' || langNow === 'no' ? 'La sesión acumuló demasiados materiales. Continúa con normalidad.' : 'Session accumulated too much material. Continue normally.' })
          setSession(prev => { const trimmed = { ...prev }; delete (trimmed as Record<string, unknown>)['artifactRegistry']; sessionRef.current = trimmed; return trimmed })
          return
        }
        throw new Error('HTTP_ERROR_' + res.status)
      }
      const data = await res.json()
      if (data.state) {
        setSession(s => {
          const n = { ...s, ...data.state, samples: [...(s.samples ?? []), ...((data.state?.samples ?? []).filter((x: string) => !(s.samples ?? []).includes(x)))], sessionId: s.sessionId }
          sessionRef.current = n
          return n
        })
      }
      if (data.diagnostic) { addMsg({ sender:'ln', text: JSON.stringify(data.diagnostic,null,2) }); return }
      const text: string = data.reply ?? data.message ?? data.content ?? ''
      if (!text && !data.artifact) { addMsg({ sender:'ln', text:'No se recibió respuesta. Intenta de nuevo.' }); return }
      addMsg({ sender: mentorRef.current, text: text || 'Material listo:', artifact: data.artifact ?? null,
        artifacts: (Array.isArray(data.artifacts) && data.artifacts.length > 0) ? data.artifacts : null,
        artifactFailures: (Array.isArray(data.artifactFailures) && data.artifactFailures.length > 0) ? data.artifactFailures : null,
        score: data.pronunciationScore,
        suggestedActions: (data.suggestedActions && data.suggestedActions.length > 0) ? data.suggestedActions : [{ type: 'export_chat_pdf', action: 'export_chat_pdf', label: 'Exportar PDF', tone: 'secondary' }] })
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      const langNow = langRef.current ?? 'en'
      let msg = langNow === 'es' ? 'Ocurrió un error inesperado. El tutor sigue activo.' : 'An unexpected error occurred. The tutor is still active.'
      if (m.includes('429')) msg = 'El servicio está temporalmente ocupado.'
      else if (m.includes('Failed to fetch') || m.includes('NetworkError') || m.includes('Load failed')) msg = 'No se pudo conectar con el servidor.'
      addMsg({ sender: mentorRef.current ?? 'ln', text: msg })
    } finally { setLoading(false) }
  }, [addMsg])
  useEffect(() => {
    const handler = (e: Event) => {
      const a = (e as CustomEvent).detail as { action: string; type?: string; label: string }
      if (!a || loading) return
      const actionMessages: Record<string, string> = {
        show_schema: 'Hazme un esquema completo de este tema', show_table: 'Hazme una tabla comparativa de este tema',
        show_matrix: 'Hazme una matriz de análisis', start_quiz: 'Hazme un simulacro de este tema',
        retry_quiz: 'Dame otro simulacro más difícil', retry_module: 'Repite este módulo',
        practice_examples: 'Dame 3 ejemplos guiados para practicar', pronunciation_drill: 'Quiero practicar la pronunciación',
        request_pronunciation: 'Evalúa mi pronunciación', deepen_topic: 'Profundiza más en este tema',
        request_explanation: 'Explícame esto con más detalle', next_module: 'Siguiente bloque',
        continue_lesson: 'Continúa con la lección', switch_mode: 'Cambiar a curso estructurado',
        switch_mentor: 'Cambiar de mentor', change_depth: 'Cambia la profundidad',
        download_pdf: 'Genera el PDF de este material', export_chat_pdf: 'Exporta esta conversación a PDF',
        download_course_pdf: 'Descarga el curso completo en PDF', review_errors: 'Repasa mis errores recurrentes',
        request_correction: 'Corrige lo que he escrito', request_translation: 'Traduce esto',
        hear_audio: 'Lee esto en voz alta', show_schema_pro: 'Hazme un esquema avanzado',
        show_image: 'Genera un diagrama visual de este tema', start_course: 'Empezamos el curso',
        resume_course: 'Continúa el curso donde lo dejamos', choose_examples: 'Ver ejemplos reales',
        choose_exercise: 'Hacer un ejercicio', request_immersion: 'Cuéntame sobre la inmersión',
        diagnostic_start: 'Evalúa mi nivel de español',
      }
      const actionKey = a.action ?? a.type ?? ''
      const msg = actionMessages[actionKey] ?? a.label
      addMsg({ sender: 'user', text: msg })
      if (actionKey === 'export_chat_pdf') {
        const transcript = msgs.map(m => ({ sender: m.sender === 'user' ? 'Student' : m.sender.toUpperCase(), text: (m.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() })).filter(l => l.text.length > 0).map(l => `[${l.sender}]: ${l.text}`).join('\n\n')
        callAPI({ message: msg, exportTranscript: transcript })
      } else {
        callAPI({ message: msg })
      }
    }
    window.addEventListener('lingora-suggested-action', handler)
    return () => window.removeEventListener('lingora-suggested-action', handler)
  }, [loading, addMsg, callAPI, msgs])
  useEffect(() => {
    const handler = (e: Event) => {
      const step = (e as CustomEvent).detail?.step as string
      if (!step || loading) return
      addMsg({ sender: 'user', text: step })
      callAPI({ message: step })
    }
    window.addEventListener('lingora-step-select', handler)
    return () => window.removeEventListener('lingora-step-select', handler)
  }, [loading, addMsg, callAPI])
  const sendComposer = useCallback(async () => {
    const msg = input.trim()
    const hasText = msg.length > 0
    const hasAudio = pendingAudioBlob !== null
    const hasFiles = pendingFiles.length > 0
    if (!hasText && !hasAudio && !hasFiles) return
    if (loading) return
    setInput('')
    if (taRef.current) taRef.current.style.height = 'auto'
    if (hasText) {
      addMsg({ sender:'user', text: msg })
      setSession(s => { const n = {...s, samples:[...s.samples,msg]}; sessionRef.current = n; return n })
    }
    const payload: Record<string, unknown> = {}
    if (hasText) payload.message = msg
    const EXPORT_RE = /\bexport(a|ar)?\b.*\bpdf\b|\bexporta\b|export.*chat/i
    if (hasText && EXPORT_RE.test(msg)) {
      const transcript = msgs.map(m => ({ sender: m.sender === 'user' ? 'Student' : m.sender.toUpperCase(), text: (m.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() })).filter(l => l.text.length > 0).map(l => `[${l.sender}]: ${l.text}`).join('\n\n')
      payload.exportTranscript = transcript
    }
    if (hasAudio) {
      const evalKeywords = ['pronuncia', 'pronunciación', 'pronunciacion', 'califica mi', 'evalúa mi', 'evalua mi', 'cómo sueno', 'como sueno']
      const inPronMode = sessionRef.current.tutorPhase === 'pronunciation' || sessionRef.current.lastAction === 'pronunciation'
      const userWantsEval = evalKeywords.some(k => msg.toLowerCase().includes(k))
      if ((inPronMode || userWantsEval) && msgs.length > 0) {
        const lastMentorMsg = [...msgs].reverse().find(m => m.sender !== 'user' && m.sender !== 'ln' && m.text?.length > 10)
        if (lastMentorMsg?.text) {
          const rawTarget = lastMentorMsg.text.replace(/<[^>]+>/g, '').trim()
          const firstSentence = rawTarget.split(/[.!?]/)[0]?.trim()
          const target = firstSentence && firstSentence.length > 5 && firstSentence.length < 120 ? firstSentence : rawTarget.slice(0, 120)
          if (target.length > 5) payload.pronunciationTarget = target
        }
      }
    }
    if (hasAudio && pendingAudioBlob) {
      if (!hasText) addMsg({ sender:'user', text:'Audio enviado', audioUrl: pendingAudioUrl ?? undefined })
      else setMsgs(prev => prev.map(m => m.id === prev[prev.length-1]?.id ? { ...m, audioUrl: pendingAudioUrl ?? undefined } : m))
      const audioDataUrl = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(pendingAudioBlob) })
      payload.audioDataUrl = audioDataUrl
      payload.audioMimeType = pendingAudioBlob.type || 'audio/webm'
    }
    if (hasFiles) {
      const imageFile = pendingFiles.find(f => f.type.startsWith('image/'))
      const imageUrl = imageFile ? `data:${imageFile.type};base64,${imageFile.base64}` : undefined
      if (!hasText && !hasAudio) addMsg({ sender:'user', text: pendingFiles.map(f=>f.name).join(', '), imageUrl })
      else if (imageUrl) setMsgs(prev => prev.map((m, i) => i === prev.length-1 ? { ...m, imageUrl } : m))
      payload.files = pendingFiles
    }
    setPendingAudioBlob(null); setPendingAudioUrl(null); setPendingFiles([])
    await callAPI(payload)
  }, [input, loading, pendingAudioBlob, pendingAudioUrl, pendingFiles, msgs, addMsg, callAPI])
  const startChat = useCallback((m: MK, t: TK, l: Lang) => {
    setMentor(m); setTopic(t); setLang(l)
    mentorRef.current = m; topicRef.current = t; langRef.current = l
    setSession(s => { const n = {...s, mentor:m, topic:t, lang:l}; sessionRef.current = n; return n })
    const c = COPY[l] ?? COPY.en
    setSplashMsg(c.lnw); setSplashRev(false); setPhase('splash')
    setTimeout(() => setSplashRev(true), 1800)
    setTimeout(() => setPhase('mode'), 3600)
  }, [])
  const selectMode = useCallback((mode: ActiveMode) => {
    setActiveMode(mode)
    setSession(s => { const n = { ...s, activeMode: mode }; sessionRef.current = n; return n })
    setPhase('chat')
    const m = mentorRef.current
    const modeLabels: Record<ActiveMode, string> = {
      interact: 'Interacción inteligente', structured: 'Curso estructurado', pdf_course: 'Curso PDF', free: 'Conversación libre',
    }
    if (mode === 'structured' || mode === 'pdf_course') {
      setMsgs([{ id:'init', sender:m, text: modeLabels[mode] + ' activado. Preparando tu ruta...' }])
      setTimeout(() => {
        callAPI({ message: 'Modo seleccionado: ' + modeLabels[mode] + '. Tema: ' + topicRef.current + '. Nivel: ' + (sessionRef.current.level ?? 'A1') + '. Por favor muestra la hoja de ruta.', activeMode: mode })
      }, 400)
    } else {
      // P18 — FIRST-TURN STREAMING. Root gap: this branch inserted a
      // hardcoded, fully-formed GREETINGS[mentor][lang] string with zero
      // API call, zero loading state, zero streaming — the mentor appeared
      // pre-scripted before ever "thinking." Fix: clear the message list
      // and call the SAME /api/chat pipeline every later turn uses, with
      // no synthetic message text. The backend's own first-turn detection
      // (state.tokens === 0) already produces a contextual greeting via
      // FIRST_TURN_DIRECTIVE — using selected mentor, interfaceLanguage,
      // topic and mode — and P18's orchestrator fix makes this specific
      // plan stream instead of blocking, so the existing Typing indicator
      // (loading && <Typing/>) shows until the first delta arrives, then
      // the bubble grows progressively exactly like any other turn.
      // No new first-message brain — one tutor pipeline, for every mentor.
      setMsgs([])
      void callAPI({ message: '', activeMode: mode })
    }
  }, [callAPI])
  const toggleRec = useCallback(async () => {
    if (recording) { mrRef.current?.stop(); setRecording(false); return }
    if (pendingAudioUrl) { URL.revokeObjectURL(pendingAudioUrl); setPendingAudioUrl(null) }
    setPendingAudioBlob(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = e => chunksRef.current.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setPendingAudioBlob(blob); setPendingAudioUrl(URL.createObjectURL(blob))
      }
      rec.start(); mrRef.current = rec; setRecording(true)
    } catch (e) { addMsg({ sender:'ln', text: 'Micrófono no disponible: ' + (e instanceof Error ? e.message : String(e)) }) }
  }, [recording, pendingAudioUrl, addMsg])
  const handleFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const r = new FileReader()
    r.onload = () => { const b64 = (r.result as string).split(',')[1] || ''; setPendingFiles(prev => [...prev, { name: file.name, type: file.type, base64: b64, size: file.size }]) }
    r.readAsDataURL(file); e.target.value = ''
  }, [])
  return {
    phase, setPhase, splashMsg, splashRev, lang, setLang, mentor, setMentor, topic, setTopic,
    msgs, input, setInput, loading, recording, showExport, setShowExport, activeMode, setActiveMode,
    pendingAudioBlob, pendingAudioUrl, pendingFiles, setPendingFiles, setPendingAudioUrl, setPendingAudioBlob,
    fileInputRef, session, msgsEndRef, taRef, mm, copy, sendComposer, startChat, selectMode, toggleRec, handleFile,
  }
}
