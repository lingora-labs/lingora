// ================================================
// LINGORA 10.2 — CONTRACTS v1.1
// Single source of truth for all JSON contracts.
// ================================================

// Note: tutorProtocol imports SessionState from here,
// and contracts imports tutor types from tutorProtocol.
// This is import type only — no runtime circular dependency.
// Future refactor: move tutor types to lib/tutorTypes.ts.
import type { TutorMode, TutorPhase, PedagogicalAction } from '@/lib/tutorProtocol'

// ─── SESSION STATE ───────────────────────────────
// ─── Exported state sub-types ────────────────────────────────────

export type DepthMode = 'shallow' | 'standard' | 'deep'

export type RequestedOperation =
  | 'transcribe'
  | 'pronunciation'
  | 'translate'
  | 'correct'
  | 'summarize'
  | 'conversation'

export interface ModuleMastery {
  score:       number
  attempts:    number
  lastUpdated: number
}

export interface ErrorMemory {
  grammar:       string[]
  vocabulary:    string[]
  pronunciation: string[]
  lastUpdated?:  number
}

export interface EngagementState {
  streak:           number
  lastActive:       number
  completedModules: number[]
}

export interface SessionState {
  lang:    string | null
  mentor:  'sarah' | 'alex' | 'nick' | null
  topic:   string | null
  level:   string
  tokens:  number
  samples: string[]
  messages: ChatMessage[]
  sessionId: string
  commercialOffers: CommercialOffer[]
  interestCount?:  number
  lastTask?:       string | null     // legacy — keep in sync with lastAction during transition
  lastArtifact?:   string | null
  attachments?:    AttachmentRecord[]

  // ── Tutor Protocol fields ──
  tutorMode?:          TutorMode
  tutorPhase?:         TutorPhase
  lessonIndex?:        number
  courseActive?:       boolean
  lastAction?:         PedagogicalAction | null
  awaitingQuizAnswer?: boolean        // true when quiz sent, waiting for user response

  // ── Sprint 2.3: Guided modes ──
  activeMode?:     'interact' | 'structured' | 'pdf_course' | 'free'

  // ── Curriculum plan (structured — stored once at course init) ──
  curriculumPlan?: CurriculumPlan
  curriculumTopic?: string

  // ── Mastery model (per-module progress) ──────────────────────
  // Gates module advancement: student must demonstrate understanding
  masteryByModule?: Record<number, ModuleMastery>

  // ── Error memory (persistent across turns) ───────────────────
  // Used to personalize corrections and revisit weak spots
  errorMemory?: ErrorMemory

  // ── Engagement state ─────────────────────────────────────────
  engagement?: EngagementState

  // ── Depth mode ───────────────────────────────────────────────
  // Controls how thoroughly the tutor expands each concept
  depthMode: DepthMode

  // ── Sprint 2.4: Explicit operation override ──
  // Set when user gives an explicit operation command.
  // Persists until user changes task or session resets.
  requestedOperation?: RequestedOperation  // MUST be cleared after execution
  learningStage?:  'diagnosis' | 'schema' | 'examples' | 'quiz' | 'score' | 'next'
  currentModule?:  number
  sessionScore?:   number   // session-level score distinct from masteryByModule scores
  pdfCourseActive?: boolean
}

export const DEFAULT_SESSION: Omit<SessionState, 'sessionId'> = {
  lang:             null,
  mentor:           null,
  topic:            null,
  level:            'A0',
  tokens:           0,
  samples:          [],
  messages:         [],
  commercialOffers: [],
  interestCount:    0,
  lastTask:         null,
  lastArtifact:     null,
  attachments:      [],
  tutorMode:        undefined,
  tutorPhase:       'idle',
  lessonIndex:      0,
  courseActive:     false,
  lastAction:       null,
  awaitingQuizAnswer: false,
  activeMode:       undefined,
  learningStage:    undefined,
  currentModule:    undefined,
  sessionScore:            undefined,
  pdfCourseActive:  false,
  requestedOperation: undefined,
  curriculumPlan:      undefined,
  curriculumTopic:     undefined,
  masteryByModule:     {},
  errorMemory:         { grammar: [], vocabulary: [], pronunciation: [] },
  engagement:          { streak: 0, lastActive: Date.now(), completedModules: [] },
  depthMode:           'standard',
}

// ─── MESSAGE ─────────────────────────────────────
export interface ChatMessage {
  sender:     string
  html:       string
  timestamp?: number
}

// ─── INCOMING PAYLOAD ────────────────────────────
export interface MessagePayload {
  message?:             string
  state?:               Partial<SessionState>
  audio?:               AudioInput | null
  files?:               FileInput[] | null
  diagnostic?:          boolean
  samples?:             string[]
  autoSchema?:          boolean
  ttsRequested?:        boolean
  pronunciationTarget?: string | null
}

