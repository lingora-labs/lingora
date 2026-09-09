// =============================================================================
// server/core/orchestrator.ts
// LINGORA SEEK 4.1c2 + SEEK 5.0 S1 Camino C — mentor-first authority
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
  PendingDocumentRequest,
} from '../../lib/contracts';

import {
  isHardOverride,
  isStrongCurriculumRequest,
  isFastPathArtifact,
} from './intent-router';

const PRIORITY = {
  HARD_OVERRIDE:    100,
  EXERCISE_LOCK:     95,
  FIRST_TURN:        90,
  SEMANTIC_OP:       85,
  CURRICULUM:        80,
  FAST_PATH:         70,
  PEDAGOGICAL:       60,
  DEFAULT:           10,
} as const;

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
  if (ARTIFACT_SPECIFIC_PATTERNS.some(p => p.test(msg))) return 'export_artifact';
  if (hasArtifacts && SESSION_REF_PATTERNS.some(p => p.test(msg))) return 'package_session';
  return null;
}

const SELF_REFERENTIAL_TERMS = [
  'pdf', 'crear un pdf', 'hacer un pdf', 'curso completo', 'un curso',
  'el curso', 'cómo crear', 'cómo hacer', 'diseñar', 'maquetación',
  'maquetacion', 'exportar', 'exportación', 'exportacion', 'formato',
  'documento', 'presentación profesional', 'presentacion profesional',
  'redaccion', 'redacción', 'portada', 'índice', 'indice',
] as const;

function isSelfReferential(topic: string): boolean {
  const norm = topic.toLowerCase().trim();
  return SELF_REFERENTIAL_TERMS.some(ref => norm.includes(ref));
}

const NON_DOMAIN_TERMS = [
  'structured', 'structure', 'interacción inteligente', 'interact', 'interactive',
  'free', 'free conversation', 'pdf_course', 'pdf course',
  'schema', 'table', 'matrix', 'quiz', 'roadmap', 'lesson', 'guide',
  'conversation', 'mode', 'general', 'standard', 'default', 'basic', 'onboarding',
] as const;

function isNonDomainTopic(topic: string): boolean {
  const norm = topic.toLowerCase().trim();
  return NON_DOMAIN_TERMS.some(
    t => norm === t || norm.startsWith(t + ' ') || norm.endsWith(' ' + t),
  );
}

const META_GOAL_TERMS = [
  'aprender rápido', 'aprender rapido', 'learn fast', 'learn quickly',
  'improve quickly', 'improve fast', 'mejorar rápido', 'mejorar rapido',
  'quiero aprender', 'quiero mejorar', 'want to learn', 'want to improve',
  'empezar', 'comenzar', 'start learning', 'beginner help',
  'practice more', 'más práctica', 'mas practica', 'quick learning',
] as const;

function isMetaGoal(topic: string): boolean {
  const norm = topic.toLowerCase().trim();
  return META_GOAL_TERMS.some(
    t => norm === t || norm.startsWith(t + ' ') || norm.endsWith(' ' + t),
  );
}

function isInvalidCourseTopic(topic: string): boolean {
  return isSelfReferential(topic) || isNonDomainTopic(topic) || isMetaGoal(topic);
}

function extractCourseTopic(message: string): string | undefined {
  const norm = message.toLowerCase();
  const sobreM = norm.match(/\b(?:sobre|acerca\s+de)\s+([a-záéíóúñü][^,.;?!\n]{2,60})/);
  if (sobreM) {
    const candidate = sobreM[1].trim().replace(/\s+en\s+(español|pdf).*$/, '').trim();
    if (candidate.length > 2 && !isSelfReferential(candidate)) return candidate;
  }
  const deM = norm.match(
    /\b(?:curso|pdf|material|guía|guia)\s+(?:[abc][012]\s+)?(?:de\s+)?(?:[a-záéíóúñü]+\s+){0,2}de\s+([a-záéíóúñü][^,.;?!\n]{2,60})/,
  );
  if (deM) {
    const candidate = deM[1].trim().replace(/\s+en\s+(español|pdf).*$/, '').trim();
    if (candidate.length > 2 && !isSelfReferential(candidate)) return candidate;
  }
  const levelM = norm.match(/\b[abc][012]\s+(?:de|sobre|en)\s+([a-záéíóúñü][^,.;?!\n]{2,60})/);
  if (levelM) {
    const candidate = levelM[1].trim();
    if (candidate.length > 2 && !isSelfReferential(candidate)) return candidate;
  }
  return undefined;
}

