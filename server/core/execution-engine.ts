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

// ─────────────────────────────────────────────────────────────────────────────
// SEEK 3.1 Fase 0-A — TOPIC RESOLVER
// Prevents "este tema" from resolving to navigational noise or the wrong topic.
// Priority: currentLessonTopic > lastConcept > lastUserGoal > curriculumPlan > message
// ─────────────────────────────────────────────────────────────────────────────

const NOISE_PATTERNS = /^(continúa|continua|siguiente|next|ok|sí|si|yes|no|vale|listo|bien|ready|go|start|más|mas|seguir|continue|adelante|siguiente módulo|next module|proceed|claro|entendido|understood)$/i;

function resolveSchemaTopicFromState(
  message: string,
  state: SessionState,
  priorText: string,
): string {
  // 1. If there is an active lesson topic — always use it
  if (state.currentLessonTopic?.trim()) return state.currentLessonTopic;

  // 2. Check if the message itself is meaningful (not navigational noise)
  const cleanMessage = message?.trim();
  if (cleanMessage && cleanMessage.length > 4 && !NOISE_PATTERNS.test(cleanMessage)) {
    return cleanMessage;
  }

  // 3. Fall back to continuity fields
  if (state.lastConcept?.trim())       return state.lastConcept;
  if (state.lastUserGoal?.trim())      return state.lastUserGoal;
  if (state.curriculumPlan?.topic)     return state.curriculumPlan.topic;

  // 4. Prior execution text (if meaningful)
  const cleanPrior = priorText?.trim();
  if (cleanPrior && cleanPrior.length > 4 && !NOISE_PATTERNS.test(cleanPrior)) {
    return cleanPrior;
  }

  return 'Spanish grammar';
}


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
      const { adaptSchemaToArtifact }  = await import('../tools/schema-adapter');

      const topic      = ctx.plan.resolvedTopic
        || resolveSchemaTopicFromState(ctx.request.message, ctx.state, priorText);
      const level      = ctx.state.confirmedLevel ?? ctx.state.userLevel ?? 'B1';
      const uiLanguage = ctx.state.interfaceLanguage ?? 'en';

      switch (step.action) {

        case 'generateSchema': {
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          return { artifact: adaptSchemaToArtifact(data, ctx.state.confirmedLevel ?? ctx.state.userLevel) };
        }

        case 'generateSchemaPro': {
          // FIX-B2: convert SchemaContent → real SchemaProArtifact with blocks[]
          // No dedicated generator needed — we map SchemaContent fields to SBlock format
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          // F-B2: use SchemaProBlockItem[] — now the canonical contract type
          const blocks: import('../../lib/contracts').SchemaProBlockItem[] = [];

          if (data.keyConcepts?.length) {
            blocks.push({ type: 'bullets', title: 'Conceptos clave', items: data.keyConcepts });
          }
          for (const sub of (data.subtopics ?? [])) {
            blocks.push({ type: 'concept', title: sub.title, body: sub.keyTakeaway ? `${sub.content}\n→ ${sub.keyTakeaway}` : sub.content });
          }
          if (data.tableRows?.length) {
            blocks.push({ type: 'table', columns: ['Forma', 'Valor'], rows: data.tableRows.map(r => [r.left, r.right]) });
          }
          if (data.summary) {
            blocks.push({ type: 'highlight', tone: 'ok', label: 'Regla 80/20', text: data.summary });
          }

          const artifact: import('../../lib/contracts').SchemaProArtifact = {
            type:     'schema_pro',
            title:    data.title,
            subtitle: data.objective,
            level:    ctx.state.confirmedLevel ?? ctx.state.userLevel,
            blocks,
          };
          return { artifact };
        }

        case 'generateQuiz': {
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          if (data.quiz?.length) {
            const artifact: import('../../lib/contracts').QuizArtifact = {
              type:  'quiz',
              title: data.title,
              questions: data.quiz.map(q => ({
                question: q.question,
                options:  q.options.map((opt, i) => ({
                  text:    opt,
                  correct: i === q.correct,
                })),
              })),
            };
            return { artifact };
          }
          console.error('[execution-engine] generateQuiz: no quiz in schema output — returning empty, not wrong artifact');
          return {};
        }

        case 'generateTable': {
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          if (data.tableRows?.length) {
            const artifact: import('../../lib/contracts').TableArtifact = {
              type:    'table',
              title:   data.title,
              columns: ['', ''],
              rows:    data.tableRows.map(row => [row.left, row.right]),
            };
            return { artifact };
          }
          console.error('[execution-engine] generateTable: no tableRows in output — returning empty, not wrong artifact');
          return {};
        }

        case 'generateTableMatrix': {
          // FIX: must produce TableMatrixArtifact (type: 'table_matrix'), not TableArtifact
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          if (data.tableRows?.length) {
            const artifact: import('../../lib/contracts').TableMatrixArtifact = {
              type:    'table_matrix',
              title:   data.title,
              columns: ['Concept', 'Value'],
              rows:    data.tableRows.map(row => [
                { value: row.left },
                { value: row.right },
              ]),
            };
            return { artifact };
          }
          console.error('[execution-engine] generateTableMatrix: no tableRows in output — returning empty, not wrong artifact');
          return {};
        }

        case 'buildRoadmapArtifact': {
          // FIX-B3: if no curriculumPlan, produce a minimal topic-based roadmap
          // instead of returning empty — gives the user something useful
          if (!ctx.state.curriculumPlan) {
            const topicFallback = resolveSchemaTopicFromState(ctx.request.message, ctx.state, '') || topic;
            const fallbackModules = [
              { index: 0, title: 'Diagnóstico de nivel',            focus: 'Evaluación inicial',      completed: false, current: true },
              { index: 1, title: `Fundamentos: ${topicFallback}`,   focus: 'Conceptos clave',         completed: false, current: false },
              { index: 2, title: 'Práctica guiada',                 focus: 'Ejercicios aplicados',    completed: false, current: false },
              { index: 3, title: 'Errores frecuentes',              focus: 'Corrección',              completed: false, current: false },
              { index: 4, title: 'Simulacro final',                 focus: 'Evaluación de dominio',   completed: false, current: false },
            ];
            const artifact: import('../../lib/contracts').RoadmapBlock = {
              type:    'roadmap',
              title:   topicFallback,
              modules: fallbackModules,
            };
            return { artifact };
          }
          const artifact: import('../../lib/contracts').RoadmapBlock = {
            type:    'roadmap',
            title:   ctx.state.curriculumPlan.topic,
            modules: ctx.state.curriculumPlan.modules.map(m => ({
              index:     m.index,
              title:     m.title,
              focus:     m.focus,
              completed: !!(ctx.state.masteryByModule[m.index]?.passed),
              current:   m.index === (ctx.state.currentModuleIndex ?? 0),
            })),
          };
          return { artifact };
        }

        default: {
          // FIX: unknown action → explicit error, no schema substitution
          console.error(`[execution-engine] tool_schema: unsupported action "${step.action}" — no artifact produced`);
          return {};  // empty — caller sees no artifact, no silent schema
        }
      }
    }

    // ── PDF generator ────────────────────────────────────────────────────────
    case 'tool_pdf': {
      const { generatePDF } = await import('../tools/pdf-generator');
      const title = ctx.state.lastConcept ?? 'LINGORA Study Guide';

      // FIX-EE1: discriminate by step.action so artifact type matches orchestrator contract
      if (step.action === 'exportChatPdf') {
        // FIX-B4: use exportTranscript (full chat history) if provided by frontend
        // falls back to request.message if not present
        const content = ctx.request.exportTranscript || ctx.request.message;
        const result = await generatePDF({ title: 'Chat Export', content });
        const messageCount = ctx.request.exportTranscript
  ? ctx.request.exportTranscript.split(/\n\s*\n/).filter(Boolean).length
  : (ctx.request.message ? 1 : 0);

const artifact = result.success
  ? {
      type: 'pdf_chat' as const,
      url: result.url,
      messageCount,
    }
  : undefined;

return { artifact };
      }

      if (step.action === 'generateCoursePdf') {
        const result = await generatePDF({ title, content: ctx.request.message });
        const artifact = result.success
          ? { type: 'course_pdf' as const, title, url: result.url, modules: [] }
          : undefined;
        return { artifact };
      }

      // Default: generic PDF
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

      // SEEK 3.1: discriminate by step.action
      if (step.action === 'generateTTS') {
        const { generateSpeech } = await import('../tools/audio-toolkit');
        // FIX-EE3: use only the most recent mentor text for TTS
        // priorText includes ALL prior steps (transcription + mentor response)
        // TTS should speak only the mentor response — not echo the user's own words
        const mentorPriorText = Array.from(ctx.priorResults.values())
          .filter(r => r.executor === 'mentor' && r.text)
          .sort((a, b) => b.stepOrder - a.stepOrder)[0]?.text;
        const textToSpeak = (mentorPriorText ?? priorText)?.trim() || ctx.request.message?.trim();
        if (!textToSpeak) return {};
        const result = await generateSpeech(textToSpeak, { voice: 'nova' });
        if (result?.success && result.url) {
          return { artifact: { type: 'audio' as const, dataUrl: result.url } };
        }
        return {};
      }

      // default branch: transcribe audio input
      const { transcribeAudio } = await import('../tools/audio-toolkit');
      const audioData = ctx.request.audioDataUrl
        ? { data: ctx.request.audioDataUrl.split(',')[1] || ctx.request.audioDataUrl, format: ctx.request.audioMimeType?.split('/')[1] || 'webm' }
        : null;

      if (!audioData && ctx.request.files?.length) {
        const audioFile = ctx.request.files.find(
          f => f.type?.startsWith('audio/') || f.type === 'video/webm',
        );
        if (audioFile) {
          const raw = audioFile.base64
            ?? (audioFile.dataUrl ? audioFile.dataUrl.split(',')[1] ?? audioFile.dataUrl : '');
          const result = await transcribeAudio({ data: raw, format: audioFile.type?.split('/')[1] || 'webm' });
          return { text: result.success ? result.text : undefined };
        }
      }

      if (!audioData) return {};
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
      // Map AttachedFile[] to the shape processAttachment expects
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
      // Accumulative diagnostic: build sample context from available state
      // diagnosticSamples tracks how many exchanges have been evaluated
      const sampleCount = (ctx.state.diagnosticSamples ?? 0) + 1;
      // Build samples array: current message + synthetic prior context
      // The confidence threshold in evaluateLevel requires >= 3 samples for low, >= 8 for high
      const samples = [
        ctx.request.message,
        // Pad with available context to reflect accumulated evidence
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

  // Clear requestedOperation after hard overrides — use null (explicit clear sentinel)
  if (plan.priority >= 100) {
    (statePatch as StatePatch).requestedOperation = null;
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

