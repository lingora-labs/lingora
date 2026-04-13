// =============================================================================
// server/core/orchestrator.ts
// LINGORA SEEK 4.1c — Sole Decision Authority + Experience Gate (PDF topic resolution)
// =============================================================================
// SEEK 4.1b CHANGES:
//   + resolveSemanticOperation(): distinguishes create_course / package_session /
//     export_chat / export_artifact before curriculum branch fires
//   + STEP 2.5: semantic operation detection inserted before STEP 3 (curriculum)
//   + buildPackageSessionPlan(): honest response for session packaging (4.2 delivers)
//   + package_session + export_artifact added to hard override map
//   Previous: SEEK 3.8
// SEEK 4.1c CHANGES:
//   + Experience Gate intercepts generate_course_pdf in buildHardOverridePlan()
//     (the real path for "hazme un curso en PDF" — hard override, not curriculum)
//   + Experience Gate also in buildCurriculumPlan() for curriculum_request path
//   + resolvedTopic injected into plan.params for execution-engine
//     before generating — prevents metacourses about "creating PDFs"
//   + extractCourseTopic(): explicit topic extractor with autoref guard
//   + isSelfReferential(): detects "pdf/curso/maquetación" as invalid topics
//   + buildClarificationPlan(): asks user for topic when none is resolvable
//   + buildClarificationMessage(): multilingual clarification (8 langs)
// =============================================================================

