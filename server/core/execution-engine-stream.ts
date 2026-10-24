// SEEK 4.1c2 stream + E-06/P8 post-content multi-signal fulfillment
// P14-C — SSEDone gains artifactFailures: ArtifactFailure[], additive and
// optional (legacy consumers that don't read it are unaffected — D4). This
// is the same result channel that already carries artifacts[], extended
// with the sibling failure case instead of a parallel notification system.
import {
  ExecutionPlan,
  ArtifactPayload,
  SessionState,
  ChatRequest,
  SuggestedAction,
  ArtifactRegistryEntry,
} from '../../lib/contracts'
import { mergeStatePatch, documentContractStatePatch, toWireState } from './state-manager'
import { recordedImmersionOfferPatch } from './commercial-context'
import { validateLearningFacts, type AcceptedLearningFact, type LearningFactRejection } from '../../lib/learning-facts'
import { mentionsImmersionChannel } from '../../lib/commercial-context'
import { buildContextualActions } from './suggested-actions'
import type { ArtifactSignal } from '../../lib/artifact-signal'
import { creditLearningProgress } from '../../lib/progress-tokens'
import type { ArtifactFailure } from './artifact-side-effect'

interface SSEDelta { delta: string }
interface SSEDone {
  done: true
  turnState?: 'complete' | 'complete_with_failures' | 'failed'
  servedModel?: string
  clientDeliveries?: string[]
  state: SessionState
  artifact?: ArtifactPayload
  artifacts?: ArtifactPayload[]
  artifactFailures?: ArtifactFailure[]
  artifactSignals?: ArtifactSignal[]
  suggestedActions?: SuggestedAction[]
  // 7.5: student facts the Tutor declared and the runtime accepted on provenance; the browser stores them in the Space.
  learningFacts?: AcceptedLearningFact[]
  learningFactRejections?: LearningFactRejection[]
}

const TUTOR_FAILURES: Record<string, string | null> = {
  provider_unavailable: 'El Tutor no respondió: el proveedor del modelo no estaba disponible. Puedes reintentar.',
  provider_stream_interrupted: 'La respuesta del Tutor se interrumpió durante la transmisión. Puedes reintentar.',
  continuation_interrupted: 'El Tutor empezó a escribir el material pero la transmisión se cortó. Puedes reintentar.',
  empty_response: 'El Tutor no devolvió texto en este turno. Puedes reintentar.',
  invalid_tool_json: 'Una instrucción técnica del Tutor llegó incompleta y no se pudo ejecutar.',
  invalid_delivery_call: 'El Tutor pidió una entrega con datos incompletos (tipo o título) y no se generó.',
  invalid_tool_contract: 'El Tutor declaró materiales con un formato que el sistema no reconoce; no se generaron.',
  closure_artifacts_missing: 'El Tutor cerró el turno sin la lista de materiales; no se generó ninguno.',
  unknown_tool: 'El Tutor usó una herramienta que no existe; se ignoró.',
  invalid_language_code: 'El Tutor intentó fijar un idioma de explicación no válido; no se guardó.',
  invalid_memory_ops: 'El Tutor intentó guardar una nota de memoria con formato no válido; no se guardó.',
  invalid_learning_fact: 'El Tutor intentó registrar un hecho del alumno con formato no válido; no se guardó.',
  // The exact visible sentence is emitted by mentor-engine; do not duplicate it as an artifact failure.
  model_mismatch: null,
  // Reported per declaration through rejectedReasons.
  artifact_signal_rejected: null,
}
/** Student-facing sentence for a Tutor-turn technical failure, or null when reported elsewhere. */
export function explainTutorFailure(code: string): string | null {
  return code in TUTOR_FAILURES ? TUTOR_FAILURES[code] : `Fallo técnico del turno (${code}).`
}
const DECLARATION: Array<[RegExp, string]> = [
  [/^invalid_type/, 'el tipo de material no existe'],
  [/^invalid_trigger/, 'faltaba el motivo de la solicitud'],
  [/^bad_subject/, 'faltaba el título del material'],
  [/^pdf_contract/, 'un PDF solo se genera cuando el alumno lo pide, con formato pdf o pdf_html'],
  [/^image_contract/, 'una imagen solo se genera cuando el alumno la pide, con formato image'],
  [/^audio_contract/, 'el audio debe declararse con formato audio'],
  [/^native_format/, 'un componente interactivo debe declararse con formato native'],
  [/^native_missing_content/, 'el componente interactivo llegó sin contenido'],
]
export function explainRejectedDeclaration(code: string): string {
  const hit = DECLARATION.find(([re]) => re.test(code))
  return `Un material que el Tutor declaró no se generó: ${hit ? hit[1] : code}`
}

