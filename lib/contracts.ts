// =============================================================================
// lib/contracts.ts
// LINGORA SEEK 3.4 — Single Source of Truth for all TypeScript types
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

/**
 * PedagogicalAction — the teaching action the orchestrator decides to execute.
 * Orchestrator assigns one of these per ExecutionPlan.
 * Execution layers use this to select directives and behavior.
 */
export type PedagogicalAction =
  // Standard phase actions
  | 'guide'
  | 'lesson'
  | 'schema'
  | 'quiz'
  | 'feedback'
  | 'conversation'
  // Specialized actions
  | 'first_turn_greeting'
  | 'curriculum_generation'
  | 'pronunciation_eval'
  | 'correction_only'
  | 'translation_only'
  | 'transcription_only'
  | 'export_chat_pdf'
  | 'generate_course_pdf'
  | 'diagnostic_assessment';

/**
 * RequestedOperation — an explicit user command that hard-overrides pedagogy.
 * Set by intent-router. Cleared by execution-engine after execution.
 * INVARIANT: must be cleared to undefined after each execution.
 */
export type RequestedOperation =
  | 'transcribe'
  | 'translate'
  | 'correct'
  | 'export_chat_pdf'
  | 'generate_course_pdf'
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

/**
 * SchemaContent — raw pedagogical schema data produced by schema-generator.ts.
 * Used as the content payload before being wrapped in SchemaArtifact or SchemaProArtifact.
 */
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
  // P4/UNED: rich error section — produced by schema-generator when UNED format active
  erroresFrecuentes?: string[];
}

export interface SchemaBlock {
  label: string;
  content: string;
  tone?: 'ok' | 'danger' | 'warn' | 'info' | 'highlight';
}

// SchemaQuizItem: structured quiz question from schema-generator
// Backward compatible with legacy string[] format
export interface SchemaQuizItem {
  question: string;
  options: string[];
  correct: number; // index 0-3
  explanation?: string; // P4/UNED: why the correct answer is correct
}

export interface SchemaArtifact {
  type: 'schema';
  title: string;
  level?: CEFRLevel;
  objective?: string;
  sections: SchemaBlock[];
  erroresFrecuentes?: string[];
  // FIX-9F: quiz as structured items (not flattened strings) to enable interactive renderer
  quiz?: Array<SchemaQuizItem | string>;
}

// SchemaProBlock — discriminated union for rich schema blocks
// Used by execution-engine (generator) and page.tsx (SchemaProBlock renderer)
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
  subtitle?: string;        // FIX-B2: added to match execution-engine output
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
  passingScore?: number; // default 70
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
  score: number; // 0–100
  feedback: string;
  tip: string;
  errors?: string[];
}

export interface SubmissionFeedback {
  type: 'submission_feedback';
  score: number; // 0–10
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

/**
 * DiagnosticState — output of diagnostics.ts evaluateLevel().
 * Accumulative CEFR assessment result. Used by the diagnostic engine.
 */
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

/**
 * ArtifactPayload — discriminated union of all 18 artifact types.
 * Travels in ChatResponse.artifact. Frontend routes on .type.
 */
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
  generatedAt: number; // timestamp
}

export interface ModuleMastery {
  score: number;      // 0–100
  attempts: number;
  lastAttemptAt: number; // timestamp
  passed: boolean;    // score >= 70
}

export interface ErrorMemory {
  grammar: string[];
  vocabulary: string[];
  pronunciation: string[];
}

export interface EngagementState {
  streak: number;
  lastActive: number; // timestamp
  completedModules: number[];
  totalTokens: number;
}

/**
 * SessionState — root state object.
 * Travels from frontend on every request. Returned (updated) by backend on every response.
 *
 * STATE INVARIANTS (violations are bugs, not edge cases):
 * - curriculumPlan is always CurriculumPlan | undefined — never a raw string
 * - masteryByModule keys must correspond to modules in curriculumPlan.modules
 * - engagement.completedModules must align with modules where masteryScore >= 70
 * - requestedOperation MUST be cleared to undefined after each execution
 * - Each request path increments tokens exactly once — never twice
 * - depthMode defaults to 'standard' — never undefined at runtime
 * - interfaceLanguage defaults to 'en' — never undefined at runtime
 * - activeMode is always a valid ActiveMode — never undefined at runtime
 */
