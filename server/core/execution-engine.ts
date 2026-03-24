// =============================================================================
// server/core/execution-engine.ts
// LINGORA SEEK 3.0 — Execution Engine
// =============================================================================
// Purpose  : Execute the ExecutionPlan produced by orchestrator.ts.
//            Reads executionOrder. Executes steps in declared order.
//            Resolves dependsOn. Collects results. Returns compiled outputs.
//
//            THIS MODULE:
//            ✅ Reads ExecutionPlan.executionOrder
//            ✅ Executes steps in order (1 → 2 → 3...)
//            ✅ Resolves dependsOn — step N waits for step M
//            ✅ Collects results from execution layers
//            ✅ Returns ExecutionResult (message + artifact + patch)
//            ❌ Does NOT decide what to execute
//            ❌ Does NOT choose executor types
//            ❌ Does NOT modify priority or blocking
//            ❌ Does NOT reinterpret intent
//            ❌ Does NOT generate ad-hoc routing logic
//
//            ARCHITECTURAL RULE:
//            If this engine needs to "decide", the architecture has failed.
//            Any decision logic found here is a bug and must be moved to
//            orchestrator.ts.
//
// Riesgo principal : Step result contamination — a step producing output that
//                    implicitly influences subsequent steps outside the declared
//                    dependsOn chain. All inter-step data must flow through
//                    StepContext.priorResults explicitly.
//
// Dependencias     : lib/contracts.ts
//                    server/mentors/mentor-engine.ts
//                    server/tools/schema-generator.ts
//                    server/tools/pdf-generator.ts
//                    server/tools/image-generator.ts
//                    server/tools/audio-toolkit.ts
//                    server/knowledge/rag.ts
//                    server/core/diagnostics.ts
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
  SuggestedActionType,
  SchemaArtifact,
  SchemaBlock,
} from '../../lib/contracts';

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION RESULT — what execution-engine returns to route.ts
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionResult {
  message: string;
  artifact?: ArtifactPayload;
  suggestedActions: SuggestedAction[];
  statePatch: StatePatch;
  stepResults: ExecutionStepResult[];
  totalDurationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP CONTEXT — passed to each executor, contains prior step outputs
// ─────────────────────────────────────────────────────────────────────────────

interface StepContext {
  plan: ExecutionPlan;
  request: ChatRequest;
  state: SessionState;
  priorResults: Map<number, StepOutput>;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export async function executePlan(
  plan: ExecutionPlan,
  request: ChatRequest,
  state: SessionState,
): Promise<ExecutionResult> {
  const engineStart = Date.now();

  const orderedSteps = [...plan.executionOrder].sort((a, b) => a.order - b.order);

  const ctx: StepContext = {
    plan,
    request,
    state,
    priorResults: new Map(),
  };

  const stepResults: ExecutionStepResult[] = [];

  for (const step of orderedSteps) {
    if (step.dependsOn !== undefined) {
      const dep = ctx.priorResults.get(step.dependsOn);
      if (!dep || !dep.success) {
        const fallback = buildDegradedStep(
          step,
          `dependency step ${step.dependsOn} failed or missing`,
        );
        ctx.priorResults.set(step.order, fallback);
        stepResults.push(toStepResult(fallback, plan));
        continue;
      }
    }

    const stepOutput = await executeStep(step, ctx);
    ctx.priorResults.set(step.order, stepOutput);
    stepResults.push(toStepResult(stepOutput, plan));
  }

  const compiled = compileResult(plan, ctx);

  return {
    ...compiled,
    stepResults,
    totalDurationMs: Date.now() - engineStart,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP EXECUTOR — dispatches to the correct execution layer
// ─────────────────────────────────────────────────────────────────────────────

async function executeStep(
  step: ExecutionStep,
  ctx: StepContext,
): Promise<StepOutput> {
  const start = Date.now();

  try {
    const output = await dispatchToExecutor(step, ctx);
    return {
      stepOrder: step.order,
      executor: step.executor,
      text: output.text,
      artifact: output.artifact,
      patch: output.patch,
      durationMs: Date.now() - start,
      success: true,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[execution-engine] step ${step.order} (${step.executor}:${step.action}) failed: ${errorMessage}`,
    );

    return buildDegradedStep(step, errorMessage, Date.now() - start);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPATCHER — routes each step to the correct execution layer module
// ─────────────────────────────────────────────────────────────────────────────

interface DispatchOutput {
  text?: string;
  artifact?: ArtifactPayload;
  patch?: StatePatch;
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

async function dispatchToExecutor(
  step: ExecutionStep,
  ctx: StepContext,
): Promise<DispatchOutput> {
  const priorText = collectPriorText(ctx.priorResults, step.order);

  switch (step.executor) {
    case 'mentor': {
      const { getMentorResponse } = await import('../mentors/mentor-engine');
      const text = await getMentorResponse({
        request: ctx.request,
        state: ctx.state,
        plan: ctx.plan,
        priorContext: priorText,
        action: step.action,
      });
      return { text };
    }

    case 'tool_schema': {
      const { generateSchemaContent } = await import('../tools/schema-generator');
      const topic = priorText || ctx.request.message;
      const data = await generateSchemaContent({
        topic,
        level: ctx.state.confirmedLevel ?? ctx.state.userLevel ?? 'B1',
        uiLanguage: ctx.state.interfaceLanguage ?? 'en',
      });
      const artifact = mapSchemaContentToArtifact(data);
      return { artifact };
    }

    case 'tool_pdf': {
      const { generatePDF } = await import('../tools/pdf-generator');
      const title = ctx.state.lastConcept ?? 'LINGORA Study Guide';
      const result = await generatePDF({ title, content: ctx.request.message });

      const artifact = result.success
        ? { type: 'pdf' as const, title, url: result.url, dataUrl: result.url }
        : undefined;

      return { artifact };
    }

    case 'tool_image': {
      const { generateImage } = await import('../tools/image-generator');
      const prompt = priorText || ctx.request.message;
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
      const audioData = ctx.request.audioDataUrl
        ? {
            data:
              ctx.request.audioDataUrl.split(',')[1] || ctx.request.audioDataUrl,
            format: ctx.request.audioMimeType?.split('/')[1] || 'webm',
          }
        : null;

      if (!audioData) return {};

      const result = await transcribeAudio(audioData);
      return {
        text: result.success ? result.text : undefined,
      };
    }

    case 'tool_attachment': {
      const { processAttachment } = await import('../tools/attachment-processor');

      const filesToProcess = (ctx.request.files ?? []).map((f) => ({
        name: f.name,
        type: f.type,
        size: f.size,
        data:
          f.base64 ??
          (f.dataUrl ? f.dataUrl.split(',')[1] ?? f.dataUrl : ''),
      }));

      const result = await processAttachment(
        filesToProcess,
        ctx.state as unknown as Record<string, unknown>,
      );

      const text = result?.extractedTexts?.[0] ?? undefined;
      return { text };
    }

    case 'tool_storage': {
      return {};
    }

    case 'knowledge': {
      const { getRagContext } = await import('../knowledge/rag');
      const result = await getRagContext(ctx.request.message);
      return { text: result?.text ?? undefined };
    }

    case 'diagnostic': {
      const { evaluateLevel } = await import('./diagnostics');
      const samples = [ctx.request.message];
      const result = await evaluateLevel(samples);

      const patch =
        result.confidence !== 'insufficient'
          ? {
              confirmedLevel: result.level as SessionState['confirmedLevel'],
              diagnosticSamples: (ctx.state.diagnosticSamples ?? 0) + 1,
            }
          : {
              diagnosticSamples: (ctx.state.diagnosticSamples ?? 0) + 1,
            };

      return { patch };
    }

    case 'commercial': {
      return {};
    }

    default: {
      console.warn(
        `[execution-engine] unknown executor: "${step.executor}" in step ${step.order}. Skipping.`,
      );
      return {};
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT COMPILER — assembles final ExecutionResult from all step outputs
// ─────────────────────────────────────────────────────────────────────────────

interface CompiledResult {
  message: string;
  artifact?: ArtifactPayload;
  suggestedActions: SuggestedAction[];
  statePatch: StatePatch;
}

function compileResult(
  plan: ExecutionPlan,
  ctx: StepContext,
): CompiledResult {
  const outputs = Array.from(ctx.priorResults.values());

  const textParts = outputs
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((o) => o.text)
    .filter((t): t is string => !!t && t.trim() !== '');

  const message =
    textParts.join('\n\n') ||
    buildFallbackMessage(ctx.state.interfaceLanguage);

  const toolArtifact = outputs.find((o) => o.artifact && o.executor !== 'mentor')
    ?.artifact;
  const mentorArtifact = outputs.find((o) => o.artifact && o.executor === 'mentor')
    ?.artifact;
  const artifact = toolArtifact ?? mentorArtifact;

  const statePatch: StatePatch = outputs.reduce(
    (acc, o) => (o.patch ? { ...acc, ...o.patch } : acc),
    {} as StatePatch,
  );

  statePatch.tokens = (ctx.state.tokens ?? 0) + 1;

  if (plan.priority >= 100) {
    statePatch.requestedOperation = undefined;
  }

  if (!plan.skipPhaseAdvance && ctx.state.activeMode === 'structured') {
    const { advanceTutorPhase } = require('./state-manager');
    statePatch.tutorPhase = advanceTutorPhase(
      ctx.state.tutorPhase,
      ctx.state.activeMode,
    );
  }

  const suggestedActions = buildSuggestedActions(plan, artifact, ctx.state);

  return { message, artifact, suggestedActions, statePatch };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTED ACTIONS BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildSuggestedActions(
  plan: ExecutionPlan,
  artifact: ArtifactPayload | undefined,
  state: SessionState,
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];

  if (artifact) {
    if (artifact.type === 'quiz') {
      actions.push({
        type: 'start_quiz',
        label: getLabel('start_quiz', state.interfaceLanguage),
      });
    }
    if (artifact.type === 'schema' || artifact.type === 'schema_pro') {
      actions.push({
        type: 'export_chat_pdf',
        label: getLabel('export_chat_pdf', state.interfaceLanguage),
      });
    }
    if (artifact.type === 'roadmap') {
      actions.push({
        type: 'start_course',
        label: getLabel('start_course', state.interfaceLanguage),
      });
    }
  }

  if (plan.pedagogicalAction === 'feedback' && state.activeMode === 'structured') {
    actions.push({
      type: 'next_module',
      label: getLabel('next_module', state.interfaceLanguage),
    });
  }

  if (plan.pedagogicalAction === 'lesson') {
    actions.push({
      type: 'show_schema',
      label: getLabel('show_schema', state.interfaceLanguage),
    });
  }

  actions.push({
    type: 'export_chat_pdf',
    label: getLabel('export_chat_pdf', state.interfaceLanguage),
  });

  return actions.filter(
    (a, i, arr) => arr.findIndex((b) => b.type === a.type) === i,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LABEL LOCALISATION
// ─────────────────────────────────────────────────────────────────────────────

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
  retry_quiz: { en: 'Try again', es: 'Intentar de nuevo', no: 'Prøv igjen' },
};

function getLabel(type: SuggestedActionType, lang: string): string {
  return LABELS[type]?.[lang] ?? LABELS[type]?.en ?? type;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function collectPriorText(
  results: Map<number, StepOutput>,
  currentOrder: number,
): string {
  return Array.from(results.values())
    .filter((r) => r.stepOrder < currentOrder && r.text)
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((r) => r.text!)
    .join('\n\n');
}

function buildDegradedStep(
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

function toStepResult(
  output: StepOutput,
  plan: ExecutionPlan,
): ExecutionStepResult {
  return {
    stepOrder: output.stepOrder,
    executor: output.executor,
    action:
      plan.executionOrder.find((s) => s.order === output.stepOrder)?.action ??
      'unknown',
    durationMs: output.durationMs,
    success: output.success,
    error: output.error,
    producedArtifacts: output.artifact ? [output.artifact.type] : [],
  };
}

function buildFallbackMessage(lang: string): string {
  const fallbacks: Record<string, string> = {
    en: "I'm here to help. What would you like to work on?",
    es: 'Estoy aquí para ayudarte. ¿En qué quieres trabajar?',
    no: 'Jeg er her for å hjelpe. Hva vil du jobbe med?',
    it: 'Sono qui per aiutarti. Su cosa vuoi lavorare?',
    fr: "Je suis là pour t'aider. Sur quoi veux-tu travailler?",
  };
  return fallbacks[lang] ?? fallbacks.en;
}
