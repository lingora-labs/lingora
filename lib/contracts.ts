// =============================================================================
// lib/contracts.ts
// LINGORA SEEK 4.1b — Single Source of Truth for all TypeScript types
// =============================================================================
// Purpose  : Canonical runtime contracts. Every interface, type and default
//            used across the LINGORA runtime is defined here and only here.
//            No consuming module may redefine structures declared in this file.
//
// Version  : SEEK 3.0 — Extended from 2.6 baseline
// Changes  : + ExecutionPlan (replaces implicit action struct)
//            + ExecutionStep (explicit order + dependsOn)
//            + IntentResult  (intent-router output contract)
//            + OrchestrationContext (orchestrator input contract)
//            + StatePatch    (state-manager merge contract)
//            + All 2.6 types preserved without breaking change
//
// Commit   : feat(contracts): add SEEK 3.0 orchestration types — ExecutionPlan,
//            ExecutionStep, IntentResult, OrchestrationContext
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 0 — PRIMITIVE ENUMERATIONS (unchanged from 2.6)
// ─────────────────────────────────────────────────────────────────────────────

export type ActiveMode = 'interact' | 'structured' | 'pdf_course' | 'free';

/**
 * PedagogicalMode — the output FORMAT the orchestrator decides for this turn.
 * ARCH decision (SEEK 3.4): 4 modes only. No submodes. No cognitiveLoad.
 * Resolved by resolvePedagogicalMode() in orchestrator.ts.
 * 'conversation' = free dialogue
 * 'explanation'  = structured explanation (default for most turns)
 * 'schema'       = full structured schema with 80/20 per subtopic
 * 'table'        = colored matrix table with tone/icon per cell
 */
export type PedagogicalMode = 'conversation' | 'explanation' | 'schema' | 'table';

export type TutorPhase =
  | 'guide'
  | 'lesson'
  | 'schema'
  | 'quiz'
  | 'feedback'
  | 'conversation';

export type TutorMode =
  | 'structured'
  | 'conversational'
  | 'professional'
  | 'diagnostic'
  | 'interact'
  | 'free';

export type DepthMode = 'shallow' | 'standard' | 'deep';

export type CEFRLevel = 'A0' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export type InterfaceLanguage =
  | 'en'
  | 'no'
  | 'es'
  | 'it'
  | 'fr'
  | 'de'
  | 'pt'
  | 'nl';

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — PEDAGOGICAL ACTION TYPES (extended for SEEK 3.0)
// ─────────────────────────────────────────────────────────────────────────────

export type PedagogicalAction =
  | 'guide'
  | 'lesson'
  | 'schema'
  | 'quiz'
  | 'feedback'
  | 'conversation'
  | 'first_turn_greeting'
  | 'curriculum_generation'
  | 'pronunciation_eval'
  | 'correction_only'
  | 'translation_only'
  | 'transcription_only'
  | 'export_chat_pdf'
  | 'generate_course_pdf'
  | 'package_session'
  | 'export_artifact'
  | 'diagnostic_assessment';

export type RequestedOperation =
  | 'transcribe'
  | 'translate'
  | 'correct'
  | 'export_chat_pdf'
  | 'generate_course_pdf'
  | 'package_session'
  | 'export_artifact'
  | 'diagnostic';

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — ARTIFACT TYPES (unchanged from 2.6 — 18 types)
// ─────────────────────────────────────────────────────────────────────────────

export type ArtifactType =
  | 'schema'
  | 'schema_pro'
  | 'table'
  | 'table_matrix'
  | 'quiz'
  | 'illustration'
  | 'pdf'
  | 'pdf_assignment'
  | 'course_pdf'
  | 'pdf_chat'
  | 'roadmap'
  | 'audio'
  | 'pronunciation_report'
  | 'submission_feedback'
  | 'score_report'
  | 'lesson_module'
  | 'rich_content'
  | 'diagnostic_report';

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — ARTIFACT PAYLOAD INTERFACES (unchanged from 2.6)
// ─────────────────────────────────────────────────────────────────────────────

