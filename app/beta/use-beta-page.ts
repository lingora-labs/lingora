'use client'
import React, { useState, useRef, useEffect, useCallback, useMemo, type ChangeEvent } from 'react'
import {
  BACKEND_LANG, MENTOR_META, COPY, TSYS, GREETINGS,
  type MK, type TK, type Lang, type Phase, type ActiveMode, type Msg, type SS, type SuggestedAction, type Artifact, resolveMsgArtifacts, applyDeliveryRetry
} from './beta-model'
import { trimStateForPayload } from './beta-io'
import { buildExportTurns, prepareConversationExport } from './export-turns'
import { QUIZ_RESOURCE_LIMITS } from '@/lib/content/quiz'
import { buildConversationRequest } from '@/lib/space/retrieve'
import {
  addConfirmedFact, addSource, applyLearningFacts, confirmFact, conversationTitle, isRefusal, mergeOffers, mirrorInferredMemory,
  recordInterest, removeFact, removeSource, setInstructions, touchConversation, createConversation, createSpace,
  type Conversation, type Refusal, type Space,
} from '@/lib/space/model'
import { createSpaceStore, memoryBackend } from '@/lib/space/store'
import { isTextSource, sha256Hex } from '@/lib/space/sha256'
import { sanitizeAcceptedFacts } from '@/lib/learning-facts'
import { quizFingerprint } from '@/lib/quiz-answer-key'
import { normalizeQuizEvidence, type QuizEvidence } from '../../lib/quiz-evidence'
import { PDF_REQUEST_TIMEOUT_MS, explainPdfRequestFailure, fetchVerifiedPdf } from '../../lib/pdf-download'
import { QUIZ_ACTIVATE_EVENT, buildQuizReviewMessage, findQuizInstance, normalizeQuizIdentity, quizIdentityLine, type QuizIdentity } from './quiz-actions'
import { readLegacySession, clearLegacySession, spaceStore, strippedArtifact } from './beta-session'
import { SpeechPlayer, type PlayerState } from './voice/speech-player'
import { SpeechSegmenter, spokenText } from './voice/speech-segmenter'
import { useVoiceConversation, pickRecorderMime, type Utterance } from './voice/use-voice'