const CONTRACT_EXPIRY_TURNS = 15;

type DocumentTurnClass = 'level_input' | 'topic_input' | 'confirmation' | 'other';

function classifyDocumentTurn(message: string): DocumentTurnClass {
  const norm = message.toLowerCase().trim();
  if (/^(sí|si|yes|ok|vale|listo|genera|generate|proceed|adelante|go ahead|hazlo|claro)$/i.test(norm)) {
    return 'confirmation';
  }
  if (/\b(a0|a1|a2|b1|b2|c1|c2|principiante|beginner|intermedio|intermediate|avanzado|advanced|básico|basic|elemental|universitario|experto)\b/i.test(norm)) {
    return 'level_input';
  }
  const t = extractCourseTopic(message);
  if (t && !isInvalidCourseTopic(t)) return 'topic_input';
  return 'other';
}

function extractDocumentLevel(message: string): string | null {
  const norm = message.toUpperCase();
  const cefrM = norm.match(/\b(A0|A1|A2|B1|B2|C1|C2)\b/);
  if (cefrM) return cefrM[1];
  if (/\bUNIVERSITARIO\b/i.test(norm)) return 'Universitario';
  if (/\bEXPERTO\b/i.test(norm)) return 'C2';
  if (/\bAVANZADO\b|ADVANCED/i.test(norm)) return 'C1-C2';
  if (/\bINTERMEDIO\b|INTERMEDIATE/i.test(norm)) return 'B1-B2';
  if (/\bPRINCIPIANTE\b|BEGINNER|ELEMENTAL|BÁSICO|BASIC\b/i.test(norm)) return 'A1-A2';
  return null;
}

function buildDocumentContractGate(ctx: OrchestrationContext): ExecutionPlan {
  const tokens = ctx.state.tokens ?? 0;
  const existing = ctx.state.pendingDocumentRequest as PendingDocumentRequest | undefined;
  const turnClass = classifyDocumentTurn(ctx.message);

  if (existing && (tokens - existing.openedAtToken) > CONTRACT_EXPIRY_TURNS) {
    return buildOpenContractPlan(ctx, null, null);
  }

  if (!existing) {
    const levelFromMsg = extractDocumentLevel(ctx.message);
    const topicRaw = extractCourseTopic(ctx.message);
    const validTopic = (topicRaw && !isInvalidCourseTopic(topicRaw)) ? topicRaw : null;
    return buildOpenContractPlan(ctx, levelFromMsg, validTopic);
  }

  let { level, topic } = existing;
  if (turnClass === 'level_input') {
    level = extractDocumentLevel(ctx.message) ?? level;
  } else if (turnClass === 'topic_input') {
    const t = extractCourseTopic(ctx.message);
    if (t && !isInvalidCourseTopic(t)) topic = t;
  }

  const hasLevel = !!(level && level !== 'General');
  if (hasLevel && (turnClass === 'confirmation' || turnClass === 'level_input' || turnClass === 'topic_input')) {
    return topic
      ? buildGeneratePdfPlan(ctx, topic, level!)
      : buildCollectingPlan(ctx, { type: 'course_pdf', level, topic, status: 'collecting', openedAtToken: existing.openedAtToken });
  }

  return buildCollectingPlan(ctx, { type: 'course_pdf', level, topic, status: 'collecting', openedAtToken: existing.openedAtToken });
}

