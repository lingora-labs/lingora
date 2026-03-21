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
}

export interface SchemaProArtifact {
  type:    'schema_pro'
  content: SchemaProContent
}

// ─── Pronunciation Report ─────────────────────────
export interface PronunciationReport {
  type:        'pronunciation_report'
  target?:     string
  transcribed: string
  score:       number
  feedback:    string
  correction?: string
}

// ─── Simulacro Result ─────────────────────────────
export interface SimulacroResult {
  type:           'simulacro_result'
  score:          number
  total:          number
  feedback:       string
  recommendation: string
  retry?:         boolean
}

// ─── Audio Transcript ─────────────────────────────
export interface AudioTranscript {
  type:      'audio_transcript'
  text:      string
  language?: string
  url?:      string
}

// ─── PDF Chat Export ──────────────────────────────
export interface PDFChat {
  type: 'pdf_chat'
  url:  string
}

export type ArtifactPayload =
  | SchemaArtifact
  | IllustrationArtifact
  | PdfArtifact
  | AudioArtifact
  | QuizArtifact
  | TableArtifact
  | TableMatrixArtifact
  | SchemaProArtifact
  | PronunciationReport
  | SimulacroResult
  | AudioTranscript
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
}
