// ============================================================================
// server/core/orchestrator.ts
// LINGORA SEEK 3.1 — Sole Decision Authority
// FASE 0-A — Estado, Precedencia e Identidad Base
// BLOQUE 0-A.3 — Inserción de Exercise Lock en precedencia del orquestador
// ============================================================================
// OBJETIVO: introducir una puerta de decisión intermedia que preserve la
//           continuidad del ejercicio activo sin invadir hard overrides ni
//           first turn, estableciendo prioridad 95 entre hard override (100)
//           y first turn (90).
// ALCANCE: añade constante EXERCISE_LOCK a PRIORITY; añade condición en
//          orchestrate() que activa buildExerciseLockPlan() cuando el estado
//          tiene expectedResponseMode='exercise_answer' y currentExercise;
//          añade función buildExerciseLockPlan() que genera plan con
//          respuesta de mentor estándar (Opción A, sin evaluateExercise).
// EXCLUSIONES: NO implementa evaluación estructurada del ejercicio (Fase 0-B);
//              NO llama a evaluateExercise; NO modifica execution-engine;
//              NO modifica ninguna otra función builder existente.
// COMPATIBILIDAD: routing core; mantiene todas las funciones originales;
//                 no elimina lógica viva; añade solo extensión mínima.
// DOCTRINA: el sistema debe decidir QUIÉN responde antes de decidir QUÉ responde.
//           Una acción por turno. El ejercicio activo tiene prioridad sobre
//           cualquier branch que no sea hard override.
// RIESGO COMPILACIÓN: BAJO — solo añade constante y condición; todas las
//                     dependencias existen en el archivo real deployado.
// ============================================================================
// VERIFICACIÓN CONTRA ARCHIVO REAL DEPLOYADO:
//   ✅ Imports idénticos
//   ✅ Helpers existen con firmas compatibles
//   ✅ PRIORITY existente — solo se añade EXERCISE_LOCK
//   ✅ buildMentorDirective idéntica
//   ✅ Todos los builders existentes se conservan
//   ✅ No se elimina lógica viva
// ============================================================================

import {
  OrchestrationContext,
  ExecutionPlan,
  ExecutionStep,
  ExecutorType,
  PedagogicalAction,
  MentorDirective,
  ArtifactType,
  ActiveMode,
  TutorPhase,
  MentorProfile,
  IntentSubtype,
} from '../../lib/contracts';

import {
  isHardOverride,
  isStrongCurriculumRequest,
  isFastPathArtifact,
} from './intent-router';

