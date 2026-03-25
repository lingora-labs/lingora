// ============================================================================
// server/core/execution-engine.ts
// LINGORA SEEK 3.1 — Execution Engine
// FASE 0-A — Estado, Precedencia e Identidad Base
// BLOQUE 0-A.2 — Alineación de StatePatch con SessionState
// ============================================================================
// OBJETIVO: corregir incompatibilidad de tipos entre StatePatch y SessionState,
//           reemplazando `requestedOperation = null` por `undefined`.
// ALCANCE: modifica la asignación de requestedOperation en compileResult().
// EXCLUSIONES: no modifica lógica de evaluación de ejercicio; no implementa
//              evaluateExercise; no altera flujo pedagógico.
// COMPATIBILIDAD: sync path; mantiene comportamiento funcional idéntico.
// DOCTRINA: el estado debe ser consistente entre contratos y ejecución.
// RIESGO COMPILACIÓN: BAJO — solo cambia null por undefined (mismo efecto).
// ============================================================================

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
// EXECUTION RESULT
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
// STEP CONTEXT
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
// NAVIGATIONAL NOISE FILTER
// ─────────────────────────────────────────────────────────────────────────────

const NOISE_PATTERNS = /^(continúa|continua|siguiente|next|ok|sí|si|yes|no|vale|listo|bien|ready|go|start|más|mas|seguir|continue|adelante|siguiente módulo|next module|proceed)$/i;

