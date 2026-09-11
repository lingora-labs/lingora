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
import { mergeStatePatch } from './state-manager'
import { evaluateCommercial } from './commercial-engine-adapter'
import type { ArtifactSignal } from '../../lib/artifact-signal'
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
        let fullText = ''
        for await (const delta of stream) {
          fullText += delta
          emit({ delta })
        }
        const signals: ArtifactSignal[] = stream.artifactSignals ?? []
        let artifacts: ArtifactPayload[] = []
        let artifactFailures: ArtifactFailure[] = []
        if (signals.length > 0) {
          const { fulfillArtifactSignals } = await import('./artifact-side-effect')
          const fulfilled = await fulfillArtifactSignals(signals, fullText, state)
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

        const artifact = artifacts[0]
        const patch: Record<string, unknown> = { tokens: (state.tokens ?? 0) + 1 }
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
        const updatedState = mergeStatePatch(state, patch)
        if (!plan.blocking) {
          const commercial = await evaluateCommercial(updatedState, plan)
          if (commercial.triggered && commercial.message) emit({ delta: `\n\n${commercial.message}` })
        }
        emit({
          done: true,
          state: updatedState,
          ...(artifact ? { artifact } : {}),
          ...(artifacts.length ? { artifacts } : {}),
          ...(artifactFailures.length ? { artifactFailures } : {}),
          ...(signals.length ? { artifactSignals: signals } : {}),
          ...(artifact ? { suggestedActions: [{ type: 'export_chat_pdf', label: 'Export as PDF' } as SuggestedAction] } : {}),
        })
        controller.close()
      } catch (err) {
        console.error('[stream] fatal:', err instanceof Error ? err.message : err)
        emit({ done: true, state: mergeStatePatch(state, { tokens: (state.tokens ?? 0) + 1 }) })
        controller.close()
      }
    },
  })
}
