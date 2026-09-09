// SEEK 4.1c2 stream + SEEK 5.0 E-06 post-content artifact fulfillment
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

interface SSEDelta { delta: string }
interface SSEDone {
  done: true
  state: SessionState
  artifact?: ArtifactPayload
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
        let artifact: ArtifactPayload | undefined
        if (signals.length > 0) {
          const { fulfillArtifactSignals } = await import('./artifact-side-effect')
          artifact = await fulfillArtifactSignals(signals, fullText, state)
        }
        const patch: Record<string, unknown> = { tokens: (state.tokens ?? 0) + 1 }
        if (artifact) {
          const existing = (state as { artifactRegistry?: ArtifactRegistryEntry[] }).artifactRegistry ?? []
          patch.artifactRegistry = [...existing, {
            id: `${artifact.type}-${Date.now()}`,
            type: artifact.type,
            title: (artifact as { title?: string }).title ?? artifact.type,
            generatedAt: Date.now(),
            payload: artifact,
          }].slice(-20)
        }
        const updatedState = mergeStatePatch(state, patch)
        if (!plan.blocking) {
          const commercial = await evaluateCommercial(updatedState, plan)
          if (commercial.triggered && commercial.message) emit({ delta: `\n\n${commercial.message}` })
        }
        const suggestedActions: SuggestedAction[] = artifact
          ? [{ type: 'export_chat_pdf', label: 'Export as PDF' }]
          : []
        emit({
          done: true,
          state: updatedState,
          ...(artifact ? { artifact } : {}),
          ...(suggestedActions.length ? { suggestedActions } : {}),
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
