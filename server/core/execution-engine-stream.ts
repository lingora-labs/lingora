// SEEK 4.1c2 stream + E-06/P8 post-content multi-signal fulfillment
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
  artifacts?: ArtifactPayload[]
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
        if (signals.length > 0) {
          const { fulfillArtifactSignals } = await import('./artifact-side-effect')
          artifacts = await fulfillArtifactSignals(signals, fullText, state)
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