export interface SchemaContent {
  title:             string;
  block?:            string;
  objective?:        string;
  keyConcepts:       string[];
  tableRows:         Array<{ left: string; right: string }>;
  subtopics?:        Array<{ title: string; content: string; keyTakeaway?: string }>;
  examples:          string[];
  summary?:          string;
  quiz:              Array<{ question: string; options: string[]; correct: number; explanation?: string }>;
  erroresFrecuentes?: string[];
}

export interface SchemaBlock {
  label: string;
  content: string;
  tone?: 'ok' | 'danger' | 'warn' | 'info' | 'highlight';
}

export interface SchemaQuizItem {
  question: string;
  options: string[];
  correct: number;
  explanation?: string;
}

export interface SchemaArtifact {
  type: 'schema';
  title: string;
  level?: CEFRLevel;
  objective?: string;
  sections: SchemaBlock[];
  erroresFrecuentes?: string[];
  quiz?: Array<SchemaQuizItem | string>;
}

export type SchemaProBlockItem =
  | { type: 'concept';    title: string; body: string; tone?: string }
  | { type: 'bullets';    title: string; items: string[] }
  | { type: 'highlight';  text: string;  tone?: string; label?: string }
  | { type: 'flow';       steps: string[] }
  | { type: 'comparison'; left: string;  right: string; label?: string }
  | { type: 'table';      columns: string[]; rows: string[][] };

export interface SchemaProArtifact {
  type: 'schema_pro';
  title: string;
  subtitle?: string;
  level?: CEFRLevel;
  blocks: SchemaProBlockItem[];
  cita?: string;
}

export interface TableCell {
  value: string;
  tone?: 'ok' | 'danger' | 'warn' | 'neutral';
  icon?: string;
  bold?: boolean;
}

export interface TableArtifact {
  type: 'table';
  title: string;
  columns: string[];
  rows: string[][];
  tone?: 'ok' | 'danger' | 'warn' | 'neutral';
}

export interface TableMatrixArtifact {
  type: 'table_matrix';
  title: string;
  columns: string[];
  rows: TableCell[][];
}

export interface QuizOption {
  text: string;
  correct: boolean;
  explanation?: string;
}

export interface QuizQuestion {
  question: string;
  options: QuizOption[];
}

export interface QuizArtifact {
  type: 'quiz';
  title: string;
  questions: QuizQuestion[];
  passingScore?: number;
}

export interface IllustrationArtifact {
  type: 'illustration';
  prompt: string;
  url?: string;
  dataUrl?: string;
  caption?: string;
}

export interface PdfArtifact {
  type: 'pdf';
  title: string;
  url?: string;
  dataUrl?: string;
  description?: string;
}

export interface PdfAssignment {
  type: 'pdf_assignment';
  moduleIndex: number;
  moduleTitle: string;
  url?: string;
  dataUrl?: string;
  instructions: string;
}

export interface CoursePdfArtifact {
  type: 'course_pdf';
  title: string;
  modules: string[];
  url?: string;
  dataUrl?: string;
}

export interface PDFChat {
  type: 'pdf_chat';
  url?: string;
  dataUrl?: string;
  messageCount: number;
}

export interface RoadmapBlock {
  type: 'roadmap';
  title: string;
  modules: Array<{
    index: number;
    title: string;
    focus: string;
    completed: boolean;
    current: boolean;
  }>;
}

export interface AudioArtifact {
  type: 'audio';
  dataUrl?: string;
  s3Url?: string;
  transcript?: string;
  durationMs?: number;
}

export interface PronunciationReport {
  type: 'pronunciation_report';
  score: number;
  feedback: string;
  tip: string;
  errors?: string[];
}

export interface SubmissionFeedback {
  type: 'submission_feedback';
  score: number;
  corrections: string[];
  nextStep: string;
  moduleIndex: number;
}

export interface ScoreReport {
  type: 'score_report';
  totalScore: number;
  breakdown: Record<string, number>;
  message: string;
}

export interface LessonModule {
  type: 'lesson_module';
  moduleIndex: number;
  title: string;
  content: string;
  examples: string[];
}

export interface RichContentArtifact {
  type: 'rich_content';
  title?: string;
  body: string;
}

export interface DiagnosticState {
  level:      string;
  confidence: 'insufficient' | 'low' | 'medium' | 'high';
  samples:    number;
  score?:     number;
  nextLevel?: string;
}

