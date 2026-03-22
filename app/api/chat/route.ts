// ================================================
// FILE: app/api/chat/route.ts
// LINGORA 10.2 — ROUTER (VALID)
// Full replacement — typed and build-safe
// ================================================

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

import { detectIntent }                        from '@/server/core/intent-detector'
import { commercialEngine, commercialDebug }   from '@/server/core/commercial-engine'
import { evaluateLevel }                       from '@/server/core/diagnostics'
import { getMentorResponse }                   from '@/server/mentors/mentor-engine'
import { getRagContext, getRagStats }          from '@/server/knowledge/rag'
import { generateSchemaContent }               from '@/server/tools/schema-generator'
import { generateImage }                       from '@/server/tools/image-generator'
import { generatePDF }                         from '@/server/tools/pdf-generator'
import { generateSpeech, evaluatePronunciation, transcribeAudio } from '@/server/tools/audio-toolkit'
import { processAttachment }                   from '@/server/tools/attachment-processor'
import {
  resolvePedagogicalAction,
  resolveTutorMode,
  modeToTutorMode,
  nextStage,
  type PedagogicalAction,
} from '@/lib/tutorProtocol'
import type {
  MessagePayload, ChatResponse, SessionState,
  ArtifactPayload, AudioArtifact, QuizArtifact, QuizItem,
  TableArtifact, TableContent,
  TableMatrixArtifact, TableMatrixContent,
  SchemaProArtifact, SchemaProContent,
  RoadmapBlock, PdfAssignment, SubmissionFeedback,
} from '@/lib/contracts'

export const runtime     = 'nodejs'
export const maxDuration = 30

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ─── Helpers ─────────────────────────────────────
function ok(body: ChatResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-LINGORA': 'v10.2' },
  })
}

function audioArtifact(url: string): AudioArtifact {
  return { type: 'audio', url, method: url.startsWith('data:') ? 'dataurl' : 's3' }
}

function intentToAction(intentType: string): PedagogicalAction | null {
  const map: Partial<Record<string, PedagogicalAction>> = {
    schema:        'schema',
    table:         'schema',    // table intent → schema action type, but routed separately below
    illustration:  'illustration',
    pdf:           'pdf',
    pronunciation: 'pronunciation',
  }
  return map[intentType] ?? null
}

// Extract quiz questions from mentor text response.
// Handles: A) / A. / 1) / 1. / - / * format options, multi-line,
// markdown bold, and text before/after the question block.
// ─── Quiz generator (JSON-coercive) ──────────────
// Forces GPT-4o to return structured quiz JSON with correct answer indices.
// No regex parsing — the model produces a contract-compliant artifact directly.
async function generateQuizContent(
  message: string,
  state: Partial<SessionState>
): Promise<QuizArtifact | null> {
  const level = state.level ?? 'A1'
  const topic = state.topic ?? 'Spanish'
  const lang  = state.lang  ?? 'en'

  const prompt = `You are a Spanish language quiz designer for LINGORA.
Student level: ${level}. Topic: ${topic}. Interface language: ${lang}.

The student said: "${message}"

Return ONLY valid JSON. No markdown. No preamble. No explanation.
Shape:
{
  "title": "short quiz title",
  "questions": [
    {
      "question": "Clear question in Spanish or ${lang}?",
      "options": ["option A", "option B", "option C", "option D"],
      "correct": 0,
      "explanation": "Brief explanation of why the correct answer is right."
    }
  ]
}

Rules:
- 1 question only (for now)
- options: exactly 4 items
- correct: 0-based index of the correct option (0=A, 1=B, 2=C, 3=D)
- question must end with ?
- options must be meaningfully different
- explanation: 1 sentence max, in the user's interface language
- difficulty: appropriate for ${level} level`

  try {
    const res = await openai.chat.completions.create({
      model:           'gpt-4o',
      messages:        [{ role: 'user', content: prompt }],
      temperature:     0.4,
      max_tokens:      400,
      response_format: { type: 'json_object' },
    })
    const raw    = res.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as { title: string; questions: QuizItem[] }

    if (!parsed.questions?.length) return null
    const q = parsed.questions[0]
    if (!q.question || !q.options?.length || typeof q.correct !== 'number') return null

    return {
      type:    'quiz',
      content: {
        title:     parsed.title ?? `Quiz: ${topic}`,
        topic,
        level,
        questions: [{ ...q, options: q.options.slice(0, 4) }],
      },
    }
  } catch {
    return null
  }
}

// ─── Table generator (fast path — bypasses full protocol) ────
// JSON-coercive prompt: model MUST return columns + rows, nothing else.
// Used when user asks for simple comparison/conjugation table.
async function generateTableContent(
  message: string,
  state:   Partial<SessionState>
): Promise<TableContent | null> {
  const level = state.level ?? 'A1'
  const topic = state.topic ?? 'Spanish'

  const prompt = `You are a Spanish language data extractor for LINGORA.
The student (level ${level}, topic: ${topic}) asked: "${message}"

Return ONLY valid JSON. No markdown. No explanations. No preamble.
Shape:
{
  "title": "short descriptive title",
  "subtitle": "optional context line",
  "columns": ["Column1", "Column2", "Column3"],
  "rows": [
    ["cell", "cell", "cell"],
    ["cell", "cell", "cell"]
  ],
  "tone": "comparison" | "conjugation" | "vocabulary" | "exam"
}

Rules:
- columns: 2-6 headers (use as many as the content needs)
- rows: as many rows as needed — do not truncate
- cells: concise (1-8 words each)
- include emojis in cells where natural (✅ ❌ 🟢 🔴 etc.)
- tone: pick the most appropriate one
- If the request is a verb conjugation, tone = "conjugation", columns = ["Persona", "Forma", "Ejemplo"]
- If comparison (ser vs estar, por vs para), tone = "comparison", columns = ["Criterio", "SER", "ESTAR"] etc.
- If vocabulary, tone = "vocabulary", columns = ["Palabra", "Significado", "Ejemplo"]`

  try {
    const res = await openai.chat.completions.create({
      model:           'gpt-4o',
      messages:        [{ role: 'user', content: prompt }],
      temperature:     0.2,
      max_tokens:      1200,
      response_format: { type: 'json_object' },
    })
    const raw = res.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as TableContent
    if (!parsed.columns?.length || !parsed.rows?.length) return null
    return parsed
  } catch {
    return null
  }
}

// Detect if this is a simple table request (fast path — no protocol needed)
function isTableRequest(message: string): boolean {
  const m = message.toLowerCase()
  return [
    'tabla', 'table', 'cuadro', 'cuadrito', 'cuadro simple', 'cuadro pequeño',
    'compárame', 'comparame', 'compara', 'diferencias entre', 'diferencia entre',
    'resumen en tabla', 'resume en tabla', 'en tabla', 'en un cuadro',
    'conjugación de', 'conjugacion de', 'conjuga el verbo', 'conjuga ',
    'vocabulario de', 'lista de', 'comparison', 'versus', ' vs ',
    // Patterns that failed in test (March 21):
    'cuadros visuales', 'cuadro visual', 'cuadro del verbo', 'tabla del verbo',
    'haz un cuadro', 'dame un cuadro', 'dame una tabla', 'hazme una tabla',
    'cuadro de', 'tabla de',
  ].some(p => m.includes(p))
}
// Detect COMPLEX content requests — must bypass simple table generator
// and go directly to mentor with rich-content directive.
// Complex = multi-tense, includes errors, explanations, long input.
function isComplexTableRequest(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('todos los tiempos') ||
    m.includes('conjugación completa') ||
    m.includes('conjugacion completa') ||
    m.includes('errores comun') ||
    m.includes('error comun') ||
    m.includes('todas las personas') ||
    m.includes('todas la persona') ||
    m.includes('explicado para') ||
    m.includes('explicación para') ||
    m.includes('explicacion para') ||
    m.includes('explica para') ||
    m.includes('completo') ||
    m.includes('completa') ||
    (m.includes('presente') && m.includes('pasado')) ||
    (m.includes('present') && m.includes('past')) ||
    m.length > 100
  )
}