export function executePlanStream(
  plan: ExecutionPlan,
  request: ChatRequest,
  state: SessionState,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (payload: SSEDelta | SSEDone) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }
      try {
        const { getMentorResponseStream } = await import('../mentors/mentor-engine')
        const stream = await getMentorResponseStream({
          request,
          state,
          plan,
          action: plan.executionOrder[0]?.action,
        })
        // The UI already graded the student's clicked answers. Disclose exact
        // selections for a quiz-specific follow-up; the Tutor Maestro provides
        // the explanation, never an inferred substitute for those selections.
        const { disclosedQuizSelections } = await import('../../lib/quiz-evidence')
        const quizFact = disclosedQuizSelections(state.quizEvidence, request.message)
        let fullText = quizFact
        if (quizFact) emit({ delta: quizFact })
        for await (const delta of stream) {
          fullText += delta
          // 7.1 art. 51/52: the runtime never rewrites, trims or reinterprets
          // the Tutor's text. What the Tutor wrote is what is streamed,
          // persisted and delivered (7.4.2: no post-processing of the reply).
          emit({ delta })
        }
        // 7.3: the Tutor's own typed calls are the authorization. The runtime
        // validates technically; it never reads the student's words.
        const deliveries = stream.textDeliveries ?? []
        const signals: ArtifactSignal[] = [...(stream.artifactSignals ?? [])]
        for (const d of deliveries) {
          if (d.kind === 'pdf' || d.kind === 'pdf_html') {
            signals.push({ type: 'emit_pdf', trigger: 'explicit_user_request', subject: d.title, format: d.kind })
          }
        }
        let artifacts: ArtifactPayload[] = []
        let artifactFailures: ArtifactFailure[] = []
        if (signals.length > 0) {
          const { fulfillArtifactSignals } = await import('./artifact-side-effect')
          const fulfilled = await fulfillArtifactSignals(signals, fullText, state, request.message)
          artifacts = fulfilled.artifacts
          artifactFailures = fulfilled.failures
        }

        // Tactile quiz declared by the Tutor: its own numbered questions and options, read by the
        // canonical reader. Never a key; on failure the student sees why.
        const quizDelivery = deliveries.find(d => d.kind === 'quiz')
        if (quizDelivery) {
          const { quizFromTutorText } = await import('./native-artifact')
          const quiz = quizFromTutorText(fullText, quizDelivery.title)
          if ('payload' in quiz) artifacts.push(quiz.payload)
          else artifactFailures.push({ subject: `Quiz táctil «${quizDelivery.title}»: ${quiz.reason}` })
        }

        // The student's own conversation as PDF: the client holds the whole conversation (with its
        // artifacts), so it runs the same full export as the export button. 7.4 built a flat,
        // token-windowed transcript here and titled it "Historial íntegro".
        const clientDeliveries: string[] = deliveries.some(d => d.kind === 'conversation_pdf') ? ['conversation_pdf'] : []

        // Article 27 is explicit UI authorization. The SAME tutor's real
        // free-text lesson becomes an expandable native review via the existing
        // validated materializer; no JSON tool output or second teacher.
        if(request.uiAction==='create_visual_review'){
          const { groundedMilestoneReview } = await import('./native-artifact')
          const review=groundedMilestoneReview(fullText,[],state.currentLessonTopic||'Último tema estudiado')
          if(review)artifacts.push(review)
          else artifactFailures.push({subject:'Esquema de refuerzo: falta contenido desarrollado'})
        }
        // 7.5: every technical failure of the turn reaches the student, by name (7.4 only logged most).
        for (const reason of stream.rejectedReasons ?? []) artifactFailures.push({ subject: explainRejectedDeclaration(reason) })
        for (const reason of new Set(stream.deliveryFailures ?? [])) {
          const sentence = explainTutorFailure(reason)
          if (sentence) artifactFailures.push({ subject: sentence })
        }
        if (stream.usage) console.info('[tutor-usage]', JSON.stringify({ model: stream.servedModel ?? null, ...stream.usage }))

        // P16 — VOICE CONVERSATION: if this turn started as spoken input,
        // the SAME text response Tutor Core just produced is also spoken by
        // default — a transport/turn-taking decision, not a pedagogical
        // one. Sarah does not have to call signal_artifact just to talk
        // back; that mechanism stays reserved for deliberate audio
        // artifacts (pronunciation models, saved listening material) via
        // fulfillArtifactSignals above. Exactly fullText is spoken — no
        // second model, no shorter/parallel answer, no new tutor. If an
        // emit_audio signal already produced an audio artifact this turn,
        // do not speak a second time.
        if (request.audioDataUrl && fullText.trim().length > 0
            && !artifacts.some((a) => (a as { type?: string }).type === 'audio')) {
          try {
            const { speakTutorText } = await import('../tools/audio-toolkit')
            const { voiceFor } = await import('./artifact-side-effect')
            const tts = await speakTutorText(fullText, { voice: voiceFor((state as unknown as { mentorProfile?: string }).mentorProfile ?? 'alex') })
            if (tts.success && tts.url) {
              artifacts.push({ type: 'audio', dataUrl: tts.url } as ArtifactPayload)
            } else {
              console.error('[P16] voice-turn TTS failed', tts.message)
              artifactFailures.push({ subject: `Respuesta hablada: ${tts.message ?? 'no se generó el audio'}` })
            }
          } catch (e) {
            console.error('[P16] voice-turn TTS exception', e instanceof Error ? e.message : e)
            artifactFailures.push({ subject: `Respuesta hablada: ${e instanceof Error ? e.message : 'no se generó el audio'}` })
          }
        }

        // 7.4.1: a retry re-materialises what the Tutor ALREADY wrote (same signals, same text, same message);
        // it is offered only for the PDF/HTML declarations a click can legitimately repeat.
        const retrySignals = signals.filter(s => s.type === 'emit_pdf')
        const artifact = artifacts[0]
        const progress=creditLearningProgress(state,request)
        const patch: Record<string, unknown> = { tokens:progress.tokens, progressCredits:progress.progressCredits, engagement:progress.engagement }
        if (stream.explanatoryLanguage) patch.explanatoryLanguage = stream.explanatoryLanguage
        // 7.4: notes the Tutor itself recorded; the platform stores them with provenance and a
        // persisted id counter so a forgotten id is never reissued to a different note.
        if (stream.memoryOps?.length) {
          const { applyMemoryOps } = await import('../../lib/tutor-memory')
          const applied = applyMemoryOps(state.tutorMemory, stream.memoryOps, progress.tokens, new Date().toISOString(), state.tutorMemorySeq)
          patch.tutorMemory = applied.entries
          patch.tutorMemorySeq = applied.seq
          if (applied.rejected.length || applied.evicted) console.warn('[tutor-memory]', JSON.stringify({ rejectedIds: applied.rejected, evicted: applied.evicted, total: applied.entries.length }))
        }
        Object.assign(patch, recordedImmersionOfferPatch(state, fullText))
        // 7.5 (contract @202f6171): facts the Tutor declared this turn. Provenance only: the student's own words
        // must contain the evidence; a decline needs an identifiable invitation in this conversation. They join the
        // Space after this turn, so they never make this same turn eligible for an invitation.
        let learning: { accepted: AcceptedLearningFact[]; rejected: LearningFactRejection[] } = { accepted: [], rejected: [] }
        if (stream.learningFacts?.length) {
          const history = Array.isArray(request.conversationHistory) ? request.conversationHistory : []
          const lastTutor = [...history].reverse().find(h => h.role === 'assistant')?.content ?? ''
          learning = validateLearningFacts(stream.learningFacts, {
            conversationId: typeof request.conversationId === 'string' ? request.conversationId : '',
            currentStudentMessage: request.message ?? '',
            priorStudentMessages: history.filter(h => h.role === 'user').map(h => h.content),
            invitationInConversation: (state.commercialOffers ?? []).some(o => o && state.sessionId != null && o.sessionId === state.sessionId)
              || mentionsImmersionChannel(lastTutor),
            at: new Date().toISOString(),
          })
          // Codes only: no student text in logs.
          console.info('[learning-facts]', JSON.stringify({ declared: stream.learningFacts.map(f => f.fact), accepted: learning.accepted.map(f => f.fact), rejected: learning.rejected }))
        }
        // Mode phases are observable state, not a separate pedagogical model.
        // A native tutor-authored quiz opens the exercise phase; after the
        // student's tactile answers the following turn gives feedback.
        if (state.activeMode === 'structured') {
          if (artifacts.some(a => a.type === 'quiz')) patch.tutorPhase = 'quiz'
          else if (state.tutorPhase === 'feedback') {
            patch.tutorPhase = 'lesson'
          }
        }
        // P17 Defect 4 — TOPIC CONTINUITY. Root cause: lastConcept was only
        // ever written in execution-engine.ts (the blocking path). Mentor-
        // first plans — the path for nearly all free-text teaching turns —
        // are blocking:false and always run through THIS file instead,
        // which never wrote lastConcept at all, so a later short follow-up
        // ("quiero tabla") fell through to a generic default instead of the
        // active subject. Mirrors execution-engine.ts's exact logic.
        const resolvedTopic = plan.resolvedTopic?.trim()
        if (resolvedTopic && resolvedTopic !== 'Spanish grammar') {
          patch.lastConcept = resolvedTopic
        }
        if (artifacts.length > 0) {
          const existing = (state as { artifactRegistry?: ArtifactRegistryEntry[] }).artifactRegistry ?? []
          patch.artifactRegistry = [
            ...existing,
            ...artifacts.map((item, i) => ({
              id: `${item.type}-${Date.now()}-${i}`,
              type: item.type,
              title: (item as { title?: string }).title ?? item.type,
              generatedAt: Date.now(),
              payload: item,
            })),
          ].slice(-20)
        }
        // DAE fix (AE-EXECUTE round, defect H) — Work's real-UI QA proved
        // this file never applied plan.clearDocumentContract at all: the
        // blocking execution-engine.ts's compileResult() had it, this
        // streaming path did not, so a redirect-with-instruction turn could
        // answer correctly (E/AE-05 passes) while the stale document
        // contract stayed alive for the next turn whenever that turn
        // streamed (H fails). Fix is the SAME shared mechanism
        // execution-engine.ts now calls — clearDocumentContractIfRequested()
        // in state-manager.ts — not a second, independently-maintained copy
        // of the same `if` check (AE: "preferiblemente con un mecanismo de
        // actualización compartido en vez de duplicar reglas").
        Object.assign(patch, documentContractStatePatch(plan, artifacts))
        const updatedState = mergeStatePatch(state, patch)
        // DAE fix (AE-EXECUTE round, defect C, completing the fix) —
        // mergeStatePatch() already translated this turn's null-as-clear
        // sentinel into `undefined` on updatedState (correct for the
        // server's OWN in-memory SessionState). Sending updatedState
        // directly over SSE would let JSON.stringify drop that now-bare
        // undefined key again — the exact same loss, one level deeper.
        // toWireState() re-applies the explicit null, from the ORIGINAL
        // patch, onto a wire-only copy so it survives transport; the
        // server's own updatedState object above is untouched.
        const wireState = toWireState(updatedState, patch)
        emit({
          done: true,
          servedModel: stream.servedModel,
          state: wireState,
          ...(artifact ? { artifact } : {}),
          ...(artifacts.length ? { artifacts } : {}),
          ...(artifactFailures.length ? { artifactFailures } : {}),
          ...(signals.length ? { artifactSignals: signals } : {}),
          ...(clientDeliveries.length ? { clientDeliveries } : {}),
          ...(learning.accepted.length ? { learningFacts: learning.accepted } : {}),
          ...(learning.rejected.length ? { learningFactRejections: learning.rejected } : {}),
          turnState: stream.deliveryFailure === 'model_mismatch' ? 'failed' : artifactFailures.length ? 'complete_with_failures' : 'complete',
          // P18 (continuation) — ROOT GAP: this used to be
          // `artifact ? [export_chat_pdf] : undefined` — no artifact meant
          // NO suggested actions at all from the backend, and the frontend's
          // own fallback then silently defaulted to a single "Export PDF"
          // button on almost every ordinary conversational turn (this is the
          // dominant path for conversation after the P18 first-turn fix).
          // Now shares the same contextual builder as the blocking path —
          // same trigger conditions, same 2-4 relevant actions per mentor
          // specialty, for every transport.
          suggestedActions: (progress.hitFive ? [{type:'create_visual_review',action:'create_visual_review',label:'Crear mi esquema visual'} as SuggestedAction] : []).concat(retrySignals.length && artifactFailures.length ? [{type:'retry_delivery',action:'retry_delivery',label:'Reintentar entrega',payload:{signals:retrySignals}} as SuggestedAction] : []).concat(buildContextualActions({
            pedagogicalAction: plan.pedagogicalAction,
            artifactType: artifact?.type,
            mentorProfile: (state as unknown as { mentorProfile?: string }).mentorProfile,
            interfaceLanguage: (state as unknown as { interfaceLanguage?: string }).interfaceLanguage,
            activeMode: (state as unknown as { activeMode?: string }).activeMode,
          })),
        })
        controller.close()
      } catch (err) {
        console.error('[stream] fatal:', err instanceof Error ? err.message : err)
        // DAE fix (AE-EXECUTE round, defect H, exhaustiveness) — this
        // fallback path (mentor LLM call failed, e.g. network error) built
        // its OWN separate state patch literal, bypassing the shared
        // clearDocumentContractIfRequested() mechanism entirely. A redirect
        // that fails over to this branch would resurrect the stale
        // document contract exactly like the original defect H, just via a
        // second, uncovered code path instead of the main one. Same shared
        // helper, same call shape, even on the error path.
        const progressFallback=creditLearningProgress(state,request)
        const fallbackPatch: Record<string, unknown> = {tokens:progressFallback.tokens,progressCredits:progressFallback.progressCredits,engagement:progressFallback.engagement}
        Object.assign(fallbackPatch, documentContractStatePatch(plan))
        const fallbackState = mergeStatePatch(state, fallbackPatch)
        // Same wire/internal split as the success path above — see the
        // comment there for why toWireState() must run on top of
        // mergeStatePatch() rather than being skipped on this branch.
        emit({ delta: '\n\nNo se pudo completar la entrega solicitada. Puedes reintentar sin perder la conversación.' })
        emit({ done: true, state: toWireState(fallbackState, fallbackPatch), turnState: 'failed',
          artifactFailures: [{ subject: `Entrega no completada en este turno: ${err instanceof Error ? err.message.slice(0, 160) : 'error interno'}` }],
          suggestedActions: [{type:'retry_delivery',action:'retry_delivery',label:'Reintentar entrega',payload:{message:request.message}} as SuggestedAction] })
        controller.close()
      }
    },
  })
}