import {
  OrchestrationContext,
  ExecutionPlan,
  ExecutionStep,
  ExecutorType,
  PedagogicalAction,
  MentorDirective,
  ArtifactType,
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
  EXERCISE_LOCK: 95,
  FIRST_TURN: 90,
  SEMANTIC_OP: 85, // SEEK 4.1b — semantic operation before curriculum
  CURRICULUM: 80,
  FAST_PATH: 70,
  PEDAGOGICAL: 60,
  DEFAULT: 10,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SEEK 4.1b — SEMANTIC OPERATION RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

type SemanticOperation = 'package_session' | 'export_artifact' | null;

const SESSION_REF_PATTERNS = [
  /lo que (hemos?|acabamos de|vimos?|trabajamos?|hicimos?)/i,
  /esta sesi[oó]n/i,
  /los materiales? de (hoy|esta clase|esta sesi[oó]n)/i,
  /todo lo (visto|trabajado|generado|que hemos?)/i,
  /empaquetar? (la sesi[oó]n|los materiales?|todo)/i,
  /pack(age)? (this )?session/i,
  /everything (we('ve)? (done|covered|worked on))/i,
  /what we (did|covered|learned) today/i,
  /materials? from (today|this session)/i,
];

const ARTIFACT_SPECIFIC_PATTERNS = [
  /exporta? (esta|este|la|el) (tabla|esquema|matriz|quiz|gr[aá]fica)/i,
  /export (this|the) (table|schema|matrix|quiz|chart|artifact)/i,
  /descargar? (esta|este)/i,
  /download (this|the) (table|schema|matrix)/i,
];

function resolveSemanticOperation(ctx: OrchestrationContext): SemanticOperation {
  const msg = ctx.message?.trim() ?? '';
  const hasArtifacts = (ctx.state.artifactRegistry?.length ?? 0) > 0;

  if (ARTIFACT_SPECIFIC_PATTERNS.some((p) => p.test(msg))) {
    return 'export_artifact';
  }

  if (hasArtifacts && SESSION_REF_PATTERNS.some((p) => p.test(msg))) {
    return 'package_session';
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPIC AND MODE RESOLVERS
// ─────────────────────────────────────────────────────────────────────────────

const ORCH_NOISE =
  /^(continúa|continua|siguiente|next|ok|sí|si|yes|no|vale|listo|bien|ready|start|más|mas|seguir|continue|adelante|proceed|claro|entendido|understood)$/i;

function resolvePedagogicalMode(
  message: string,
  state: import('../../lib/contracts').SessionState,
): import('../../lib/contracts').PedagogicalMode {
  const t = message.toLowerCase().trim();
  if (
    /\besquema\b|\bschema\b|\bresumen\s+visual|\bstructured\s+summary\b|\bstructure\s+this\b|\borganize\s+this\b/i.test(
      t,
    )
  ) {
    return 'schema';
  }
  if (
    /\btabla\b|\bmatriz\b|\btable\b|\bmatrix\b|\bcompar[ae]/i.test(t) &&
    !/\btabla.*de\s+contenido/i.test(t)
  ) {
    return 'table';
  }
  if (state.pedagogicalMode === 'schema') return 'schema';
  if (state.pedagogicalMode === 'table') return 'table';
  if (state.activeMode === 'free') return 'conversation';
  return 'explanation';
}

function resolveCurrentTopic(
  state: import('../../lib/contracts').SessionState,
  message: string,
): string {
  if (state.currentLessonTopic?.trim()) return state.currentLessonTopic;

  const clean = message?.trim();
  const EXACT_REFERENTIAL =
    /^(este tema|this topic|lo mismo|the same|eso|that|esto|this|el mismo|same|continuar|continue|lo anterior|el tema|the topic|más sobre|more on)$/i;
  const SEMANTIC_REFERENTIAL =
    /\b(hazme|dame|genera|crea|muéstrame|show me|give me|make|create|generate|convierte|convert|exporta|export)\b.{0,60}\b(este|esto|eso|ese|el mismo|el tema|this|that|it|the same)\b/i;

  const isReferential =
    !clean ||
    clean.length < 30 ||
    EXACT_REFERENTIAL.test(clean) ||
    SEMANTIC_REFERENTIAL.test(clean);

  if (!isReferential && clean && clean.length > 4 && !ORCH_NOISE.test(clean)) {
    return clean;
  }
  if (state.lastConcept?.trim()) return state.lastConcept;
  if (state.lastUserGoal?.trim()) return state.lastUserGoal;
  if (state.curriculumPlan?.topic) return state.curriculumPlan.topic;
  if (clean && clean.length > 4 && !ORCH_NOISE.test(clean)) return clean;
  return 'Spanish grammar';
}

function getOnboardingTopic(state: OrchestrationContext['state']): string | undefined {
  const maybe = state as unknown as { topic?: unknown };
  return typeof maybe.topic === 'string' && maybe.topic.trim()
    ? maybe.topic.trim()
    : undefined;
}

function resolveEffectiveCourseTopic(
  ctx: OrchestrationContext,
  explicit?: string,
): string | undefined {
  return explicit
    ? explicit
    : ctx.state.lastConcept?.trim()
      ? ctx.state.lastConcept.trim()
      : ctx.state.lastUserGoal?.trim()
        ? ctx.state.lastUserGoal.trim()
        : getOnboardingTopic(ctx.state);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export function orchestrate(ctx: OrchestrationContext): ExecutionPlan {
  const pedagogicalMode = resolvePedagogicalMode(ctx.message, ctx.state);
  if (pedagogicalMode !== ctx.state.pedagogicalMode) {
    ctx = { ...ctx, state: { ...ctx.state, pedagogicalMode } };
  }

  // STEP 1 — HARD OVERRIDES
  if (isHardOverride(ctx.intent)) {
    return buildHardOverridePlan(ctx);
  }

  // STEP 1.5 — EXERCISE LOCK
  if (ctx.state.expectedResponseMode === 'exercise_answer' && ctx.state.currentExercise) {
    return buildExerciseLockPlan(ctx);
  }

  // STEP 2 — FIRST INTERACTION
  if (ctx.isFirstTurn) {
    return buildFirstTurnPlan(ctx);
  }

  // STEP 2.5 — SEMANTIC OPERATION
  const semanticOp = resolveSemanticOperation(ctx);
  if (semanticOp === 'package_session') {
    return buildPackageSessionPlan(ctx);
  }
  if (semanticOp === 'export_artifact') {
    return buildExportArtifactPlan(ctx);
  }

  // STEP 3 — STRONG CURRICULUM REQUEST
  if (isStrongCurriculumRequest(ctx.intent)) {
    return buildCurriculumPlan(ctx);
  }

  // STEP 4 — FAST-PATH ARTIFACT REQUEST
  if (isFastPathArtifact(ctx.intent)) {
    return buildFastPathPlan(ctx);
  }

  // STEP 5 — ACTIVE PEDAGOGICAL PHASE
  if (ctx.state.activeMode === 'structured' || ctx.state.activeMode === 'pdf_course') {
    return buildPedagogicalPlan(ctx);
  }

  // STEP 6 — DEFAULT CONVERSATION FALLBACK
  return buildConversationPlan(ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// BRANCH BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildHardOverridePlan(ctx: OrchestrationContext): ExecutionPlan {
  const subtype = ctx.intent.subtype as IntentSubtype;

  const overrideMap: Record<
    string,
    {
      executor: ExecutorType | 'hybrid';
      action: string;
      pedagogicalAction: PedagogicalAction;
      artifacts: ArtifactType[];
    }
  > = {
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
      artifacts: ['audio'],
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
    package_session: {
      executor: 'tool_pdf',
      action: 'packageSession',
      pedagogicalAction: 'package_session',
      artifacts: ['pdf_chat'],
    },
    export_artifact: {
      executor: 'tool_pdf',
      action: 'exportArtifact',
      pedagogicalAction: 'export_artifact',
      artifacts: ['pdf'],
    },
    pronunciation_eval: {
      executor: 'hybrid',
      action: 'evaluatePronunciation',
      pedagogicalAction: 'pronunciation_eval',
      artifacts: ['pronunciation_report', 'audio'],
    },
  };

  const config = overrideMap[subtype] ?? {
    executor: 'mentor' as ExecutorType,
    action: 'hardOverrideFallback',
    pedagogicalAction: 'conversation' as PedagogicalAction,
    artifacts: [] as ArtifactType[],
  };

  // SEEK 4.1c — Experience Gate for generate_course_pdf
  if (subtype === 'generate_course_pdf') {
    const explicit = extractCourseTopic(ctx.message);
    const resolvedTopic = resolveEffectiveCourseTopic(ctx, explicit);

    if (!resolvedTopic || isSelfReferential(resolvedTopic)) {
      return buildClarificationPlan(ctx);
    }

    return {
      executor: 'tool_pdf',
      priority: PRIORITY.HARD_OVERRIDE,
      blocking: true,
      pedagogicalAction: 'generate_course_pdf',
      artifacts: ['course_pdf'],
      mentor: buildMentorDirective(
        ctx.state.mentorProfile,
        'CURRICULUM_PRESENTER_DIRECTIVE',
        ctx,
      ),
      commercial: undefined,
      skipPhaseAdvance: true,
      reason: `hard_override:generate_course_pdf — topic="${resolvedTopic}" resolved via experience_gate. Source: ${explicit ? 'explicit' : ctx.state.lastConcept ? 'lastConcept' : ctx.state.lastUserGoal ? 'lastUserGoal' : 'onboarding'}.`,
      resolvedTopic,
      executionOrder: [
        {
          order: 1,
          executor: 'tool_pdf',
          action: 'generateCoursePdf',
          timeout: 120000,
          params: { topic: resolvedTopic },
        },
      ],
    };
  }

  const step: ExecutionStep = {
    order: 1,
    executor: config.executor === 'hybrid' ? 'mentor' : config.executor,
    action: config.action,
    timeout: 15000,
  };

  return {
    executor: config.executor,
    priority: PRIORITY.HARD_OVERRIDE,
    blocking: true,
    pedagogicalAction: config.pedagogicalAction,
    artifacts: config.artifacts,
    mentor:
      config.executor === 'mentor' || config.executor === 'hybrid'
        ? buildMentorDirective(
            ctx.state.mentorProfile,
            subtype === 'translate'
              ? 'TRANSLATION_ONLY_DIRECTIVE'
              : subtype === 'correct'
                ? 'CORRECTION_ONLY_DIRECTIVE'
                : subtype === 'pronunciation_eval'
                  ? 'PRONUNCIATION_EVAL_DIRECTIVE'
                  : 'RICH_CONTENT_DIRECTIVE',
            ctx,
          )
        : undefined,
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: `hard_override:${subtype} — user explicitly requested ${subtype}. Bypasses all pedagogy.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: buildHardOverrideSteps(subtype, step),
  };
}

function buildHardOverrideSteps(subtype: string, step1: ExecutionStep): ExecutionStep[] {
  if (subtype === 'transcribe') {
    return [
      step1,
      {
        order: 2,
        executor: 'mentor' as ExecutorType,
        action: 'respondToTranscription',
        dependsOn: 1,
        timeout: 12000,
      },
      {
        order: 3,
        executor: 'tool_audio' as ExecutorType,
        action: 'generateTTS',
        dependsOn: 2,
        timeout: 10000,
      },
    ];
  }
  if (subtype === 'pronunciation_eval') {
    return [
      {
        order: 1,
        executor: 'tool_audio' as ExecutorType,
        action: 'transcribeAudio',
        timeout: 10000,
      },
      {
        order: 2,
        executor: 'mentor' as ExecutorType,
        action: 'evaluatePronunciation',
        dependsOn: 1,
        timeout: 12000,
      },
      {
        order: 3,
        executor: 'tool_audio' as ExecutorType,
        action: 'generateTTS',
        dependsOn: 2,
        timeout: 8000,
      },
    ];
  }
  return [step1];
}

function buildPackageSessionPlan(ctx: OrchestrationContext): ExecutionPlan {
  const artifactCount = ctx.state.artifactRegistry?.length ?? 0;

  return {
    executor: 'mentor',
    priority: PRIORITY.SEMANTIC_OP,
    blocking: true,
    pedagogicalAction: 'package_session',
    artifacts: [],
    mentor: buildMentorDirective(ctx.state.mentorProfile, 'RICH_CONTENT_DIRECTIVE', ctx),
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: `semantic_op:package_session — user wants session materials packaged. artifactRegistry has ${artifactCount} entries. exportSessionStudyPdf available in SEEK 4.2. Honest mentor response.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: [
      {
        order: 1,
        executor: 'mentor',
        action: 'packageSessionHonestResponse',
        timeout: 12000,
        params: { artifactCount, availableIn: 'SEEK 4.2' },
      },
    ],
  };
}

function buildExportArtifactPlan(ctx: OrchestrationContext): ExecutionPlan {
  return {
    executor: 'mentor',
    priority: PRIORITY.SEMANTIC_OP,
    blocking: true,
    pedagogicalAction: 'export_artifact',
    artifacts: [],
    mentor: buildMentorDirective(ctx.state.mentorProfile, 'RICH_CONTENT_DIRECTIVE', ctx),
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: `semantic_op:export_artifact — user wants individual artifact exported. Per-artifact export buttons available in SEEK 4.2.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: [
      {
        order: 1,
        executor: 'mentor',
        action: 'exportArtifactHonestResponse',
        timeout: 12000,
        params: { availableIn: 'SEEK 4.2' },
      },
    ],
  };
}

function buildExerciseLockPlan(ctx: OrchestrationContext): ExecutionPlan {
  return {
    executor: 'hybrid',
    priority: PRIORITY.EXERCISE_LOCK,
    blocking: false,
    pedagogicalAction: 'feedback',
    artifacts: ['audio'],
    mentor: buildMentorDirective(ctx.state.mentorProfile, 'EXERCISE_FEEDBACK_DIRECTIVE', ctx),
    commercial: undefined,
    skipPhaseAdvance: false,
    reason: `exercise_lock:priority_95 — user answering active exercise "${ctx.state.currentExercise?.substring(0, 60) ?? 'unknown'}".`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: [
      { order: 1, executor: 'mentor', action: 'evaluateExerciseResponse', timeout: 15000 },
      {
        order: 2,
        executor: 'tool_audio',
        action: 'generateTTS',
        dependsOn: 1,
        timeout: 10000,
      },
    ],
  };
}

function buildFirstTurnPlan(ctx: OrchestrationContext): ExecutionPlan {
  const isStructured = ctx.state.activeMode === 'structured' || ctx.state.activeMode === 'pdf_course';
  const steps: ExecutionStep[] = [
    { order: 1, executor: 'mentor', action: 'firstTurnGreeting', timeout: 12000 },
  ];
  if (isStructured) {
    steps.push({
      order: 2,
      executor: 'tool_audio',
      action: 'generateTTS',
      dependsOn: 1,
      timeout: 8000,
    });
  }
  return {
    executor: isStructured ? 'hybrid' : 'mentor',
    priority: PRIORITY.FIRST_TURN,
    blocking: true,
    pedagogicalAction: 'first_turn_greeting',
    artifacts: isStructured ? ['audio'] : [],
    mentor: buildMentorDirective(ctx.state.mentorProfile, 'FIRST_TURN_DIRECTIVE', ctx),
    commercial: undefined,
    skipPhaseAdvance: false,
    reason: 'first_turn — tokens=0, session start.',
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: steps,
  };
}

function buildCurriculumPlan(ctx: OrchestrationContext): ExecutionPlan {
  const explicit = extractCourseTopic(ctx.message);
  const resolvedTopic = resolveEffectiveCourseTopic(ctx, explicit);

  if (!resolvedTopic || isSelfReferential(resolvedTopic)) {
    return buildClarificationPlan(ctx);
  }

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
    reason: `curriculum_generation — topic="${resolvedTopic}" resolved. intent.subtype=curriculum_request.`,
    resolvedTopic,
    executionOrder: [
      { order: 1, executor: 'knowledge', action: 'retrieveTopicContext', timeout: 5000 },
      { order: 2, executor: 'mentor', action: 'generateCurriculum', dependsOn: 1, timeout: 20000 },
      {
        order: 3,
        executor: 'tool_schema',
        action: 'buildRoadmapArtifact',
        dependsOn: 2,
        timeout: 10000,
      },
    ],
  };
}

function buildFastPathPlan(ctx: OrchestrationContext): ExecutionPlan {
  const subtype = ctx.intent.subtype;
  type ArtifactConfig = {
    executor: ExecutorType;
    action: string;
    artifact: ArtifactType;
  };
  const artifactMap: Record<string, ArtifactConfig> = {
    table_matrix: {
      executor: 'tool_schema',
      action: 'generateTableMatrix',
      artifact: 'table_matrix',
    },
    schema_pro: {
      executor: 'tool_schema',
      action: 'generateSchemaPro',
      artifact: 'schema_pro',
    },
    table: {
      executor: 'tool_schema',
      action: 'generateTable',
      artifact: 'table',
    },
    schema: {
      executor: 'tool_schema',
      action: 'generateSchema',
      artifact: 'schema',
    },
    quiz: {
      executor: 'tool_schema',
      action: 'generateQuiz',
      artifact: 'quiz',
    },
    illustration: {
      executor: 'tool_image',
      action: 'generateIllustration',
      artifact: 'illustration',
    },
    roadmap: {
      executor: 'tool_schema',
      action: 'buildRoadmapArtifact',
      artifact: 'roadmap',
    },
  };
  const config: ArtifactConfig = artifactMap[subtype ?? ''] ?? {
    executor: 'tool_schema',
    action: 'generateSchema',
    artifact: 'schema',
  };
  return {
    executor: 'hybrid',
    priority: PRIORITY.FAST_PATH,
    blocking: false,
    pedagogicalAction: 'lesson',
    artifacts: [config.artifact],
    mentor: buildMentorDirective(ctx.state.mentorProfile, 'RICH_CONTENT_DIRECTIVE', ctx),
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: `fast_path:${subtype ?? 'schema'} — explicit artifact request.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: [
      { order: 1, executor: config.executor, action: config.action, timeout: 12000 },
      {
        order: 2,
        executor: 'mentor',
        action: 'briefArtifactIntro',
        dependsOn: 1,
        timeout: 8000,
      },
    ],
  };
}

function buildPedagogicalPlan(ctx: OrchestrationContext): ExecutionPlan {
  const { tutorPhase, activeMode } = ctx.state;
  type PhaseConfig = {
    pedagogicalAction: PedagogicalAction;
    artifact?: ArtifactType;
    directive: MentorDirective['directive'];
    producesArtifact: boolean;
  };
  const phaseMap: Record<TutorPhase, PhaseConfig> = {
    guide: {
      pedagogicalAction: 'guide',
      directive: 'STRUCTURED_COURSE_DIRECTIVE',
      producesArtifact: false,
    },
    lesson: {
      pedagogicalAction: 'lesson',
      directive: 'STRUCTURED_COURSE_DIRECTIVE',
      producesArtifact: false,
    },
    schema: {
      pedagogicalAction: 'schema',
      artifact: 'schema',
      directive: 'STRUCTURED_COURSE_DIRECTIVE',
      producesArtifact: true,
    },
    quiz: {
      pedagogicalAction: 'quiz',
      artifact: 'quiz',
      directive: 'STRUCTURED_COURSE_DIRECTIVE',
      producesArtifact: true,
    },
    feedback: {
      pedagogicalAction: 'feedback',
      directive: 'STRUCTURED_COURSE_DIRECTIVE',
      producesArtifact: false,
    },
    conversation: {
      pedagogicalAction: 'conversation',
      directive: 'FREE_CONVERSATION_DIRECTIVE',
      producesArtifact: false,
    },
  };
  const config = phaseMap[tutorPhase] ?? phaseMap.guide;
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
    steps.push({ order: 1, executor: 'mentor', action: `phase_${tutorPhase}`, timeout: 15000 });
    steps.push({
      order: 2,
      executor: 'tool_audio',
      action: 'generateTTS',
      dependsOn: 1,
      timeout: 8000,
    });
  }
  return {
    executor: 'hybrid',
    priority: PRIORITY.PEDAGOGICAL,
    blocking: false,
    pedagogicalAction: config.pedagogicalAction,
    artifacts: config.artifact ? [config.artifact] : [],
    mentor: buildMentorDirective(ctx.state.mentorProfile, config.directive, ctx),
    commercial: undefined,
    skipPhaseAdvance: false,
    reason: `pedagogical_phase:${tutorPhase} — mode=${activeMode}.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: steps,
  };
}

function buildConversationPlan(ctx: OrchestrationContext): ExecutionPlan {
  const directive =
    ctx.state.activeMode === 'free' ? 'FREE_CONVERSATION_DIRECTIVE' : 'RICH_CONTENT_DIRECTIVE';
  return {
    executor: 'hybrid',
    priority: PRIORITY.DEFAULT,
    blocking: false,
    pedagogicalAction: 'conversation',
    artifacts: ['audio'],
    mentor: buildMentorDirective(ctx.state.mentorProfile, directive, ctx),
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: `default_conversation — fallthrough from all branches. mode=${ctx.state.activeMode}.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: [
      { order: 1, executor: 'mentor', action: 'conversation', timeout: 15000 },
      {
        order: 2,
        executor: 'tool_audio',
        action: 'generateTTS',
        dependsOn: 1,
        timeout: 8000,
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SEEK 4.1c — EXPERIENCE GATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const SELF_REFERENTIAL_TERMS = [
  'pdf',
  'crear un pdf',
  'hacer un pdf',
  'curso completo',
  'un curso',
  'el curso',
  'cómo crear',
  'cómo hacer',
  'diseñar',
  'maquetación',
  'maquetacion',
  'exportar',
  'exportación',
  'formato',
  'documento',
  'presentación profesional',
  'presentacion profesional',
  'redaccion',
  'redacción',
  'portada',
  'índice',
  'indice',
] as const;

function isSelfReferential(topic: string): boolean {
  const norm = topic.toLowerCase().trim();
  return SELF_REFERENTIAL_TERMS.some((ref) => norm.includes(ref));
}

function extractCourseTopic(message: string): string | undefined {
  const norm = message.toLowerCase();

  const sobreM = norm.match(/\b(?:sobre|acerca\s+de)\s+([a-záéíóúñü][^,.;?!\n]{2,60})/);
  if (sobreM) {
    const candidate = sobreM[1]
      .trim()
      .replace(/\s+en\s+(español|pdf).*$/, '')
      .trim();
    if (candidate.length > 2 && !isSelfReferential(candidate)) return candidate;
  }

  const deM = norm.match(
    /\b(?:curso|pdf|material|guía|guia)\s+(?:[abc][012]\s+)?(?:de\s+)?(?:[a-záéíóúñü]+\s+){0,2}de\s+([a-záéíóúñü][^,.;?!\n]{2,60})/,
  );
  if (deM) {
    const candidate = deM[1]
      .trim()
      .replace(/\s+en\s+(español|pdf).*$/, '')
      .trim();
    if (candidate.length > 2 && !isSelfReferential(candidate)) return candidate;
  }

  const levelM = norm.match(/\b[abc][012]\s+(?:de|sobre|en)\s+([a-záéíóúñü][^,.;?!\n]{2,60})/);
  if (levelM) {
    const candidate = levelM[1].trim();
    if (candidate.length > 2 && !isSelfReferential(candidate)) return candidate;
  }

  return undefined;
}

function buildClarificationMessage(lang?: string): string {
  const msgs: Record<string, string> = {
    es: 'Claro, preparo el curso en PDF. ¿Sobre qué tema lo quieres? Por ejemplo: gramática española, verbos irregulares, vocabulario de viajes, comunicación profesional... Dime el tema y lo genero.',
    en: "Sure, I can prepare the PDF course. What topic would you like? For example: Spanish grammar, irregular verbs, travel vocabulary, professional communication... Tell me the topic and I'll generate it.",
    no: 'Jeg kan lage PDF-kurset. Hva vil du lære om? For eksempel: spansk grammatikk, uregelmessige verb, reisevokabular, profesjonell kommunikasjon... Fortell meg emnet, så lager jeg det.',
    de: 'Klar, ich bereite den PDF-Kurs vor. Über welches Thema? Z.B.: spanische Grammatik, unregelmäßige Verben, Reisewortschatz... Sag mir das Thema.',
    fr: 'Bien sûr, je prépare le cours en PDF. Sur quel sujet? Par exemple: grammaire espagnole, verbes irréguliers, vocabulaire de voyage... Dis-moi le sujet.',
    it: 'Certo, preparo il corso in PDF. Su quale argomento? Ad esempio: grammatica spagnola, verbi irregolari, vocabolario di viaggio... Dimmi il tema.',
    pt: 'Claro, preparo o curso em PDF. Sobre qual tema? Por exemplo: gramática espanhola, verbos irregulares, vocabulário de viagens... Diga-me o tema.',
    nl: 'Uiteraard, ik maak de PDF-cursus. Over welk onderwerp? Bijvoorbeeld: Spaanse grammatica, onregelmatige werkwoorden, reiswoordenschat... Vertel me het onderwerp.',
  };
  return msgs[lang ?? ''] ?? msgs.en;
}

function buildClarificationPlan(ctx: OrchestrationContext): ExecutionPlan {
  return {
    executor: 'mentor',
    priority: PRIORITY.CURRICULUM,
    blocking: true,
    pedagogicalAction: 'conversation',
    artifacts: [],
    mentor: buildMentorDirective(ctx.state.mentorProfile, 'RICH_CONTENT_DIRECTIVE', ctx),
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: 'experience_gate:clarification — PDF course requested without resolvable topic. Asking user before generating.',
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: [
      {
        order: 1,
        executor: 'mentor',
        action: 'clarifyCourseTopic',
        timeout: 8000,
        params: { clarificationMessage: buildClarificationMessage(ctx.interfaceLanguage) },
      },
    ],
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
  return {
    profile: resolvedProfile,
    directive,
    injectContinuity: !!(ctx.state.lastConcept || ctx.state.lastUserGoal),
    injectErrorMemory: !!(
      ctx.state.errorMemory &&
      (ctx.state.errorMemory.grammar.length > 0 ||
        ctx.state.errorMemory.vocabulary.length > 0)
    ),
    cognitiveStructure:
      directive === 'STRUCTURED_COURSE_DIRECTIVE' ||
      directive === 'FREE_CONVERSATION_DIRECTIVE',
    ...(directive === 'EXERCISE_FEEDBACK_DIRECTIVE' && {
      activeExercise: ctx.state.currentExercise,
      activeTopic: ctx.state.currentLessonTopic ?? ctx.state.lastConcept,
    }),
  };
}