// Rich-content directive for complex requests routed to mentor
// Produces DeepSeek-quality output: multiple tables, full conjugations,
// errors, explanations — no row/column caps, no simplification.
const RICH_CONTENT_DIRECTIVE = `You are an elite Spanish language content generator.

RULES:
- Follow the user request EXACTLY — do not change topic or simplify
- Use rich markdown: ## headers, **bold**, tables, bullet points
- Tables must be COMPLETE — include all persons, all tenses requested
- Include multiple tables if the request covers multiple topics
- Include real common mistakes with incorrect/correct examples
- If explaining for English speakers, add contrastive English notes
- No length limit — produce as much as needed to fully answer
- Structure: title → conjugation table(s) → errors table → key notes

This is content generation, not conversation. Produce the full material.`
// ── Detect matrix request (rich table with cell semantics) ──
function isMatrixRequest(message: string): boolean {
  const m = message.toLowerCase()
  return [
    'matriz', 'matrix', 'auditoría', 'auditoria', 'audit',
    'tabla de riesgos', 'tabla de errores', 'tabla de criterios',
    'cuadro complejo', 'cuadro denso', 'cuadro detallado',
    'comparativa compleja', 'tabla con estados', 'tabla con notas',
    'tabla matricial', 'cuadro matricial',
  ].some(p => m.includes(p))
}

// ── Detect schema_pro request (visual block-based schema) ──
function isSchemaProRequest(message: string): boolean {
  const m = message.toLowerCase()
  return [
    'esquema completo', 'esquema visual', 'mapa conceptual',
    'esquema del verbo', 'esquema de la', 'esquema del',
    'estructura del', 'diagrama de', 'organiza', 'bloque visual',
    'bloques de', 'lección visual', 'mapa de',
  ].some(p => m.includes(p))
}

// ── Detect explicit quiz/simulacro request ───────────
function isQuizRequest(message: string): boolean {
  const m = message.toLowerCase()
  return [
    'dame otro simulacro', 'otro simulacro', 'nuevo simulacro',
    'dame un quiz', 'hazme un quiz', 'quiero un quiz',
    'hazme un test', 'quiero un test', 'dame un test',
    'dame preguntas', 'hazme preguntas', 'práctica interactiva',
    'simulacro de', 'quiz de', 'test de',
  ].some(p => m.includes(p))
}

// ── Detect level assessment request ──────────────────
function isLevelRequest(message: string): boolean {
  const m = message.toLowerCase()
  return [
    'califica mi nivel', 'evalúa mi nivel', 'evalua mi nivel',
    'qué nivel tengo', 'que nivel tengo', 'cómo va mi español',
    'como va mi español', 'dame una nota', 'dame mi nota',
    'cómo lo estoy haciendo', 'cuál es mi nivel',
    'assess my level', 'what is my level',
  ].some(p => m.includes(p))
}

// ─── Table Matrix generator ───────────────────────────
async function generateTableMatrix(
  message: string,
  state: Partial<SessionState>
): Promise<TableMatrixContent | null> {
  const level = state.level ?? 'A1'
  const lang  = state.lang  ?? 'en'

  const prompt = `You are a Spanish language visual data designer for LINGORA.
Student level: ${level}. Interface: ${lang}. Request: "${message}"

Return ONLY valid JSON. No markdown. No preamble.
Shape:
{
  "title": "short descriptive title",
  "subtitle": "optional context",
  "layout": "audit" | "comparison" | "study" | "report",
  "columns": [{"key":"col1","label":"Column Name","width":"optional"}],
  "rows": [
    [
      {"text":"cell content","tone":"ok","icon":"✅","bold":true},
      {"text":"cell content","tone":"neutral"}
    ]
  ]
}

Rules:
- columns: 2-5 headers
- rows: 3-10 rows
- tone values: ok=green, warn=yellow, danger=red, info=blue, neutral=default
- use icons (✅ ❌ ⚠️ 🔵 🔴 ✓) where semantically meaningful
- bold first column cells
- layout: choose the most appropriate for the content`

  try {
    const res = await openai.chat.completions.create({
      model:           'gpt-4o',
      messages:        [{ role: 'user', content: prompt }],
      temperature:     0.2,
      max_tokens:      800,
      response_format: { type: 'json_object' },
    })
    const raw    = res.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as TableMatrixContent
    if (!parsed.columns?.length || !parsed.rows?.length) return null
    return parsed
  } catch { return null }
}

// ─── Schema Pro generator ─────────────────────────────
async function generateSchemaPro(
  message: string,
  state: Partial<SessionState>
): Promise<SchemaProContent | null> {
  const level = state.level ?? 'A1'
  const topic = state.topic ?? 'Spanish'
  const lang  = state.lang  ?? 'en'

  const prompt = `You are a Spanish language educational designer for LINGORA.
Student level: ${level}. Topic: ${topic}. Interface: ${lang}.
Request: "${message}"

Return ONLY valid JSON. No markdown. No preamble.
Shape:
{
  "title": "schema title",
  "subtitle": "optional subtitle",
  "level": "${level}",
  "blocks": [
    {"type":"concept","title":"Core idea","body":"explanation"},
    {"type":"bullets","title":"Key points","items":["point 1","point 2"]},
    {"type":"highlight","text":"The most important rule","tone":"ok","label":"80/20"},
    {"type":"comparison","left":"SER","right":"ESTAR","label":"Criterio"},
    {"type":"flow","steps":["Step 1","Step 2","Step 3"]},
    {"type":"table","columns":["Form","Example"],"rows":[["soy","I am"]]}
  ]
}

Rules:
- 4-8 blocks total
- always start with a 'concept' block
- include at least one 'highlight' block (80/20 rule)
- include 'bullets' for key concepts
- use 'comparison' only when comparing two things
- use 'flow' for sequences, conjugations, or step-by-step
- use 'table' only for compact data (max 6 rows)
- tone options: ok, warn, info, highlight`

  try {
    const res = await openai.chat.completions.create({
      model:           'gpt-4o',
      messages:        [{ role: 'user', content: prompt }],
      temperature:     0.3,
      max_tokens:      1000,
      response_format: { type: 'json_object' },
    })
    const raw    = res.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as SchemaProContent
    if (!parsed.blocks?.length) return null
    return parsed
  } catch { return null }
}

// ─── canBypassTutorPhase ─────────────────────────────
// Doctrinal helper: intent types that always override the internal
// tutorPhase. Used by both text and audio routing paths.
// Centralises bypass logic so it's readable, not scattered inline.
function canBypassTutorPhase(intent: string): boolean {
  return [
    'schema', 'schema_pro',
    'table',  'matrix',
    'quiz',   'simulacro',
    'level',
    'pdf',    'pdf_chat',
    'pronunciation',
    'image',  'illustration',
  ].includes(intent)
}

