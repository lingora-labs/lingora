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
import { mergeStatePatch, clearDocumentContractIfRequested, toWireState } from './state-manager'
import { evaluateCommercial } from './commercial-engine-adapter'
import { buildContextualActions } from './suggested-actions'
import type { ArtifactSignal } from '../../lib/artifact-signal'
import { directFormatFor, formatDirectAnswer } from '../../lib/direct-intent-contract'
import type { ArtifactFailure } from './artifact-side-effect'

interface SSEDelta { delta: string }
interface SSEDone {
  done: true
  state: SessionState
  artifact?: ArtifactPayload
  artifacts?: ArtifactPayload[]
  artifactFailures?: ArtifactFailure[]
  artifactSignals?: ArtifactSignal[]
  suggestedActions?: SuggestedAction[]
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
        const directFormat = directFormatFor(request.message)
        let fullText = quizFact
        if (quizFact && !directFormat) emit({ delta: quizFact })
        for await (const delta of stream) {
          fullText += delta
          // Buffer only strict direct transformations; otherwise retain
          // progressive SSE streaming without altering tutoring or artifacts.
          if (!directFormat) emit({ delta })
        }
        if (directFormat) {
          fullText = formatDirectAnswer(directFormat, fullText)
          if (fullText) emit({ delta: fullText })
        }
        // Direct transformation is user authority for text alone.
        const signals: ArtifactSignal[] = directFormat ? [] : (stream.artifactSignals ?? [])
        let artifacts: ArtifactPayload[] = []
        let artifactFailures: ArtifactFailure[] = []
        if (signals.length > 0) {
          const { fulfillArtifactSignals } = await import('./artifact-side-effect')
          const fulfilled = await fulfillArtifactSignals(signals, fullText, state, request.message)
          artifacts = fulfilled.artifacts
          artifactFailures = fulfilled.failures
        }

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
            const { generateSpeech } = await import('../tools/audio-toolkit')
            const MENTOR_VOICES: Record<string, string> = { sarah: 'shimmer', alex: 'fable', nick: 'onyx' }
            const mentorKey = String((state as unknown as { mentorProfile?: string }).mentorProfile ?? 'alex').toLowerCase()
            const voice = MENTOR_VOICES[mentorKey] ?? 'fable'
            const tts = await generateSpeech(fullText, { voice })
            if (tts.success && tts.url) {
              artifacts.push({ type: 'audio', dataUrl: tts.url } as ArtifactPayload)
            } else {
              console.error('[P16] voice-turn TTS failed', tts.message)
              artifactFailures.push({ subject: 'Respuesta hablada' })
            }
          } catch (e) {
            console.error('[P16] voice-turn TTS exception', e instanceof Error ? e.message : e)
            artifactFailures.push({ subject: 'Respuesta hablada' })
          }
        }

        // On a five-turn milestone the tutor's own native schema has priority.
        // If absent, the existing authored explanation can be reorganized
        // WITHOUT a second model or invented pedagogical content.
        const visualDue = ((state.tokens ?? 0) + 1) % 5 === 0 &&
          (state.tokens ?? 0) > 0 && state.activeMode !== 'free' &&
          !/\b(no quiero|sin|no generes|don't|without)\b.{0,45}\b(esquema|visual|artifact|diagrama|scheme)\b/i.test(request.message)
        if (visualDue && !artifacts.some(a => a.type === 'schema_pro')) {
          const { groundedMilestoneReview } = await import('./native-artifact')
          const review = groundedMilestoneReview(fullText,
            (request.conversationHistory ?? []) as Array<{role:string;content:string}>,
            plan.resolvedTopic ?? state.lastConcept ?? 'Tema actual')
          if (review) artifacts.push(review)
          else artifactFailures.push({ subject:'Refuerzo visual del quinto turno' })
        }
        const artifact = artifacts[0]
        const patch: Record<string, unknown> = { tokens: (state.tokens ?? 0) + 1 }
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
        Object.assign(patch, clearDocumentContractIfRequested(plan))
        const updatedState = mergeStatePatch(state, patch)
        if (!plan.blocking) {
          const commercial = await evaluateCommercial(updatedState, plan)
          if (commercial.triggered && commercial.message) emit({ delta: `\n\n${commercial.message}` })
        }
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
          state: wireState,
          ...(artifact ? { artifact } : {}),
          ...(artifacts.length ? { artifacts } : {}),
          ...(artifactFailures.length ? { artifactFailures } : {}),
          ...(signals.length ? { artifactSignals: signals } : {}),
          // P18 (continuation) — ROOT GAP: this used to be
          // `artifact ? [export_chat_pdf] : undefined` — no artifact meant
          // NO suggested actions at all from the backend, and the frontend's
          // own fallback then silently defaulted to a single "Export PDF"
          // button on almost every ordinary conversational turn (this is the
          // dominant path for conversation after the P18 first-turn fix).
          // Now shares the same contextual builder as the blocking path —
          // same trigger conditions, same 2-4 relevant actions per mentor
          // specialty, for every transport.
          suggestedActions: buildContextualActions({
            pedagogicalAction: plan.pedagogicalAction,
            artifactType: artifact?.type,
            mentorProfile: (state as unknown as { mentorProfile?: string }).mentorProfile,
            interfaceLanguage: (state as unknown as { interfaceLanguage?: string }).interfaceLanguage,
            activeMode: (state as unknown as { activeMode?: string }).activeMode,
          }),
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
        const fallbackPatch: Record<string, unknown> = { tokens: (state.tokens ?? 0) + 1 }
        Object.assign(fallbackPatch, clearDocumentContractIfRequested(plan))
        const fallbackState = mergeStatePatch(state, fallbackPatch)
        // Same wire/internal split as the success path above — see the
        // comment there for why toWireState() must run on top of
        // mergeStatePatch() rather than being skipped on this branch.
        emit({ delta: '\n\nNo pude completar esta entrega. Los materiales solicitados no están disponibles; inténtalo de nuevo.' })
        emit({ done: true, state: toWireState(fallbackState, fallbackPatch),
          artifactFailures: [{ subject: 'Entrega no completada en este turno' }] })
        controller.close()
      }
    },
  })
}