function buildOpenContractPlan(
  ctx: OrchestrationContext,
  level: string | null,
  topic: string | null,
): ExecutionPlan {
  const contract: PendingDocumentRequest = { type: 'course_pdf', level, topic, status: 'collecting', openedAtToken: ctx.state.tokens ?? 0 };
  if (level && level !== 'General' && topic) {
    return buildGeneratePdfPlan(ctx, topic, level);
  }
  const lang = ctx.interfaceLanguage;
  const askMsgs: Record<string, string> = {
    es: '¿Para qué nivel quieres el curso? (A1, A2, B1, B2, C1 o C2)',
    en: 'What level do you need the course for? (A1, A2, B1, B2, C1 or C2)',
    no: 'Hvilket nivå vil du ha kurset for? (A1, A2, B1, B2, C1 eller C2)',
    de: 'Für welches Niveau möchten Sie den Kurs? (A1, A2, B1, B2, C1 oder C2)',
    fr: 'Pour quel niveau voulez-vous le cours? (A1, A2, B1, B2, C1 ou C2)',
    it: 'Per quale livello vuoi il corso? (A1, A2, B1, B2, C1 o C2)',
    pt: 'Para qual nível quer o curso? (A1, A2, B1, B2, C1 ou C2)',
    nl: 'Voor welk niveau wil je de cursus? (A1, A2, B1, B2, C1 of C2)',
  };
  return {
    executor: 'mentor', priority: PRIORITY.HARD_OVERRIDE, blocking: true,
    pedagogicalAction: 'conversation', artifacts: [],
    mentor: buildMentorDirective(ctx.state.mentorProfile, 'RICH_CONTENT_DIRECTIVE', ctx),
    commercial: undefined, skipPhaseAdvance: true,
    reason: 'document_contract:opened — awaiting level. lastConcept not consulted.',
    resolvedTopic: undefined,
    executionOrder: [{ order: 1, executor: 'mentor', action: 'openDocumentContract', timeout: 8000,
      params: { clarificationMessage: lang ? (askMsgs[lang] ?? askMsgs['en']) : askMsgs['en'], pendingDocumentRequest: contract } }],
  };
}

function buildCollectingPlan(ctx: OrchestrationContext, contract: PendingDocumentRequest): ExecutionPlan {
  const lang = ctx.interfaceLanguage;
  const msgs: Record<string, string> = {
    es: contract.level ? '¿Sobre qué tema quieres el curso? O confirma el nivel para un curso general de español.' : '¿Para qué nivel? (A1, A2, B1, B2, C1 o C2)',
    en: contract.level ? 'What topic? Or confirm the level for a general Spanish course.' : 'What level? (A1, A2, B1, B2, C1 or C2)',
    no: contract.level ? 'Hvilket tema? Eller bekreft nivå for et generelt spansk kurs.' : 'Hvilket nivå? (A1, A2, B1, B2, C1 eller C2)',
    de: contract.level ? 'Welches Thema? Oder bestätigen Sie das Niveau.' : 'Welches Niveau? (A1, A2, B1, B2, C1 oder C2)',
    fr: contract.level ? 'Quel sujet? Ou confirmez le niveau.' : 'Quel niveau? (A1, A2, B1, B2, C1 ou C2)',
    it: contract.level ? 'Che argomento? O conferma il livello.' : 'Che livello? (A1, A2, B1, B2, C1 o C2)',
    pt: contract.level ? 'Qual tema? Ou confirme o nível.' : 'Qual nível? (A1, A2, B1, B2, C1 ou C2)',
    nl: contract.level ? 'Welk onderwerp? Of bevestig het niveau.' : 'Welk niveau? (A1, A2, B1, B2, C1 of C2)',
  };
  return {
    executor: 'mentor', priority: PRIORITY.HARD_OVERRIDE, blocking: true,
    pedagogicalAction: 'conversation', artifacts: [],
    mentor: buildMentorDirective(ctx.state.mentorProfile, 'RICH_CONTENT_DIRECTIVE', ctx),
    commercial: undefined, skipPhaseAdvance: true,
    reason: `document_contract:collecting — level=${contract.level ?? 'null'}, topic=${contract.topic ?? 'null'}`,
    resolvedTopic: undefined,
    executionOrder: [{ order: 1, executor: 'mentor', action: 'collectDocumentParameter', timeout: 8000,
      params: { clarificationMessage: lang ? (msgs[lang] ?? msgs['en']) : msgs['en'], pendingDocumentRequest: contract } }],
  };
}