export interface SessionState {
  // ── Core routing ──────────────────────────────────────────────────────────
  activeMode: ActiveMode;
  tutorPhase: TutorPhase;
  tokens: number;

  // ── Identity ──────────────────────────────────────────────────────────────
  mentorProfile?: 'Alex' | 'Sarah' | 'Nick';
  interfaceLanguage: InterfaceLanguage;
  nativeLanguage?: string;
  userLevel?: CEFRLevel;
  userObjective?: 'social' | 'professional' | 'academic' | 'travel' | 'general';

  // ── Curriculum ────────────────────────────────────────────────────────────
  curriculumPlan?: CurriculumPlan;
  currentModuleIndex?: number;
  masteryByModule: Record<number, ModuleMastery>;

  // ── Continuity ────────────────────────────────────────────────────────────
  lastConcept?: string;
  lastUserGoal?: string;
  lastMistake?: string;
  errorMemory?: ErrorMemory;

  // ── Engagement ────────────────────────────────────────────────────────────
  engagement?: EngagementState;

  // ── Operations ────────────────────────────────────────────────────────────
  requestedOperation?: RequestedOperation;
  depthMode: DepthMode;

  // ── Diagnostics ───────────────────────────────────────────────────────────
  diagnosticSamples?: number;
  confirmedLevel?: CEFRLevel;

  // ── SEEK 3.1 — SEMANTIC STATE (Fase 0-A) ─────────────────────────────────
  // These fields preserve the active pedagogical context across turns.
  // They prevent "topic drift" where "este tema" stops meaning the active topic.
  currentLessonTopic?: string;        // e.g. "ser vs estar" — survives all turns
  currentExercise?: string;           // the active exercise pending evaluation
  expectedResponseMode?: 'exercise_answer' | 'free' | 'quiz_answer';
  _exerciseAttemptCount?: number;     // how many attempts on current exercise
  // G5 — SEEK 3.3: persist audio transcript to prevent cognitive loop
  lastUserAudioTranscript?: string;   // last transcribed audio — survives all turns
  // SEEK 3.4: explicit pedagogical output format — decided by orchestrator, not LLM
  pedagogicalMode?: PedagogicalMode;
  lastStructuredOutput?: 'schema' | 'table' | null;
}

export const DEFAULT_SESSION_STATE: SessionState = {
  activeMode: 'interact',
  tutorPhase: 'guide',
  tokens: 0,
  interfaceLanguage: 'en',
  masteryByModule: {},
  depthMode: 'standard',
  // SEEK 3.1 — SEMANTIC STATE (Fase 0-A)
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
  type: string;       // MIME type
  size: number;       // bytes
  dataUrl?: string;
  base64?: string;
}

export interface ChatRequest {
  message: string;
  // FIX-B4: optional transcript for PDF export — populated by doExportPdfBackend in page.tsx
  exportTranscript?: string;
  state: SessionState;
  files?: AttachedFile[];
  audioDataUrl?: string;
  audioMimeType?: string;
  // SEEK 3.0: optional client hint (never used for routing decisions)
  clientHint?: string;
}