// ─── AUDIO INPUT ─────────────────────────────────
export interface AudioInput {
  data:   string   // base64
  format: string
}

// ─── FILE INPUT ──────────────────────────────────
export interface FileInput {
  name:  string
  type:  string
  data:  string   // base64
  size?: number
}

// ─── ARTIFACTS ───────────────────────────────────

export interface SchemaArtifact {
  type:      'schema'
  content:   SchemaContent
  metadata?: { timestamp: number; auto?: boolean }
}

export interface IllustrationArtifact {
  type: 'illustration'
  url:  string
}

export interface PdfArtifact {
  type: 'pdf'
  url:  string
}

export interface AudioArtifact {
  type:   'audio'
  url:    string
  method: 's3' | 'dataurl'
}

// QuizArtifact: standalone quiz (not embedded in schema)
// Used when action === 'quiz' without a full schema
export interface QuizArtifact {
  type:    'quiz'
  content: QuizContent
}

export interface QuizContent {
  title:     string
  topic:     string
  level:     string
  questions: QuizItem[]
}

// TableArtifact: fast visual table — bypasses full protocol pipeline
// Used for simple comparisons, conjugation grids, vocabulary tables
export interface TableArtifact {
  type:    'table'
  content: TableContent
}

export interface TableContent {
  title?:    string
  subtitle?: string
  columns:   string[]
  rows:      string[][]
  tone?:     'comparison' | 'conjugation' | 'vocabulary' | 'exam'
}
// ─── Rich Table (table_matrix) ─────────────────────
// Superset of TableArtifact — supports cell-level semantics
export interface RichCell {
  text:    string
  icon?:   string
  tone?:   'ok' | 'warn' | 'danger' | 'info' | 'neutral'
  bold?:   boolean
  align?:  'left' | 'center' | 'right'
}

export interface TableMatrixContent {
  title?:    string
  subtitle?: string
  layout?:   'audit' | 'comparison' | 'study' | 'report'
  columns:   { key: string; label: string; width?: string }[]
  rows:      RichCell[][]
}

export interface TableMatrixArtifact {
  type:    'table_matrix'
  content: TableMatrixContent
}

// ─── Schema Pro (schema_pro) ───────────────────────
export type SchemaBlock =
  | { type: 'concept';    title: string; body: string; tone?: string }
  | { type: 'bullets';    title: string; items: string[] }
  | { type: 'highlight';  text: string;  tone?: string; label?: string }
  | { type: 'flow';       steps: string[] }
  | { type: 'comparison'; left: string;  right: string; label?: string }
  | { type: 'table';      columns: string[]; rows: string[][] }

export interface SchemaProContent {
  title:     string
  subtitle?: string
  level?:    string
  blocks:    SchemaBlock[]
  errors?: string[]
  colorHints?: Record<string, 'green' | 'red' | 'blue' | 'yellow' | 'purple'>
}

export interface SchemaProArtifact {
  type:    'schema_pro'
  content: SchemaProContent
}

// ─── Pronunciation Report ─────────────────────────
export interface PronunciationReport {
  type:    'pronunciation_report'
  content: {
    target?:     string
    transcribed: string
    score:       number
    feedback:    string
    correction?: string
  }
}

// ─── Simulacro Result ─────────────────────────────
export interface SimulacroResult {
  type:    'simulacro_result'
  content: {
    score:          number
    total:          number
    feedback:       string
    recommendation: string
    retry?:         boolean
  }
}

// ─── Audio Transcript ─────────────────────────────
export interface AudioTranscript {
  type:    'audio_transcript'
  content: {
    text:      string
    language?: string
    url?:      string
  }
}

// ─── Suggested Actions (interactive pathing) ────────────────

export type SuggestedActionType =
  | 'next_module'
  | 'show_schema'
  | 'show_table'
  | 'show_matrix'
  | 'start_quiz'
  | 'retry_quiz'
  | 'practice_examples'
  | 'pronunciation_drill'
  | 'deepen_topic'
  | 'switch_mode'
  | 'download_pdf'
  | 'review_errors'
  | 'hear_audio'
  | 'show_image'

export interface SuggestedAction {
  id:       string
  label:    string
  action:   SuggestedActionType
  payload?: Record<string, unknown>
  tone?:    'primary' | 'secondary' | 'warning'
  emoji?:   string
}

// ─── Curriculum types (exported for route.ts) ───────────────

export interface CurriculumModule {
  number:        number
  title:         string
  focus:         string
  skills:        string[]
  completed?:    boolean
  masteryScore?: number
}

export interface CurriculumPlan {
  title:   string
  topic:   string
  level:   string
  modules: CurriculumModule[]
}

// ─── Sprint 2.3 Artifacts ────────────────────────

export interface RoadmapBlock {
  type:    'roadmap'
  content: {
    mode:   'interact' | 'structured' | 'pdf_course' | 'free'
    mentor: string
    topic:  string
    level:  string
    steps:  string[]
    first:  string
  }
}