function buildGeneratePdfPlan(ctx: OrchestrationContext, topic: string, level: string): ExecutionPlan {
  return {
    executor: 'tool_pdf', priority: PRIORITY.HARD_OVERRIDE, blocking: true,
    pedagogicalAction: 'generate_course_pdf', artifacts: ['course_pdf'],
    mentor: buildMentorDirective(ctx.state.mentorProfile, 'CURRICULUM_PRESENTER_DIRECTIVE', ctx),
    commercial: undefined, skipPhaseAdvance: true,
    reason: `document_contract:ready — topic="${topic}", level="${level}". Sovereign: pendingDocumentRequest. lastConcept not read.`,
    resolvedTopic: topic,
    executionOrder: [{ order: 1, executor: 'tool_pdf', action: 'generateCoursePdf', timeout: 120000,
      params: { topic, level, clearDocumentContract: true } }],
  };
}

const ORCH_NOISE = /^(continúa|continua|siguiente|next|ok|sí|si|yes|no|vale|listo|bien|ready|start|más|mas|seguir|continue|adelante|proceed|claro|entendido|understood)$/i;

function resolvePedagogicalMode(
  message: string,
  state: import('../../lib/contracts').SessionState,
): import('../../lib/contracts').PedagogicalMode {
  const t = message.toLowerCase().trim();
  if (/\besquema\b|\bschema\b|\bresumen\s+visual|\bstructured\s+summary\b|\bstructure\s+this\b|\borganize\s+this\b/i.test(t)) return 'schema';
  if (/\btabla\b|\bmatriz\b|\btable\b|\bmatrix\b|\bcompar[ae]/i.test(t) &&
      !/\btabla.*de\s+contenido/i.test(t)) return 'table';
  if (state.pedagogicalMode === 'schema') return 'schema';
  if (state.pedagogicalMode === 'table') return 'table';
  if (state.activeMode === 'free') return 'conversation';
  return 'explanation';
}

function resolveCurrentTopic(state: import('../../lib/contracts').SessionState, message: string): string {
  if (state.currentLessonTopic?.trim()) return state.currentLessonTopic;
  const clean = message?.trim();
  const EXACT_REFERENTIAL = /^(este tema|this topic|lo mismo|the same|eso|that|esto|this|el mismo|same|continuar|continue|lo anterior|el tema|the topic|más sobre|more on)$/i;
  const SEMANTIC_REFERENTIAL = /\b(hazme|dame|genera|crea|muéstrame|show me|give me|make|create|generate|convierte|convert|exporta|export)\b.{0,60}\b(este|esto|eso|ese|el mismo|el tema|this|that|it|the same)\b/i;
  const isReferential =
    !clean ||
    clean.length < 30 ||
    EXACT_REFERENTIAL.test(clean) ||
    SEMANTIC_REFERENTIAL.test(clean);
  if (!isReferential && clean && clean.length > 4 && !ORCH_NOISE.test(clean)) return clean;
  if (state.lastConcept?.trim())   return state.lastConcept;
  if (state.lastUserGoal?.trim())  return state.lastUserGoal;
  if (state.curriculumPlan?.topic) return state.curriculumPlan.topic;
  if (clean && clean.length > 4 && !ORCH_NOISE.test(clean)) return clean;
  return 'Spanish grammar';
}

function ttsEnabled(): boolean {
  return process.env.LINGORA_TTS_ENABLED === 'true';
}

function withoutAudioSteps(plan: ExecutionPlan): ExecutionPlan {
  if (ttsEnabled()) return plan;
  const executionOrder = plan.executionOrder.filter(s => s.executor !== 'tool_audio' && s.action !== 'generateTTS');
  return {
    ...plan,
    artifacts: plan.artifacts.filter(a => a !== 'audio'),
    executionOrder,
  };
}

function isMentorFirstIntent(intent: import('../../lib/contracts').IntentResult): boolean {
  return intent.type === 'learn' && intent.subtype !== 'curriculum_request';
}

function isCompoundPedagogicalAct(message: string): boolean {
  const text = message.toLowerCase();
  const teach =
    /ens[eé][nñ]ame|expl[íi]came|teach me|quiero que me ense[nñ]es|introducci[oó]n seria|cambia de dominio|despu[eé]s cambia|como una profesora/;
  const artifact = /\bpdf\b|artifact|curso de|genera dos|descargables|en pdf|exporta la sesi[oó]n|exporta la sesion/;
  return teach.test(text) && artifact.test(text);
}