export interface ChatResponse {
  message: string;
  artifact?: ArtifactPayload;
  state: SessionState;
  suggestedActions?: SuggestedAction[];
  // SEEK 3.0: execution trace for debugging — omitted in production
  executionTrace?: ExecutionTrace;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — SEEK 3.0 ORCHESTRATION CONTRACTS (NEW)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IntentType — the classification category produced by intent-router.
 * Determines which orchestrator branch evaluates the request.
 */
export type IntentType =
  | 'hard_override'   // explicit command bypassing all pedagogy
  | 'learn'           // explicit learning request
  | 'practice'        // practice or quiz request
  | 'artifact'        // explicit artifact request (schema, table, etc.)
  | 'conversation'    // free conversation, no explicit pedagogical intent
  | 'diagnostic';     // explicit level assessment request

/**
 * IntentSubtype — narrows hard_override and artifact intents.
 */
export type IntentSubtype =
  // hard_override subtypes
  | 'translate'
  | 'correct'
  | 'transcribe'
  | 'export_chat_pdf'
  | 'generate_course_pdf'
  | 'pronunciation_eval'
  // artifact subtypes
  | 'schema'
  | 'schema_pro'
  | 'table'
  | 'table_matrix'
  | 'quiz'
  | 'illustration'
  | 'roadmap'
  // learn subtypes
  | 'curriculum_request'
  | 'topic_lesson'
  | 'grammar_explanation'
  | 'vocabulary_request';

/**
 * IntentResult — output of intent-router.ts.
 * Deterministic. No LLM. No side effects. < 10ms.
 */
export interface IntentResult {
  type: IntentType;
  subtype?: IntentSubtype;
  /** true when user phrased the intent explicitly (e.g. "translate this") */
  explicit: boolean;
  /** 0.0–1.0 classification confidence */
  confidence: number;
  /** Raw matched pattern, for audit purposes */
  matchedPattern?: string;
}

/**
 * ExecutorType — which execution layer the orchestrator assigns to a step.
 */
export type ExecutorType =
  | 'mentor'          // mentor-engine.ts → getMentorResponse()
  | 'tool_audio'      // audio-toolkit.ts
  | 'tool_pdf'        // pdf-generator.ts
  | 'tool_image'      // image-generator.ts
  | 'tool_schema'     // schema-generator.ts
  | 'tool_attachment' // attachment-processor.ts
  | 'tool_storage'    // storage.ts
  | 'knowledge'       // rag.ts (always supplementary)
  | 'commercial'      // commercial-engine.ts (always last, never blocking)
  | 'diagnostic';     // diagnostics.ts

/**
 * ExecutionStep — one atomic step in an execution plan.
 * Steps are executed in order. dependsOn references a prior step's order number.
 *
 * INVARIANT: if step N has dependsOn: M, step M must have a lower order number.
 */
export interface ExecutionStep {
  order: number;
  executor: ExecutorType;
  action: string;       // human-readable action name, e.g. "getMentorResponse"
  /** Step order number this step must wait for. Undefined = no dependency. */
  dependsOn?: number;
  /** Max ms to wait for this step before failing gracefully. */
  timeout?: number;
  /** Metadata passed to the executor — type-safe via executor-specific interfaces */
  params?: Record<string, unknown>;
}

/**
 * MentorDirective — configuration passed to mentor-engine for a specific execution.
 */
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
    | 'EXERCISE_FEEDBACK_DIRECTIVE'   // SEEK 3.1 Fase 0-A — evaluates user response to active exercise
    | 'PRONUNCIATION_EVAL_DIRECTIVE'   // G2 — evaluates pronunciation, returns JSON {score,feedback,tip,errors}
    | 'DIAGNOSTIC_FIRST_TURN_DIRECTIVE'; // G7/SEEK 3.3 — first-turn diagnostic when level is unknown (A0 or unset)
  injectContinuity: boolean;
  injectErrorMemory: boolean;
  cognitiveStructure: boolean; // enforce CONTEXT→CONCEPT→EXAMPLE→TRANSFER→ACTION
  // SEEK 3.1 Fase 0-A — populated when directive = EXERCISE_FEEDBACK_DIRECTIVE
  activeExercise?: string;  // exact exercise the user is responding to
  activeTopic?: string;     // lesson topic (e.g. 'ser vs estar')
}