function resolveSchemaTopicFromState(
  message: string,
  state: SessionState,
  priorText: string,
): string {
  const cleanMessage = message?.trim();
  if (cleanMessage && cleanMessage.length > 4 && !NOISE_PATTERNS.test(cleanMessage)) {
    return cleanMessage;
  }

  if (state.lastConcept?.trim())   return state.lastConcept;
  if (state.lastUserGoal?.trim())  return state.lastUserGoal;

  if (state.curriculumPlan?.topic) return state.curriculumPlan.topic;

  const cleanPrior = priorText?.trim();
  if (cleanPrior && cleanPrior.length > 4 && !NOISE_PATTERNS.test(cleanPrior)) {
    return cleanPrior;
  }

  return 'Spanish grammar';
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

  for (const step of orderedSteps) {
    if (step.dependsOn !== undefined) {
      const dep = ctx.priorResults.get(step.dependsOn);
      if (!dep || !dep.success) {
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

  const compiled = compileResult(plan, ctx, stepResults);

  return {
    ...compiled,
    stepResults,
    totalDurationMs: Date.now() - engineStart,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP EXECUTOR
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
// DISPATCHER
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

  const priorText = collectPriorText(ctx.priorResults, step.order);

  switch (step.executor) {

    // ── Mentor ──────────────────────────────────────────────────────────────
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

    // ── Schema generator ────────────────────────────────────────────────────
    case 'tool_schema': {
      const { generateSchemaContent } = await import('../tools/schema-generator');
      const { adaptSchemaToArtifact }  = await import('../tools/schema-adapter');

      const topic = resolveSchemaTopicFromState(
        ctx.request.message,
        ctx.state,
        priorText,
      );

      const data = await generateSchemaContent({
        topic,
        level:      ctx.state.confirmedLevel ?? ctx.state.userLevel ?? 'B1',
        uiLanguage: ctx.state.interfaceLanguage ?? 'en',
      });
      const artifact = adaptSchemaToArtifact(
        data,
        ctx.state.confirmedLevel ?? ctx.state.userLevel,
      );
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

      if (step.action === 'generateTTS') {
        const { generateSpeech } = await import('../tools/audio-toolkit');
        const textToSpeak = priorText?.trim() || ctx.request.message?.trim();
        if (!textToSpeak) {
          console.warn('[execution-engine] generateTTS: no text to speak — skipping');
          return {};
        }
        const result = await generateSpeech(textToSpeak, { voice: 'nova' });
        if (result?.success && result.url) {
          return { artifact: {
            type: 'audio' as const,
            dataUrl: result.url,
          }};
        }
        console.warn('[execution-engine] generateTTS: speech generation failed:', result);
        return {};
      }

      const { transcribeAudio } = await import('../tools/audio-toolkit');

      let audioData: { data: string; format: string } | null = null;

      if (ctx.request.audioDataUrl) {
        audioData = {
          data:   ctx.request.audioDataUrl.split(',')[1] || ctx.request.audioDataUrl,
          format: ctx.request.audioMimeType?.split('/')[1] || 'webm',
        };
      } else if (ctx.request.files?.length) {
        const audioFile = ctx.request.files.find(
          f => f.type?.startsWith('audio/') || f.type === 'video/webm',
        );
        if (audioFile) {
          const raw = audioFile.base64
            ?? (audioFile.dataUrl ? audioFile.dataUrl.split(',')[1] ?? audioFile.dataUrl : '');
          audioData = {
            data:   raw,
            format: audioFile.type?.split('/')[1] || 'webm',
          };
        }
      }

      if (!audioData) {
        console.warn('[execution-engine] transcribeAudio: no audio data found in request — skipping');
        return {};
      }

      const result = await transcribeAudio(audioData);
      return {
        text:     result.success ? result.text : undefined,
        artifact: undefined,
        patch:    undefined,
      };
    }

    // ── Attachment processor ─────────────────────────────────────────────────
    case 'tool_attachment': {
      const { processAttachment } = await import('../tools/attachment-processor');
      const filesToProcess = (ctx.request.files ?? []).map(f => ({
        name: f.name,
        type: f.type,
        size: f.size,
        data: f.base64 ?? (f.dataUrl ? f.dataUrl.split(',')[1] ?? f.dataUrl : ''),
      }));
      const result = await processAttachment(
        filesToProcess,
        ctx.state as unknown as Record<string, unknown>,
      );
      const text = result?.extractedTexts?.[0] ?? undefined;
      return { text };
    }

    // ── Storage ───────────────────────────────────────────────────────────────
    case 'tool_storage': {
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
      const sampleCount = (ctx.state.diagnosticSamples ?? 0) + 1;
      const samples = [
        ctx.request.message,
        ...(ctx.state.lastConcept    ? [ctx.state.lastConcept]    : []),
        ...(ctx.state.lastUserGoal   ? [ctx.state.lastUserGoal]   : []),
        ...(ctx.state.lastMistake    ? [ctx.state.lastMistake]    : []),
      ];
      const result = await evaluateLevel(samples);
      const patch = {
        diagnosticSamples: sampleCount,
        ...(result.confidence !== 'insufficient' && result.confidence !== 'low'
          ? { confirmedLevel: result.level as import('../../lib/contracts').CEFRLevel }
          : {}),
      };
      return { patch };
    }

    // ── Commercial ────────────────────────────────────────────────────────────
    case 'commercial': {
      return {};
    }

    default: {
      console.warn(
        `[execution-engine] unknown executor: "${step.executor}" in step ${step.order}. Skipping.`
      );
      return {};
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT COMPILER
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

  const textParts = outputs
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map(o => o.text)
    .filter((t): t is string => !!t && t.trim() !== '');

  const message = textParts.join('\n\n') ||
    buildFallbackMessage(plan, ctx.state.interfaceLanguage);

  const toolArtifact = outputs.find(
    o => o.artifact && o.executor !== 'mentor'
  )?.artifact;
  const mentorArtifact = outputs.find(
    o => o.artifact && o.executor === 'mentor'
  )?.artifact;

  let artifact = toolArtifact ?? mentorArtifact;
  if (toolArtifact && mentorArtifact) {
    const pedagogical = [toolArtifact, mentorArtifact].find(
      a => a && a.type !== 'audio'
    );
    artifact = pedagogical ?? toolArtifact;
  }

  const statePatch: StatePatch = outputs.reduce(
    (acc, o) => (o.patch ? { ...acc, ...o.patch } : acc),
    {} as StatePatch,
  );

  statePatch.tokens = (ctx.state.tokens ?? 0) + 1;

  // FIX 0-A.2: replace null with undefined for type alignment
  if (plan.priority >= 100) {
    (statePatch as StatePatch).requestedOperation = undefined;
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
      actions.push({ type: 'start_quiz', label: getLabel('start_quiz', state.interfaceLanguage) });
    }
    if (artifact.type === 'schema' || artifact.type === 'schema_pro') {
      actions.push({ type: 'start_quiz',      label: getLabel('start_quiz', state.interfaceLanguage) });
      actions.push({ type: 'export_chat_pdf', label: getLabel('export_chat_pdf', state.interfaceLanguage) });
    }
    if (artifact.type === 'roadmap') {
      actions.push({ type: 'start_course',    label: getLabel('start_course', state.interfaceLanguage) });
    }
  }

  if (plan.pedagogicalAction === 'feedback' && state.activeMode === 'structured') {
    actions.push({ type: 'next_module', label: getLabel('next_module', state.interfaceLanguage) });
  }
  if (plan.pedagogicalAction === 'lesson') {
    actions.push({ type: 'show_schema', label: getLabel('show_schema', state.interfaceLanguage) });
  }
  if (plan.pedagogicalAction === 'conversation') {
    actions.push({ type: 'show_schema', label: getLabel('show_schema', state.interfaceLanguage) });
    actions.push({ type: 'start_quiz',  label: getLabel('start_quiz',  state.interfaceLanguage) });
  }

  actions.push({ type: 'export_chat_pdf', label: getLabel('export_chat_pdf', state.interfaceLanguage) });

  return actions.filter(
    (a, i, arr) => arr.findIndex(b => b.type === a.type) === i
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCALISATION
// ─────────────────────────────────────────────────────────────────────────────

const LABELS: Record<string, Record<string, string>> = {
  start_quiz:      { en: 'Take quiz',     es: 'Hacer simulacro',  no: 'Ta quiz'        },
  export_chat_pdf: { en: 'Export as PDF', es: 'Exportar a PDF',   no: 'Eksporter PDF'  },
  next_module:     { en: 'Next module',   es: 'Siguiente módulo', no: 'Neste modul'    },
  start_course:    { en: 'Start course',  es: 'Empezar curso',    no: 'Start kurs'     },
  show_schema:     { en: 'Show schema',   es: 'Ver esquema',      no: 'Vis skjema'     },
  retry_quiz:      { en: 'Try again',     es: 'Intentar de nuevo',no: 'Prøv igjen'     },
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

// ============================================================================
// COMMIT:
// fix(execution-engine): replace requestedOperation null reset with undefined
// ============================================================================