function buildMentorFirstPlan(ctx: OrchestrationContext): ExecutionPlan {
  return withoutAudioSteps({
    executor: 'mentor',
    priority: PRIORITY.DEFAULT,
    blocking: false,
    pedagogicalAction: 'lesson',
    artifacts: [],
    mentor: buildMentorDirective(ctx.state.mentorProfile, 'RICH_CONTENT_DIRECTIVE', ctx),
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: 's1_e01: mentor-first — learn/topic_lesson before first-turn and document gate. Artifact is a later side-effect.',
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: [
      { order: 1, executor: 'mentor', action: 'conversation', timeout: 180000,
        params: { pedagogicalGoal: 'teach', artifactGoal: null } },
    ],
  });
}

export function orchestrate(ctx: OrchestrationContext): ExecutionPlan {
  const pedagogicalMode = resolvePedagogicalMode(ctx.message, ctx.state);
  if (pedagogicalMode !== ctx.state.pedagogicalMode) {
    ctx = { ...ctx, state: { ...ctx.state, pedagogicalMode } };
  }

  if (isMentorFirstIntent(ctx.intent) || isCompoundPedagogicalAct(ctx.message)) {
    return buildMentorFirstPlan(ctx);
  }

  if (isHardOverride(ctx.intent)) {
    return withoutAudioSteps(buildHardOverridePlan(ctx));
  }

  if (ctx.state.expectedResponseMode === 'exercise_answer' && ctx.state.currentExercise) {
    return withoutAudioSteps(buildExerciseLockPlan(ctx));
  }

  if (ctx.state.pendingDocumentRequest?.status === 'collecting') {
    return buildDocumentContractGate(ctx);
  }

  if (ctx.isFirstTurn) {
    return withoutAudioSteps(buildFirstTurnPlan(ctx));
  }

  const semanticOp = resolveSemanticOperation(ctx);
  if (semanticOp === 'package_session') return buildPackageSessionPlan(ctx);
  if (semanticOp === 'export_artifact') return buildExportArtifactPlan(ctx);

  if (isStrongCurriculumRequest(ctx.intent)) {
    return buildCurriculumPlan(ctx);
  }

  if (isFastPathArtifact(ctx.intent)) {
    return buildFastPathPlan(ctx);
  }

  if (ctx.state.activeMode === 'structured' || ctx.state.activeMode === 'pdf_course') {
    return withoutAudioSteps(buildPedagogicalPlan(ctx));
  }

  return withoutAudioSteps(buildConversationPlan(ctx));
}