/**
 * CommercialTrigger — optional commercial suggestion appended post-execution.
 * INVARIANT: never blocking. Always posterior. Never overrides pedagogy.
 *
 * type values include both the SEEK 3.0 orchestrator names and the real
 * commercial-engine.ts output name ('immersion') verified from the
 * PROTECTED engine in SEEK 2.6.
 */
export interface CommercialTrigger {
  /** Trigger type — 'immersion' is the canonical value from the real engine */
  type: 'immersion' | 'immersion_suggestion' | 'program_invite';
  destination?: 'spain' | 'colombia' | 'miami';
  cooldownRespected: boolean;
  sessionScore: number; // 0–100
}

/**
 * CommercialEngineTrigger — the typed output of the PROTECTED commercial-engine.ts.
 * Extends CommercialTrigger with the canonical message field that the engine
 * computes and returns. This is the type used by commercial-engine-adapter.ts.
 *
 * RULE: if message is present, it is authoritative. The adapter must use it
 * directly and must not derive alternative copy.
 *
 * Verified against commercial-engine.ts SEEK 2.6 [PROTECTED] output:
 *   trigger: { type: 'immersion', level: 'high'|'medium', message: string }
 */
export interface CommercialEngineTrigger extends CommercialTrigger {
  /** The canonical, already-localized commercial message from the engine. */
  message: string;
  /** Scoring level set by the engine: 'high' (score >= 80) or 'medium'. */
  level?: 'high' | 'medium';
}

/**
 * CommercialOffer — legacy compatibility type for protected commercial-engine.ts.
 * SEEK 3.0 uses the trigger-based commercial model, but the PROTECTED
 * commercial-engine.ts still imports CommercialOffer from contracts.ts.
 * Restored as a compatibility bridge — do not remove without updating the
 * protected engine first.
 */
export interface CommercialOffer {
  triggered?: boolean;
  message?:   string;
  trigger?:   CommercialTrigger | CommercialEngineTrigger | null;
  // Fields required by protected commercial-engine.ts
  timestamp:  number;
  sessionId?: string | null;
  type?:      'immersion' | 'immersion_suggestion' | 'program_invite';
  score?:     number;
  interest?:  boolean;
}

/**
 * ExecutionPlan — output of orchestrator.ts.
 * The single authoritative description of what will happen, in what order,
 * with what dependencies, for what reason.
 *
 * KEY INVARIANTS:
 * - executionOrder must have at least one step
 * - steps must be ordered by their .order field (ascending, no gaps)
 * - if executor is 'hybrid', executionOrder must have >= 2 steps
 * - commercial step, if present, must always have the highest order number
 * - reason must be non-empty — empty reason is a bug
 * - blocking=true means this plan prevents any other concurrent plan
 */
export interface ExecutionPlan {
  /** Primary executor type — 'hybrid' when multiple steps involve different executors */
  executor: ExecutorType | 'hybrid';
  /** Higher = more urgent. Hard overrides = 100. Pedagogy = 50–80. Default = 10. */
  priority: number;
  /** If true, no other plan may run concurrently. Hard overrides are always blocking. */
  blocking: boolean;
  /** The teaching action this plan implements. */
  pedagogicalAction: PedagogicalAction;
  /** Artifacts this plan is expected to produce (may be empty). */
  artifacts: ArtifactType[];
  /** Mentor configuration — required when any step uses 'mentor' executor. */
  mentor?: MentorDirective;
  /** Optional commercial trigger — appended after all blocking steps complete. */
  commercial?: CommercialTrigger;
  /** If true, tutorPhase advancement is skipped for this turn. */
  skipPhaseAdvance: boolean;
  /**
   * Human-readable explanation of why this plan was chosen.
   * Required. Must reference the orchestrator branch that produced it.
   * Example: "hard_override:translate — user explicitly requested translation"
   */
  reason: string;
  /**
   * Ordered execution steps. The execution-engine runs these in order[].order ascending.
   * Steps with dependsOn must not start until their dependency completes.
   */
  executionOrder: ExecutionStep[];
  /** SEEK 3.1 Fase 0-A: topic resolved by orchestrator, passed to execution-engine
   *  to prevent re-resolution and divergence. */
  resolvedTopic?: string;
}

