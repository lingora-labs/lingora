'use client'
import React, { useState, useRef, useEffect, useCallback, useMemo, type ChangeEvent } from 'react'
import {
  BACKEND_LANG, MENTOR_META, COPY, TSYS, GREETINGS,
  type MK, type TK, type Lang, type Phase, type ActiveMode, type Msg, type SS, type SuggestedAction, type Artifact, applyDeliveryRetry
} from './beta-model'
import { trimStateForPayload } from './beta-io'
import { selectHistoryWindow } from '@/lib/tutor-memory'
import { quizFingerprint } from '@/lib/quiz-answer-key'
import { normalizeQuizEvidence, type QuizEvidence } from '../../lib/quiz-evidence'
import { readBetaSession, saveBetaSession, clearBetaSession } from './beta-session'

const actionOf = (x: SuggestedAction): string => (x as unknown as { action?: string }).action ?? x.type ?? ''
export function useBetaPage() {
  const [phase, setPhase] = useState<Phase>('onboarding')
  const [hydrated, setHydrated] = useState(false)
  const [persistWarning, setPersistWarning] = useState<string | null>(null)
  const [splashMsg, setSplashMsg] = useState('')
  const [splashRev, setSplashRev] = useState(false)
  const [lang, setLang] = useState<Lang>('en')
  // OTROS: the student's language is not in the picker. The UI starts in English; the Tutor is free from there.
  const [otherLang, setOtherLang] = useState(false)
  const otherRef = useRef(false)
  const lastCallFailedRef = useRef(false)
  const pickLang = useCallback((l: Lang) => { otherRef.current = false; setOtherLang(false); setLang(l) }, [])
  const pickOther = useCallback(() => { otherRef.current = true; setOtherLang(true); setLang('en') }, [])
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
  // Synchronous navigation authority; async callbacks must never capture first-render mode/phase.
  const phaseRef = useRef<Phase>(phase)
  const activeModeRef = useRef<ActiveMode>(activeMode)
  const pendingQuizFeedbackRef = useRef<QuizEvidence | null>(null)
  const resetGenerationRef = useRef(0)
  const resetInProgressRef = useRef(false)
  const mentorRef = useRef<MK>(mentor)
  const langRef = useRef<Lang>(lang)
  const topicRef = useRef<TK>(topic)
  const msgsRef = useRef<Msg[]>(msgs)
  const msgsEndRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const mrRef = useRef<MediaRecorder|null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mm = useMemo(() => MENTOR_META[mentor], [mentor])
  const copy = useMemo(() => COPY[lang] ?? COPY.en, [lang])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { activeModeRef.current = activeMode }, [activeMode])
  useEffect(() => { mentorRef.current = mentor }, [mentor])
  useEffect(() => { langRef.current = lang }, [lang])
  useEffect(() => { topicRef.current = topic }, [topic])
  // msgsRef is the single canonical store: every writer updates it first and then mirrors it into state.
  // (A passive effect copying state -> ref could overwrite a newer ref with a stale render.)
  useEffect(() => { msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, loading])
  useEffect(() => {
    // Restore full artifact URLs from IndexedDB before enabling autosave.
    // Earlier localStorage sessions migrate transparently, without
    // claiming that URLs previously discarded can be reconstructed.
    let mounted = true
    void readBetaSession().then(saved => {
      if (!mounted) return
      if (saved) {
        setLang(saved.lang); langRef.current = saved.lang
        setMentor(saved.mentor); mentorRef.current = saved.mentor
        setTopic(saved.topic); topicRef.current = saved.topic
        activeModeRef.current = saved.activeMode; setActiveMode(saved.activeMode)
        setSession(saved.session); sessionRef.current = saved.session
        setMsgs(saved.msgs); msgsRef.current = saved.msgs
        phaseRef.current = saved.phase; setPhase(saved.phase)
        if (saved.reduced) setPersistWarning('Se recuperó una sesión reducida. Comprueba si están todos tus archivos.')
      } else {
        try {
          const raw = localStorage.getItem('lng1010')
          if (raw) {
            const p = JSON.parse(raw) as Partial<SS>
            const languages = ['es','en','no','fr','de','it','pt','ar','ja','zh']
            if (p.lang && languages.includes(p.lang)) { setLang(p.lang); langRef.current = p.lang }
            if (p.mentor && ['sarah','alex','nick'].includes(p.mentor)) { setMentor(p.mentor); mentorRef.current = p.mentor }
            if (p.topic && ['conversation','structured','cervantes','business','travel','course','leveltest'].includes(p.topic)) { setTopic(p.topic); topicRef.current = p.topic }
          }
        } catch {}
      }
      setHydrated(true)
    }).catch(err => {
      console.warn('[LINGORA] beta hydration failed', err)
      if (mounted) { setPersistWarning('No se pudo recuperar el almacenamiento de esta sesión.'); setHydrated(true) }
    })
    return () => { mounted = false }
  }, [])
  useEffect(() => {
    if (!hydrated) return
    const snapshot = {
      phase: (phase === 'chat' ? 'chat' : 'onboarding') as 'chat' | 'onboarding',
      lang, mentor, topic, activeMode, session, msgs,
    }
    let cancelled = false
    const generation = resetGenerationRef.current
    const write = () => {
      if (generation !== resetGenerationRef.current || resetInProgressRef.current) return
      void saveBetaSession(snapshot).then(result => {
        if (cancelled) return
        if (result === 'failed') setPersistWarning('No se pudo guardar la sesión. Descarga los documentos antes de salir.')
        else if (result === 'reduced') setPersistWarning('La sesión se guardó parcialmente. Algunos archivos podrían no recuperarse.')
        else setPersistWarning(null)
      })
    }
    // Buffer token-by-token streaming writes; flush promptly when a response
    // completes. Avoid writing multi-MB PDFs every single streamed token.
    const delay = loading ? 650 : 100
    const timer = setTimeout(write, delay)
    const onHide = () => { if (document.visibilityState === 'hidden') { clearTimeout(timer); write() } }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [hydrated, phase, lang, mentor, topic, activeMode, session, msgs, loading])
  const addMsg = useCallback((m: Omit<Msg,'id'>) => {
    // 7.4.1: the ref is the canonical snapshot (callAPI and the quiz-progress handler rebuild state from it).
    // Updating only React state left a window in which a concurrent rebuild silently dropped the new message
    // (seen in E2E as a missing student bubble and Tutor reply after "enviar a revisión").
    const next = [...msgsRef.current, { ...m, id: Date.now()+'-'+Math.random().toString(36).slice(2) }]
    msgsRef.current = next
    setMsgs(next)
  }, [])
  const registerExport = useCallback(async (archiveUrl: string, expectedSessionId: string):
    Promise<'saved' | 'reduced' | 'failed' | 'cancelled'> => {
    if (resetInProgressRef.current || sessionRef.current.sessionId !== expectedSessionId) return 'cancelled'
    // A saved tool output, not a student turn. Commit the complete archive
    // before the interface is permitted to announce that it will survive a return.
    const archive: Msg = {
      id: Date.now()+'-export-'+Math.random().toString(36).slice(2),
      sender: 'ln', text: 'Historial PDF de esta sesión',
      artifact: { type: 'pdf_chat', url: archiveUrl },
    }
    const nextMsgs = [...msgsRef.current, archive]
    msgsRef.current = nextMsgs
    setMsgs(nextMsgs)
    const status = await saveBetaSession({
      phase: phaseRef.current === 'chat' ? 'chat' : 'onboarding',
      lang: langRef.current, mentor: mentorRef.current,
      topic: topicRef.current, activeMode: activeModeRef.current,
      session: sessionRef.current, msgs: nextMsgs,
    })
    return resetInProgressRef.current || sessionRef.current.sessionId !== expectedSessionId
      ? 'cancelled' : status
  }, [])
  const callAPI = useCallback(async (payload: Record<string, unknown>, opts?: { retryTargetId?: string; rewindToLastUser?: boolean }) => {
    const filterPdfActions = (items:SuggestedAction[]):SuggestedAction[] => items
    lastCallFailedRef.current = false
    setLoading(true)
    try {
      // BASE-MODEL-PARITY — recent real turns (not a code-derived summary),
      // capped to keep the request bounded. 'ln' bubbles are system/UI
      // messages, not dialogue — excluded. Text only: artifacts/audio are
      // materializations of what was already said in the text, not
      // additional dialogue content.
      // 7.3.3f: the whole thread that fits a token budget (never a fixed message count); the
      // Tutor's typed memory (state.tutorMemory) covers whatever the budget can no longer hold.
      // 7.4.1: re-asking after a turn that never produced material must not show the student's words to the
      // Tutor twice: the history stops before the last student message, which `message` repeats.
      const lastUser = msgsRef.current.map(m => m.sender).lastIndexOf('user')
      const historySource = opts?.rewindToLastUser && lastUser >= 0 ? msgsRef.current.slice(0, lastUser) : msgsRef.current
      const conversationHistory = selectHistoryWindow(historySource
        .filter(m => m.sender !== 'ln' && (m.text || '').trim().length > 0)
        .map(m => ({ role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.text }))).kept
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          conversationHistory,
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
            uiLanguageChoice: otherRef.current ? 'other' : undefined,
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
        const openTurn: Msg = { id: streamId, sender: mentorRef.current, text: '', artifact: null, artifacts: null, artifactFailures: null }
        // Keep the canonical snapshot in sync with streamed text, not just React's next render.
        msgsRef.current = [...msgsRef.current, openTurn]
        setMsgs(msgsRef.current)
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
                msgsRef.current = msgsRef.current.map(m => m.id === streamId ? { ...m, text: accumulated } : m)
                setMsgs(msgsRef.current)
              }
              if (parsed.done) {
                const previous = sessionRef.current
                const nextSession: SS = parsed.state
                  ? { ...previous, ...parsed.state,
                    samples: [...(previous.samples ?? []), ...((parsed.state.samples ?? []).filter((x: string) => !(previous.samples ?? []).includes(x)))],
                    sessionId: previous.sessionId }
                  : previous
                const defaultActions = [{ type: 'export_chat_pdf', action: 'export_chat_pdf', label: 'Exportar PDF', tone: 'secondary' as const }]
                const safeActions = Array.isArray(parsed.suggestedActions) ? filterPdfActions(parsed.suggestedActions) : []
                const finalActions = safeActions.length > 0 ? safeActions : defaultActions
                const completedMsgs: Msg[] = msgsRef.current.map(m => m.id === streamId ? {
                  ...m, text: accumulated,
                  artifact: parsed.artifact ?? m.artifact ?? null,
                  artifacts: (Array.isArray(parsed.artifacts) && parsed.artifacts.length > 0) ? parsed.artifacts : (m.artifacts ?? null),
                  artifactFailures: (Array.isArray(parsed.artifactFailures) && parsed.artifactFailures.length > 0) ? parsed.artifactFailures : (m.artifactFailures ?? null),
                  suggestedActions: finalActions,
                } : m)
                // COMMIT BEFORE DISPLAY: an immediate refresh cannot observe a
                // completed turn until its exact artifacts are durable in IndexedDB.
                // The existing serialized save path owns both success and failure.
                const result = await saveBetaSession({
                  phase: phaseRef.current === 'chat' ? 'chat' : 'onboarding',
                  lang: langRef.current, mentor: mentorRef.current, topic: topicRef.current,
                  activeMode: activeModeRef.current,
                  session: nextSession, msgs: completedMsgs,
                })
                sessionRef.current = nextSession
                setSession(nextSession)
                msgsRef.current = completedMsgs
                setMsgs(completedMsgs)
                if (result === 'failed') setPersistWarning('No se pudieron conservar estos archivos. Descárgalos antes de recargar.')
                else if (result === 'reduced') setPersistWarning('Algunos archivos no se conservaron. Descárgalos antes de recargar.')
                else setPersistWarning(null)
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
      // 7.4.1: a delivery retry updates the message that failed, in place. No new bubble, no new Tutor turn.
      if (opts?.retryTargetId && data.retryOf) {
        const patched: Msg[] = applyDeliveryRetry(msgsRef.current, opts.retryTargetId, data)
        const result = await saveBetaSession({
          phase: phaseRef.current === 'chat' ? 'chat' : 'onboarding',
          lang: langRef.current, mentor: mentorRef.current, topic: topicRef.current,
          activeMode: activeModeRef.current, session: sessionRef.current, msgs: patched,
        })
        msgsRef.current = patched
        setMsgs(patched)
        if (result === 'failed') setPersistWarning('No se pudieron conservar estos archivos. Descárgalos antes de recargar.')
        else if (result === 'reduced') setPersistWarning('Algunos archivos no se conservaron. Descárgalos antes de recargar.')
        else setPersistWarning(null)
        return
      }
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
        suggestedActions: Array.isArray(data.suggestedActions) && filterPdfActions(data.suggestedActions).length > 0
        ? filterPdfActions(data.suggestedActions)
        : ([{ type: 'export_chat_pdf', action: 'export_chat_pdf', label: 'Exportar PDF', tone: 'secondary' }]) })
    } catch (e) {
      lastCallFailedRef.current = true
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
        show_image: 'Genera un diagrama visual de este tema', create_visual_review: 'Desarrolla un esquema de repaso del último tema con al menos cuatro ideas sustantivas, explicaciones claras y ejemplos concretos, en secciones separadas.', start_course: 'Empezamos el curso',
        resume_course: 'Continúa el curso donde lo dejamos', choose_examples: 'Ver ejemplos reales',
        choose_exercise: 'Hacer un ejercicio', request_immersion: 'Cuéntame sobre la inmersión',
        diagnostic_start: 'Evalúa mi nivel de español',
      }
      const actionKey = a.action ?? a.type ?? ''
      const msg = actionKey === 'retry_delivery' && typeof (a as SuggestedAction).payload?.message === 'string'
        ? String((a as SuggestedAction).payload!.message).slice(0,4000)
        : actionMessages[actionKey] ?? a.label
      if (actionKey === 'retry_delivery') {
        // The Tutor's material is already on screen: repeat only its delivery, in the same message.
        const retryPayload = (a as SuggestedAction).payload ?? {}
        const target = [...msgsRef.current].reverse().find(m => m.sender !== 'user' && m.sender !== 'ln'
          && (m.suggestedActions ?? []).some(x => actionOf(x) === 'retry_delivery'))
        if (Array.isArray(retryPayload.signals) && retryPayload.signals.length > 0 && target?.text?.trim()) {
          callAPI({ message: 'Reintentar entrega', uiAction: 'retry_delivery', materialText: target.text,
            retrySignals: retryPayload.signals }, { retryTargetId: target.id })
        } else if (typeof retryPayload.message === 'string') {
          // The turn failed before the Tutor wrote anything: ask again, without a second student bubble.
          callAPI({ message: String(retryPayload.message).slice(0, 4000) }, { rewindToLastUser: true })
        }
        return
      }
      if (!['export_chat_pdf', 'download_pdf', 'hear_audio'].includes(actionKey)) {
        addMsg({ sender: 'user', text: msg })
      }
      if (actionKey === 'export_chat_pdf') {
        const transcript = msgs.map(m => ({ sender: m.sender === 'user' ? 'Student' : m.sender.toUpperCase(), text: (m.text || '').trim() })).filter(l => l.text.length > 0).map(l => `[${l.sender}]: ${l.text}`).join('\n\n')
        callAPI({ message: msg, exportTranscript: transcript, uiAction: 'export_chat_pdf' })
      } else if (actionKey === 'create_visual_review') {
        // Exact touch intent, not a PDF keyword and not a cognitive router.
        callAPI({ message: msg, uiAction: 'create_visual_review' })
      } else if (actionKey === 'download_pdf' || actionKey === 'hear_audio') {
        // Instrumental touch actions operate on the tutor content already on
        // screen. They do not inject an artificial student utterance.
        const material = [...msgs].reverse().find(m => m.sender !== 'user' && m.sender !== 'ln' && m.text?.trim())
        callAPI({ message: msg, uiAction: actionKey, materialText: material?.text ?? '' })
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
  // Feedback is a queued state transition, not an event that can be lost
  // merely because a response is still finishing or the mode is updating.
  const flushStructuredQuizFeedback = useCallback(() => {
    if (loading || sessionRef.current.activeMode !== 'structured') return
    const evidence = pendingQuizFeedbackRef.current
    if (!evidence) return
    pendingQuizFeedbackRef.current = null // exactly once, before async fetch
    const details = evidence.responses.map((r,i) =>
      String(i+1) + '. ' + r.question +
      ' | elegí ' + JSON.stringify(r.chosen) +
      ' | correcta ' + JSON.stringify(r.expected) +
      ' | resultado ' + (r.correct ? 'acierto' : 'error'),
    ).join('\n')
    const message = 'He completado el quiz: ' + evidence.correctCount +
      '/' + evidence.total + '. Mis selecciones:\n' + details +
      '\nEvalúa los errores registrados y guía el siguiente paso.'
    addMsg({sender:'user', text:message})
    void callAPI({message})
  }, [loading, addMsg, callAPI])
  useEffect(() => { flushStructuredQuizFeedback() }, [flushStructuredQuizFeedback])
  useEffect(() => {
    const handler = (e: Event) => {
      const evidence = normalizeQuizEvidence((e as CustomEvent).detail)
      if (!evidence) return
      const mode = sessionRef.current.activeMode
      const next: SS = {
        ...sessionRef.current, quizEvidence:evidence,
        ...(mode === 'structured' ? {tutorPhase:'feedback'} : {}),
      }
      sessionRef.current = next
      setSession(next)
      if (mode === 'structured') {
        pendingQuizFeedbackRef.current = evidence
        flushStructuredQuizFeedback()
      }
    }
    window.addEventListener('lingora-quiz-completed', handler)
    return () => window.removeEventListener('lingora-quiz-completed', handler)
  }, [flushStructuredQuizFeedback])
  // Unverified answer keys can be attempted by touch, but are NEVER
  // auto-scored. The selected Tutor Maestro is asked to assess what the
  // student chose; no model-authored 'correct' index enters quizEvidence.
  useEffect(() => {
    const handler = (event: Event) => {
      if (loading) return
      const value = (event as CustomEvent).detail?.responses
      if (!Array.isArray(value) || value.length < 2 || value.length > 8) return
      const responses = value.map((r: unknown) => {
        if (!r || typeof r !== 'object') return null
        const item = r as {question?:unknown;options?:unknown;chosen?:unknown;verified?:unknown}
        if (typeof item.question !== 'string' || item.question.length > 1800 ||
            !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 4 ||
            item.options.some(o=>typeof o !== 'string') ||
            typeof item.chosen !== 'string' || !item.options.includes(item.chosen)) return null
        return {question:item.question,chosen:item.chosen,options:item.options as string[],verified:item.verified==='correct'||item.verified==='incorrect'?item.verified:undefined}
      })
      if (responses.some(r=>r===null)) return
      const message = 'He respondido a este quiz táctil. Mis respuestas, sin calificación automática:\n' +
        responses.map((r,i)=>String(i+1)+'. '+r!.question+'\nOpciones: '+r!.options.join(' | ')+'\nElegí: '+r!.chosen+(r!.verified?'\nComprobación automática con clave independiente: '+(r!.verified==='correct'?'acierto':'error'):'')).join('\n') +
        '\nRevisa pedagógicamente cada elección e indica las soluciones justificadas; no inventes una puntuación verificada ni generes PDF.'
      const next = {...sessionRef.current,tutorPhase:'feedback' as const}
      sessionRef.current=next
      setSession(next)
      addMsg({sender:'user',text:message})
      void callAPI({message})
    }
    window.addEventListener('lingora-quiz-review-request',handler)
    return () => window.removeEventListener('lingora-quiz-review-request',handler)
  }, [loading,callAPI,addMsg])
  // 7.4 — the student's quiz answers are persisted with the message that carries the quiz, so a
  // reload restores what was answered and whether the Tutor already reviewed it.
  useEffect(() => {
    const handler = (event: Event) => {
      const d = (event as CustomEvent).detail as { key?: unknown; instanceId?: unknown; answers?: unknown; sent?: unknown } | undefined
      if (!d || typeof d.key !== 'string' || !Array.isArray(d.answers)) return
      const answers = d.answers.map(v => (typeof v === 'number' ? v : null))
      const sent = d.sent === true
      const target = typeof d.instanceId === 'string' ? d.instanceId.split('#') : null
      const matches = (a: Artifact): boolean => {
        if (a.type !== 'quiz') return false
        const c = (a.content ?? a) as { questions?: Array<{ question?: unknown; options?: unknown }> }
        const qs = Array.isArray(c.questions) ? c.questions.map(q => ({ question: String(q.question ?? ''), options: Array.isArray(q.options) ? q.options.map(o => (typeof o === 'object' && o && 'text' in o ? String((o as { text: unknown }).text) : String(o))) : [] })) : []
        return qs.length > 0 && quizFingerprint(qs) === d.key
      }
      const next = msgsRef.current.map(m => {
        if (!(m.artifacts || m.artifact)) return m
        if (target && m.id !== target[0]) return m
        const idx = target ? Number(target[1]) : -1
        const list: Artifact[] = m.artifacts && m.artifacts.length > 0 ? m.artifacts : (m.artifact ? [m.artifact] : [])
        const upd = list.map((a, i) => ((idx < 0 || i === idx) && matches(a) ? { ...a, progress: { answers, sent } } : a))
        if (m.artifacts && m.artifacts.length > 0) return { ...m, artifacts: upd }
        return { ...m, artifact: upd[0] ?? m.artifact }
      })
      msgsRef.current = next
      setMsgs(next)
    }
    window.addEventListener('lingora-quiz-progress', handler)
    return () => window.removeEventListener('lingora-quiz-progress', handler)
  }, [])
  // "Seguir aprendiendo": the Tutor continues the lesson from the student's results; no artifact is requested.
  useEffect(() => {
    const handler = () => {
      if (loading) return
      const message = 'Quiero seguir aprendiendo a partir de este quiz. Continúa tú la lección con el siguiente paso adaptado a mis aciertos y errores; no generes documentos ni otro quiz salvo que yo lo pida.'
      addMsg({ sender: 'user', text: message })
      void callAPI({ message })
    }
    window.addEventListener('lingora-quiz-continue', handler)
    return () => window.removeEventListener('lingora-quiz-continue', handler)
  }, [loading, callAPI, addMsg])
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
      else { const cur = msgsRef.current; msgsRef.current = cur.map(m => m.id === cur[cur.length-1]?.id ? { ...m, audioUrl: pendingAudioUrl ?? undefined } : m); setMsgs(msgsRef.current) }
      const audioDataUrl = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(pendingAudioBlob) })
      payload.audioDataUrl = audioDataUrl
      payload.audioMimeType = pendingAudioBlob.type || 'audio/webm'
    }
    if (hasFiles) {
      const imageFile = pendingFiles.find(f => f.type.startsWith('image/'))
      const imageUrl = imageFile ? `data:${imageFile.type};base64,${imageFile.base64}` : undefined
      if (!hasText && !hasAudio) addMsg({ sender:'user', text: pendingFiles.map(f=>f.name).join(', '), imageUrl })
      else if (imageUrl) { const cur = msgsRef.current; msgsRef.current = cur.map((m, i) => i === cur.length-1 ? { ...m, imageUrl } : m); setMsgs(msgsRef.current) }
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
    setSplashMsg(c.lnw); setSplashRev(false); phaseRef.current = 'splash'; setPhase('splash')
    setTimeout(() => setSplashRev(true), 1800)
    setTimeout(() => { phaseRef.current = 'mode'; setPhase('mode') }, 3600)
  }, [])
  const selectMode = useCallback((mode: ActiveMode) => {
    activeModeRef.current = mode; setActiveMode(mode)
    // Set authoritative transport state BEFORE the opening request.
    const selected: SS = { ...sessionRef.current, activeMode: mode, tutorPhase:'guide' }
    sessionRef.current = selected
    pendingQuizFeedbackRef.current = null
    setSession(selected)
    phaseRef.current = 'chat'; setPhase('chat')
    // A session-open event has no student utterance: the Tutor itself opens, in
    // streaming, in the language the student selected (OTROS opens in English).
    // The thinking bubble shows while it starts. If the request fails, the
    // localized static welcome keeps the session usable.
    msgsRef.current = []
    setMsgs([])
    void (async () => {
      await callAPI({ message: '' })
      if (!lastCallFailedRef.current) return
      const greeting = GREETINGS[mentorRef.current]?.[langRef.current]
        ?? GREETINGS[mentorRef.current]?.en ?? ''
      const fallback: Msg[] = greeting
        ? [{id: Date.now()+'-welcome',sender:mentorRef.current,text:greeting}]
        : []
      msgsRef.current = fallback
      setMsgs(fallback)
    })()
  }, [callAPI])
  const resetChat = useCallback(async () => {
    if (resetInProgressRef.current) return
    resetInProgressRef.current = true
    // Invalidate prior debounced writes before clearing the serialized queue.
    resetGenerationRef.current += 1
    pendingQuizFeedbackRef.current = null
    setPersistWarning('Eliminando los materiales locales…')
    const cleared = await clearBetaSession()
    if (!cleared) {
      setPersistWarning('Reset no confirmado: el almacenamiento local no pudo limpiarse.')
      resetInProgressRef.current = false
      return
    }
    const freshSession: SS = {
      lang: langRef.current, mentor: mentorRef.current, topic: topicRef.current,
      level: 'A0', tokens: 0, samples: [],
      sessionId: 's'+Math.random().toString(36).slice(2),
      commercialOffers: [], lastTask: null, lastArtifact: null,
    }
    sessionRef.current = freshSession
    setMsgs([]); msgsRef.current = []
    setInput(''); setPersistWarning(null)
    setSession(freshSession)
    activeModeRef.current = 'interact'; setActiveMode('interact')
    phaseRef.current = 'onboarding'; setPhase('onboarding')
    resetInProgressRef.current = false
  }, [])
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
    phase, setPhase, hydrated, persistWarning, resetChat, registerExport, splashMsg, splashRev, lang, setLang, pickLang, pickOther, otherLang, mentor, setMentor, topic, setTopic,
    msgs, input, setInput, loading, recording, showExport, setShowExport, activeMode, setActiveMode,
    pendingAudioBlob, pendingAudioUrl, pendingFiles, setPendingFiles, setPendingAudioUrl, setPendingAudioBlob,
    fileInputRef, session, msgsEndRef, taRef, mm, copy, sendComposer, startChat, selectMode, toggleRec, handleFile,
  }
}