function buildHardOverridePlan(ctx: OrchestrationContext): ExecutionPlan {
  const subtype = ctx.intent.subtype as IntentSubtype;

  const overrideMap: Record<string, {
    executor: ExecutorType | 'hybrid';
    action: string;
    pedagogicalAction: PedagogicalAction;
    artifacts: ArtifactType[];
  }> = {
    translate: { executor: 'mentor', action: 'translateOnly', pedagogicalAction: 'translation_only', artifacts: [] },
    correct: { executor: 'mentor', action: 'correctOnly', pedagogicalAction: 'correction_only', artifacts: [] },
    transcribe: { executor: 'tool_audio', action: 'transcribeAudio', pedagogicalAction: 'transcription_only', artifacts: ['audio'] },
    export_chat_pdf: { executor: 'tool_pdf', action: 'exportChatPdf', pedagogicalAction: 'export_chat_pdf', artifacts: ['pdf_chat'] },
    generate_course_pdf: { executor: 'tool_pdf', action: 'generateCoursePdf', pedagogicalAction: 'generate_course_pdf', artifacts: ['course_pdf'] },
    package_session: { executor: 'tool_pdf', action: 'packageSession', pedagogicalAction: 'package_session', artifacts: ['pdf_chat'] },
    export_artifact: { executor: 'tool_pdf', action: 'exportArtifact', pedagogicalAction: 'export_artifact', artifacts: ['pdf'] },
    pronunciation_eval: { executor: 'hybrid', action: 'evaluatePronunciation', pedagogicalAction: 'pronunciation_eval', artifacts: ['pronunciation_report', 'audio'] },
  };

  const config = overrideMap[subtype] ?? {
    executor: 'mentor' as ExecutorType,
    action: 'hardOverrideFallback',
    pedagogicalAction: 'conversation' as PedagogicalAction,
    artifacts: [] as ArtifactType[],
  };

  if (subtype === 'generate_course_pdf') {
    return buildDocumentContractGate(ctx);
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
    mentor: (config.executor === 'mentor' || config.executor === 'hybrid')
      ? buildMentorDirective(
          ctx.state.mentorProfile,
          subtype === 'translate'            ? 'TRANSLATION_ONLY_DIRECTIVE'
          : subtype === 'correct'            ? 'CORRECTION_ONLY_DIRECTIVE'
          : subtype === 'pronunciation_eval' ? 'PRONUNCIATION_EVAL_DIRECTIVE'
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
      { order: 2, executor: 'mentor' as ExecutorType, action: 'respondToTranscription', dependsOn: 1, timeout: 12000 },
      { order: 3, executor: 'tool_audio' as ExecutorType, action: 'generateTTS', dependsOn: 2, timeout: 10000 },
    ];
  }
  if (subtype === 'pronunciation_eval') {
    return [
      { order: 1, executor: 'tool_audio' as ExecutorType, action: 'transcribeAudio', timeout: 10000 },
      { order: 2, executor: 'mentor' as ExecutorType, action: 'evaluatePronunciation', dependsOn: 1, timeout: 12000 },
      { order: 3, executor: 'tool_audio' as ExecutorType, action: 'generateTTS', dependsOn: 2, timeout: 8000 },
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
    reason: `semantic_op:package_session — artifactRegistry has ${artifactCount} entries. Honest mentor response.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: [
      { order: 1, executor: 'mentor', action: 'packageSessionHonestResponse', timeout: 12000,
        params: { artifactCount, availableIn: 'SEEK 4.2' } },
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
    reason: 'semantic_op:export_artifact — honest mentor response.',
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: [
      { order: 1, executor: 'mentor', action: 'exportArtifactHonestResponse', timeout: 12000,
        params: { availableIn: 'SEEK 4.2' } },
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
    reason: `exercise_lock:priority_95 — user answering active exercise.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: [
      { order: 1, executor: 'mentor', action: 'evaluateExerciseResponse', timeout: 15000 },
      { order: 2, executor: 'tool_audio', action: 'generateTTS', dependsOn: 1, timeout: 10000 },
    ],
  };
}

function buildFirstTurnPlan(ctx: OrchestrationContext): ExecutionPlan {
  const isStructured = ctx.state.activeMode === 'structured' || ctx.state.activeMode === 'pdf_course';
  const steps: ExecutionStep[] = [
    { order: 1, executor: 'mentor', action: 'firstTurnGreeting', timeout: 12000 },
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
    mentor: buildMentorDirective(ctx.state.mentorProfile, 'FIRST_TURN_DIRECTIVE', ctx),
    commercial: undefined,
    skipPhaseAdvance: false,
    reason: 'first_turn — tokens=0, session start.',
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: steps,
  };
}

function buildCurriculumPlan(ctx: OrchestrationContext): ExecutionPlan {
  return buildDocumentContractGate(ctx);
}

function buildFastPathPlan(ctx: OrchestrationContext): ExecutionPlan {
  const subtype = ctx.intent.subtype;
  type ArtifactConfig = { executor: ExecutorType; action: string; artifact: ArtifactType };
  const artifactMap: Record<string, ArtifactConfig> = {
    table_matrix: { executor: 'tool_schema', action: 'generateTableMatrix', artifact: 'table_matrix' },
    schema_pro:   { executor: 'tool_schema', action: 'generateSchemaPro',   artifact: 'schema_pro' },
    table:        { executor: 'tool_schema', action: 'generateTable',        artifact: 'table' },
    schema:       { executor: 'tool_schema', action: 'generateSchema',       artifact: 'schema' },
    quiz:         { executor: 'tool_schema', action: 'generateQuiz',         artifact: 'quiz' },
    illustration: { executor: 'tool_image',  action: 'generateIllustration', artifact: 'illustration' },
    roadmap:      { executor: 'tool_schema', action: 'buildRoadmapArtifact', artifact: 'roadmap' },
  };
  const config: ArtifactConfig = artifactMap[subtype ?? ''] ?? { executor: 'tool_schema', action: 'generateSchema', artifact: 'schema' };
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
      { order: 2, executor: 'mentor', action: 'briefArtifactIntro', dependsOn: 1, timeout: 8000 },
    ],
  };
}