export interface DiagnosticReport {
  type: 'diagnostic_report';
  estimatedLevel: CEFRLevel;
  confidence: 'low' | 'medium' | 'high';
  sampleCount: number;
  observations: string[];
}

export type ArtifactPayload =
  | SchemaArtifact
  | SchemaProArtifact
  | TableArtifact
  | TableMatrixArtifact
  | QuizArtifact
  | IllustrationArtifact
  | PdfArtifact
  | PdfAssignment
  | CoursePdfArtifact
  | PDFChat
  | RoadmapBlock
  | AudioArtifact
  | PronunciationReport
  | SubmissionFeedback
  | ScoreReport
  | LessonModule
  | RichContentArtifact
  | DiagnosticReport;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3b — ARTIFACT REGISTRY (SEEK 4.1b)
// Persistent record of artifacts generated in a session.
// Stores serializable payload so exportSessionStudyPdf (SEEK 4.2) can
// rehidrate the original artifact without relying on the transcript.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ArtifactRegistryEntry — one entry in the session artifact memory.
 * payload contains the full ArtifactPayload so the artifact can be
 * reconstructed in export operations (SEEK 4.2: exportSessionStudyPdf).
 */
export interface ArtifactRegistryEntry {
  id:          string;          // unique per session, e.g. `${type}-${timestamp}`
  type:        ArtifactType;
  title:       string;
  generatedAt: number;          // timestamp ms
  payload:     ArtifactPayload; // full serializable artifact — not just metadata
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — SESSION STATE (unchanged from 2.6 — invariants preserved)
// ─────────────────────────────────────────────────────────────────────────────

export interface CurriculumModule {
  index: number;
  title: string;
  focus: string;
  skills: string[];
  estimatedTurns?: number;
}

export interface CurriculumPlan {
  topic: string;
  level: CEFRLevel;
  modules: CurriculumModule[];
  totalModules: number;
  generatedAt: number;
}

export interface ModuleMastery {
  score: number;
  attempts: number;
  lastAttemptAt: number;
  passed: boolean;
}

export interface ErrorMemory {
  grammar: string[];
  vocabulary: string[];
  pronunciation: string[];
}

export interface EngagementState {
  streak: number;
  lastActive: number;
  completedModules: number[];
  totalTokens: number;
}

export interface SessionState {
  activeMode: ActiveMode;
  tutorPhase: TutorPhase;
  tokens: number;

  mentorProfile?: 'Alex' | 'Sarah' | 'Nick';
  interfaceLanguage: InterfaceLanguage;
  nativeLanguage?: string;
  userLevel?: CEFRLevel;
  userObjective?: 'social' | 'professional' | 'academic' | 'travel' | 'general';

  curriculumPlan?: CurriculumPlan;
  currentModuleIndex?: number;
  masteryByModule: Record<number, ModuleMastery>;

  lastConcept?: string;
  lastUserGoal?: string;
  lastMistake?: string;
  errorMemory?: ErrorMemory;

  engagement?: EngagementState;

  requestedOperation?: RequestedOperation;
  depthMode: DepthMode;

  diagnosticSamples?: number;
  confirmedLevel?: CEFRLevel;

  // SEEK 3.1 — SEMANTIC STATE (Fase 0-A)
  currentLessonTopic?: string;
  currentExercise?: string;
  expectedResponseMode?: 'exercise_answer' | 'free' | 'quiz_answer';
  _exerciseAttemptCount?: number;
  lastUserAudioTranscript?: string;
  // SEEK 3.4: explicit pedagogical output format
  pedagogicalMode?: PedagogicalMode;
  lastStructuredOutput?: 'schema' | 'table' | null;

