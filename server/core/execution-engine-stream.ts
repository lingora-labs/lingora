// =============================================================================
// server/core/execution-engine-stream.ts
// LINGORA SEEK 3.0 — Streaming Execution Engine
// =============================================================================
//
// ── SSE CONTRACT (verified against app/beta/page.tsx SEEK 2.6) ───────────────
//
//   Frontend accumulates text from: { delta: string }
//   Frontend applies state from:    { done: true, state, artifact?, suggestedActions? }
//
//   This engine emits:
//     data: {"delta":"...partial mentor text..."}\n\n    (0–N times)
//     data: {"delta":"...commercial suffix..."}\n\n      (0–1 times, if triggered)
//     data: {"done":true,"state":{...},...}\n\n          (exactly once)
//
//   Commercial parity:
//     The commercial suffix is emitted as a FINAL delta event, immediately
//     before the terminal done. This ensures it is accumulated by the frontend
//     into the same message as the mentor text — identical to the JSON branch
//     where it is appended to result.message before returning.
//
//     JSON:  message = mentorText + "\n\n" + commercialSuffix  →  in ChatResponse.message
//     SSE:   delta(mentorText) + delta(commercialSuffix)        →  accumulated in frontend
//     Result: user sees same content in both branches. ✅
//
// ── getMentorResponseStream — REQUIRED EXTENSION ────────────────────────────
//
//   SEEK 2.6 mentor-engine.ts only exports getMentorResponse() (non-streaming).
//   The streaming branch requires getMentorResponseStream() which must be added
//   to mentor-engine.ts as part of Sprint 2.7.
//
//   Required contract (formal declaration):
//
//     export async function getMentorResponseStream(params: {
//       request:      ChatRequest;
//       state:        SessionState;
//       plan:         ExecutionPlan;
//       priorContext: string;
//       action:       string;
//     }): Promise<AsyncGenerator<string>>
//
//   Until getMentorResponseStream() is implemented in mentor-engine.ts,
//   the stream engine falls back to getMentorResponse() and emits the complete
//   text as a single delta. This preserves the SSE wire format contract and
//   keeps the frontend compatible, at the cost of no incremental streaming
//   for the mentor text. The fallback is declared explicitly and logs a warning.
//
// ── INVARIANTS ────────────────────────────────────────────────────────────────
//   1. ORDER: Steps walk executionOrder ascending. No grouping by executor.
//   2. DEPENDSON: Failure → visible degraded step, not silent skip.
//   3. MENTOR GATE: executor='mentor' always runs. plan.mentor is metadata only.
//   4. PATCH/STATE: buildStatePatch() → StatePatch (delta).
//                   mergeStatePatch() → updatedState (final).
//                   Terminal done emits updatedState, not statePatch.
//   5. COMMERCIAL: Emitted as final delta before done (observable in UI).
//                  Evaluated with post-merge updatedState — same as JSON branch.
//
// Commit   : fix(execution-engine-stream): commercial as final delta for UI
//            observability; getMentorResponseStream formally declared;
//            fallback to getMentorResponse if stream variant unavailable
// =============================================================================

import {
  ExecutionPlan,
  ExecutionStep,
  ExecutionStepResult,
  ExecutorType,
  ArtifactPayload,
  SessionState,
  StatePatch,
  ChatRequest,
  SuggestedAction,
} from '../../lib/contracts';

import { ExecutionResult }                    from './execution-engine';
import { advanceTutorPhase, mergeStatePatch } from './state-manager';
import { evaluateCommercial }                 from './commercial-engine-adapter';

// ─────────────────────────────────────────────────────────────────────────────
// SSE WIRE FORMAT — exactly what app/beta/page.tsx SEEK 2.6 consumes
// ─────────────────────────────────────────────────────────────────────────────

interface SSEDelta { delta: string; }
interface SSEDone  {
  done:              true;
  state:             SessionState;
  artifact?:         ArtifactPayload;
  suggestedActions?: SuggestedAction[];
}
type SSEPayload = SSEDelta | SSEDone;

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL
// ─────────────────────────────────────────────────────────────────────────────