export interface ScoreReport {
  type:    'score_report'
  content: {
    score:          number
    total:          number
    feedback:       string
    recommendation: string
    nextStep:       string
  }
}

export interface LessonModule {
  type:    'lesson_module'
  content: {
    module: number
    title:  string
    stage:  'diagnosis' | 'schema' | 'examples' | 'quiz' | 'score' | 'next'
  }
}

export interface PdfAssignment {
  type:    'pdf_assignment'
  content: {
    title:        string
    instructions: string
    url?:         string
    exercises?:   string[]
  }
}

export interface SubmissionFeedback {
  type:    'submission_feedback'
  content: {
    score:          number
    corrections:    string[]
    feedback:       string
    nextAssignment: string
  }
}


// ─── PDF Chat Export ──────────────────────────────
export interface PDFChat {
  type: 'pdf_chat'
  url:  string
}

export type ArtifactPayload =
  | SchemaArtifact
  | SchemaProArtifact
  | TableArtifact
  | TableMatrixArtifact
  | QuizArtifact
  | PdfArtifact
  | PdfAssignment
  | SubmissionFeedback
  | IllustrationArtifact
  | AudioArtifact
  | PronunciationReport
  | SimulacroResult
  | AudioTranscript
  | RoadmapBlock
  | ScoreReport
  | LessonModule
  | PDFChat
  | null

// ─── SCHEMA CONTENT ──────────────────────────────
export interface SchemaContent {
  title:           string
  block?:          string
  objective?:      string
  keyConcepts?:    string[]
  tableRows?:      SchemaTableRow[]
  subtopics?:      SchemaSubtopic[]
  examples?:       string[]
  summary?:        string
  globalTakeaway?: string
  keyTakeaway?:    string
  quiz?:           QuizItem[]
}

export interface SchemaTableRow {
  left:        string
  right:       string
  label?:      string
  value?:      string
  persona?:    string
  forma?:      string
  term?:       string
  definition?: string
}

export interface SchemaSubtopic {
  title:        string
  content:      string
  keyTakeaway?: string
}

export interface QuizItem {
  question:     string
  options:      string[]
  correct:      number
  explanation?: string   // real explanation from gpt-4o, shown after answer selection
}

// ─── DIAGNOSTIC ──────────────────────────────────
export interface DiagnosticState {
  level:      string
  confidence: 'insufficient' | 'low' | 'medium' | 'high'
  samples:    number
  score?:     number
  nextLevel?: string
}

// ─── COMMERCIAL ──────────────────────────────────
export interface CommercialOffer {
  timestamp: number
  sessionId: string | null
  type:      string
  score:     number
  interest?: boolean
}

export interface CommercialTrigger {
  type:    string
  level:   'high' | 'medium'
  message: string
}

// ─── ATTACHMENT ──────────────────────────────────
export interface AttachmentRecord {
  name:             string
  type:             string
  size:             number
  url:              string | null
  extractedText:    string
  extractionMethod: string
  ocrAvailable:     boolean | null
}

// ─── API RESPONSE ────────────────────────────────
export interface ChatResponse {
  message:             string
  artifact?:           ArtifactPayload
  state?:              Partial<SessionState>
  transcription?:      string
  pronunciationScore?: number
  ttsAvailable?:       boolean
  ttsError?:           string | null
  attachments?:        string[]
  extractedTexts?:     string[]
  diagnostic?:         unknown
  error?:              string
  suggestedActions?: SuggestedAction[]
}

// ─── TYPE GUARD HELPERS (runtime safety) ─────────────────────────

export function isCurriculumPlan(obj: unknown): obj is CurriculumPlan {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    Array.isArray((obj as CurriculumPlan).modules)
  )
}

export function isModuleMastery(obj: unknown): obj is ModuleMastery {
  return typeof obj === 'object' && obj !== null && 'score' in obj && 'attempts' in obj
}

export function isErrorMemory(obj: unknown): obj is ErrorMemory {
  if (typeof obj !== 'object' || obj === null) return false
  const e = obj as Record<string, unknown>
  return Array.isArray(e.grammar) && Array.isArray(e.vocabulary) && Array.isArray(e.pronunciation)
}

// ─── STATE INVARIANTS ────────────────────────────────────────────
// contracts.ts is the single source of truth for all state shapes.
// No other module may redefine structures already declared here.
// Invariants:
// 1. curriculumPlan is always CurriculumPlan | undefined — never a raw string
// 2. masteryByModule keys must correspond to modules in curriculumPlan.modules
// 3. engagement.completedModules must align with modules where masteryScore >= 70
// 4. requestedOperation MUST be cleared to undefined after each execution
// 5. each request path increments tokens exactly once before returning — never twice
// 6. depthMode defaults to 'standard' — never undefined at runtime


