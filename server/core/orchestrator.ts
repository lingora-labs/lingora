// =============================================================================
// server/core/orchestrator.ts
// LINGORA SEEK 3.3 — Sole Decision Authority
// =============================================================================
// Purpose  : The single authority that decides WHO responds, in WHAT ORDER,
//            with WHAT DEPENDENCIES, under WHAT BLOCKING CONDITIONS.
//
//            THIS MODULE:
//            ✅ Reads OrchestrationContext (intent + state)
//            ✅ Evaluates 6 branches in constitutional order
//            ✅ Produces one complete, auditable ExecutionPlan
//            ❌ Does NOT call OpenAI or any external service
//            ❌ Does NOT execute anything
//            ❌ Does NOT modify state
//            ❌ Does NOT produce artifacts
//            ❌ Does NOT decide on mentor responses
//
// Constitutional evaluation order (MUST NOT be scattered):
//   1. Hard overrides
//   2. First interaction (tokens === 0)
//   3. Strong curriculum request
//   4. Fast-path artifact request
//   5. Active pedagogical phase (structured mode)
//   6. Default conversation fallback
//
// Riesgo principal : Evaluation order drift — adding bypass logic outside
//                    this file reintroduces multi-cerebro. Any new branch
//                    MUST be added here and only here.
//
// Dependencia      : lib/contracts.ts, server/core/intent-router.ts
//
// Commit   : feat(orchestrator): SEEK 3.3 — sole decision authority,
//            6-step constitutional evaluation, auditable ExecutionPlan
// =============================================================================

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
  HARD_OVERRIDE:    100,
  EXERCISE_LOCK:     95,  // SEEK 3.1 Fase 0-A — between hard override and first turn
  FIRST_TURN:        90,
  CURRICULUM:        80,
  FAST_PATH:         70,
  PEDAGOGICAL:       60,
  DEFAULT:           10,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SEEK 3.1 Fase 0-A — TOPIC RESOLVER (orchestrator)
// Single source of truth for "what topic is this session about".
// Execution-engine receives the pre-resolved topic via ExecutionPlan.resolvedTopic.
// ─────────────────────────────────────────────────────────────────────────────

const ORCH_NOISE = /^(continúa|continua|siguiente|next|ok|sí|si|yes|no|vale|listo|bien|ready|start|más|mas|seguir|continue|adelante|proceed|claro|entendido|understood)$/i;

function resolveCurrentTopic(state: import('../../lib/contracts').SessionState, message: string): string {
  if (state.currentLessonTopic?.trim()) return state.currentLessonTopic;
  const clean = message?.trim();
  if (clean && clean.length > 4 && !ORCH_NOISE.test(clean)) return clean;
  if (state.lastConcept?.trim())    return state.lastConcept;
  if (state.lastUserGoal?.trim())   return state.lastUserGoal;
  if (state.curriculumPlan?.topic)  return state.curriculumPlan.topic;
  return 'Spanish grammar';
}


// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — THE ONLY ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * orchestrate
 * ──────────────────────────────────────────────────────────────────────────
 * The sole runtime decision function. All execution authority flows through
 * this function. Every request MUST pass through here.
 *
 * Returns a complete ExecutionPlan:
 * - executor type (or 'hybrid')
 * - priority
 * - blocking flag
 * - pedagogical action
 * - expected artifact types
 * - mentor directive (if applicable)
 * - explicit execution order with step dependencies
 * - human-readable reason (mandatory, non-empty)
 *
 * DETERMINISM GUARANTEE:
 * Same ctx.message + ctx.state + ctx.intent → same ExecutionPlan, always.
 * No randomness. No external calls. No side effects.
 */
