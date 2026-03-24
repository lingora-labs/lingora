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
//
// Commit   : feat(execution-engine): SEEK 3.0 — ordered step execution with
//            dependsOn resolution, no decision logic
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
} from '../../lib/contracts';

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION RESULT — what execution-engine returns to route.ts
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionResult {
  /** Primary text message for the user */
  message: string;
  /** Artifact to render, if any — determined by plan */
  artifact?: ArtifactPayload;
  /** Suggested actions for the user */
  suggestedActions: SuggestedAction[];
  /** State changes to merge back into SessionState */
  statePatch: StatePatch;
  /** Step-level results for trace/audit */
  stepResults: ExecutionStepResult[];
  /** Total wall time for all steps */
  totalDurationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP CONTEXT — passed to each executor, contains prior step outputs
// ─────────────────────────────────────────────────────────────────────────────

interface StepContext {
  plan: ExecutionPlan;
  request: ChatRequest;
  state: SessionState;
  /** Results from completed steps, keyed by step.order */
  priorResults: Map<number, StepOutput>;
}

interface StepOutput {
  stepOrder: number;
  executor: ExecutorType;
  /** Raw text output from this step, if any */
  text?: string;
  /** Artifact produced by this step, if any */
  artifact?: ArtifactPayload;
  /** Patch from this step */
  patch?: StatePatch;
  durationMs: number;
  success: boolean;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * executePlan
 * ──────────────────────────────────────────────────────────────────────────
 * Executes the given ExecutionPlan step by step, in the order defined by
 * plan.executionOrder. Steps with dependsOn are held until their dependency
 * completes.
 *
 * Returns a compiled ExecutionResult containing the final message, artifact,
 * suggested actions, state patch, and full step audit trail.
 *
 * @param plan    The ExecutionPlan from orchestrator.ts
 * @param request The original ChatRequest
 * @param state   The current (validated) SessionState
 */
export async function executePlan(
  plan: ExecutionPlan,
  request: ChatRequest,
  state: SessionState,
): Promise<ExecutionResult> {
  const engineStart = Date.now();

  // Sort steps by order (ascending) — defensive, plan should already be sorted
  const orderedSteps = [...plan.executionOrder].sort(
    (a, b) => a.order - b.order,
  );

  const ctx: StepContext = {
    plan,
    request,
    state,
    priorResults: new Map(),
  };

  const stepResults: ExecutionStepResult[] = [];

  // ── Execute steps in declared order ──────────────────────────────────────
  for (const step of orderedSteps) {
    // Wait for dependency if declared
    if (step.dependsOn !== undefined) {
      const dep = ctx.priorResults.get(step.dependsOn);
      if (!dep || !dep.success) {
        // Dependency failed — attempt graceful degradation
        const fallback = buildDegradedStep(step, `dependency step ${step.dependsOn} failed or missing`);
        ctx.priorResults.set(step.order, fallback);
        stepResults.push(toStepResult(fallback, plan));
        continue;
      }
    }

    const stepOutput = await executeStep(step, ctx);
    ctx.priorResults.set(step.order, stepOutput);
    stepResults.push(toStepResult(stepOutput, plan));
  }

  // ── Compile final result from all step outputs ────────────────────────────
  const compiled = compileResult(plan, ctx, stepResults);

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
      `[execution-engine] step ${step.order} (${step.executor}:${step.action}) failed: ${errorMessage}`
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

async function dispatchToExecutor(
  step: ExecutionStep,
  ctx: StepContext,
): Promise<DispatchOutput> {

  // Collect prior text context for steps that need it
  const priorText = collectPriorText(ctx.priorResults, step.order);

  switch (step.executor) {

    // ── Mentor ───────────────────────────────────────────────────────────────
    case 'mentor': {
      // Dynamic import to avoid circular dependency at module load time
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

    // ── Schema generator ─────────────────────────────────────────────────────
    case 'tool_schema': {
      const { generateSchemaContent } = await import('../tools/schema-generator');
      const topic = priorText || ctx.request.message;
      const data  = await generateSchemaContent({
        topic,
        level:      ctx.state.confirmedLevel ?? ctx.state.userLevel ?? 'B1',
        uiLanguage: ctx.state.interfaceLanguage ?? 'en',
      });
      const artifact = { type: 'schema' as const, sections: [], ...data };
      return { artifact };
    }

    // ── PDF generator ────────────────────────────────────────────────────────
    case 'tool_pdf': {
      const { generatePDF } = await import('../tools/pdf-generator');
      const title  = ctx.state.lastConcept ?? 'LINGORA Study Guide';
      const result = await generatePDF({ title, content: ctx.request.message });
      const artifact = result.success
        ? { type: 'pdf' as const, title, url: result.url, dataUrl: result.url }
        : undefined;
      return { artifact };
    }

    // ── Image generator ──────────────────────────────────────────────────────
    case 'tool_image': {
      const { generateImage } = await import('../tools/image-generator');
      const prompt = priorText || ctx.request.message;
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

    // ── Audio toolkit ────────────────────────────────────────────────────────
    case 'tool_audio': {
      const { transcribeAudio } = await import('../tools/audio-toolkit');
      const audioData = ctx.request.audioDataUrl
        ? { data: ctx.request.audioDataUrl.split(',')[1] || ctx.request.audioDataUrl, format: ctx.request.audioMimeType?.split('/')[1] || 'webm' }
        : null;
      if (!audioData) return {};
      const result = await transcribeAudio(audioData);
      return {
        text: result.success ? result.text : undefined,
        artifact: undefined,
        patch: undefined,
      };
    }

    // ── Attachment processor ─────────────────────────────────────────────────
    case 'tool_attachment': {
      const { processAttachment } = await import('../tools/attachment-processor');
      const result = await processAttachment(
        ctx.request.files ?? [],
        ctx.state as Record<string, unknown>,
      );
      const text = result?.extractedTexts?.[0] ?? undefined;
      return { text };
    }

    // ── Storage ───────────────────────────────────────────────────────────────
    case 'tool_storage': {
      // Storage is handled internally by pdf-generator and audio-toolkit
      // If it appears as a standalone step, it's a no-op here
      return {};
    }

    // ── Knowledge / RAG ───────────────────────────────────────────────────────
    case 'knowledge': {
      const { getRagContext } = await import('../knowledge/rag');
      const result = await getRagContext(ctx.request.message);
      return { text: result?.text ?? undefined };
    }

    // ── Diagnostics ───────────────────────────────────────────────────────────
    case 'diagnostic': {
      const { evaluateLevel } = await import('./diagnostics');
      // evaluateLevel takes accumulated samples array
      const samples = ctx.state.diagnosticSamples
        ? [ctx.request.message]  // append current message to samples
        : [ctx.request.message];
      const result = await evaluateLevel(samples);
      const patch = result.confidence !== 'insufficient'
        ? { confirmedLevel: result.level as any, diagnosticSamples: (ctx.state.diagnosticSamples ?? 0) + 1 }
        : { diagnosticSamples: (ctx.state.diagnosticSamples ?? 0) + 1 };
      return { patch };
    }

    // ── Commercial ────────────────────────────────────────────────────────────
    case 'commercial': {
      // Commercial is evaluated by route.ts post-execution, not here.
      // If it appears in executionOrder, it is always the last step.
      // execution-engine never triggers commercial independently.
      return {};
    }

    default: {
      // Unknown executor — safe no-op with warning
      console.warn(
        `[execution-engine] unknown executor: "${step.executor}" in step ${step.order}. Skipping.`
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
  stepResults: ExecutionStepResult[],
): CompiledResult {
  const outputs = Array.from(ctx.priorResults.values());

  // ── Primary message: join all non-empty text outputs ─────────────────────
  // Respects execution order — mentor last in hybrid plans
  const textParts = outputs
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map(o => o.text)
    .filter((t): t is string => !!t && t.trim() !== '');

  const message = textParts.join('\n\n') ||
    buildFallbackMessage(plan, ctx.state.interfaceLanguage);

  // ── Primary artifact: first artifact produced by a tool step ─────────────
  // In hybrid plans, tool artifacts take precedence over mentor artifacts
  const toolArtifact = outputs.find(
    o => o.artifact && o.executor !== 'mentor'
  )?.artifact;
  const mentorArtifact = outputs.find(
    o => o.artifact && o.executor === 'mentor'
  )?.artifact;
  const artifact = toolArtifact ?? mentorArtifact;

  // ── State patch: merge all step patches ──────────────────────────────────
  const statePatch: StatePatch = outputs.reduce(
    (acc, o) => (o.patch ? { ...acc, ...o.patch } : acc),
    {} as StatePatch,
  );

  // Always increment tokens (execution-engine responsibility)
  statePatch.tokens = (ctx.state.tokens ?? 0) + 1;

  // Clear requestedOperation after hard overrides
  if (plan.priority >= 100) {
    statePatch.requestedOperation = undefined;
  }

  // Advance tutor phase unless plan says to skip
  if (!plan.skipPhaseAdvance && ctx.state.activeMode === 'structured') {
    const { advanceTutorPhase } = require('./state-manager');
    statePatch.tutorPhase = advanceTutorPhase(
      ctx.state.tutorPhase,
      ctx.state.activeMode,
    );
  }

  // ── Suggested actions: derive from plan and artifact ─────────────────────
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

  // Artifact-based actions
  if (artifact) {
    if (artifact.type === 'quiz') {
      actions.push({ type: 'start_quiz', label: getLabel('start_quiz', state.interfaceLanguage) });
    }
    if (artifact.type === 'schema' || artifact.type === 'schema_pro') {
      actions.push({ type: 'export_chat_pdf', label: getLabel('export_chat_pdf', state.interfaceLanguage) });
    }
    if (artifact.type === 'roadmap') {
      actions.push({ type: 'start_course', label: getLabel('start_course', state.interfaceLanguage) });
    }
  }

  // Phase-based actions
  if (plan.pedagogicalAction === 'feedback' && state.activeMode === 'structured') {
    actions.push({ type: 'next_module', label: getLabel('next_module', state.interfaceLanguage) });
  }
  if (plan.pedagogicalAction === 'lesson') {
    actions.push({ type: 'show_schema', label: getLabel('show_schema', state.interfaceLanguage) });
  }

  // Export is always available
  actions.push({ type: 'export_chat_pdf', label: getLabel('export_chat_pdf', state.interfaceLanguage) });

  // Deduplicate
  return actions.filter(
    (a, i, arr) => arr.findIndex(b => b.type === a.type) === i
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LABEL LOCALISATION — minimal, full layer in Sprint 2.7
// ─────────────────────────────────────────────────────────────────────────────

const LABELS: Record<string, Record<string, string>> = {
  start_quiz:       { en: 'Start quiz', es: 'Empezar quiz', no: 'Start quiz' },
  export_chat_pdf:  { en: 'Export as PDF', es: 'Exportar a PDF', no: 'Eksporter som PDF' },
  next_module:      { en: 'Next module', es: 'Siguiente módulo', no: 'Neste modul' },
  start_course:     { en: 'Start course', es: 'Empezar curso', no: 'Start kurs' },
  show_schema:      { en: 'Show schema', es: 'Ver esquema', no: 'Vis skjema' },
  retry_quiz:       { en: 'Try again', es: 'Intentar de nuevo', no: 'Prøv igjen' },
};

function getLabel(type: SuggestedActionType, lang: string): string {
  return LABELS[type]?.[lang] ?? LABELS[type]?.['en'] ?? type;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function collectPriorText(
  results: Map<number, StepOutput>,
  currentOrder: number,
): string {
  return Array.from(results.values())
    .filter(r => r.stepOrder < currentOrder && r.text)
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map(r => r.text!)
    .join('\n\n');
}

function buildDegradedStep(
  step: ExecutionStep,
  reason: string,
  durationMs: number = 0,
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
    action: plan.executionOrder.find(s => s.order === output.stepOrder)?.action ?? 'unknown',
    durationMs: output.durationMs,
    success: output.success,
    error: output.error,
    producedArtifacts: output.artifact ? [output.artifact.type] : [],
  };
}

function buildFallbackMessage(plan: ExecutionPlan, lang: string): string {
  const fallbacks: Record<string, string> = {
    en: "I'm here to help. What would you like to work on?",
    es: "Estoy aquí para ayudarte. ¿En qué quieres trabajar?",
    no: "Jeg er her for å hjelpe. Hva vil du jobbe med?",
    it: "Sono qui per aiutarti. Su cosa vuoi lavorare?",
    fr: "Je suis là pour t'aider. Sur quoi veux-tu travailler?",
  };
  return fallbacks[lang] ?? fallbacks['en'];
}