const actionOf = (x: SuggestedAction): string => (x as unknown as { action?: string }).action ?? x.type ?? ''
const LANGS: Lang[] = ['es','en','no','fr','de','it','pt','ar','ja','zh']
const MENTORS: MK[] = ['sarah','alex','nick']
const TOPICS: TK[] = ['conversation','structured','cervantes','business','travel','course','leveltest']
const MODES: ActiveMode[] = ['interact','structured','pdf_course','free']
const freshSession = (lang: Lang, mentor: MK, topic: TK): SS => ({
  lang, mentor, topic, level: 'A0', tokens: 0, samples: [],
  sessionId: 's'+Math.random().toString(36).slice(2),
  commercialOffers: [], lastTask: null, lastArtifact: null,
})
type ConvMeta = { id: string; spaceId: string; createdAt: string }
type UiPhase = Conversation['ui']['phase']
const SOURCE_FILE_BYTES = 8_000_000
export function useBetaPage() {
  const [phase, setPhase] = useState<Phase>('onboarding')
  const [hydrated, setHydrated] = useState(false)
  const [persistWarning, setPersistWarning] = useState<string | null>(null)
  // 7.5: the student's Space (instructions, sources, memory, conversations). The page shows ONE conversation.
  const [space, setSpace] = useState<Space | null>(null)
  const [spaceNotice, setSpaceNotice] = useState<string | null>(null)
  const spaceRef = useRef<Space | null>(null)
  const storeRef = useRef(spaceStore)
  const conversationRef = useRef<ConvMeta | null>(null)
  const [splashMsg, setSplashMsg] = useState('')
  const [splashRev, setSplashRev] = useState(false)
  const [lang, setLang] = useState<Lang>('en')
  // OTROS: the student's language is not in the picker. The UI starts in English; the Tutor is free from there.
  const [otherLang, setOtherLang] = useState(false)
  const otherRef = useRef(false)
  const lastCallFailedRef = useRef(false)
  const pickLang = useCallback((l: Lang) => { otherRef.current = false; setOtherLang(false); setLang(l); setSession(s => ({ ...s, uiLanguageChoice: undefined })) }, [])
  const pickOther = useCallback(() => { otherRef.current = true; setOtherLang(true); setLang('en'); setSession(s => ({ ...s, uiLanguageChoice: 'other' })) }, [])
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
  const pendingQuizIdentityRef = useRef<QuizIdentity | null>(null)
  const pendingExportRef = useRef(false)
  // 7.5 P1-A: one voice for the Tutor (the player), one microphone (hands-free conversation), one state.
  const voiceModeRef = useRef(false)
  const [voiceMode, setVoiceModeState] = useState(false)
  const playerRef = useRef<SpeechPlayer | null>(null)
  const [player, setPlayer] = useState<SpeechPlayer | null>(null)
  const [playerState, setPlayerState] = useState<PlayerState | null>(null)
  const voiceTimingRef = useRef<Record<string, { firstTextMs: number | null; asrMs: number | null; asrModel: string | null; servedModel: string | null }>>({})
  const pendingUtteranceRef = useRef<Utterance | null>(null)
  const loadingRef = useRef(false)
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
  const uiPhaseOf = (p: Phase): UiPhase => (p === 'chat' ? 'chat' : p === 'mode' ? 'mode' : 'onboarding')
  /** Shows one conversation of the Space. Cancels any pending save of the previous one. */
  const applyConversation = useCallback((c: Conversation<Msg, SS>) => {
    resetGenerationRef.current += 1
    conversationRef.current = { id: c.id, spaceId: c.spaceId, createdAt: c.createdAt }
    const l = (LANGS as string[]).includes(c.ui.lang) ? c.ui.lang as Lang : langRef.current
    const m = (MENTORS as string[]).includes(c.ui.mentor) ? c.ui.mentor as MK : mentorRef.current
    const t = (TOPICS as string[]).includes(c.ui.topic) ? c.ui.topic as TK : topicRef.current
    const mode = (MODES as string[]).includes(c.ui.activeMode) ? c.ui.activeMode as ActiveMode : 'interact'
    setLang(l); langRef.current = l
    const freeLanguage = c.session.uiLanguageChoice === 'other' || (c.session.explanatoryLanguageSource === 'tutor_detected' && c.ui.lang === 'en')
    otherRef.current = freeLanguage; setOtherLang(freeLanguage)
    setMentor(m); mentorRef.current = m
    setTopic(t); topicRef.current = t
    activeModeRef.current = mode; setActiveMode(mode)
    setSession(c.session); sessionRef.current = c.session
    setMsgs(c.msgs); msgsRef.current = c.msgs
    pendingQuizFeedbackRef.current = null; pendingExportRef.current = false
    const phaseNow: Phase = c.ui.phase === 'chat' ? 'chat' : c.ui.phase === 'mode' ? 'mode' : 'onboarding'
    phaseRef.current = phaseNow; setPhase(phaseNow)
    setInput('')
    setPersistWarning(c.reduced ? 'Se recuperó una conversación reducida. Comprueba si están todos tus archivos.' : null)
  }, [])
  const seedFor = useCallback((phaseNow: UiPhase) => ({
    session: freshSession(langRef.current, mentorRef.current, topicRef.current),
    ui: { phase: phaseNow, lang: langRef.current, mentor: mentorRef.current, topic: topicRef.current, activeMode: 'interact' },
  }), [])
  const recordOf = useCallback((meta: ConvMeta, msgsNow: Msg[], sessionNow: SS, phaseNow: Phase): Conversation<Msg, SS> => ({
    id: meta.id, spaceId: meta.spaceId, createdAt: meta.createdAt, updatedAt: new Date().toISOString(),
    msgs: msgsNow, session: sessionNow,
    ui: { phase: uiPhaseOf(phaseNow), lang: langRef.current, mentor: mentorRef.current, topic: topicRef.current, activeMode: activeModeRef.current },
  }), [])
  /** Read-modify-write of the Space. A refusal is shown to the student, never swallowed. */
  const updateSpace = useCallback(async (fn: (s: Space) => Space | Refusal): Promise<boolean> => {
    const out = await storeRef.current.mutate(sp => { const r = fn(sp); return isRefusal(r) ? { refusal: r.message } : { space: r, result: true } })
    if (!out.ok) { setSpaceNotice(out.message); return false }
    if (out.space !== spaceRef.current) { spaceRef.current = out.space; setSpace(out.space) }
    return true
  }, [])
  /** Saves the active conversation; keeps its title in the Space index in step with its first line. */
  const saveActive = useCallback(async (meta: ConvMeta | null, msgsNow: Msg[], sessionNow: SS, phaseNow: Phase) => {
    if (!meta) return 'failed' as const
    const result = await storeRef.current.saveConversation(recordOf(meta, msgsNow, sessionNow, phaseNow))
    const ref = spaceRef.current?.conversations.find(c => c.id === meta.id)
    const title = conversationTitle(msgsNow, '')
    if (ref && title && ref.title !== title) void updateSpace(sp => touchConversation(sp, meta.id, title))
    return result
  }, [recordOf, updateSpace])
  /** What a finished turn leaves in the Space: the offer record, the Tutor's notes as INFERRED memory, and the
   *  facts the runtime accepted on the student's own words (goal, result, decline/reopening) as CONFIRMED memory.
   *  Awaited before the turn ends, so the next turn reads the updated Space; a failed write is shown, never hidden. */
  const absorbTurn = useCallback(async (next: SS, facts?: unknown) => {
    const id = conversationRef.current?.id
    if (!id) return
    const accepted = sanitizeAcceptedFacts(facts).filter(f => f.conversationId === id)
    const ok = await updateSpace(sp => applyLearningFacts(mirrorInferredMemory(mergeOffers(sp, next.commercialOffers), id, next.tutorMemory), accepted))
    if (!ok && accepted.length) setSpaceNotice('Un hecho que tu tutor reconoció no se pudo guardar en tu espacio.')
  }, [updateSpace])
  useEffect(() => {
    // 7.5: open (or create) the Space. A 7.1–7.4 single session migrates once into the first conversation.
    let mounted = true
    const legacySeed = async () => {
      const legacy = await readLegacySession()
      return legacy ? {
        session: legacy.session, msgs: legacy.msgs, reduced: legacy.reduced,
        ui: { phase: legacy.phase as UiPhase, lang: legacy.lang, mentor: legacy.mentor, topic: legacy.topic, activeMode: legacy.activeMode },
      } : null
    }
    const fresh = () => seedFor('onboarding')
    const opened = storeRef.current.open(legacySeed, fresh).catch(async err => {
      // No IndexedDB (private mode, blocked storage): the Space lives in memory for this visit and says so.
      console.warn('[LINGORA] Space storage unavailable', err)
      storeRef.current = createSpaceStore<Msg, SS>(memoryBackend(), { reduceMessage: strippedArtifact })
      if (mounted) setSpaceNotice('Este navegador no permite guardar tu espacio: todo se perderá al cerrar la página.')
      return storeRef.current.open(async () => null, fresh)
    })
    void opened.then(({ space: sp, conversation, migrated }) => {
      if (!mounted) return
      if (migrated) void clearLegacySession()
      spaceRef.current = sp; setSpace(sp)
      if (!migrated && conversation.msgs.length === 0 && conversation.ui.phase === 'onboarding') {
        try {
          const raw = localStorage.getItem('lng1010')
          if (raw) {
            const p = JSON.parse(raw) as Partial<SS>
            if (p.lang && LANGS.includes(p.lang)) conversation.ui.lang = p.lang
            if (p.mentor && MENTORS.includes(p.mentor)) conversation.ui.mentor = p.mentor
            if (p.topic && TOPICS.includes(p.topic)) conversation.ui.topic = p.topic
          }
        } catch {}
      }
      applyConversation(conversation)
      setHydrated(true)
    }).catch(err => {
      console.warn('[LINGORA] beta hydration failed', err)
      if (!mounted) return
      // Last resort: an unsaved Space in memory, so the page still works.
      const conv = createConversation<Msg, SS>('', fresh().session, fresh().ui)
      const sp = createSpace(conv.id)
      spaceRef.current = sp; setSpace(sp)
      applyConversation({ ...conv, spaceId: sp.id })
      setPersistWarning('No se pudo recuperar el almacenamiento de esta sesión.')
      setHydrated(true)
    })
    return () => { mounted = false }
  }, [applyConversation, seedFor])
  useEffect(() => {
    if (!hydrated) return
    // The conversation is captured NOW: a switch before the timer fires cannot write these messages elsewhere.
    const meta = conversationRef.current
    let cancelled = false
    const generation = resetGenerationRef.current
    const write = () => {
      if (generation !== resetGenerationRef.current || resetInProgressRef.current) return
      void saveActive(meta, msgs, session, phase).then(result => {
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
  }, [hydrated, phase, lang, mentor, topic, activeMode, session, msgs, loading, saveActive])
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
    const status = await saveActive(conversationRef.current, nextMsgs, sessionRef.current, phaseRef.current)
    return resetInProgressRef.current || sessionRef.current.sessionId !== expectedSessionId
      ? 'cancelled' : status
  }, [saveActive])
  // Speak a message the student already has on screen (no new Tutor turn): its visible text, in segments.
  const speakMessage = useCallback((m: Msg | undefined) => {
    const p = playerRef.current
    if (!p || !m || m.sender === 'user' || m.sender === 'ln' || !m.text?.trim()) return
    p.begin(m.id)
    const seg = new SpeechSegmenter()
    for (const s of [...seg.push(m.text), ...seg.flush()]) p.enqueue(s)
    p.end()
  }, [])
  const callAPI = useCallback(async (payload: Record<string, unknown>, opts?: { retryTargetId?: string; rewindToLastUser?: boolean; speak?: boolean; voiceStartedAt?: number; userMsgId?: string }) => {
    // 7.5 P1-A: a spoken answer starts with its first sentence, while the rest is still being written.
    const speak = Boolean(opts?.speak || voiceModeRef.current) && !payload.uiAction
    const segmenter = speak ? new SpeechSegmenter() : null
    const t0 = opts?.voiceStartedAt ?? performance.now()
    let firstDeltaMs: number | null = null
    const filterPdfActions = (items:SuggestedAction[]):SuggestedAction[] => items
    lastCallFailedRef.current = false
    setLoading(true)
    // 7.5: «Descargar PDF» has a deadline and a visible outcome; it never waits silently.
    const pdfRequest = payload.uiAction === 'download_pdf'
    const pdfAbort = pdfRequest ? new AbortController() : null
    const pdfTimer = pdfAbort ? setTimeout(() => pdfAbort.abort(), PDF_REQUEST_TIMEOUT_MS) : null
    const pdfFailure = (cause: string) => addMsg({ sender: mentorRef.current ?? 'ln', text: `No se pudo entregar el PDF: ${cause}.`,
      artifact: null, artifactFailures: [{ subject: `PDF del material: ${cause}` }] })
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
      // 7.5: the active conversation's own history, plus what the Space contributes (instructions, passages
      // and confirmed memory with provenance, offer frequency, recorded interest). No other conversation is read.
      const sp = spaceRef.current
      const meta = conversationRef.current
      const turn = buildConversationRequest(sp ?? createSpace('none'), { id: meta?.id ?? 'none', msgs: msgsRef.current },
        typeof payload.message === 'string' ? payload.message : '', { rewindToLastUser: opts?.rewindToLastUser })
      const conversationHistory = turn.conversationHistory
      const res = await fetch('/api/chat', {
        method: 'POST',
        ...(pdfAbort ? { signal: pdfAbort.signal } : {}),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          conversationHistory,
          ...(sp ? { spaceContext: turn.spaceContext } : {}),
          ...(meta ? { conversationId: meta.id } : {}),
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
            uiLanguageChoice: (sessionRef.current.uiLanguageChoice === 'other' || otherRef.current) ? 'other' : undefined,
            currentLessonTopic: sessionRef.current.currentLessonTopic,
            currentExercise: sessionRef.current.currentExercise,
            expectedResponseMode: sessionRef.current.expectedResponseMode,
            _exerciseAttemptCount: sessionRef.current._exerciseAttemptCount,
            ...(sp ? { commercialOffers: turn.commercialOffers, immersionInterest: turn.immersionInterest, commercialFacts: turn.commercialFacts } : {}),
          }
        }),
      })
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream')) {
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        const streamId = Date.now()+'-stream'
        const openTurn: Msg = { id: streamId, sender: mentorRef.current, text: '', complete: false, artifact: null, artifacts: null, artifactFailures: null }
        if (segmenter) playerRef.current?.begin(streamId, t0)
        // Keep the canonical snapshot in sync with streamed text, not just React's next render.
        msgsRef.current = [...msgsRef.current, openTurn]
        setMsgs(msgsRef.current)
        let accumulated = ''
        let sseBuffer = ''
        let sawCompleted = false
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
              if (parsed.voice && opts?.userMsgId) {
                // The student sees what was understood (and what was not) before the Tutor answers.
                const v = parsed.voice as { transcript: string; uncertain: string[]; asrModel: string; asrMs: number }
                msgsRef.current = msgsRef.current.map(m => m.id === opts.userMsgId ? { ...m, text: v.transcript, voice: { state: 'heard', uncertain: v.uncertain, asrModel: v.asrModel, asrMs: v.asrMs } } : m)
                setMsgs(msgsRef.current)
              }
              if (parsed.delta) {
                if (firstDeltaMs === null) firstDeltaMs = Math.round(performance.now() - t0)
                if (segmenter) for (const seg of segmenter.push(parsed.delta)) playerRef.current?.enqueue(seg)
                accumulated += parsed.delta
                msgsRef.current = msgsRef.current.map(m => m.id === streamId ? { ...m, text: accumulated } : m)
                setMsgs(msgsRef.current)
              }
              if (parsed.done) {
                sawCompleted = true
                if (segmenter) { for (const seg of segmenter.flush()) playerRef.current?.enqueue(seg); playerRef.current?.end() }
                if (speak) voiceTimingRef.current[streamId] = { firstTextMs: firstDeltaMs, asrMs: (parsed.voice as { asrMs?: number } | undefined)?.asrMs ?? null, asrModel: (parsed.voice as { asrModel?: string } | undefined)?.asrModel ?? null, servedModel: typeof parsed.servedModel === 'string' ? parsed.servedModel : null }
                if (Array.isArray(parsed.clientDeliveries) && parsed.clientDeliveries.includes('conversation_pdf')) pendingExportRef.current = true
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
                  ...m, text: accumulated, complete:true,
                  turnState: typeof parsed.turnState === 'string' ? parsed.turnState : undefined,
                  ...(speak ? { spoken: true } : {}),
                  artifact: parsed.artifact ?? m.artifact ?? null,
                  artifacts: (Array.isArray(parsed.artifacts) && parsed.artifacts.length > 0) ? parsed.artifacts : (m.artifacts ?? null),
                  artifactFailures: (Array.isArray(parsed.artifactFailures) && parsed.artifactFailures.length > 0) ? parsed.artifactFailures : (m.artifactFailures ?? null),
                  suggestedActions: finalActions,
                } : m)
                // COMMIT BEFORE DISPLAY: an immediate refresh cannot observe a
                // completed turn until its exact artifacts are durable in IndexedDB.
                // The existing serialized save path owns both success and failure.
                const result = await saveActive(conversationRef.current, completedMsgs, nextSession, phaseRef.current)
                await absorbTurn(nextSession, parsed.learningFacts)
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
        if(!sawCompleted) throw new Error('STREAM_ENDED_WITHOUT_COMPLETION')
        return
      }
      if (!res.ok) {
        if (res.status === 413 && !pdfRequest) {
          const langNow = langRef.current ?? 'en'
          addMsg({ sender: mentorRef.current ?? 'ln', text: langNow === 'es' || langNow === 'no' ? 'La sesión acumuló demasiados materiales. Continúa con normalidad.' : 'Session accumulated too much material. Continue normally.' })
          setSession(prev => { const trimmed = { ...prev }; delete (trimmed as Record<string, unknown>)['artifactRegistry']; sessionRef.current = trimmed; return trimmed })
          return
        }
        throw new Error('HTTP_ERROR_' + res.status)
      }
      const data = await res.json()
      if (data.voice?.understood === false && opts?.userMsgId) {
        msgsRef.current = msgsRef.current.map(m => m.id === opts.userMsgId ? { ...m, text: 'Audio no entendido', voice: { state: 'not_understood' } } : m)
        setMsgs(msgsRef.current)
      }
      if (pdfRequest && data.artifact?.type === 'pdf') {
        // Success is announced only after the bytes the student will save were recovered and checked.
        const check = await fetchVerifiedPdf(data.artifact.url, { byteLength: data.artifact.pdfByteLength, sha256: data.artifact.pdfSha256 })
        if (!check.ok) { pdfFailure(check.reason); return }
        const pages = typeof data.artifact.pageCount === 'number' ? `${data.artifact.pageCount} ${data.artifact.pageCount === 1 ? 'página' : 'páginas'}, ` : ''
        data.message = `PDF comprobado: ${pages}${Math.max(1, Math.round(check.byteLength / 1024))} KB. Pulsa «Descargar PDF» para guardarlo.`
      }
      // 7.4.1: a delivery retry updates the message that failed, in place. No new bubble, no new Tutor turn.
      if (opts?.retryTargetId && data.retryOf) {
        const patched: Msg[] = applyDeliveryRetry(msgsRef.current, opts.retryTargetId, data)
        const result = await saveActive(conversationRef.current, patched, sessionRef.current, phaseRef.current)
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
        await absorbTurn({ ...sessionRef.current, ...data.state }, data.learningFacts)
      }
      if (data.diagnostic) { addMsg({ sender:'ln', text: JSON.stringify(data.diagnostic,null,2) }); return }
      if (Array.isArray(data.clientDeliveries) && data.clientDeliveries.includes('conversation_pdf')) pendingExportRef.current = true
      const text: string = data.reply ?? data.message ?? data.content ?? ''
      if (!text && !data.artifact) { addMsg({ sender:'ln', text:'No se recibió respuesta. Intenta de nuevo.' }); return }
      addMsg({ sender: mentorRef.current, text: text || 'Material listo:', artifact: data.artifact ?? null,
        artifacts: (Array.isArray(data.artifacts) && data.artifacts.length > 0) ? data.artifacts : null,
        artifactFailures: (Array.isArray(data.artifactFailures) && data.artifactFailures.length > 0) ? data.artifactFailures : null,
        score: data.pronunciationScore,
        suggestedActions: Array.isArray(data.suggestedActions) && filterPdfActions(data.suggestedActions).length > 0
        ? filterPdfActions(data.suggestedActions)
        : ([{ type: 'export_chat_pdf', action: 'export_chat_pdf', label: 'Exportar PDF', tone: 'secondary' }]) })
      if (speak && text) speakMessage(msgsRef.current[msgsRef.current.length - 1])
    } catch (e) {
      lastCallFailedRef.current = true
      if (pdfRequest) { pdfFailure(explainPdfRequestFailure(e)); return }
      const m = e instanceof Error ? e.message : String(e)
      const langNow = langRef.current ?? 'en'
      let msg = langNow === 'es' ? 'Ocurrió un error inesperado. El tutor sigue activo.' : 'An unexpected error occurred. The tutor is still active.'
      if (m.includes('429')) msg = 'El servicio está temporalmente ocupado.'
      else if (m.includes('Failed to fetch') || m.includes('NetworkError') || m.includes('Load failed')) msg = 'No se pudo conectar con el servidor.'
      addMsg({ sender: mentorRef.current ?? 'ln', text: msg })
    } finally { if (pdfTimer) clearTimeout(pdfTimer); setLoading(false) }
  }, [addMsg, saveActive, absorbTurn, speakMessage])
  // ONE conversation export for the menu, the chat chip and a Tutor's conversation_pdf delivery:
  // the whole conversation held here, with its artifacts, printed by the canonical document page.
  const runConversationExport = useCallback((message: string) => {
    const built = prepareConversationExport(msgsRef.current)
    if (!built.ok) { setPersistWarning(built.message); return }
    void callAPI({ message, exportTurns: built.turns, uiAction: 'export_chat_pdf' })
  }, [callAPI])
  useEffect(() => {
    if (loading || !pendingExportRef.current) return
    pendingExportRef.current = false
    runConversationExport('Exporta esta conversación a PDF')
  }, [loading, runConversationExport])
  useEffect(() => {
    const handler = (e: Event) => {
      const a = (e as CustomEvent).detail as { action: string; type?: string; label: string; sourceMsgId?: string }
      if (!a) return
      if ((a.action ?? a.type) === 'start_quiz') {
        // 7.5: open the quiz already on screen. No student message, no request, the same component.
        const instanceId = findQuizInstance(msgsRef.current, a.sourceMsgId)
        if (instanceId) window.dispatchEvent(new CustomEvent(QUIZ_ACTIVATE_EVENT, { detail: { instanceId } }))
        else addMsg({ sender: 'ln', text: 'No hay ningún quiz en pantalla para empezar. Si quieres uno nuevo, pídeselo a tu Tutor.' })
        return
      }
      if (loading) return
      const actionMessages: Record<string, string> = {
        show_schema: 'Hazme un esquema completo de este tema', show_table: 'Hazme una tabla comparativa de este tema',
        show_matrix: 'Hazme una matriz de análisis',
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
        runConversationExport(msg)
      } else if (actionKey === 'create_visual_review') {
        // Exact touch intent, not a PDF keyword and not a cognitive router.
        callAPI({ message: msg, uiAction: 'create_visual_review' })
      } else if (actionKey === 'download_pdf' || actionKey === 'hear_audio') {
        // Instrumental touch actions operate on the tutor content already on
        // screen. They do not inject an artificial student utterance.
        // 7.5: the message itself, with its artifacts, so the PDF prints exactly what is on screen.
        // 7.5: the material is the message whose button was pressed; the latest Tutor message only as fallback.
        const isMaterial = (m: Msg) => m.sender !== 'user' && m.sender !== 'ln' && Boolean(m.text?.trim())
        const material = (a.sourceMsgId ? msgs.find(m => m.id === a.sourceMsgId && isMaterial(m)) : undefined)
          ?? [...msgs].reverse().find(isMaterial)
        const turn = material ? buildExportTurns([material]) : null
        callAPI({ message: msg, uiAction: actionKey, materialText: material?.text ?? '',
          ...(actionKey === 'download_pdf' && turn?.ok ? { materialTurn: turn.turns[0] } : {}) })
      } else {
        callAPI({ message: msg })
      }
    }
    window.addEventListener('lingora-suggested-action', handler)
    return () => window.removeEventListener('lingora-suggested-action', handler)
  }, [loading, addMsg, callAPI, msgs, runConversationExport])
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
    const quiz = pendingQuizIdentityRef.current
    pendingQuizIdentityRef.current = null
    const details = evidence.responses.map((r,i) =>
      String(i+1) + '. ' + r.question +
      ' | elegí ' + JSON.stringify(r.chosen) +
      ' | correcta ' + JSON.stringify(r.expected) +
      ' | resultado ' + (r.correct ? 'acierto' : 'error'),
    ).join('\n')
    const message = 'He completado el ' + (quiz ? quizIdentityLine(quiz) : 'quiz') + ': ' + evidence.correctCount +
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
        pendingQuizIdentityRef.current = normalizeQuizIdentity((e as CustomEvent).detail?.quiz)
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
      // 7.4.6: the sender is told whether the request was ACCEPTED; a silent return used to leave
      // the quiz saying "Enviado a tu Tutor" while nothing had been sent.
      if (loading) return
      const value = (event as CustomEvent).detail?.responses
      if (!Array.isArray(value) || value.length < 1 || value.length > QUIZ_RESOURCE_LIMITS.questions) return
      const responses = value.map((r: unknown) => {
        if (!r || typeof r !== 'object') return null
        const item = r as {question?:unknown;options?:unknown;chosen?:unknown;verified?:unknown}
        if (typeof item.question !== 'string' || item.question.length > QUIZ_RESOURCE_LIMITS.chars ||
            !Array.isArray(item.options) || item.options.length < 2 || item.options.length > QUIZ_RESOURCE_LIMITS.options ||
            item.options.some(o=>typeof o !== 'string') ||
            typeof item.chosen !== 'string' || !item.options.includes(item.chosen)) return null
        return {question:item.question,chosen:item.chosen,options:item.options as string[],verified:item.verified==='correct'||item.verified==='incorrect'?item.verified as 'correct'|'incorrect':undefined}
      })
      if (responses.some(r=>r===null)) return
      // 7.5: the review is about ONE identified quiz; a request without identity is not sent.
      const quiz = normalizeQuizIdentity((event as CustomEvent).detail?.quiz)
      if (!quiz) return
      const message = buildQuizReviewMessage(quiz, responses.filter((r): r is NonNullable<typeof r> => r !== null))
      const next = {...sessionRef.current,tutorPhase:'feedback' as const}
      sessionRef.current=next
      setSession(next)
      ;(event as CustomEvent).detail.accepted = true
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
    const handler = (e: Event) => {
      if (loading) return
      const quiz = normalizeQuizIdentity((e as CustomEvent).detail?.quiz)
      const message = 'Quiero seguir aprendiendo a partir del ' + (quiz ? quizIdentityLine(quiz) : 'último quiz') + '. Continúa tú la lección con el siguiente paso adaptado a mis aciertos y errores; no generes documentos ni otro quiz salvo que yo lo pida.'
      addMsg({ sender: 'user', text: message })
      void callAPI({ message })
    }
    window.addEventListener('lingora-quiz-continue', handler)
    return () => window.removeEventListener('lingora-quiz-continue', handler)
  }, [loading, callAPI, addMsg])
  // ── 7.5 P1-A: voice ─────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const p = new SpeechPlayer({ mentor: () => mentorRef.current, onState: st => {
      setPlayerState(st)
      // Latency evidence of a spoken answer: first text and first audio, measured from the end of speech.
      if (st.messageId && st.firstAudioMs !== undefined && voiceTimingRef.current[st.messageId] && !('firstAudioMs' in voiceTimingRef.current[st.messageId])) {
        const t = { ...voiceTimingRef.current[st.messageId], firstAudioMs: st.firstAudioMs, speechModel: st.speechModel ?? null }
        voiceTimingRef.current[st.messageId] = t
        console.info('[voice-timing]', JSON.stringify(t))
        msgsRef.current = msgsRef.current.map(m => m.id === st.messageId ? { ...m, voiceTimings: t } : m)
        setMsgs(msgsRef.current)
      }
    } })
    playerRef.current = p; setPlayer(p)
    return () => { p.stop(); playerRef.current = null }
  }, [])
  useEffect(() => { loadingRef.current = loading }, [loading])
  const sendUtterance = useCallback(async (u: Utterance) => {
    const audioUrl = URL.createObjectURL(u.blob)
    const id = Date.now() + '-voice-' + Math.random().toString(36).slice(2)
    msgsRef.current = [...msgsRef.current, { id, sender: 'user', text: '🎤 …', audioUrl, voice: { state: 'pending' } }]
    setMsgs(msgsRef.current)
    const audioDataUrl = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(u.blob) })
    await callAPI({ audioDataUrl, audioMimeType: u.mime, clientSpeech: true, ...(u.interruption ? { voiceInterruption: u.interruption } : {}) },
      { speak: true, voiceStartedAt: u.endedAt, userMsgId: id })
  }, [callAPI])
  const voice = useVoiceConversation({
    player,
    onUtterance: u => { if (loadingRef.current) pendingUtteranceRef.current = u; else void sendUtterance(u) },
    onInterrupt: () => {
      const id = playerRef.current?.current.messageId
      if (id) { msgsRef.current = msgsRef.current.map(m => m.id === id ? { ...m, interrupted: true } : m); setMsgs(msgsRef.current) }
    },
  })
  // An utterance spoken while the Tutor was still writing is sent as soon as the turn closes (one per utterance).
  useEffect(() => {
    if (loading || !pendingUtteranceRef.current) return
    const u = pendingUtteranceRef.current; pendingUtteranceRef.current = null
    void sendUtterance(u)
  }, [loading, sendUtterance])
  const setVoiceMode = useCallback(async (on: boolean) => {
    playerRef.current?.unlock()
    voiceModeRef.current = on; setVoiceModeState(on)
    if (on) await voice.start(); else { voice.stop(); playerRef.current?.stop() }
  }, [voice])
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail?.id as string | undefined
      const m = msgsRef.current.find(x => x.id === id)
      playerRef.current?.unlock()
      const p = playerRef.current
      if (p && p.current.messageId === id && p.current.status === 'error') p.retry()
      else speakMessage(m)
    }
    window.addEventListener('lingora-speak-message', handler)
    return () => window.removeEventListener('lingora-speak-message', handler)
  }, [speakMessage])
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
    let userVoiceId: string | undefined
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
      if (!hasText) { userVoiceId = Date.now() + '-voice'; msgsRef.current = [...msgsRef.current, { id: userVoiceId, sender: 'user', text: '🎤 …', audioUrl: pendingAudioUrl ?? undefined, voice: { state: 'pending' } }]; setMsgs(msgsRef.current) }
      else { const cur = msgsRef.current; msgsRef.current = cur.map(m => m.id === cur[cur.length-1]?.id ? { ...m, audioUrl: pendingAudioUrl ?? undefined } : m); setMsgs(msgsRef.current) }
      const audioDataUrl = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(pendingAudioBlob) })
      payload.audioDataUrl = audioDataUrl
      payload.audioMimeType = pendingAudioBlob.type || 'audio/webm'
      payload.clientSpeech = true
    }
    if (hasFiles) {
      const imageFile = pendingFiles.find(f => f.type.startsWith('image/'))
      const imageUrl = imageFile ? `data:${imageFile.type};base64,${imageFile.base64}` : undefined
      if (!hasText && !hasAudio) addMsg({ sender:'user', text: pendingFiles.map(f=>f.name).join(', '), imageUrl })
      else if (imageUrl) { const cur = msgsRef.current; msgsRef.current = cur.map((m, i) => i === cur.length-1 ? { ...m, imageUrl } : m); setMsgs(msgsRef.current) }
      payload.files = pendingFiles
    }
    setPendingAudioBlob(null); setPendingAudioUrl(null); setPendingFiles([])
    playerRef.current?.unlock()
    await callAPI(payload, hasAudio ? { speak: true, voiceStartedAt: performance.now(), ...(userVoiceId ? { userMsgId: userVoiceId } : {}) } : undefined)
  }, [input, loading, pendingAudioBlob, pendingAudioUrl, pendingFiles, msgs, addMsg, callAPI])
  const startChat = useCallback((m: MK, t: TK, l: Lang) => {
    setMentor(m); setTopic(t); setLang(l)
    mentorRef.current = m; topicRef.current = t; langRef.current = l
    setSession(s => { const n = {...s, mentor:m, topic:t, lang:l, uiLanguageChoice: otherRef.current ? 'other' as const : undefined}; sessionRef.current = n; return n })
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
  // Reset empties the ACTIVE conversation only. The Space (instructions, sources, confirmed memory,
  // other conversations) stays; «Borrar espacio» is a separate, explicit action.
  const resetChat = useCallback(async () => {
    if (resetInProgressRef.current) return
    const meta = conversationRef.current
    if (!meta) return
    resetInProgressRef.current = true
    // Invalidate prior debounced writes before clearing the serialized queue.
    resetGenerationRef.current += 1
    pendingQuizFeedbackRef.current = null
    setPersistWarning('Vaciando esta conversación…')
    const seed = seedFor('onboarding')
    const cleared = await storeRef.current.resetConversation(recordOf(meta, msgsRef.current, sessionRef.current, phaseRef.current), seed)
    if (!cleared) {
      setPersistWarning('Reset no confirmado: el almacenamiento local no pudo limpiarse.')
      resetInProgressRef.current = false
      return
    }
    // The emptied conversation keeps neither a title from its old content nor the Tutor's inferences from it.
    const index = (spaceRef.current?.conversations.findIndex(c => c.id === meta.id) ?? 0) + 1
    await updateSpace(sp => mirrorInferredMemory(touchConversation(sp, meta.id, 'Conversación ' + index), meta.id, []))
    sessionRef.current = seed.session
    setMsgs([]); msgsRef.current = []
    setInput(''); setPersistWarning(null)
    setSession(seed.session)
    activeModeRef.current = 'interact'; setActiveMode('interact')
    phaseRef.current = 'onboarding'; setPhase('onboarding')
    resetInProgressRef.current = false
  }, [seedFor, recordOf, updateSpace])
  /** Flushes the visible conversation before showing another one. */
  const flushActive = useCallback(async () => {
    resetGenerationRef.current += 1
    return saveActive(conversationRef.current, msgsRef.current, sessionRef.current, phaseRef.current)
  }, [saveActive])
  const newConversation = useCallback(async () => {
    const sp = spaceRef.current
    if (loading || !sp) return
    await flushActive()
    // Same Space, same language/mentor/topic; empty thread; the student chooses the mode and the Tutor greets.
    const out = await storeRef.current.newConversation(spaceRef.current ?? sp, seedFor('mode'))
    spaceRef.current = out.space; setSpace(out.space)
    applyConversation(out.conversation)
  }, [loading, flushActive, seedFor, applyConversation])
  const openConversation = useCallback(async (id: string) => {
    const sp = spaceRef.current
    if (loading || !sp || id === conversationRef.current?.id) return
    await flushActive()
    const out = await storeRef.current.switchConversation(spaceRef.current ?? sp, id)
    if (!out) { setSpaceNotice('Esa conversación ya no está en este navegador.'); return }
    spaceRef.current = out.space; setSpace(out.space)
    applyConversation(out.conversation)
  }, [loading, flushActive, applyConversation])
  const deleteConversation = useCallback(async (id: string) => {
    const sp = spaceRef.current
    if (loading || !sp) return
    await flushActive()
    const out = await storeRef.current.deleteConversation(spaceRef.current ?? sp, id, seedFor('onboarding'))
    spaceRef.current = out.space; setSpace(out.space)
    if (out.conversation.id !== conversationRef.current?.id || id === conversationRef.current?.id) applyConversation(out.conversation)
  }, [loading, flushActive, seedFor, applyConversation])
  const deleteSpace = useCallback(async () => {
    const sp = spaceRef.current
    if (loading || !sp) return
    resetGenerationRef.current += 1
    const done = await storeRef.current.deleteSpace(sp)
    if (!done) { setSpaceNotice('No se pudo borrar el espacio de este navegador.'); return }
    const out = await storeRef.current.open(async () => null, () => seedFor('onboarding'))
    spaceRef.current = out.space; setSpace(out.space)
    applyConversation(out.conversation)
    setSpaceNotice('Espacio borrado: conversaciones, fuentes, memoria e interés eliminados de este navegador.')
  }, [loading, seedFor, applyConversation])
  const spaceActions = useMemo(() => ({
    setInstructions: (text: string) => updateSpace(sp => setInstructions(sp, text)),
    addSourceFile: async (file: File) => {
      if (!isTextSource(file.name, file.type)) { setSpaceNotice(`«${file.name}»: el espacio admite por ahora fuentes de texto (.txt, .md, .csv, .json, .html, .srt). No se añadió.`); return false }
      if (file.size > SOURCE_FILE_BYTES) { setSpaceNotice(`«${file.name}» ocupa ${(file.size / 1e6).toFixed(1)} MB; el máximo por fuente es ${SOURCE_FILE_BYTES / 1e6} MB. No se añadió.`); return false }
      try {
        const text = await file.text()
        const sha256 = await sha256Hex(text)
        const ok = await updateSpace(sp => addSource(sp, { name: file.name, mime: file.type || 'text/plain', text, sha256 }))
        if (ok) setSpaceNotice(`Fuente «${file.name}» añadida (SHA-256 ${sha256.slice(0, 12)}…).`)
        return ok
      } catch (e) { setSpaceNotice(`«${file.name}» no se pudo leer: ${e instanceof Error ? e.message : String(e)}`); return false }
    },
    removeSource: (id: string) => updateSpace(sp => removeSource(sp, id)),
    addFact: (key: string, value: string) => updateSpace(sp => addConfirmedFact(sp, key, value)),
    confirmFact: (id: string) => updateSpace(sp => confirmFact(sp, id)),
    removeFact: (id: string) => updateSpace(sp => removeFact(sp, id)),
    recordInterest: (note: string) => updateSpace(sp => recordInterest(sp, conversationRef.current?.id ?? null, note)),
    clearNotice: () => setSpaceNotice(null),
  }), [updateSpace])
  const toggleRec = useCallback(async () => {
    if (recording) { mrRef.current?.stop(); setRecording(false); return }
    if (pendingAudioUrl) { URL.revokeObjectURL(pendingAudioUrl); setPendingAudioUrl(null) }
    setPendingAudioBlob(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      // 7.5 P1-A: the browser's own recording format (Safari records mp4), labelled as such.
      const mime = pickRecorderMime()
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      rec.ondataavailable = e => chunksRef.current.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime || 'audio/webm' })
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
    space, spaceNotice, spaceActions, newConversation, openConversation, deleteConversation, deleteSpace,
    activeConversationId: conversationRef.current?.id ?? null,
    phase, setPhase, hydrated, persistWarning, resetChat, registerExport, splashMsg, splashRev, lang, setLang, pickLang, pickOther, otherLang, mentor, setMentor, topic, setTopic,
    msgs, input, setInput, loading, recording, showExport, setShowExport, activeMode, setActiveMode,
    voiceMode, setVoiceMode, voiceStatus: voice.status, voiceError: voice.error, voiceLevel: voice.level, player, playerState,
    pendingAudioBlob, pendingAudioUrl, pendingFiles, setPendingFiles, setPendingAudioUrl, setPendingAudioBlob,
    fileInputRef, session, msgsEndRef, taRef, mm, copy, sendComposer, startChat, selectMode, toggleRec, handleFile,
  }
}
