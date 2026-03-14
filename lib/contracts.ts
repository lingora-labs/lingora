// ================================================
// LINGORA 10.0 — CONTRACTS
// Single source of truth for all JSON contracts
// between frontend and backend.
// ================================================

// ─── SESSION STATE ───────────────────────────────
export interface SessionState {
  lang: string | null
  mentor: 'sarah' | 'alex' | 'nick' | null
  topic: string | null
  level: string
  tokens: number
  samples: string[]
  messages: ChatMessage[]
  sessionId: string
  commercialOffers: CommercialOffer[]
  interestCount?: number
  lastTask?: string | null
  lastArtifact?: string | null
  attachments?: AttachmentRecord[]
}

export const DEFAULT_SESSION: SessionState = {
  lang: null,
  mentor: null,
  topic: null,
  level: 'A0',
  tokens: 0,
  samples: [],
  messages: [],
  sessionId: '',
  commercialOffers: [],
  interestCount: 0,
  lastTask: null,
  lastArtifact: null,
  attachments: [],
}

// ─── MESSAGE ─────────────────────────────────────
export interface ChatMessage {
  sender: string
  html: string
  timestamp?: number
}

// ─── INCOMING PAYLOAD ────────────────────────────
export interface MessagePayload {
  message?: string
  state?: Partial<SessionState>
  audio?: AudioInput | null
  files?: FileInput[] | null
  diagnostic?: boolean
  samples?: string[]
  autoSchema?: boolean
  ttsRequested?: boolean
  pronunciationTarget?: string | null
}

// ─── AUDIO ───────────────────────────────────────
export interface AudioInput {
  data: string        // base64
  format: string      // 'webm' | 'mp4' | 'ogg' | 'wav'
}

// ─── FILE UPLOAD ─────────────────────────────────
export interface FileInput {
  name: string
  type: string        // MIME type
  data: string        // base64
  size?: number
}

// ─── ARTIFACTS ───────────────────────────────────
export type ArtifactType = 'schema' | 'illustration' | 'pdf' | 'audio'

export interface SchemaArtifact {
  type: 'schema'
  content: SchemaContent
  metadata?: { timestamp: number }
}

export interface IllustrationArtifact {
  type: 'illustration'
  url: string
}

export interface PdfArtifact {
  type: 'pdf'
  url: string         // S3 URL or data:application/pdf;base64,...
}

export interface AudioArtifact {
  type: 'audio'
  url: string         // S3 URL or data:audio/mpeg;base64,...
  method: 's3' | 'dataurl'
}

export type ArtifactPayload =
  | SchemaArtifact
  | IllustrationArtifact
  | PdfArtifact
  | AudioArtifact
  | null

// ─── SCHEMA CONTENT ──────────────────────────────
export interface SchemaContent {
  title: string
  block?: string
  objective?: string
  keyConcepts?: string[]
  subtopics?: SchemaSubtopic[]
  globalTakeaway?: string
  quiz?: QuizItem[]
}

export interface SchemaSubtopic {
  title: string
  content: string
  keyTakeaway?: string
}

export interface QuizItem {
  question: string
  options: string[]
  correct: number
}

// ─── DIAGNOSTIC ──────────────────────────────────
export interface DiagnosticState {
  level: string
  confidence: 'insufficient' | 'low' | 'medium' | 'high'
  samples: number
  score?: number
  nextLevel?: string
}

// ─── COMMERCIAL ──────────────────────────────────
export interface CommercialOffer {
  timestamp: number
  sessionId: string | null
  type: string
  score: number
  interest?: boolean
}

export interface CommercialTrigger {
  type: string
  level: 'high' | 'medium'
  message: string
}

// ─── ATTACHMENT ──────────────────────────────────
export interface AttachmentRecord {
  name: string
  type: string
  size: number
  url: string | null
  extractedText: string
  extractionMethod: string
  ocrAvailable: boolean | null
}

// ─── API RESPONSE ────────────────────────────────
export interface ChatResponse {
  message: string
  artifact?: ArtifactPayload
  state?: Partial<SessionState>
  transcription?: string
  pronunciationScore?: number
  ttsAvailable?: boolean
  ttsError?: string | null
  attachments?: string[]
  extractedTexts?: string[]
  diagnostic?: unknown
  error?: string
}