/**
 * OrchestrationContext — input to orchestrator.ts.
 * Assembled by route.ts from the parsed ChatRequest + validated state + intent.
 */
export interface OrchestrationContext {
  message: string;
  state: SessionState;
  intent: IntentResult;
  files?: AttachedFile[];
  hasAudio: boolean;
  isFirstTurn: boolean;         // state.tokens === 0
  interfaceLanguage: InterfaceLanguage;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — STATE MANAGER CONTRACTS (NEW)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * StatePatch — partial update to SessionState produced by execution layers.
 * state-manager.ts merges patches into the current state, enforcing invariants.
 *
 * CLEAR SEMANTICS (unambiguous — Opción A):
 *   undefined in patch field = "do not touch this field" (preserves current value)
 *   null in patch field      = "explicitly clear this field"
 *
 * The only field that uses null-as-clear is requestedOperation.
 * clearRequestedOperation() returns { requestedOperation: null } to trigger this.
 * All other fields use undefined as the no-op sentinel.
 */
export type StatePatch = Omit<Partial<SessionState>, 'requestedOperation'> & {
  requestedOperation?: RequestedOperation | null;
};

/**
 * StateValidationResult — returned by state-manager.validateStateInvariants().
 */
export interface StateValidationResult {
  valid: boolean;
  errors: string[];       // descriptions of each invariant violation
  warnings: string[];     // non-fatal inconsistencies
}

/**
 * ContinuityFields — the fields state-manager must preserve across turns.
 * These must never be lost in a merge, even if the patch doesn't include them.
 */
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
  // SEEK 3.1 — SEMANTIC STATE (Fase 0-A) — must survive every merge
  'currentLessonTopic',
  'currentExercise',
  'expectedResponseMode',
  '_exerciseAttemptCount',
  'lastUserAudioTranscript',  // G5 — SEEK 3.3
  // SEEK 3.4: persist pedagogical output mode across turns
  'pedagogicalMode',
  'lastStructuredOutput',
] as const;

/**
 * InvariantFields — the fields state-manager enforces as non-undefined.
 * If any of these are missing or invalid, validateStateInvariants() returns errors.
 */
export const INVARIANT_FIELDS: ReadonlyArray<keyof SessionState> = [
  'activeMode',
  'tutorPhase',
  'tokens',
  'interfaceLanguage',
  'depthMode',
  'masteryByModule',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — EXECUTION TRACE (NEW — for debugging and audit)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ExecutionStepResult — the outcome of a single ExecutionStep.
 */
export interface ExecutionStepResult {
  stepOrder: number;
  executor: ExecutorType;
  action: string;
  durationMs: number;
  success: boolean;
  error?: string;
  /** Artifacts produced by this step, if any. */
  producedArtifacts?: ArtifactType[];
}

/**
 * ExecutionTrace — full audit record of a single request lifecycle.
 * Included in ChatResponse only when LINGORA_DEBUG_TRACE=true.
 * Used by QA for determinism tests and race condition detection.
 */
export interface ExecutionTrace {
  requestId: string;
  intentResult: IntentResult;
  executionPlan: ExecutionPlan;
  stepResults: ExecutionStepResult[];
  totalDurationMs: number;
  statePatchApplied: StatePatch;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — MASTERY GATE CONSTANTS (unchanged from 2.6)
// ─────────────────────────────────────────────────────────────────────────────

export const MASTERY_PASS_THRESHOLD = 70;   // minimum score to advance module
export const DIAGNOSTIC_MIN_SAMPLES  = 3;   // minimum turns before confirming level
export const TOKEN_SCHEMA_INTERVAL   = 5;   // schema reward every N tokens
export const COMMERCIAL_COOLDOWN_TOKENS = 20; // min tokens between commercial triggers

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — MENTOR PROFILES ENUM (unchanged from 2.6)
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
