// =============================================================================
// server/core/orchestrator.ts
// LINGORA SEEK 3.0 — Sole Decision Authority
// =============================================================================
// FIX LOG (applied by Consultora Senior 2026-03-25):
//
//   FIX-2   buildConversationPlan: adds TTS step (order 2) after mentor step
//           (order 1) with dependsOn:1. This restores audio output for all
//           conversational responses, which was missing from the original.
//
//   FIX-2B  buildPedagogicalPlan: adds TTS step after mentor response steps
//           for non-artifact phases (guide, lesson, feedback, conversation).
//           Artifact phases (schema, quiz) do not get TTS — artifact is primary.
//
//   FIX-4   buildMentorDirective: cognitiveStructure is mode-aware.
//           true  → structured, pdf_course, first_turn, curriculum, fast_path
//           false → free, interact (conversation must feel natural, not templated)
//           This prevents over-didactization of modes that should feel human.
//
// Constitutional evaluation order unchanged:
//   1. Hard overrides
//   2. First interaction (tokens === 0)
//   3. Strong curriculum request
//   4. Fast-path artifact request
//   5. Active pedagogical phase (structured/pdf_course mode)
//   6. Default conversation fallback
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
  HARD_OVERRIDE: 100,
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

  // Transcription override: after transcribing, mentor responds to the content
  // Hard overrides for translate/correct also get a follow-up mentor step
  const steps: ExecutionStep[] = [step];

  if (config.executor === 'tool_audio' && subtype === 'transcribe') {
    // Transcription: tool transcribes (step 1), mentor responds to content (step 2)
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

// ── STEP 2: First Turn ────────────────────────────────────────────────────

function buildFirstTurnPlan(ctx: OrchestrationContext): ExecutionPlan {
  // FIX-2: first turn gets TTS so Sarah/Alex/Nick's greeting is heard
  const steps: ExecutionStep[] = [
    { order: 1, executor: 'mentor',     action: 'firstTurnGreeting', timeout: 10000 },
    { order: 2, executor: 'tool_audio', action: 'generateTTS',       dependsOn: 1, timeout: 10000 },
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
    addTTS: boolean;  // FIX-2B: whether to add a TTS step
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
      addTTS: false,  // artifact is primary — no TTS for schema
    },
    quiz: {
      pedagogicalAction: 'quiz',
      artifact: 'quiz',
      directive: 'STRUCTURED_COURSE_DIRECTIVE',
      producesArtifact: true,
      addTTS: false,  // artifact is primary — no TTS for quiz
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
    // FIX-2B: add TTS for spoken phases
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

  // FIX-2: restore TTS — mentor responds (step 1), TTS generates audio (step 2)
  const steps: ExecutionStep[] = [
    { order: 1, executor: 'mentor',     action: 'conversation', timeout: 15000 },
    { order: 2, executor: 'tool_audio', action: 'generateTTS',  dependsOn: 1, timeout: 10000 },
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
// FIX-4: cognitiveStructure is mode-aware, not always true
// ─────────────────────────────────────────────────────────────────────────────

function buildMentorDirective(
  profile: MentorProfile | undefined,
  directive: MentorDirective['directive'],
  ctx: OrchestrationContext,
): MentorDirective {
  const resolvedProfile: MentorProfile = profile ?? 'Alex';

  // FIX-4: cognitiveStructure = true for modes that need structured output.
  // false for free/interact so conversation feels natural, not templated.
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