// ─────────────────────────────────────────────────────────────────────────────
// PRIORITY CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY = {
  HARD_OVERRIDE: 100,
  EXERCISE_LOCK:  95,  // FASE 0-A — NUEVO
  FIRST_TURN:     90,
  CURRICULUM:     80,
  FAST_PATH:      70,
  PEDAGOGICAL:    60,
  DEFAULT:        10,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export function orchestrate(ctx: OrchestrationContext): ExecutionPlan {

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 — HARD OVERRIDES
  // ══════════════════════════════════════════════════════════════════════════
  if (isHardOverride(ctx.intent)) {
    return buildHardOverridePlan(ctx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1.5 — EXERCISE LOCK (FASE 0-A)
  // ══════════════════════════════════════════════════════════════════════════
  if (ctx.state.expectedResponseMode === 'exercise_answer' && ctx.state.currentExercise) {
    return buildExerciseLockPlan(ctx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 — FIRST INTERACTION
  // ══════════════════════════════════════════════════════════════════════════
  if (ctx.isFirstTurn) {
    return buildFirstTurnPlan(ctx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — STRONG CURRICULUM REQUEST
  // ══════════════════════════════════════════════════════════════════════════
  if (isStrongCurriculumRequest(ctx.intent)) {
    return buildCurriculumPlan(ctx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4 — FAST-PATH ARTIFACT REQUEST
  // ══════════════════════════════════════════════════════════════════════════
  if (isFastPathArtifact(ctx.intent)) {
    return buildFastPathPlan(ctx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5 — ACTIVE PEDAGOGICAL PHASE
  // ══════════════════════════════════════════════════════════════════════════
  if (ctx.state.activeMode === 'structured' || ctx.state.activeMode === 'pdf_course') {
    return buildPedagogicalPlan(ctx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6 — DEFAULT CONVERSATION FALLBACK
  // ══════════════════════════════════════════════════════════════════════════
  return buildConversationPlan(ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// BRANCH BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

// ── STEP 1: Hard Override ─────────────────────────────────────────────────

function buildHardOverridePlan(ctx: OrchestrationContext): ExecutionPlan {
  const subtype = ctx.intent.subtype as IntentSubtype;

  const overrideMap: Record<string, {
    executor: ExecutorType;
    action: string;
    pedagogicalAction: PedagogicalAction;
    artifacts: ArtifactType[];
  }> = {
    translate: {
      executor: 'mentor',
      action: 'translateOnly',
      pedagogicalAction: 'translation_only',
      artifacts: [],
    },
    correct: {
      executor: 'mentor',
      action: 'correctOnly',
      pedagogicalAction: 'correction_only',
      artifacts: [],
    },
    transcribe: {
      executor: 'tool_audio',
      action: 'transcribeAudio',
      pedagogicalAction: 'transcription_only',
      artifacts: [],
    },
    export_chat_pdf: {
      executor: 'tool_pdf',
      action: 'exportChatPdf',
      pedagogicalAction: 'export_chat_pdf',
      artifacts: ['pdf_chat'],
    },
    generate_course_pdf: {
      executor: 'tool_pdf',
      action: 'generateCoursePdf',
      pedagogicalAction: 'generate_course_pdf',
      artifacts: ['course_pdf'],
    },
  };

  const config = overrideMap[subtype] ?? {
    executor: 'mentor' as ExecutorType,
    action: 'hardOverrideFallback',
    pedagogicalAction: 'conversation' as PedagogicalAction,
    artifacts: [] as ArtifactType[],
  };

  const step: ExecutionStep = {
    order: 1,
    executor: config.executor,
    action: config.action,
    timeout: 15000,
  };

  const steps: ExecutionStep[] = [step];

  if (config.executor === 'tool_audio' && subtype === 'transcribe') {
    steps.push({
      order: 2,
      executor: 'mentor',
      action: 'respondToTranscription',
      dependsOn: 1,
      timeout: 12000,
    });
  }

  return {
    executor: steps.length > 1 ? 'hybrid' : config.executor,
    priority: PRIORITY.HARD_OVERRIDE,
    blocking: true,
    pedagogicalAction: config.pedagogicalAction,
    artifacts: config.artifacts,
    mentor: config.executor === 'mentor' || steps.length > 1
      ? buildMentorDirective(ctx.state.mentorProfile, 'CORRECTION_ONLY_DIRECTIVE', ctx)
      : undefined,
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: `hard_override:${subtype} — user explicitly requested ${subtype}. Bypasses all pedagogy. Matched pattern: ${ctx.intent.matchedPattern ?? 'unknown'}`,
    executionOrder: steps,
  };
}

// ── STEP 1.5: Exercise Lock (FASE 0-A — Opción A) ─────────────────────────
// NOTA: Este plan NO llama a evaluateExercise. La evaluación real se implementa
//       en Fase 0-B. Por ahora, el mentor maneja la respuesta de forma estándar,
//       pero el lock se preserva por precedencia. El campo expectedResponseMode
//       permanece en 'exercise_answer' hasta que Fase 0-B lo resuelva.

function buildExerciseLockPlan(ctx: OrchestrationContext): ExecutionPlan {
  const steps: ExecutionStep[] = [
    {
      order: 1,
      executor: 'mentor',
      action: 'conversation',  // Respuesta estándar por ahora
      timeout: 15000,
    },
    {
      order: 2,
      executor: 'tool_audio',
      action: 'generateTTS',
      dependsOn: 1,
      timeout: 10000,
    },
  ];

  return {
    executor: 'hybrid',
    priority: PRIORITY.EXERCISE_LOCK,
    blocking: false,
    pedagogicalAction: 'feedback',
    artifacts: ['audio'],
    mentor: buildMentorDirective(
      ctx.state.mentorProfile,
      'CORRECTION_ONLY_DIRECTIVE',
      ctx,
    ),
    commercial: undefined,
    skipPhaseAdvance: false,
    reason: `exercise_lock — user answering active exercise. Expected mode: exercise_answer. Lock preserved. Exercise: "${ctx.state.currentExercise?.substring(0, 80)}". Evaluation pending in Phase 0-B.`,
    executionOrder: steps,
  };
}

// ── STEP 2: First Turn ────────────────────────────────────────────────────

function buildFirstTurnPlan(ctx: OrchestrationContext): ExecutionPlan {
  const steps: ExecutionStep[] = [
    { order: 1, executor: 'mentor', action: 'firstTurnGreeting', timeout: 10000 },
    { order: 2, executor: 'tool_audio', action: 'generateTTS', dependsOn: 1, timeout: 10000 },
  ];

  return {
    executor: 'hybrid',
    priority: PRIORITY.FIRST_TURN,
    blocking: true,
    pedagogicalAction: 'first_turn_greeting',
    artifacts: ['audio'],
    mentor: buildMentorDirective(
      ctx.state.mentorProfile,
      'FIRST_TURN_DIRECTIVE',
      ctx,
    ),
    commercial: undefined,
    skipPhaseAdvance: false,
    reason: `first_turn — tokens=0, session start. Mentor delivers situated greeting for language=${ctx.interfaceLanguage}, mentor=${ctx.state.mentorProfile ?? 'Alex'}`,
    executionOrder: steps,
  };
}

// ── STEP 3: Curriculum ────────────────────────────────────────────────────

function buildCurriculumPlan(ctx: OrchestrationContext): ExecutionPlan {
  const steps: ExecutionStep[] = [
    {
      order: 1,
      executor: 'knowledge',
      action: 'retrieveTopicContext',
      timeout: 5000,
    },
    {
      order: 2,
      executor: 'mentor',
      action: 'generateCurriculum',
      dependsOn: 1,
      timeout: 20000,
    },
    {
      order: 3,
      executor: 'tool_schema',
      action: 'buildRoadmapArtifact',
      dependsOn: 2,
      timeout: 10000,
    },
  ];

  return {
    executor: 'hybrid',
    priority: PRIORITY.CURRICULUM,
    blocking: true,
    pedagogicalAction: 'curriculum_generation',
    artifacts: ['roadmap'],
    mentor: buildMentorDirective(
      ctx.state.mentorProfile,
      'CURRICULUM_PRESENTER_DIRECTIVE',
      ctx,
    ),
    commercial: undefined,
    skipPhaseAdvance: false,
    reason: `curriculum_generation — strong course request detected. intent.subtype=curriculum_request, confidence=${ctx.intent.confidence}. Generates full curriculum with roadmap artifact.`,
    executionOrder: steps,
  };
}

// ── STEP 4: Fast-Path Artifact ────────────────────────────────────────────

function buildFastPathPlan(ctx: OrchestrationContext): ExecutionPlan {
  const subtype = ctx.intent.subtype;

  type ArtifactConfig = {
    executor: ExecutorType;
    action: string;
    artifact: ArtifactType;
  };

  const artifactMap: Record<string, ArtifactConfig> = {
    table_matrix: { executor: 'tool_schema', action: 'generateTableMatrix', artifact: 'table_matrix' },
    schema_pro:   { executor: 'tool_schema', action: 'generateSchemaPro',   artifact: 'schema_pro'   },
    table:        { executor: 'tool_schema', action: 'generateTable',       artifact: 'table'        },
    schema:       { executor: 'tool_schema', action: 'generateSchema',      artifact: 'schema'       },
    quiz:         { executor: 'tool_schema', action: 'generateQuiz',        artifact: 'quiz'         },
    illustration: { executor: 'tool_image',  action: 'generateIllustration',artifact: 'illustration' },
    roadmap:      { executor: 'tool_schema', action: 'buildRoadmapArtifact',artifact: 'roadmap'      },
  };

  const config: ArtifactConfig = artifactMap[subtype ?? ''] ?? {
    executor: 'tool_schema',
    action: 'generateSchema',
    artifact: 'schema',
  };

  const steps: ExecutionStep[] = [
    {
      order: 1,
      executor: config.executor,
      action: config.action,
      timeout: 12000,
    },
    {
      order: 2,
      executor: 'mentor',
      action: 'briefArtifactIntro',
      dependsOn: 1,
      timeout: 8000,
    },
  ];

  return {
    executor: 'hybrid',
    priority: PRIORITY.FAST_PATH,
    blocking: false,
    pedagogicalAction: 'lesson',
    artifacts: [config.artifact],
    mentor: buildMentorDirective(
      ctx.state.mentorProfile,
      'RICH_CONTENT_DIRECTIVE',
      ctx,
    ),
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: `fast_path:${subtype ?? 'schema'} — explicit artifact request. Tool generates artifact (step 1) before mentor intro (step 2).`,
    executionOrder: steps,
  };
}

// ── STEP 5: Pedagogical Phase ─────────────────────────────────────────────

function buildPedagogicalPlan(ctx: OrchestrationContext): ExecutionPlan {
  const { tutorPhase, activeMode } = ctx.state;

  type PhaseConfig = {
    pedagogicalAction: PedagogicalAction;
    artifact?: ArtifactType;
    directive: MentorDirective['directive'];
    producesArtifact: boolean;
    addTTS: boolean;
  };

  const phaseMap: Record<TutorPhase, PhaseConfig> = {
    guide: {
      pedagogicalAction: 'guide',
      directive: 'STRUCTURED_COURSE_DIRECTIVE',
      producesArtifact: false,
      addTTS: true,
    },
    lesson: {
      pedagogicalAction: 'lesson',
      directive: 'STRUCTURED_COURSE_DIRECTIVE',
      producesArtifact: false,
      addTTS: true,
    },
    schema: {
      pedagogicalAction: 'schema',
      artifact: 'schema',
      directive: 'STRUCTURED_COURSE_DIRECTIVE',
      producesArtifact: true,
      addTTS: false,
    },
    quiz: {
      pedagogicalAction: 'quiz',
      artifact: 'quiz',
      directive: 'STRUCTURED_COURSE_DIRECTIVE',
      producesArtifact: true,
      addTTS: false,
    },
    feedback: {
      pedagogicalAction: 'feedback',
      directive: 'STRUCTURED_COURSE_DIRECTIVE',
      producesArtifact: false,
      addTTS: true,
    },
    conversation: {
      pedagogicalAction: 'conversation',
      directive: 'FREE_CONVERSATION_DIRECTIVE',
      producesArtifact: false,
      addTTS: true,
    },
  };

  const config = phaseMap[tutorPhase] ?? phaseMap['guide'];

  const steps: ExecutionStep[] = [];

  if (config.producesArtifact && config.artifact) {
    steps.push({
      order: 1,
      executor: 'tool_schema',
      action: config.artifact === 'schema' ? 'generateSchema' : 'generateQuiz',
      timeout: 12000,
    });
    steps.push({
      order: 2,
      executor: 'mentor',
      action: 'deliverArtifactWithLesson',
      dependsOn: 1,
      timeout: 10000,
    });
  } else {
    steps.push({
      order: 1,
      executor: 'mentor',
      action: `phase_${tutorPhase}`,
      timeout: 15000,
    });
    if (config.addTTS) {
      steps.push({
        order: 2,
        executor: 'tool_audio',
        action: 'generateTTS',
        dependsOn: 1,
        timeout: 10000,
      });
    }
  }

  const artifactTypes: ArtifactType[] = [];
  if (config.artifact) artifactTypes.push(config.artifact);
  if (config.addTTS && !config.producesArtifact) artifactTypes.push('audio');

  return {
    executor: steps.length > 1 ? 'hybrid' : 'mentor',
    priority: PRIORITY.PEDAGOGICAL,
    blocking: false,
    pedagogicalAction: config.pedagogicalAction,
    artifacts: artifactTypes,
    mentor: buildMentorDirective(
      ctx.state.mentorProfile,
      config.directive,
      ctx,
    ),
    commercial: undefined,
    skipPhaseAdvance: false,
    reason: `pedagogical_phase:${tutorPhase} — mode=${activeMode}, continuing structured sequence. Phase ${config.producesArtifact ? 'produces ' + config.artifact : 'mentor only'}.`,
    executionOrder: steps,
  };
}

// ── STEP 6: Default Conversation ─────────────────────────────────────────

function buildConversationPlan(ctx: OrchestrationContext): ExecutionPlan {
  const directive =
    ctx.state.activeMode === 'free'
      ? 'FREE_CONVERSATION_DIRECTIVE'
      : 'RICH_CONTENT_DIRECTIVE';

  const steps: ExecutionStep[] = [
    { order: 1, executor: 'mentor', action: 'conversation', timeout: 15000 },
    { order: 2, executor: 'tool_audio', action: 'generateTTS', dependsOn: 1, timeout: 10000 },
  ];

  return {
    executor: 'hybrid',
    priority: PRIORITY.DEFAULT,
    blocking: false,
    pedagogicalAction: 'conversation',
    artifacts: ['audio'],
    mentor: buildMentorDirective(ctx.state.mentorProfile, directive, ctx),
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: `default_conversation — fallthrough from all branches. mode=${ctx.state.activeMode}, intent=${ctx.intent.type}(${ctx.intent.confidence.toFixed(2)}). Safe fallsafe branch.`,
    executionOrder: steps,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — Mentor Directive Builder
// ─────────────────────────────────────────────────────────────────────────────

function buildMentorDirective(
  profile: MentorProfile | undefined,
  directive: MentorDirective['directive'],
  ctx: OrchestrationContext,
): MentorDirective {
  const resolvedProfile: MentorProfile = profile ?? 'Alex';

  const isFreeMode = (
    ctx.state.activeMode === 'free' ||
    ctx.state.activeMode === 'interact'
  );
  const cognitiveStructure = !isFreeMode || directive === 'STRUCTURED_COURSE_DIRECTIVE';

  return {
    profile: resolvedProfile,
    directive,
    injectContinuity: !!(ctx.state.lastConcept || ctx.state.lastUserGoal),
    injectErrorMemory: !!(
      ctx.state.errorMemory &&
      (ctx.state.errorMemory.grammar.length > 0 ||
       ctx.state.errorMemory.vocabulary.length > 0)
    ),
    cognitiveStructure,
  };
}

// ============================================================================
// COMMIT:
// feat(orchestrator): insert exercise lock precedence at priority 95 —
// adds STEP 1.5 between hard overrides and first turn to preserve
// exercise continuity. Evaluation deferred to Phase 0-B (Opción A).
// Verified against deployed file — no existing logic removed.
// ============================================================================