  // SEEK 4.1b — artifact memory registry
  // Persists full artifact payloads across turns for session export (SEEK 4.2).
  // Survives mergeStatePatch via { ...current, ...patch } spread (verified SEEK 4.1a).
  artifactRegistry?: ArtifactRegistryEntry[];
}

export const DEFAULT_SESSION_STATE: SessionState = {
  activeMode: 'interact',
  tutorPhase: 'guide',
  tokens: 0,
  interfaceLanguage: 'en',
  masteryByModule: {},
  depthMode: 'standard',
  currentLessonTopic:     undefined,
  currentExercise:        undefined,
  expectedResponseMode:   undefined,
  _exerciseAttemptCount:  undefined,
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — SUGGESTED ACTIONS (unchanged from 2.6 — 23 types)
// ─────────────────────────────────────────────────────────────────────────────

export type SuggestedActionType =
  | 'next_module'
  | 'retry_module'
  | 'show_schema'
  | 'show_table'
  | 'show_matrix'
  | 'show_schema_pro'
  | 'start_quiz'
  | 'retry_quiz'
  | 'export_chat_pdf'
  | 'download_course_pdf'
  | 'continue_lesson'
  | 'choose_examples'
  | 'choose_exercise'
  | 'switch_mentor'
  | 'change_depth'
  | 'request_explanation'
  | 'request_correction'
  | 'request_translation'
  | 'start_course'
  | 'resume_course'
  | 'request_immersion'
  | 'request_pronunciation'
  | 'diagnostic_start';

export interface SuggestedAction {
  type: SuggestedActionType;
  label: string;
  payload?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — CHAT REQUEST / RESPONSE (extended for SEEK 3.0)
// ─────────────────────────────────────────────────────────────────────────────

export interface AttachedFile {
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  base64?: string;
}

export interface ChatRequest {
  message: string;
  exportTranscript?: string;
  state: SessionState;
  files?: AttachedFile[];
  audioDataUrl?: string;
  audioMimeType?: string;
  clientHint?: string;
}

export interface ChatResponse {
  message: string;
  artifact?: ArtifactPayload;
  state: SessionState;
  suggestedActions?: SuggestedAction[];
  executionTrace?: ExecutionTrace;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — SEEK 3.0 ORCHESTRATION CONTRACTS (NEW)
// ─────────────────────────────────────────────────────────────────────────────

export type IntentType =
  | 'hard_override'
  | 'learn'
  | 'practice'
  | 'artifact'
  | 'conversation'
  | 'diagnostic';

export type IntentSubtype =
  | 'translate'
  | 'correct'
  | 'transcribe'
  | 'export_chat_pdf'
  | 'generate_course_pdf'
  | 'package_session'
  | 'export_artifact'
  | 'pronunciation_eval'
  | 'schema'
  | 'schema_pro'
  | 'table'
  | 'table_matrix'
  | 'quiz'
  | 'illustration'
  | 'roadmap'
  | 'curriculum_request'
  | 'topic_lesson'
  | 'grammar_explanation'
  | 'vocabulary_request';

export interface IntentResult {
  type: IntentType;
  subtype?: IntentSubtype;
  explicit: boolean;
  confidence: number;
  matchedPattern?: string;
}

export type ExecutorType =
  | 'mentor'
  | 'tool_audio'
  | 'tool_pdf'
  | 'tool_image'
  | 'tool_schema'
  | 'tool_attachment'
  | 'tool_storage'
  | 'knowledge'
  | 'commercial'
  | 'diagnostic';

export interface ExecutionStep {
  order: number;
  executor: ExecutorType;
  action: string;
  dependsOn?: number;
  timeout?: number;
  params?: Record<string, unknown>;
}

export interface MentorDirective {
  profile: 'Alex' | 'Sarah' | 'Nick';
  directive:
    | 'RICH_CONTENT_DIRECTIVE'
    | 'STRUCTURED_COURSE_DIRECTIVE'
    | 'FREE_CONVERSATION_DIRECTIVE'
    | 'PDF_COURSE_DIRECTIVE'
    | 'CORRECTION_ONLY_DIRECTIVE'
    | 'TRANSLATION_ONLY_DIRECTIVE'
    | 'FIRST_TURN_DIRECTIVE'
    | 'CURRICULUM_PRESENTER_DIRECTIVE'
    | 'EXERCISE_FEEDBACK_DIRECTIVE'
    | 'PRONUNCIATION_EVAL_DIRECTIVE'
    | 'DIAGNOSTIC_FIRST_TURN_DIRECTIVE';
  injectContinuity: boolean;
  injectErrorMemory: boolean;
  cognitiveStructure: boolean;
  activeExercise?: string;
  activeTopic?: string;
}

export interface CommercialTrigger {
  type: 'immersion' | 'immersion_suggestion' | 'program_invite';
  destination?: 'spain' | 'colombia' | 'miami';
  cooldownRespected: boolean;
  sessionScore: number;
}

export interface CommercialEngineTrigger extends CommercialTrigger {
  message: string;
  level?: 'high' | 'medium';
}

export interface CommercialOffer {
  triggered?: boolean;
  message?:   string;
  trigger?:   CommercialTrigger | CommercialEngineTrigger | null;
  timestamp:  number;
  sessionId?: string | null;
  type?:      'immersion' | 'immersion_suggestion' | 'program_invite';
  score?:     number;
  interest?:  boolean;
}

export interface ExecutionPlan {
  executor: ExecutorType | 'hybrid';
  priority: number;
  blocking: boolean;
  pedagogicalAction: PedagogicalAction;
  artifacts: ArtifactType[];
  mentor?: MentorDirective;
  commercial?: CommercialTrigger;
  skipPhaseAdvance: boolean;
  reason: string;
  executionOrder: ExecutionStep[];
  resolvedTopic?: string;
}

export interface OrchestrationContext {
  message: string;
  state: SessionState;
  intent: IntentResult;
  files?: AttachedFile[];
  hasAudio: boolean;
  isFirstTurn: boolean;
  interfaceLanguage: InterfaceLanguage;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — STATE MANAGER CONTRACTS
// ─────────────────────────────────────────────────────────────────────────────

export type StatePatch = Omit<Partial<SessionState>, 'requestedOperation'> & {
  requestedOperation?: RequestedOperation | null;
};

export interface StateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export const CONTINUITY_FIELDS: ReadonlyArray<keyof SessionState> = [
  'lastConcept',
  'lastUserGoal',
  'lastMistake',
  'errorMemory',
  'masteryByModule',
  'curriculumPlan',
  'currentModuleIndex',
  'engagement',
  'confirmedLevel',
  'diagnosticSamples',
  'currentLessonTopic',
  'currentExercise',
  'expectedResponseMode',
  '_exerciseAttemptCount',
  'lastUserAudioTranscript',
  'pedagogicalMode',
  'lastStructuredOutput',
  // SEEK 4.1b: artifact memory must survive every merge
  'artifactRegistry',
] as const;

export const INVARIANT_FIELDS: ReadonlyArray<keyof SessionState> = [
  'activeMode',
  'tutorPhase',
  'tokens',
  'interfaceLanguage',
  'depthMode',
  'masteryByModule',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — EXECUTION TRACE
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionStepResult {
  stepOrder: number;
  executor: ExecutorType;
  action: string;
  durationMs: number;
  success: boolean;
  error?: string;
  producedArtifacts?: ArtifactType[];
}

export interface ExecutionTrace {
  requestId: string;
  intentResult: IntentResult;
  executionPlan: ExecutionPlan;
  stepResults: ExecutionStepResult[];
  totalDurationMs: number;
  statePatchApplied: StatePatch;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — MASTERY GATE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const MASTERY_PASS_THRESHOLD = 70;
export const DIAGNOSTIC_MIN_SAMPLES  = 3;
export const TOKEN_SCHEMA_INTERVAL   = 5;
export const COMMERCIAL_COOLDOWN_TOKENS = 20;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — MENTOR PROFILES ENUM
// ─────────────────────────────────────────────────────────────────────────────

export type MentorProfile = 'Alex' | 'Sarah' | 'Nick';

export const MENTOR_PROFILES: Record<MentorProfile, {
  specialty: string;
  tone: string;
  defaultDirective: MentorDirective['directive'];
}> = {
  Alex: {
    specialty: 'conversation and travel',
    tone: 'warm, dynamic, motivating',
    defaultDirective: 'FREE_CONVERSATION_DIRECTIVE',
  },
  Sarah: {
    specialty: 'academic and grammar',
    tone: 'pedagogical, analytical, precise',
    defaultDirective: 'STRUCTURED_COURSE_DIRECTIVE',
  },
  Nick: {
    specialty: 'business and professional',
    tone: 'direct, professional, strategic',
    defaultDirective: 'STRUCTURED_COURSE_DIRECTIVE',
  },
};

