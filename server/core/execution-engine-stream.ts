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
// =============================================================================

import {
  ExecutionPlan,
  ExecutionStep,
  ExecutorType,
  ArtifactPayload,
  SessionState,
  StatePatch,
  ChatRequest,
  SuggestedAction,
  SchemaArtifact,
  SchemaBlock,
} from '../../lib/contracts';

import { advanceTutorPhase, mergeStatePatch } from './state-manager';
import { evaluateCommercial } from './commercial-engine-adapter';

interface SSEDelta {
  delta: string;
}
interface SSEDone {
  done: true;
  state: SessionState;
  artifact?: ArtifactPayload;
  suggestedActions?: SuggestedAction[];
}
type SSEPayload = SSEDelta | SSEDone;

interface StepOutput {
  stepOrder: number;
  executor: ExecutorType;
  text?: string;
  artifact?: ArtifactPayload;
  patch?: StatePatch;
  durationMs: number;
  success: boolean;
  error?: string;
}

function mapSchemaContentToArtifact(data: {
  title: string;
  objective?: string;
  keyConcepts?: string[];
  subtopics?: Array<{ title: string; content: string }>;
  examples?: string[];
  summary?: string;
  quiz?: Array<{ question: string; options: string[]; correct: number }>;
}): SchemaArtifact {
  const sections: SchemaBlock[] = [
    ...(data.keyConcepts?.map((k) => ({ label: 'Concepto', content: k })) ?? []),
    ...(data.subtopics?.map((s) => ({ label: s.title, content: s.content })) ?? []),
    ...(data.examples?.map((e) => ({ label: 'Ejemplo', content: e })) ?? []),
    ...(data.summary ? [{ label: 'Resumen', content: data.summary }] : []),
  ];

  return {
    type: 'schema',
    title: data.title,
    objective: data.objective,
    sections,
    quiz: data.quiz?.map((q) => `${q.question} (${q.options.join(' / ')})`),
  };
}

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
        const orderedSteps = [...plan.executionOrder].sort((a, b) => a.order - b.order);

        for (const step of orderedSteps) {
          if (step.dependsOn !== undefined) {
            const dep = priorResults.get(step.dependsOn);
            if (!dep || !dep.success) {
              priorResults.set(
                step.order,
                degradedStep(step, `dep ${step.dependsOn} failed`),
              );
              console.error(
                `[stream] step ${step.order} skipped: dep ${step.dependsOn} failed`,
              );
              continue;
            }
          }

          const priorText = collectPriorText(priorResults, step.order);

          if (step.executor === 'mentor') {
            if (!plan.mentor) {
              console.warn(
                `[stream] step ${step.order}: plan.mentor missing — will use default directive`,
              );
            }

            const start = Date.now();

            try {
              const { getMentorResponseStream, getMentorResponse } = await import(
                '../mentors/mentor-engine'
              );

              if (typeof getMentorResponseStream === 'function') {
                const stream = await getMentorResponseStream({
                  request,
                  state,
                  plan,
                  priorContext: priorText,
                  action: step.action,
                });

                let fullText = '';
                for await (const delta of stream) {
                  fullText += delta;
                  emit({ delta });
                }

                priorResults.set(step.order, {
                  stepOrder: step.order,
                  executor: 'mentor',
                  text: fullText,
                  durationMs: Date.now() - start,
                  success: true,
                });
              } else {
                console.warn(
                  '[stream] getMentorResponseStream not found — falling back to getMentorResponse',
                );

                const fullText = await getMentorResponse({
                  request,
                  state,
                  plan,
                  priorContext: priorText,
                  action: step.action,
                });

                emit({ delta: fullText });

                priorResults.set(step.order, {
                  stepOrder: step.order,
                  executor: 'mentor',
                  text: fullText,
                  durationMs: Date.now() - start,
                  success: true,
                });
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[stream] mentor step ${step.order} failed:`, msg);
              priorResults.set(step.order, degradedStep(step, msg));
            }
          } else {
            const output = await executeSyncStep(step, request, state, priorText);
            priorResults.set(step.order, output);
          }
        }

        const statePatch = buildStatePatch(plan, state, priorResults);
        const updatedState = mergeStatePatch(state, statePatch);

        const outputs = Array.from(priorResults.values());
        const artifact =
          outputs.find((o) => o.artifact && o.executor !== 'mentor')?.artifact ??
          outputs.find((o) => o.artifact && o.executor === 'mentor')?.artifact;

        const suggestedActions = buildSuggestedActions(plan, artifact, updatedState);

        if (!plan.blocking) {
          const commercial = await evaluateCommercial(updatedState, plan);
          if (commercial.triggered && commercial.message) {
            emit({ delta: `\n\n${commercial.message}` });
          }
        }

        const donePayload: SSEDone = {
          done: true,
          state: updatedState,
          ...(artifact && { artifact }),
          ...(suggestedActions.length > 0 && { suggestedActions }),
        };

        emit(donePayload);
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Stream error';
        console.error('[stream] fatal:', msg);

        emit({
          done: true,
          state: mergeStatePatch(state, { tokens: (state.tokens ?? 0) + 1 }),
        });

        controller.close();
      }
    },
  });
}

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

interface SyncOut {
  text?: string;
  artifact?: ArtifactPayload;
  patch?: StatePatch;
}

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
      stepOrder: step.order,
      executor: step.executor,
      text: out.text,
      artifact: out.artifact,
      patch: out.patch,
      durationMs: Date.now() - start,
      success: true,
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
      const data = await generateSchemaContent({
        topic,
        level: state.confirmedLevel ?? state.userLevel ?? 'B1',
        uiLanguage: state.interfaceLanguage ?? 'en',
      });

      const artifact = mapSchemaContentToArtifact(data);
      return { artifact };
    }

    case 'tool_pdf': {
      const { generatePDF } = await import('../tools/pdf-generator');
      const title = state.lastConcept ?? 'LINGORA Study Guide';
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
        return {
          artifact: {
            type: 'illustration' as const,
            prompt,
            url: result.url,
            caption: result.message ?? undefined,
          },
        };
      }

      return {};
    }

    case 'tool_audio': {
      const { transcribeAudio } = await import('../tools/audio-toolkit');
      const audioData = request.audioDataUrl
        ? {
            data: request.audioDataUrl.split(',')[1] || request.audioDataUrl,
            format: request.audioMimeType?.split('/')[1] || 'webm',
          }
        : null;

      if (!audioData) return {};

      const result = await transcribeAudio(audioData);
      return { text: result.success ? result.text : undefined };
    }

    case 'tool_attachment': {
      const { processAttachment } = await import('../tools/attachment-processor');

      const filesToProcess = (request.files ?? []).map((f) => ({
        name: f.name,
        type: f.type,
        size: f.size,
        data:
          f.base64 ??
          (f.dataUrl ? f.dataUrl.split(',')[1] ?? f.dataUrl : ''),
      }));

      const r = await processAttachment(
        filesToProcess,
        state as unknown as Record<string, unknown>,
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

      const patch =
        result.confidence !== 'insufficient'
          ? {
              confirmedLevel: result.level as SessionState['confirmedLevel'],
              diagnosticSamples: (state.diagnosticSamples ?? 0) + 1,
            }
          : {
              diagnosticSamples: (state.diagnosticSamples ?? 0) + 1,
            };

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

function buildSuggestedActions(
  plan: ExecutionPlan,
  artifact: ArtifactPayload | undefined,
  state: SessionState,
): SuggestedAction[] {
  const lang = state.interfaceLanguage ?? 'en';
  const a: SuggestedAction[] = [];

  if (artifact?.type === 'quiz')
    a.push({ type: 'start_quiz', label: loc('start_quiz', lang) });

  if (artifact?.type === 'schema' || artifact?.type === 'schema_pro')
    a.push({ type: 'export_chat_pdf', label: loc('export_chat_pdf', lang) });

  if (artifact?.type === 'roadmap')
    a.push({ type: 'start_course', label: loc('start_course', lang) });

  if (plan.pedagogicalAction === 'feedback' && state.activeMode === 'structured')
    a.push({ type: 'next_module', label: loc('next_module', lang) });

  if (plan.pedagogicalAction === 'lesson')
    a.push({ type: 'show_schema', label: loc('show_schema', lang) });

  a.push({ type: 'export_chat_pdf', label: loc('export_chat_pdf', lang) });

  return a.filter((x, i, arr) => arr.findIndex((b) => b.type === x.type) === i);
}

function collectPriorText(r: Map<number, StepOutput>, order: number): string {
  return Array.from(r.values())
    .filter((s) => s.stepOrder < order && s.text)
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((s) => s.text!)
    .join('\n\n');
}

function degradedStep(
  step: ExecutionStep,
  reason: string,
  durationMs = 0,
): StepOutput {
  return {
    stepOrder: step.order,
    executor: step.executor,
    durationMs,
    success: false,
    error: reason,
  };
}

const LABELS: Record<string, Record<string, string>> = {
  start_quiz: { en: 'Start quiz', es: 'Empezar quiz', no: 'Start quiz' },
  export_chat_pdf: {
    en: 'Export as PDF',
    es: 'Exportar a PDF',
    no: 'Eksporter som PDF',
  },
  next_module: {
    en: 'Next module',
    es: 'Siguiente módulo',
    no: 'Neste modul',
  },
  start_course: {
    en: 'Start course',
    es: 'Empezar curso',
    no: 'Start kurs',
  },
  show_schema: { en: 'Show schema', es: 'Ver esquema', no: 'Vis skjema' },
};

function loc(k: string, l: string): string {
  return LABELS[k]?.[l] ?? LABELS[k]?.en ?? k;
}