function buildPedagogicalPlan(ctx: OrchestrationContext): ExecutionPlan {
  const { tutorPhase, activeMode } = ctx.state;
  type PhaseConfig = { pedagogicalAction: PedagogicalAction; artifact?: ArtifactType; directive: MentorDirective['directive']; producesArtifact: boolean };
  const phaseMap: Record<TutorPhase, PhaseConfig> = {
    guide:        { pedagogicalAction: 'guide',        directive: 'STRUCTURED_COURSE_DIRECTIVE', producesArtifact: false },
    lesson:       { pedagogicalAction: 'lesson',       directive: 'STRUCTURED_COURSE_DIRECTIVE', producesArtifact: false },
    schema:       { pedagogicalAction: 'schema',       artifact: 'schema', directive: 'STRUCTURED_COURSE_DIRECTIVE', producesArtifact: true },
    quiz:         { pedagogicalAction: 'quiz',         artifact: 'quiz',   directive: 'STRUCTURED_COURSE_DIRECTIVE', producesArtifact: true },
    feedback:     { pedagogicalAction: 'feedback',     directive: 'STRUCTURED_COURSE_DIRECTIVE', producesArtifact: false },
    conversation: { pedagogicalAction: 'conversation', directive: 'FREE_CONVERSATION_DIRECTIVE',  producesArtifact: false },
  };
  const config = phaseMap[tutorPhase] ?? phaseMap['guide'];
  const steps: ExecutionStep[] = [];
  if (config.producesArtifact && config.artifact) {
    steps.push({ order: 1, executor: 'tool_schema', action: config.artifact === 'schema' ? 'generateSchema' : 'generateQuiz', timeout: 12000 });
    steps.push({ order: 2, executor: 'mentor', action: 'deliverArtifactWithLesson', dependsOn: 1, timeout: 10000 });
  } else {
    steps.push({ order: 1, executor: 'mentor', action: `phase_${tutorPhase}`, timeout: 15000 });
    steps.push({ order: 2, executor: 'tool_audio', action: 'generateTTS', dependsOn: 1, timeout: 8000 });
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
  const directive = ctx.state.activeMode === 'free' ? 'FREE_CONVERSATION_DIRECTIVE' : 'RICH_CONTENT_DIRECTIVE';
  return {
    executor: 'hybrid',
    priority: PRIORITY.DEFAULT,
    blocking: false,
    pedagogicalAction: 'conversation',
    artifacts: ['audio'],
    mentor: buildMentorDirective(ctx.state.mentorProfile, directive, ctx),
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: `default_conversation — fallthrough. mode=${ctx.state.activeMode}.`,
    resolvedTopic: resolveCurrentTopic(ctx.state, ctx.message),
    executionOrder: [
      { order: 1, executor: 'mentor', action: 'conversation', timeout: 15000 },
      { order: 2, executor: 'tool_audio', action: 'generateTTS', dependsOn: 1, timeout: 8000 },
    ],
  };
}

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
    injectErrorMemory: !!(ctx.state.errorMemory && (ctx.state.errorMemory.grammar.length > 0 || ctx.state.errorMemory.vocabulary.length > 0)),
    cognitiveStructure: directive === 'STRUCTURED_COURSE_DIRECTIVE' || directive === 'FREE_CONVERSATION_DIRECTIVE',
    ...(directive === 'EXERCISE_FEEDBACK_DIRECTIVE' && {
      activeExercise: ctx.state.currentExercise,
      activeTopic:    ctx.state.currentLessonTopic ?? ctx.state.lastConcept,
    }),
  };
}