interface StepOutput {
  stepOrder:  number;
  executor:   ExecutorType;
  text?:      string;
  artifact?:  ArtifactPayload;
  patch?:     StatePatch;
  durationMs: number;
  success:    boolean;
  error?:     string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export function executePlanStream(
  plan: ExecutionPlan,
  request: ChatRequest,
  state: SessionState,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {

      function emit(payload: SSEPayload): void {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }

      const priorResults = new Map<number, StepOutput>();

      try {
        const orderedSteps = [...plan.executionOrder].sort(
          (a, b) => a.order - b.order,
        );

        // ── Walk steps in exact plan order ────────────────────────────────
        for (const step of orderedSteps) {

          // dependsOn resolution
          if (step.dependsOn !== undefined) {
            const dep = priorResults.get(step.dependsOn);
            if (!dep || !dep.success) {
              priorResults.set(step.order, degradedStep(step, `dep ${step.dependsOn} failed`));
              console.error(`[stream] step ${step.order} skipped: dep ${step.dependsOn} failed`);
              continue;
            }
          }

          const priorText = collectPriorText(priorResults, step.order);

          // ── MENTOR STEP — always executes; streams if possible ────────────
          if (step.executor === 'mentor') {
            if (!plan.mentor) {
              console.warn(`[stream] step ${step.order}: plan.mentor missing — will use default directive`);
            }
            const start = Date.now();
            try {
              const { getMentorResponseStream, getMentorResponse } = await import('../mentors/mentor-engine');

              if (typeof getMentorResponseStream === 'function') {
                // ── Streaming path (Sprint 2.7+ when getMentorResponseStream exists) ──
                const stream = await getMentorResponseStream({
                  request, state, plan, priorContext: priorText, action: step.action,
                });
                let fullText = '';
                for await (const delta of stream) {
                  fullText += delta;
                  emit({ delta }); // frontend accumulates
                }
                priorResults.set(step.order, {
                  stepOrder: step.order, executor: 'mentor',
                  text: fullText, durationMs: Date.now() - start, success: true,
                });

              } else {
                // ── Fallback path (SEEK 2.6 mentor-engine without stream variant) ──
                // Emits complete mentor text as a single delta.
                // SSE wire format is preserved; incremental streaming is not available.
                console.warn(`[stream] getMentorResponseStream not found — falling back to getMentorResponse`);
                const fullText = await getMentorResponse({
                  request, state, plan, priorContext: priorText, action: step.action,
                });
                emit({ delta: fullText }); // single delta — still valid SSE
                priorResults.set(step.order, {
                  stepOrder: step.order, executor: 'mentor',
                  text: fullText, durationMs: Date.now() - start, success: true,
                });
              }

            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[stream] mentor step ${step.order} failed:`, msg);
              priorResults.set(step.order, degradedStep(step, msg));
            }

          // ── NON-MENTOR STEP — execute synchronously ───────────────────────
          } else {
            const output = await executeSyncStep(step, request, state, priorText);
            priorResults.set(step.order, output);
            // Non-mentor artifacts travel in terminal done event — not mid-stream
          }
        }

        // ── Build statePatch (delta) ───────────────────────────────────────
        const statePatch   = buildStatePatch(plan, state, priorResults);

        // ── Merge → updatedState (final) ──────────────────────────────────
        // These two are kept separate throughout.
        // Terminal event emits updatedState (not statePatch).
        const updatedState = mergeStatePatch(state, statePatch);

        // ── Artifact ──────────────────────────────────────────────────────
        const outputs = Array.from(priorResults.values());
        const artifact =
          outputs.find(o => o.artifact && o.executor !== 'mentor')?.artifact
          ?? outputs.find(o => o.artifact && o.executor === 'mentor')?.artifact;

        // ── Suggested actions ─────────────────────────────────────────────
        const suggestedActions = buildSuggestedActions(plan, artifact, updatedState);

        // ── Commercial — evaluated post-merge with updatedState ───────────
        // Parity: same evaluateCommercial(), same updatedState, same timing as JSON.
        // Observable: emitted as a final DELTA before done, so frontend accumulates
        // it into the same message as mentor text — identical user experience to JSON.
        if (!plan.blocking) {
          const commercial = await evaluateCommercial(updatedState, plan);
          if (commercial.triggered && commercial.message) {
            // Emit as final delta: "\n\n" + suffix — same separator as JSON branch
            emit({ delta: `\n\n${commercial.message}` });
          }
        }

        // ── Terminal event — frontend wire format ─────────────────────────
        // state: updatedState (already merged) — not statePatch
        const donePayload: SSEDone = {
          done:  true,
          state: updatedState,
          ...(artifact               && { artifact }),
          ...(suggestedActions.length > 0 && { suggestedActions }),
        };
        emit(donePayload);
        controller.close();

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Stream error';
        console.error('[stream] fatal:', msg);
        // Terminal event even on fatal — frontend must not hang
        emit({
          done:  true,
          state: mergeStatePatch(state, { tokens: (state.tokens ?? 0) + 1 }),
        });
        controller.close();
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE PATCH BUILDER
// Mirrors execution-engine.ts compileResult() lines 381–408 exactly.
// ─────────────────────────────────────────────────────────────────────────────

function buildStatePatch(
  plan: ExecutionPlan,
  state: SessionState,
  priorResults: Map<number, StepOutput>,
): StatePatch {
  const outputs = Array.from(priorResults.values());

  const patch: StatePatch = outputs.reduce(
    (acc, o) => (o.patch ? { ...acc, ...o.patch } : acc),
    {} as StatePatch,
  );

  patch.tokens = (state.tokens ?? 0) + 1;

  if (plan.priority >= 100) patch.requestedOperation = undefined;

  if (!plan.skipPhaseAdvance && state.activeMode === 'structured') {
    patch.tutorPhase = advanceTutorPhase(state.tutorPhase, state.activeMode);
  }

  return patch;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC DISPATCHER — mirrors execution-engine.ts
// ─────────────────────────────────────────────────────────────────────────────

interface SyncOut { text?: string; artifact?: ArtifactPayload; patch?: StatePatch; }

async function executeSyncStep(
  step: ExecutionStep,
  request: ChatRequest,
  state: SessionState,
  priorContext: string,
): Promise<StepOutput> {
  const start = Date.now();
  try {
    const out = await dispatchSync(step, request, state, priorContext);
    return {
      stepOrder: step.order, executor: step.executor,
      text: out.text, artifact: out.artifact, patch: out.patch,
      durationMs: Date.now() - start, success: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return degradedStep(step, msg, Date.now() - start);
  }
}

async function dispatchSync(
  step: ExecutionStep,
  request: ChatRequest,
  state: SessionState,
  priorContext: string,
): Promise<SyncOut> {
  switch (step.executor) {
    case 'tool_schema': {
      const { generateSchemaContent } = await import('../tools/schema-generator');
      const topic = priorContext || request.message;
      const data  = await generateSchemaContent({
        topic,
        level:      state.confirmedLevel ?? state.userLevel ?? 'B1',
        uiLanguage: state.interfaceLanguage ?? 'en',
      });
      // Wrap SchemaContent in a schema artifact for the artifact renderer
      return { artifact: { type: 'schema', sections: [], ...data } as any };
    }
    case 'tool_pdf': {
      const { generatePDF } = await import('../tools/pdf-generator');
      const title  = state.lastConcept ?? 'LINGORA Study Guide';
      const result = await generatePDF({ title, content: request.message });
      const artifact = result.success
        ? { type: 'pdf' as const, title, url: result.url, dataUrl: result.url }
        : undefined;
      return { artifact };
    }
    case 'tool_image': {
      const { generateImage } = await import('../tools/image-generator');
      const prompt = priorContext || request.message;
      const result = await generateImage(prompt);
      if (result?.success && result.url) {
        return { artifact: {
          type: 'illustration' as const,
          prompt,
          url: result.url,
          caption: result.message ?? undefined,
        }};
      }
      return {};
    }
    case 'tool_audio': {
      const { transcribeAudio } = await import('../tools/audio-toolkit');
      const audioData = request.audioDataUrl
        ? { data: request.audioDataUrl.split(',')[1] || request.audioDataUrl, format: request.audioMimeType?.split('/')[1] || 'webm' }
        : null;
      if (!audioData) return {};
      const result = await transcribeAudio(audioData);
      return { text: result.success ? result.text : undefined };
    }
    case 'tool_attachment': {
      const { processAttachment } = await import('../tools/attachment-processor');
      // Map AttachedFile[] to the shape processAttachment expects
      const filesToProcess = (request.files ?? []).map(f => ({
        name: f.name,
        type: f.type,
        size: f.size,
        data: f.base64 ?? (f.dataUrl ? f.dataUrl.split(',')[1] ?? f.dataUrl : ''),
      }));
      const r = await processAttachment(
        filesToProcess,
        state as Record<string, unknown>,
      );
      const text = r?.extractedTexts?.[0] ?? undefined;
      return { text };
    }
    case 'knowledge': {
      const { getRagContext } = await import('../knowledge/rag');
      const result = await getRagContext(request.message);
      return { text: result?.text ?? undefined };
    }
    case 'diagnostic': {
      const { evaluateLevel } = await import('./diagnostics');
      const samples = [request.message];
      const result = await evaluateLevel(samples);
      const patch = result.confidence !== 'insufficient'
        ? { confirmedLevel: result.level as any, diagnosticSamples: (state.diagnosticSamples ?? 0) + 1 }
        : { diagnosticSamples: (state.diagnosticSamples ?? 0) + 1 };
      return { patch };
    }
    case 'tool_storage':
    case 'commercial':
      return {};
    default:
      console.warn(`[stream] unknown executor "${step.executor}" — skipping`);
      return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTED ACTIONS — identical to execution-engine.ts
// ─────────────────────────────────────────────────────────────────────────────

function buildSuggestedActions(
  plan: ExecutionPlan,
  artifact: ArtifactPayload | undefined,
  state: SessionState,
): SuggestedAction[] {
  const lang = state.interfaceLanguage ?? 'en';
  const a: SuggestedAction[] = [];

  if (artifact?.type === 'quiz')                                         a.push({ type: 'start_quiz',      label: loc('start_quiz', lang) });
  if (artifact?.type === 'schema' || artifact?.type === 'schema_pro')    a.push({ type: 'export_chat_pdf', label: loc('export_chat_pdf', lang) });
  if (artifact?.type === 'roadmap')                                      a.push({ type: 'start_course',    label: loc('start_course', lang) });
  if (plan.pedagogicalAction === 'feedback' && state.activeMode === 'structured')
                                                                          a.push({ type: 'next_module',     label: loc('next_module', lang) });
  if (plan.pedagogicalAction === 'lesson')                               a.push({ type: 'show_schema',     label: loc('show_schema', lang) });
  a.push({ type: 'export_chat_pdf', label: loc('export_chat_pdf', lang) });
  return a.filter((x, i, arr) => arr.findIndex(b => b.type === x.type) === i);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function collectPriorText(r: Map<number, StepOutput>, order: number): string {
  return Array.from(r.values())
    .filter(s => s.stepOrder < order && s.text)
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map(s => s.text!)
    .join('\n\n');
}

function degradedStep(step: ExecutionStep, reason: string, durationMs = 0): StepOutput {
  return { stepOrder: step.order, executor: step.executor, durationMs, success: false, error: reason };
}

const LABELS: Record<string, Record<string, string>> = {
  start_quiz:      { en: 'Start quiz',    es: 'Empezar quiz',     no: 'Start quiz' },
  export_chat_pdf: { en: 'Export as PDF', es: 'Exportar a PDF',   no: 'Eksporter som PDF' },
  next_module:     { en: 'Next module',   es: 'Siguiente módulo', no: 'Neste modul' },
  start_course:    { en: 'Start course',  es: 'Empezar curso',    no: 'Start kurs' },
  show_schema:     { en: 'Show schema',   es: 'Ver esquema',      no: 'Vis skjema' },
};
function loc(k: string, l: string): string { return LABELS[k]?.[l] ?? LABELS[k]?.['en'] ?? k; }