// ─── runFastPaths ─────────────────────────────────────
// Shared fast-path runner used by BOTH text and audio branches.
// Receives the resolved text (typed message or transcription) and
// the current session state. Returns ok() Response or null (fall through).
// Audio calls this after Whisper transcription so spoken intent is
// respected identically to typed intent.
async function runFastPaths(
  text:  string,
  state: Partial<SessionState>
): Promise<Response | null> {
  // Precedence: matrix > schema_pro > table > quiz > level
  // (mirrors the inline order in the text branch)
  if (isMatrixRequest(text)) {
    console.log('[ROUTER] fast-path=table_matrix (audio)')
    try {
      const matrixContent = await generateTableMatrix(text, state)
      if (matrixContent) {
        const artifact: TableMatrixArtifact = { type: 'table_matrix', content: matrixContent }
        const next: Partial<SessionState> = {
          ...state,
          lastTask: 'table', lastAction: 'schema' as PedagogicalAction,
          tutorPhase: 'lesson', tokens: (state.tokens ?? 0) + 1, courseActive: true,
        }
        return ok({ message: matrixContent.title ?? 'Matriz lista:', artifact, state: next })
      }
    } catch { /* fall through */ }
  }

  if (isSchemaProRequest(text)) {
    console.log('[ROUTER] fast-path=schema_pro (audio)')
    try {
      const schemaProContent = await generateSchemaPro(text, state)
      if (schemaProContent) {
        const artifact: SchemaProArtifact = { type: 'schema_pro', content: schemaProContent }
        const next: Partial<SessionState> = {
          ...state,
          lastTask: 'schema', lastAction: 'schema' as PedagogicalAction,
          tutorPhase: 'lesson', tokens: (state.tokens ?? 0) + 1, courseActive: true,
        }
        return ok({ message: schemaProContent.title + ':', artifact, state: next })
      }
    } catch { /* fall through */ }
  }

  if (isTableRequest(text)) {
    console.log('[ROUTER] fast-path=table (audio)')
    try {
      const tableContent = await generateTableContent(text, state)
      if (tableContent) {
        const artifact: TableArtifact = { type: 'table', content: tableContent }
        const next: Partial<SessionState> = {
          ...state,
          lastTask: 'schema', lastAction: 'schema' as PedagogicalAction,
          tutorPhase: 'lesson', tokens: (state.tokens ?? 0) + 1, courseActive: true,
        }
        return ok({ message: tableContent.title ?? 'Tabla lista:', artifact, state: next })
      }
    } catch { /* fall through */ }
  }

  if (isQuizRequest(text)) {
    console.log('[ROUTER] fast-path=quiz (audio)')
    try {
      const quizArtifact = await generateQuizContent(text, state)
      const next: Partial<SessionState> = {
        ...state,
        lastAction: 'feedback' as PedagogicalAction, lastTask: 'feedback',
        tutorPhase: 'feedback', awaitingQuizAnswer: false,
        tokens: (state.tokens ?? 0) + 1,
      }
      if (quizArtifact) {
        return ok({ message: quizArtifact.content.title + ':', artifact: quizArtifact, state: next })
      }
    } catch { /* fall through */ }
  }

  if (isLevelRequest(text)) {
    console.log('[ROUTER] fast-path=level (audio)')
    const report = evaluateLevel(state.samples ?? [])
    return ok({ message: '', diagnostic: report, state })
  }

  return null  // no fast-path matched — caller proceeds to normal flow
}

// ─── STRUCTURED_COURSE_DIRECTIVE ─────────────────
// Mode 2: guided Cervantes-based course sequence.
// One action per message. Tutor drives. User follows.
const STRUCTURED_COURSE_DIRECTIVE = `You are executing a guided Spanish course session (LINGORA Structured Mode).

CURRENT SEQUENCE (follow strictly, one step per message):
1. SCHEMA — Produce a complete structured schema for the topic. Include: main rule, 80/20 key, conjugation/vocabulary table, common errors, examples.
2. EXAMPLES — Give 3 guided examples using the student's real context (profession, origin, goals). Ask student to produce one example themselves.
3. QUIZ — Generate a DELE/CCSE format quiz: 1 reading comprehension text + 3 multiple choice questions. Real exam format.
4. SCORE — After student answers, give: score (X/3), specific corrections, one-sentence reinforcement.
5. NEXT — Ask: "Ready for the next block?" and briefly name the next topic.

RULES:
- ONE step per message. Never combine steps.
- Adapt all examples to the student's actual level and professional context.
- Use the student's interface language for instructions.
- Spanish for examples and exercises.
- Never explain what you are going to do. Just do it.`

// ─── PDF_COURSE_DIRECTIVE ─────────────────────────
// Mode 3: course material generation + submission evaluation.
const PDF_COURSE_DIRECTIVE = `You are generating a formal Spanish course module (LINGORA PDF Course Mode).

When generating course content:
- Produce complete theory: explanation, 80/20 rule, full table
- Include 4-6 exercises: fill-in, multiple choice, production
- Add submission instructions: "Write your answers and send them as a message or file"
- Structure: ## Title / ### Theory / ### Exercises / ### Submission instructions

When evaluating a student submission:
- Read carefully what they sent
- Give score (X/total)
- List specific corrections with explanation
- Give one encouragement sentence
- Say: "Module complete. Ready for the next one?"

RULES:
- If PDF download is not available, deliver full content in chat
- Never simulate a PDF that cannot be downloaded
- Be honest about technical limitations`

// ─── FREE_CONVERSATION_DIRECTIVE ─────────────────
// Mode 4: natural conversation, opportunistic correction.
const FREE_CONVERSATION_DIRECTIVE = `You are having a natural Spanish conversation with the student (LINGORA Free Mode).

RULES:
- Respond naturally. No forced structure.
- Correct errors only when they are clear and recurring — weave correction into the conversation, do not interrupt
- Introduce useful vocabulary or structures naturally when relevant
- If the student asks a question, answer it fully
- Insert a table or schema only when it clearly helps the current topic
- Never force a learning sequence
- Match the student's energy and pace`


function buildAutoSchemaPrompt(state: Partial<SessionState>): string {
  const topic   = state.topic    ?? 'conversación'
  const level   = state.level    ?? 'A1'
  const samples = state.samples  ?? []
  const recent  = samples.slice(-3).join(' ').slice(0, 200)
  return `[SISTEMA: SCHEMA PEDAGÓGICO AUTOMÁTICO — NO MOSTRAR AL USUARIO]
Genera un esquema de refuerzo compacto para: tema="${topic}", nivel=${level}.
${recent.length > 20 ? `Contexto reciente del estudiante: "${recent}".` : ''}
El esquema debe reforzar el concepto gramatical o vocabulario más relevante del contexto.
No debe repetir literalmente lo último discutido.`
}

// ─── GET — Health ─────────────────────────────────
export async function GET() {
  const rag = await getRagStats().catch(() => ({}))
  return NextResponse.json({
    status:    'healthy',
    version:   'v10.2',
    system:    'LINGORA',
    platform:  'vercel-nextjs',
    timestamp: new Date().toISOString(),
    rag,
    tutorProtocol: 'v1.1',
    environment: {
      openAIConfigured:  Boolean(process.env.OPENAI_API_KEY),
      storageConfigured: Boolean(process.env.S3_BUCKET),
      awsConfigured:     Boolean(process.env.AWS_ACCESS_KEY_ID),
      ttsEnabled:        process.env.LINGORA_TTS_ENABLED === 'true' || Boolean(process.env.OPENAI_API_KEY),
    },
  })
}