export function orchestrate(ctx: OrchestrationContext): ExecutionPlan {

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 — HARD OVERRIDES
  // Explicit system commands. Bypass all pedagogy. Always blocking.
  // ══════════════════════════════════════════════════════════════════════════
  if (isHardOverride(ctx.intent)) {
    return buildHardOverridePlan(ctx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1.5 — EXERCISE LOCK (SEEK 3.1 Fase 0-A)
  // User is answering an active exercise. Evaluate the response — do not launch new theory.
  // ══════════════════════════════════════════════════════════════════════════
  if (
    ctx.state.expectedResponseMode === 'exercise_answer' &&
    ctx.state.currentExercise
  ) {
    return buildExerciseLockPlan(ctx);
  }

  // STEP 2 — FIRST INTERACTION
  // Zero tokens = first turn of the session. Situated greeting, not generic.
  // ══════════════════════════════════════════════════════════════════════════
  if (ctx.isFirstTurn) {
    return buildFirstTurnPlan(ctx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — STRONG CURRICULUM REQUEST
  // User wants a complete structured course. Generate full curriculum.
  // ══════════════════════════════════════════════════════════════════════════
  if (isStrongCurriculumRequest(ctx.intent)) {
    return buildCurriculumPlan(ctx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4 — FAST-PATH ARTIFACT REQUEST
  // User explicitly requested a schema, table, matrix, or illustration.
  // Returns artifact without going through pedagogical phases.
  // Priority: table_matrix > schema_pro > table > schema > quiz > illustration
  // ══════════════════════════════════════════════════════════════════════════
  if (isFastPathArtifact(ctx.intent)) {
    return buildFastPathPlan(ctx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5 — ACTIVE PEDAGOGICAL PHASE
  // Structured or pdf_course mode with an active phase sequence.
  // ══════════════════════════════════════════════════════════════════════════
  if (ctx.state.activeMode === 'structured' || ctx.state.activeMode === 'pdf_course') {
    return buildPedagogicalPlan(ctx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6 — DEFAULT CONVERSATION FALLBACK
  // Free conversation, interact mode, or any unclassified intent.
  // This branch NEVER throws. It is the guaranteed fallsafe.
  // ══════════════════════════════════════════════════════════════════════════
  return buildConversationPlan(ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// BRANCH BUILDERS — private, each produces one complete ExecutionPlan
// ─────────────────────────────────────────────────────────────────────────────

// ── STEP 1: Hard Override ─────────────────────────────────────────────────

function buildHardOverridePlan(ctx: OrchestrationContext): ExecutionPlan {
  const subtype = ctx.intent.subtype as IntentSubtype;

  // Map subtype to executor + action + artifact
  const overrideMap: Record<string, {
    executor: ExecutorType | 'hybrid';
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
      artifacts: ['audio'],  // FIX-9B: TTS step produces audio artifact
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
    pronunciation_eval: {
      // 2.8-A: 3-step plan — transcribe → mentor evaluates → TTS
      // executor is hybrid because it combines tool_audio + mentor + TTS
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
    // F-B4: directive per hard override subtype
    // Also set for hybrid executor (pronunciation_eval) — mentor step needs it
    mentor: (config.executor === 'mentor' || config.executor === 'hybrid')
      ? buildMentorDirective(
          ctx.state.mentorProfile,
          subtype === 'translate'          ? 'TRANSLATION_ONLY_DIRECTIVE'
          : subtype === 'correct'          ? 'CORRECTION_ONLY_DIRECTIVE'
          : subtype === 'pronunciation_eval' ? 'PRONUNCIATION_EVAL_DIRECTIVE'
          : 'RICH_CONTENT_DIRECTIVE',
          ctx,
        )
      : undefined,
    commercial: undefined, // hard overrides never trigger commercial
    skipPhaseAdvance: true,
    reason: `hard_override:${subtype} — user explicitly requested ${subtype}. Bypasses all pedagogy. Matched pattern: ${ctx.intent.matchedPattern ?? 'unknown'}`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: buildHardOverrideSteps(subtype, step),
  };
}

// FIX-9B: build multi-step execution for transcribe (transcribe → mentor → TTS)
// Other hard overrides remain single-step
function buildHardOverrideSteps(
  subtype: string,
  step1: ExecutionStep,
): ExecutionStep[] {
  if (subtype === 'transcribe') {
    return [
      step1,
      { order: 2, executor: 'mentor' as ExecutorType, action: 'respondToTranscription', dependsOn: 1, timeout: 12000 },
      { order: 3, executor: 'tool_audio' as ExecutorType, action: 'generateTTS', dependsOn: 2, timeout: 10000 },
    ];
  }
  // 2.8-A: pronunciation_eval — transcribe audio → mentor evaluates → TTS feedback
  if (subtype === 'pronunciation_eval') {
    return [
      // Step 1: transcribe what the user said
      { order: 1, executor: 'tool_audio' as ExecutorType, action: 'transcribeAudio', timeout: 10000 },
      // Step 2: mentor evaluates pronunciation against last mentor phrase
      { order: 2, executor: 'mentor' as ExecutorType, action: 'evaluatePronunciation', dependsOn: 1, timeout: 12000 },
      // Step 3: speak the corrected pronunciation so user can hear it
      { order: 3, executor: 'tool_audio' as ExecutorType, action: 'generateTTS', dependsOn: 2, timeout: 8000 },
    ];
  }
  return [step1];
}

// ── STEP 2: First Turn ────────────────────────────────────────────────────

// ── STEP 1.5: Exercise Lock (SEEK 3.1 Fase 0-A) ─────────────────────────────
// The user is responding to an active exercise. The mentor evaluates that
// specific response — it does NOT launch new theory or change the topic.
// expectedResponseMode stays 'exercise_answer' until the mentor clears it
// by writing 'free' to state after delivering feedback.

function buildExerciseLockPlan(ctx: OrchestrationContext): ExecutionPlan {
  const steps: ExecutionStep[] = [
    {
      order: 1,
      executor: 'mentor',
      action: 'evaluateExerciseResponse',  // mentor receives exercise context + user answer
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
    executor:          'hybrid',
    priority:          PRIORITY.EXERCISE_LOCK,
    blocking:          false,
    pedagogicalAction: 'feedback',
    artifacts:         ['audio'],
    mentor:            buildMentorDirective(
      ctx.state.mentorProfile,
      'EXERCISE_FEEDBACK_DIRECTIVE',
      ctx,
    ),
    commercial:        undefined,
    skipPhaseAdvance:  false,
    reason: `exercise_lock:priority_95 — user answering active exercise "${
      ctx.state.currentExercise?.substring(0, 60) ?? 'unknown'
    }". System evaluates response before any other branch. Topic: "${
      ctx.state.currentLessonTopic ?? 'unknown'
    }". Attempt #${(ctx.state._exerciseAttemptCount ?? 0) + 1}.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: steps,
  };
}

function buildFirstTurnPlan(ctx: OrchestrationContext): ExecutionPlan {
  const isStructured = ctx.state.activeMode === 'structured' || ctx.state.activeMode === 'pdf_course';

  // G7 — SEEK 3.3: if level is unknown, request a spontaneous sample BEFORE
  // starting the pedagogical sequence. Enforces Art. 22/24-bis Manifiesto 7.0.
  // G7 — FIX: 'A0' is the default unknown level from the frontend, not a confirmed level.
  // The diagnostic should fire when: no confirmedLevel AND (no level OR level is 'A0')
  const levelUnknown = !ctx.state.confirmedLevel &&
  (!ctx.state.userLevel || ctx.state.userLevel === 'A0');

  // P2: in structured/pdf_course mode, first turn includes TTS so user
  // hears the mentor's introduction while reading — mandatory for the product experience
  const steps: ExecutionStep[] = [
    {
      order: 1,
      executor: 'mentor',
      // G7: if level is unknown use diagnostic greeting, otherwise normal first-turn greeting
      action: levelUnknown && isStructured ? 'diagnosticFirstTurn' : 'firstTurnGreeting',
      timeout: 12000,
    },
  ];
  if (isStructured) {
    steps.push({ order: 2, executor: 'tool_audio', action: 'generateTTS', dependsOn: 1, timeout: 8000 });
  }

  return {
    executor: isStructured ? 'hybrid' : 'mentor',
    priority: PRIORITY.FIRST_TURN,
    blocking: true,
    pedagogicalAction: 'first_turn_greeting',
    artifacts: isStructured ? ['audio'] : [],
    mentor: buildMentorDirective(
      ctx.state.mentorProfile,
      // G7: use diagnostic directive when level is unknown on first turn
      levelUnknown && isStructured ? 'DIAGNOSTIC_FIRST_TURN_DIRECTIVE' : 'FIRST_TURN_DIRECTIVE',
      ctx,
    ),
    commercial: undefined,
    skipPhaseAdvance: false,
    reason: `first_turn — tokens=0, session start. Mentor delivers situated greeting${isStructured ? ' + TTS audio' : ''}. language=${ctx.interfaceLanguage}, mentor=${ctx.state.mentorProfile ?? 'Alex'}`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: steps,
  };
}

// ── STEP 3: Curriculum ────────────────────────────────────────────────────

function buildCurriculumPlan(ctx: OrchestrationContext): ExecutionPlan {
  // Hybrid: mentor presents curriculum narrative + tool generates roadmap artifact
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
      dependsOn: 1,  // needs RAG context before generating
      timeout: 20000,
    },
    {
      order: 3,
      executor: 'tool_schema',
      action: 'buildRoadmapArtifact',
      dependsOn: 2,  // needs curriculum content before building roadmap
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
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: steps,
  };
}

// ── STEP 4: Fast-Path Artifact ────────────────────────────────────────────

function buildFastPathPlan(ctx: OrchestrationContext): ExecutionPlan {
  const subtype = ctx.intent.subtype;

  // Artifact priority resolution: matrix > schema_pro > table > schema > quiz > illustration
  type ArtifactConfig = {
    executor: ExecutorType;
    action: string;
    artifact: ArtifactType;
  };

  const artifactMap: Record<string, ArtifactConfig> = {
    table_matrix:   { executor: 'tool_schema', action: 'generateTableMatrix', artifact: 'table_matrix' },
    schema_pro:     { executor: 'tool_schema', action: 'generateSchemaPro',   artifact: 'schema_pro' },  // FIX-B2: routes to generateSchemaPro → artifact schema_pro
    table:          { executor: 'tool_schema', action: 'generateTable',        artifact: 'table' },
    schema:         { executor: 'tool_schema', action: 'generateSchema',       artifact: 'schema' },
    quiz:           { executor: 'tool_schema', action: 'generateQuiz',         artifact: 'quiz' },
    illustration:   { executor: 'tool_image',  action: 'generateIllustration', artifact: 'illustration' },
    roadmap:        { executor: 'tool_schema', action: 'buildRoadmapArtifact', artifact: 'roadmap' },
  };

  const config: ArtifactConfig = artifactMap[subtype ?? ''] ?? {
    executor: 'tool_schema',
    action: 'generateSchema',
    artifact: 'schema',
  };

  // Hybrid: mentor gives brief contextual text + tool generates artifact
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
      dependsOn: 1, // mentor introduces artifact after it is generated
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
    reason: `fast_path:${subtype ?? 'schema'} — explicit artifact request. Tool generates artifact (step 1) before mentor intro (step 2). Order guaranteed by executionOrder.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: steps,
  };
}

// ── STEP 5: Pedagogical Phase ─────────────────────────────────────────────

function buildPedagogicalPlan(ctx: OrchestrationContext): ExecutionPlan {
  const { tutorPhase, activeMode } = ctx.state;

  // Phase → action + artifact + directive mapping
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

  const config = phaseMap[tutorPhase] ?? phaseMap['guide'];

  const steps: ExecutionStep[] = [];

  if (config.producesArtifact && config.artifact) {
    // Schema and quiz phases: tool generates artifact, mentor delivers it
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
    // Non-artifact phases: mentor responds, then TTS speaks it (G3 — SEEK 3.3)
    steps.push({
      order: 1,
      executor: 'mentor',
      action: `phase_${tutorPhase}`,
      timeout: 15000,
    });
    // G3: TTS step after every mentor response in structured mode
    // This restores parity with SEEK 2.6 where every tutor response had audio
    steps.push({
      order: 2,
      executor: 'tool_audio' as ExecutorType,
      action: 'generateTTS',
      dependsOn: 1,
      timeout: 8000,
    });
  }

  return {
    executor: config.producesArtifact ? 'hybrid' : 'hybrid',  // G3: always hybrid now
    priority: PRIORITY.PEDAGOGICAL,
    blocking: false,
    pedagogicalAction: config.pedagogicalAction,
    artifacts: config.artifact ? [config.artifact] : [],
    mentor: buildMentorDirective(
      ctx.state.mentorProfile,
      config.directive,
      ctx,
    ),
    commercial: undefined, // evaluated separately post-execution by commercial-engine
    skipPhaseAdvance: false,
    reason: `pedagogical_phase:${tutorPhase} — mode=${activeMode}, continuing structured sequence. Phase produces ${config.producesArtifact ? config.artifact : 'no artifact'}.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: steps,
  };
}

// ── STEP 6: Default Conversation ─────────────────────────────────────────

function buildConversationPlan(ctx: OrchestrationContext): ExecutionPlan {
  const directive =
    ctx.state.activeMode === 'free'
      ? 'FREE_CONVERSATION_DIRECTIVE'
      : 'RICH_CONTENT_DIRECTIVE';

  const step: ExecutionStep = {
    order: 1,
    executor: 'mentor',
    action: 'conversation',
    timeout: 15000,
  };

  return {
    executor: 'mentor',
    priority: PRIORITY.DEFAULT,
    blocking: false,
    pedagogicalAction: 'conversation',
    artifacts: [],
    mentor: buildMentorDirective(ctx.state.mentorProfile, directive, ctx),
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: `default_conversation — fallthrough from all branches. mode=${ctx.state.activeMode}, intent=${ctx.intent.type}(${ctx.intent.confidence.toFixed(2)}). Safe fallsafe branch.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: [step],
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
    // SEEK 3.1 Fase 0-A — inject exercise context so mentor knows what to evaluate
    ...(directive === 'EXERCISE_FEEDBACK_DIRECTIVE' && {
      activeExercise: ctx.state.currentExercise,
      activeTopic:    ctx.state.currentLessonTopic ?? ctx.state.lastConcept,
    }),
  };
}