// ─── POST ────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body: MessagePayload = await req.json()
    const {
      message, state = {} as Partial<SessionState>,
      audio, files,
      diagnostic = false, samples = [],
      autoSchema   = false,
      ttsRequested = false, pronunciationTarget = null,
    } = body

    // Resolve mode and enrich state for this request
    const tutorMode     = state.activeMode
      ? modeToTutorMode(state.activeMode as 'interact'|'structured'|'pdf_course'|'free', state.topic ?? null, state.mentor ?? null)
      : resolveTutorMode(state.topic ?? null, state.mentor ?? null)
    const enrichedState: Partial<SessionState> = { ...state, tutorMode }

    // ── M. Mode-aware routing setup ──────────────
    // Read activeMode from state, select appropriate directive.
    // Roadmap: if this is the very first chat message (tokens=0) in a mode,
    // return roadmap response immediately before any other processing.
    const activeMode = enrichedState.activeMode ?? 'interact'

    // Select system directive based on active mode
    function getModeDirective(): string {
      switch (activeMode) {
        case 'structured':  return STRUCTURED_COURSE_DIRECTIVE
        case 'pdf_course':  return PDF_COURSE_DIRECTIVE
        case 'free':        return FREE_CONVERSATION_DIRECTIVE
        default:            return RICH_CONTENT_DIRECTIVE  // 'interact'
      }
    }

    // Roadmap: first message in structured/pdf_course mode
    // Triggered when tokens=0 and activeMode is a guided mode
    // Roadmap fires when: (a) first message in session, OR (b) explicit mode-start signal
    // Using tokens===0 as primary signal + explicit flag as fallback
    const isFirstMessage = (enrichedState.tokens ?? 0) === 0 || enrichedState.learningStage === undefined
    const isGuidedMode   = activeMode === 'structured' || activeMode === 'pdf_course'

    if (isFirstMessage && isGuidedMode && message && message.trim().length > 0) {
      const mentor = enrichedState.mentor ?? 'sarah'
      const topic  = enrichedState.topic  ?? 'español general'
      const level  = enrichedState.level  ?? 'A1'
      const lang   = enrichedState.lang   ?? 'en'

      const roadmapPrompt = activeMode === 'structured'
        ? `The student has chosen: mentor=${mentor}, topic=${topic}, level=${level}, mode=Structured Course.
Generate a concise roadmap message in the student's language (${lang}).
Format exactly:
"Has elegido [mentor] · [topic] · [level] · Curso estructurado.

Ruta de hoy:
1. Esquema completo del tema
2. Ejemplos guiados con tu contexto
3. Simulacro formato DELE/CCSE
4. Puntuación y siguiente bloque

Empezamos. [Ask: what specific aspect of the topic do you want to cover first, OR propose one if the topic is specific enough]"
Respond in ${lang}. Keep it under 120 words. No preamble.`
        : `The student has chosen: mentor=${mentor}, topic=${topic}, level=${level}, mode=PDF Course.
Generate a concise roadmap in the student's language (${lang}).
Format:
"Has elegido [mentor] · [topic] · [level] · Curso PDF.

Cómo funciona:
1. Te envío el módulo completo con teoría y ejercicios
2. Haces los ejercicios y me los devuelves
3. Los corrijo y te doy tu puntuación
4. Pasamos al siguiente módulo

[Ask: ready to receive Module 1?]"
Respond in ${lang}. Under 120 words. No preamble.`

      try {
        const roadmapText = await getMentorResponse(roadmapPrompt, enrichedState)
        const roadmapNextState: Partial<SessionState> = {
          ...enrichedState,
          tokens:        1,
          learningStage: 'schema',
          currentModule: 1,
          courseActive:  true,
          // Seed protocol so next turn enters at schema, not guide.
          // derivePhase() reads lastAction — 'guide' maps to TutorPhase 'guide'.
          // advancePhase('guide', 'structured', 1) → next in SEQUENCE = 'lesson'.
          // 'lesson' in pdf_course/structured triggers the module content path.
          lastAction:  'guide' as PedagogicalAction,
          tutorPhase:  'guide',
        }
        const roadmapArtifact: RoadmapBlock = {
          type:    'roadmap',
          content: {
            mode:   activeMode as 'interact' | 'structured' | 'pdf_course' | 'free',
            mentor: enrichedState.mentor ?? 'sarah',
            topic:  enrichedState.topic ?? 'español',
            level:  enrichedState.level ?? 'A1',
            steps:  activeMode === 'structured'
              ? ['Esquema completo', 'Ejemplos guiados', 'Simulacro DELE/CCSE', 'Puntuación', 'Siguiente bloque']
              : ['Teoría + ejercicios', 'Entrega por adjunto', 'Corrección y puntuación', 'Siguiente módulo'],
            first: activeMode === 'structured' ? 'Empezamos con el esquema completo.' : 'Generando el primer módulo PDF.',
          },
        }
        return ok({ message: roadmapText ?? '', artifact: roadmapArtifact as unknown as ArtifactPayload, state: roadmapNextState })
      } catch { /* fall through to normal flow */ }
    }

    // ── 0. Diagnostic trigger ─────────────────────
    if ((message ?? '').trim() === '*1357*#') {
      const ragStats = await getRagStats().catch(() => ({ error: 'unavailable' }))
      return ok({
        message: 'LINGORA v10.2 · Diagnostico activo',
        diagnostic: {
          system: 'LINGORA', version: 'v10.2', tutorProtocol: 'v1.1',
          platform: 'vercel-nextjs', status: 'operational',
          timestamp: new Date().toISOString(),
          modules: { schema: true, image: true, audio: true, tts: true,
                     pronunciation: true, rag: true, commercial: true,
                     quiz: true, tutorProtocol: true, autoSchema: true },
          environment: {
            openAIConfigured:  Boolean(process.env.OPENAI_API_KEY),
            storageConfigured: Boolean(process.env.S3_BUCKET),
            awsConfigured:     Boolean(process.env.AWS_ACCESS_KEY_ID),
            ttsEnabled:        process.env.LINGORA_TTS_ENABLED === 'true' || Boolean(process.env.OPENAI_API_KEY),
          },
          state: {
            activeMentor:       state.mentor       ?? 'unknown',
            level:              state.level        ?? 'A0',
            tokens:             state.tokens       ?? 0,
            tutorMode,
            tutorPhase:         state.tutorPhase   ?? 'idle',
            lessonIndex:        state.lessonIndex  ?? 0,
            courseActive:       state.courseActive ?? false,
            lastAction:         state.lastAction   ?? null,
            awaitingQuizAnswer: state.awaitingQuizAnswer ?? false,
          },
          rag: ragStats,
          commercial: commercialDebug(enrichedState),
        },
      })
    }

    // ── 1. Level diagnostic ───────────────────────
    if (diagnostic) {
      const report = evaluateLevel(samples.length ? samples : (state.samples ?? []))
      return ok({ message: '', diagnostic: report, state: enrichedState })
    }

    // ── 2. Auto-schema (milestone reinforcement) ──
    if (autoSchema) {
      const tokenCount  = state.tokens ?? 0
      const sampleCount = (state.samples ?? []).length
      if (tokenCount < 4 || sampleCount < 2) {
        return ok({ message: '', artifact: null, state: enrichedState })
      }
      try {
        const schemaContent = await generateSchemaContent({
          topic:      buildAutoSchemaPrompt(enrichedState),
          level:      enrichedState.level  ?? 'A1',
          uiLanguage: enrichedState.lang   ?? 'en',
        })
        if (!schemaContent?.title) return ok({ message: '', artifact: null, state: enrichedState })
        const nextState: Partial<SessionState> = {
          ...enrichedState,
          lastTask:    'schema',    // keep legacy in sync
          lastAction:  'schema',
          lastArtifact: `schema:${schemaContent.title}`,
        }
        return ok({
          message:  'Refuerzo pedagógico listo:',
          artifact: { type: 'schema', content: schemaContent, metadata: { timestamp: Date.now(), auto: true } },
          state:    nextState,
        })
      } catch {
        return ok({ message: '', artifact: null, state: enrichedState })
      }
    }

    // ── 3. Audio ──────────────────────────────────
    if (audio) {
      const tx = await transcribeAudio(audio)
      if (!tx.success) {
        return ok({ message: `No se pudo transcribir el audio: ${tx.message ?? 'error desconocido'}`, state: enrichedState })
      }
      const transcribed = tx.text

      // ── SEEK fix: run fast-paths on transcribed text ──────────
      // Spoken intent must be respected identically to typed intent.
      const audioFastPath = await runFastPaths(transcribed, enrichedState)
      if (audioFastPath) return audioFastPath

      // ── PRONUNCIATION EVALUATION MODE ─────────────────────────
      // Only activates when:
      //   A) frontend explicitly sends pronunciationTarget (user in guided practice)
      //   B) user explicitly asked to be evaluated in the transcribed text
      // Does NOT activate on normal conversation audio — prevents mode hijacking.
      const explicitEvalKeywords = [
        'pronuncia', 'pronunciación', 'pronunciacion',
        'califica mi', 'evalúa mi', 'evalua mi',
        'cómo sueno', 'como sueno', 'corrige mi pronunciación', 'corrige mi pronunciacion',
        'score my pronunciation', 'rate my pronunciation',
      ]
      const userAskedForEval = explicitEvalKeywords.some(
        p => transcribed.toLowerCase().includes(p)
      )

      if (pronunciationTarget !== null || userAskedForEval) {
        try {
          // Determine evaluation target
          let evalTarget = pronunciationTarget

          if (!evalTarget && transcribed.trim().length > 3) {
            // Auto-mode: GPT generates ideal Spanish version of what was said
            const idealRes = await openai.chat.completions.create({
              model:       'gpt-4o',
              messages:    [{ role: 'user', content: `A Spanish learner said: "${transcribed}"
Write the grammatically correct and naturally fluent Spanish version.
Return ONLY the corrected sentence. No explanation. No quotes.` }],
              temperature: 0.1,
              max_tokens:  80,
            }).catch(() => null)
            evalTarget = idealRes?.choices?.[0]?.message?.content?.trim() ?? transcribed
          }

          const evalResult = await evaluatePronunciation(
            transcribed, evalTarget ?? transcribed, state.lang
          )

          if (evalResult.success) {
            // Parse multiline feedbackText → PronunciationReport fields
            const lines        = (evalResult.feedbackText ?? '').split('\n')
            const feedbackLine = lines.find(l => l.startsWith('FEEDBACK:'))?.replace('FEEDBACK:', '').trim() ?? ''
            const tipLine      = lines.find(l => l.startsWith('TIP:'))?.replace('TIP:', '').trim() ?? ''
            const errorsLine   = lines.find(l => l.startsWith('ERRORS:'))?.replace('ERRORS:', '').trim() ?? ''
            const feedbackFull = [feedbackLine, errorsLine && errorsLine !== 'Ninguno detectado' ? errorsLine : ''].filter(Boolean).join(' — ')

            // PronunciationReport goes inside artifact.content — matches frontend renderer
            const pronContent = {
              target:      evalTarget ?? undefined,
              transcribed,
              score:       evalResult.score ?? 0,
              feedback:    feedbackFull || (evalResult.feedbackText ?? ''),
              correction:  tipLine || undefined,
            }
            const pronArtifact: ArtifactPayload = {
              type:    'pronunciation_report',
              content: pronContent,
            } as unknown as ArtifactPayload

            const pronNextState: Partial<SessionState> = {
              ...enrichedState,
              tokens: (enrichedState.tokens ?? 0) + 1,
            }

            return ok({
              message:            '',
              transcription:      transcribed,
              pronunciationScore: evalResult.score ?? undefined,
              artifact:           pronArtifact,
              state:              pronNextState,
            })
          }
          // evaluatePronunciation returned failure — fall through to conversation mode
        } catch {
          // Evaluation threw — fall through to conversation mode
        }
      }

      // ── CONVERSATION MODE ──────────────────────────────────────
      // Normal audio: transcribe → mentor → TTS response
      const {
        action: audioAction,
        systemDirective: audioDirective,
        nextPhase: audioPhase,
        nextLessonIndex: audioLesson,
        nextCourseActive: audioCourse,
      } = resolvePedagogicalAction({ message: transcribed, state: enrichedState, explicit: null })

      const mentorText   = await getMentorResponse(transcribed, enrichedState, audioDirective).catch(() => null)
      const responseText = mentorText ?? `🎤 "${transcribed}"`

      let audioNextState: Partial<SessionState> = {
        ...enrichedState,
        tutorPhase:    audioPhase,
        lastAction:    audioAction,
        lastTask:      audioAction,
        lessonIndex:   audioLesson,
        courseActive:  audioCourse,
        tokens:        (enrichedState.tokens ?? 0) + 1,
        samples:       [...(enrichedState.samples ?? []), transcribed],
      }

      const wantsTts = ttsRequested ||
                       process.env.LINGORA_TTS_ENABLED === 'true' ||
                       Boolean(process.env.OPENAI_API_KEY)
      let ttsArt: ArtifactPayload | null = null
      if (wantsTts && mentorText) {
        const tts = await generateSpeech(mentorText, { voice: 'nova' })
        if (tts.success && tts.url) ttsArt = audioArtifact(tts.url)
      }
      return ok({ message: responseText, transcription: transcribed, artifact: ttsArt, state: audioNextState })
    }

    // ── 3b. PDF Course submission intercept ─────────
    // When activeMode is pdf_course and files are present,
    // treat as student submission. Extract file content first, then evaluate.
    if (activeMode === 'pdf_course' && files?.length) {
      const moduleNum = enrichedState.currentModule ?? 1
      try {
        // Extract readable content from the submitted files
        const submissionTexts: string[] = []
        for (const f of files) {
          if (f.data) {
            if (f.type?.startsWith('text/') || f.type?.includes('json')) {
              // Decode base64 text directly
              const decoded = Buffer.from(f.data, 'base64').toString('utf-8').slice(0, 2000)
              submissionTexts.push(`[${f.name}]: ${decoded}`)
            } else if (f.type?.startsWith('image/')) {
              // Image: use vision to extract text/content
              const visionRes = await openai.chat.completions.create({
                model: 'gpt-4o', max_tokens: 400,
                messages: [{ role: 'user', content: [
                  { type: 'text', text: 'This is a student exercise submission. Extract all written text and answers you can see. Return only the content, no commentary.' },
                  { type: 'image_url', image_url: { url: `data:${f.type};base64,${f.data}`, detail: 'auto' } },
                ]}],
              }).catch(() => null)
              const extracted = visionRes?.choices?.[0]?.message?.content ?? ''
              if (extracted) submissionTexts.push(`[${f.name} — extracted]: ${extracted}`)
            }
          }
        }
        const submissionContent = submissionTexts.join('\n\n') || (message ?? 'Sin contenido legible')
        const evalPrompt = `Eres el tutor de LINGORA evaluando la entrega del estudiante para el módulo ${moduleNum}.
Contenido entregado:
${submissionContent}
${message ? `Comentario del estudiante: "${message}"` : ''}

Evalúa con estas secciones exactas:
1. PUNTUACIÓN: X/10 (basada en corrección, completitud y calidad)
2. CORRECCIONES: lista los errores específicos (máximo 5)
3. FEEDBACK: observación principal de refuerzo (1-2 frases)
4. SIGUIENTE: pregunta si está listo para el módulo ${moduleNum + 1}

Sé específico. Corrige errores reales. No improvises si el contenido no es legible.`

        const evalText = await getMentorResponse(evalPrompt, enrichedState, PDF_COURSE_DIRECTIVE)

        // Parse score from response (look for "X/10" pattern)
        const scoreMatch = (evalText ?? '').match(/(\d+)\s*\/\s*10/)
        const parsedScore = scoreMatch ? parseInt(scoreMatch[1]) : null

        const feedbackContent = {
          score:          parsedScore ?? 0,
          corrections:    [],  // parsed from evalText by frontend if needed
          feedback:       evalText ?? '',
          nextAssignment: `Módulo ${moduleNum + 1}`,
        }
        const subArtifact: SubmissionFeedback = { type: 'submission_feedback', content: feedbackContent }
        const subNextState: Partial<SessionState> = {
          ...enrichedState,
          currentModule:  moduleNum + 1,
          learningStage:  'schema',
          tokens:         (enrichedState.tokens ?? 0) + 1,
        }
        return ok({ message: '', artifact: subArtifact as unknown as ArtifactPayload, state: subNextState })
      } catch { /* fall through to generic file handler */ }
    }

    // ── 4. File upload ────────────────────────────
    if (files?.length) {
      // Vision fast-path: if the first file is an image, use OpenAI vision directly
      const firstFile = files[0]
      const isImage   = firstFile?.type?.startsWith('image/')

      if (isImage && firstFile.data) {
        console.log('[ROUTER] intent=vision file=' + firstFile.name)
        try {
          const userText  = (message ?? '').trim()
          const prompt    = userText
            ? userText
            : 'Analyze this image in the context of Spanish language learning. Describe what you see, identify any Spanish text or educational content, and provide relevant pedagogical feedback.'

          const visionRes = await openai.chat.completions.create({
            model:      'gpt-4o',
            max_tokens: 800,
            messages:   [{
              role:    'user',
              content: [
                { type: 'text',      text: prompt },
                { type: 'image_url', image_url: { url: `data:${firstFile.type};base64,${firstFile.data}`, detail: 'auto' } },
              ],
            }],
          })

          const visionText = visionRes.choices?.[0]?.message?.content ?? ''
          const nextState: Partial<SessionState> = {
            ...enrichedState,
            lastTask:   'vision',
            lastAction: 'conversation' as PedagogicalAction,
            tokens:     (enrichedState.tokens ?? 0) + 1,
          }
          return ok({ message: visionText || 'He analizado la imagen.', state: nextState })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[ROUTER] vision error:', msg)
          // Fall through to normal attachment processing
        }
      }
      try {
        const result    = await processAttachment(files, enrichedState as Record<string, unknown>)
        const extracted = (result.extractedTexts ?? []).filter(Boolean)
        let analysisMessage = `Archivo recibido: ${result.names.join(', ')}`

        if (extracted.length > 0) {
          const textContent = extracted.join('\n\n').slice(0, 2500)
          const isHonest    = textContent.includes('[OCR not available') ||
                              textContent.includes('[No text detected') ||
                              textContent.includes('[Unsupported file type')
          if (isHonest) {
            analysisMessage = `Archivo recibido: ${result.names.join(', ')}\n\n${textContent}`
          } else {
            const prompt = `El estudiante subió: ${result.names.join(', ')}.\n\nContenido:\n${textContent}\n\nAnaliza, corrige errores si los hay, y da feedback pedagógico concreto. Responde en el idioma del estudiante.`
            const analysis = await getMentorResponse(prompt, enrichedState).catch(() => null)
            analysisMessage = analysis ?? `Archivo recibido: ${result.names.join(', ')}\n\n${textContent.slice(0, 500)}`
          }
        }
        return ok({ message: analysisMessage, attachments: result.urls, extractedTexts: extracted, state: result.state as Partial<SessionState> })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: `No se pudo procesar el archivo: ${msg}`, state: enrichedState })
      }
    }

    // ── 5. Text — protocol-governed routing ───────
    const intent   = detectIntent(message ?? '')
    const explicit = intentToAction(intent.type)


    // ── 5-FAST. Table fast path ───────────────────
    // Bypass full protocol for simple table requests.
    // isTableRequest() runs BEFORE using intent result —
    // because detectIntent() has no 'table' type: 'tabla', 'compara', 'conjugación'
    // all return 'conversation', which would miss the fast-path entirely.
    // Checking isTableRequest() directly guarantees the fast-path fires correctly.
    const messageIsTable  = isTableRequest(message ?? '')
    const messageIsMatrix = isMatrixRequest(message ?? '')
    const messageIsSchemaPro = isSchemaProRequest(message ?? '')
    const messageIsQuiz   = isQuizRequest(message ?? '')
    const messageIsLevel  = isLevelRequest(message ?? '')

    // Precedence: matrix > schema_pro > table > quiz > level > protocol
    // ── 5-FAST-A. Matrix table ─────────────────────
    if (messageIsMatrix) {
      console.log('[ROUTER] fast-path=table_matrix')
      try {
        const matrixContent = await generateTableMatrix(message ?? '', enrichedState)
        if (matrixContent) {
          const artifact: TableMatrixArtifact = { type: 'table_matrix', content: matrixContent }
          const nextState: Partial<SessionState> = {
            ...enrichedState,
            lastTask: 'table', lastAction: 'schema' as PedagogicalAction,
            tutorPhase: 'lesson', tokens: (enrichedState.tokens ?? 0) + 1, courseActive: true,
          }
          return ok({ message: matrixContent.title ?? 'Matriz lista:', artifact, state: nextState })
        }
      } catch { /* fall through */ }
    }

    // ── 5-FAST-B. Schema Pro ────────────────────────
    if (messageIsSchemaPro) {
      console.log('[ROUTER] fast-path=schema_pro')
      try {
        const schemaProContent = await generateSchemaPro(message ?? '', enrichedState)
        if (schemaProContent) {
          const artifact: SchemaProArtifact = { type: 'schema_pro', content: schemaProContent }
          const nextState: Partial<SessionState> = {
            ...enrichedState,
            lastTask: 'schema', lastAction: 'schema' as PedagogicalAction,
            tutorPhase: 'lesson', tokens: (enrichedState.tokens ?? 0) + 1, courseActive: true,
          }
          return ok({ message: schemaProContent.title + ':', artifact, state: nextState })
        }
      } catch { /* fall through */ }
    }

    // ── 5-FAST-C. Simple table ─────────────────────
    // Complex requests skip the capped generator and go to mentor with rich directive
    if (messageIsTable && !isComplexTableRequest(message ?? '')) {
      console.log('[ROUTER] fast-path=table')
      try {
        const tableContent = await generateTableContent(message ?? '', enrichedState)
        if (tableContent) {
          const tableArtifact: TableArtifact = { type: 'table', content: tableContent }
          const nextState: Partial<SessionState> = {
            ...enrichedState,
            lastTask:    'table',
            lastAction:  'schema',   // treat as schema for protocol continuity
            tutorPhase:  'lesson',
            tokens:      (enrichedState.tokens ?? 0) + 1,
            courseActive: true,
          }
          console.log(`[ROUTER] table ok title="${tableContent.title}"`)
          return ok({ message: tableContent.title ?? 'Tabla lista:', artifact: tableArtifact, state: nextState })
        }
        // If table generation failed, fall through to schema
        console.log('[ROUTER] table generation failed, falling through to schema')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[ROUTER] table error:', msg)
        // Fall through to full schema
      }
    }

    // ── 5-FAST-C2. Rich content (complex table/content requests) ──────
    // Routes to mentor with uncapped directive — produces DeepSeek-quality output.
    // Triggered when: multi-tense, errors requested, explanations, long input.
    const messageIsComplex = isComplexTableRequest(message ?? '') && isTableRequest(message ?? '')
    if (messageIsComplex) {
      console.log('[ROUTER] fast-path=rich-content')
      try {
        const richResponse = await getMentorResponse(message ?? '', enrichedState, RICH_CONTENT_DIRECTIVE)
        if (richResponse && richResponse.trim().length > 50) {
          const richNextState: Partial<SessionState> = {
            ...enrichedState,
            lastTask:   'lesson', lastAction: 'lesson' as PedagogicalAction,
            tutorPhase: 'lesson', tokens: (enrichedState.tokens ?? 0) + 1, courseActive: true,
          }
          return ok({ message: richResponse, artifact: null, state: richNextState })
        }
      } catch { /* fall through to protocol */ }
    }

    const {
      action, systemDirective, nextPhase,
      nextLessonIndex, nextCourseActive,
    } = resolvePedagogicalAction({ message: message ?? '', state: enrichedState, explicit })

    console.log(`[ROUTER] intent=${intent.type} action=${action} mode=${tutorMode} phase=${nextPhase} lesson=${nextLessonIndex} bypass=${canBypassTutorPhase(action)}`)

    // Base next state — always sync both lastTask (legacy) and lastAction
    let nextState: Partial<SessionState> = {
      ...enrichedState,
      tutorMode,
      tutorPhase:    nextPhase,
      lastAction:    action,
      lastTask:      action,   // keep legacy field in sync during transition
      lessonIndex:   nextLessonIndex,
      courseActive:  nextCourseActive,
      activeMode,              // preserve mode across all turns
    }
    // ── 5-FAST-D. Explicit quiz override ──────────
    // User explicitly asked for quiz/simulacro — override protocol phase
    if (messageIsQuiz) {
      console.log('[ROUTER] explicit-quiz-override')
      // Route directly to quiz branch by setting action
      const quizArtifact = await generateQuizContent(message ?? '', nextState)
      nextState = {
        ...nextState,
        lastAction: 'feedback' as PedagogicalAction, lastTask: 'feedback',
        tutorPhase: 'feedback', awaitingQuizAnswer: false,
        tokens: (nextState.tokens ?? 0) + 1,
      }
      if (quizArtifact) {
        return ok({ message: quizArtifact.content.title + ':', artifact: quizArtifact, state: nextState })
      }
    }

    // ── 5-FAST-E. Level assessment override ───────
    if (messageIsLevel) {
      console.log('[ROUTER] explicit-level-assessment')
      const report = evaluateLevel(enrichedState.samples ?? [])
      return ok({ message: '', diagnostic: report, state: enrichedState })
    }


    // ── 5a. Pronunciation ─────────────────────────
    // Text-only path: user typed about pronunciation but sent no audio.
    // Cannot evaluate without audio — give clear, actionable instruction.
    if (action === 'pronunciation') {
      try {
        const lang = enrichedState.lang ?? 'en'
        const prompts: Record<string, string> = {
          es: 'Para evaluar tu pronunciación necesito escucharte. Usa el micrófono y graba una frase en español — por ejemplo "Me llamo Sarah y vivo en Oslo." Después te doy tu puntuación y feedback concreto.',
          en: 'To evaluate your pronunciation I need to hear you. Use the microphone and record a phrase in Spanish — for example "Me llamo Sarah y vivo en Oslo." Then I\'ll give you your score and specific feedback.',
          no: 'For å evaluere uttalen din må jeg høre deg. Bruk mikrofonen og ta opp en setning på spansk — for eksempel "Me llamo Sarah y vivo en Oslo." Så gir jeg deg poengsum og konkret tilbakemelding.',
        }
        const guidanceText = prompts[lang] ?? prompts.en

        nextState = { ...nextState, tokens: (nextState.tokens ?? 0) + 1 }
        const tts = await generateSpeech(guidanceText, { voice: 'nova', speed: 0.9 })
        return ok({
          message:      guidanceText,
          artifact:     tts.success && tts.url ? audioArtifact(tts.url) : null,
          ttsAvailable: tts.success,
          state:        nextState,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: `No se pudo procesar: ${msg}`, state: nextState })
      }
    }

    // ── 5b. Schema ────────────────────────────────
    if (action === 'schema') {
      try {
        const schemaContent = await generateSchemaContent({
          topic:      message ?? '',
          level:      nextState.level     ?? 'A1',
          uiLanguage: nextState.lang      ?? 'en',
        })
        if (!schemaContent?.title) throw new Error('Invalid schema structure')
        nextState = { ...nextState, tokens: (nextState.tokens ?? 0) + 10, lastArtifact: `schema:${schemaContent.title}` }
        return ok({
          message:  'Schema listo:',
          artifact: { type: 'schema', content: schemaContent, metadata: { timestamp: Date.now() } },
          state:    nextState,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: `No se pudo generar el schema: ${msg}`, artifact: null, state: nextState })
      }
    }

    // ── 5c. Illustration ──────────────────────────
    if (action === 'illustration') {
      try {
        const image = await generateImage(message ?? '')
        if (image.success && image.url) {
          nextState = { ...nextState, lastArtifact: 'illustration' }
          return ok({ message: 'Imagen lista:', artifact: { type: 'illustration', url: image.url }, state: nextState })
        }
        return ok({ message: `No se pudo generar la imagen: ${image.message ?? 'error desconocido'}`, artifact: null, state: nextState })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: `Error de imagen: ${msg}`, artifact: null, state: nextState })
      }
    }

    // ── 5d. PDF ───────────────────────────────────
    if (action === 'pdf') {
      try {
        const contentRes = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'Genera contenido educativo estructurado en español. Primera línea = título. Secciones separadas por línea en blanco. Máximo 600 palabras. Sin markdown.' },
            { role: 'user',   content: message ?? '' },
          ],
          temperature: 0.4, max_tokens: 800,
        })
        const pdfContent = contentRes.choices?.[0]?.message?.content ?? message ?? ''
        const titleLine  = pdfContent.split('\n')[0].slice(0, 80).trim()
        const pdf = await generatePDF({ title: titleLine || 'Material LINGORA', content: pdfContent, filename: `lingora-${Date.now()}` })
        if (pdf.success && pdf.url) {
          nextState = { ...nextState, lastArtifact: `pdf:${titleLine}` }
          return ok({ message: 'PDF listo:', artifact: { type: 'pdf', url: pdf.url }, state: nextState })
        }
        return ok({ message: `No se pudo generar el PDF: ${pdf.message ?? 'error desconocido'}`, artifact: null, state: nextState })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: `Error de PDF: ${msg}`, artifact: null, state: nextState })
      }
    }

    // ── 5e. QUIZ — explicit branch ────────────────
    // Returns a QuizArtifact. Sets awaitingQuizAnswer = true.
    if (action === 'quiz') {
      try {
        // Generate structured quiz — JSON-coercive, correct answer is real index
        // Philosophy: autocorrection in frontend (immediate feedback, self-scoring)
        // awaitingQuizAnswer = false — quiz is standalone, protocol advances normally
        const quizArtifact = await generateQuizContent(message ?? '', nextState)

        nextState = {
          ...nextState,
          // Option A: autocorrected quiz counts as feedback-complete.
          // lastAction='feedback' tells the protocol the quiz cycle is closed.
          // Next turn: advancePhase('feedback') → skips guide → goes to 'lesson'.
          // awaitingQuizAnswer=false because frontend shows correct answer immediately.
          lastAction:         'feedback' as PedagogicalAction,
          lastTask:           'feedback',
          tutorPhase:         'feedback',
          awaitingQuizAnswer: false,
          tokens:             (nextState.tokens ?? 0) + 1,
        }

        if (quizArtifact) {
          return ok({
            message:  quizArtifact.content.title + ':',
            artifact: quizArtifact,
            state:    nextState,
          })
        }

        // Fallback: generateQuizContent failed — ask mentor for a quiz question as text
        const fallbackText = await getMentorResponse(
          message ?? '', nextState, systemDirective
        ).catch(() => null)
        return ok({ message: fallbackText ?? 'Pregunta de práctica:', artifact: null, state: nextState })

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: `Error al generar el quiz: ${msg}`, state: nextState })
      }
    }

    // ── 5f. FEEDBACK — explicit branch ───────────
    // Clears awaitingQuizAnswer, advances lesson.
    if (action === 'feedback') {
      const feedbackText = await getMentorResponse(message ?? '', nextState, systemDirective)
      nextState = { ...nextState, awaitingQuizAnswer: false, tokens: (nextState.tokens ?? 0) + 1 }
      return ok({ message: feedbackText ?? '', artifact: null, state: nextState })
    }

    // ── 5g. GUIDE — explicit branch ───────────────
    // First interaction on topic. Mentor uses guide directive.
    if (action === 'guide') {
      const guideText = await getMentorResponse(message ?? '', nextState, systemDirective)
      nextState = { ...nextState, tokens: (nextState.tokens ?? 0) + 1 }
      return ok({ message: guideText ?? '', artifact: null, state: nextState })
    }

    // ── 5h. LESSON — explicit branch ──────────────
    if (action === 'lesson') {
      // pdf_course mode: generate PdfAssignment instead of plain lesson
      // Integrated here so action=lesson cannot skip this in pdf_course mode
      if (activeMode === 'pdf_course') {
        const moduleNum = enrichedState.currentModule ?? 1
        try {
          const moduleContent = await getMentorResponse(
            message ?? `Genera el modulo ${moduleNum} del curso PDF. Teoria completa, tabla de vocabulario o conjugacion, 4-6 ejercicios con instrucciones de entrega.`,
            enrichedState, PDF_COURSE_DIRECTIVE
          )
          const pdfArt: PdfAssignment = {
            type: 'pdf_assignment',
            content: {
              title:        `Modulo ${moduleNum}`,
              instructions: 'Realiza los ejercicios y envialos como mensaje o archivo adjunto.',
              exercises:    [],
            },
          }
          nextState = { ...nextState, pdfCourseActive: true, currentModule: moduleNum, learningStage: 'schema', tokens: (nextState.tokens ?? 0) + 1 }
          return ok({ message: moduleContent ?? '', artifact: pdfArt as unknown as ArtifactPayload, state: nextState })
        } catch { /* fall through to normal lesson on error */ }
      }

      let ragContext = null
      try { ragContext = await getRagContext(message ?? '') } catch { /* non-critical */ }
      const msg = ragContext
        ? `${message}\n\n[Contexto de referencia — integrar naturalmente:]\n${ragContext.text}`
        : (message ?? '')
      const lessonText = await getMentorResponse(msg, nextState, activeMode === 'structured' ? STRUCTURED_COURSE_DIRECTIVE : activeMode === 'pdf_course' ? PDF_COURSE_DIRECTIVE : systemDirective)
      const lessonStage = (activeMode === 'structured' || activeMode === 'pdf_course') && enrichedState.learningStage
        ? nextStage(enrichedState.learningStage as 'diagnosis'|'schema'|'examples'|'quiz'|'score'|'next')
        : enrichedState.learningStage
      nextState = { ...nextState, tokens: (nextState.tokens ?? 0) + 1, ...(lessonStage ? { learningStage: lessonStage } : {}) }
      return ok({ message: lessonText ?? '', artifact: null, state: nextState })
    }



    // ── 5i. CONVERSATION (default + free practice) ─
    // Also handles cases where protocol resolves to conversation mode
    // In guided modes, override the system directive with mode-specific one
    const modeDirective = getModeDirective()
    const effectiveDirective = (activeMode !== 'interact' && modeDirective !== RICH_CONTENT_DIRECTIVE)
      ? modeDirective
      : systemDirective

    let ragContext = null
    try { ragContext = await getRagContext(message ?? '') } catch { /* non-critical */ }

    const msgWithContext = ragContext
      ? `${message}\n\n[Contexto de referencia — integrar naturalmente, no citar literalmente:]\n${ragContext.text}`
      : (message ?? '')

    // Humanization: 1.2s pause on first message — tutor feels present, not instant-bot
    if ((enrichedState.tokens ?? 0) <= 1) {
      await new Promise(r => setTimeout(r, 1200))
    }

    const mentorResponse = await getMentorResponse(msgWithContext, nextState, effectiveDirective)
    let finalResponse    = (mentorResponse ?? '').trim() || 'How can I help you?'

    // Commercial engine — non-critical
    try {
      const commercial = commercialEngine(message ?? '', nextState)
      if (commercial.trigger) finalResponse += `\n\n${commercial.trigger.message}`
      if (commercial.state)   nextState = { ...nextState, ...commercial.state }
    } catch { /* non-critical */ }

    // Optional TTS — enabled by env var, request flag, or by default if OPENAI is configured
    // generateSpeech() already falls back to data:audio/mpeg;base64 when S3 is unavailable
    const wantsTts = ttsRequested ||
                     process.env.LINGORA_TTS_ENABLED === 'true' ||
                     Boolean(process.env.OPENAI_API_KEY)
    let ttsArtifact: ArtifactPayload | null = null
    if (wantsTts && finalResponse) {
      const tts = await generateSpeech(finalResponse, { voice: 'nova' })
      if (tts.success && tts.url) ttsArtifact = audioArtifact(tts.url)
    }

    // Token increment: route is the authoritative source.
    // page.tsx must NOT increment tokens — it should reflect state.tokens from response.
    // In structured/pdf mode: advance learningStage after each interaction
    const advancedStage = (activeMode === 'structured' || activeMode === 'pdf_course') && enrichedState.learningStage
      ? nextStage(enrichedState.learningStage as Parameters<typeof nextStage>[0])
      : enrichedState.learningStage
    nextState = {
      ...nextState,
      tokens: (nextState.tokens ?? 0) + 1,
      ...(advancedStage ? { learningStage: advancedStage } : {}),
    }

    return ok({ message: finalResponse, artifact: ttsArtifact, state: nextState })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CHAT ROUTE] Fatal:', msg)
    return ok({ message: 'Error interno. Por favor intenta de nuevo.', error: msg }, 500)
  }
}
