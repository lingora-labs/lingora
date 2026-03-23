// ================================================
// FILE: app/api/chat/route.ts
// LINGORA v10.2 — CHAT ROUTER
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
  CurriculumPlan, CurriculumModule, ModuleMastery, ErrorMemory, EngagementState, RequestedOperation,
  SuggestedAction, SuggestedActionType,
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
- EMOJI SEMANTICS (mandatory when applicable): ✅ correct/good, ❌ error/wrong, ⚠️ caution, 💡 note/tip, 🧠 rule, 🗣️ natural use, 📌 context, 🔁 contrast, 🎯 key focus
- if there is an "error" or "mistake" column: that column MUST use ❌ in header or cells
- if there is a "correct" or "corrección" column: use ✅
- if there is a "rule" or "regla" column: use 🧠
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
// Produces benchmark-quality output: multiple tables, full conjugations,
// errors, explanations — no row/column caps, no simplification.
const RICH_CONTENT_DIRECTIVE = `You are an elite Spanish language content generator.
LANGUAGE RULE: Always respond in the student's interface language for instructions and explanations. Use Spanish for examples, conjugations, and exercises. Do not switch languages arbitrarily.

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

  const prompt = `You are an expert Spanish language educational designer for LINGORA.
Student level: ${level}. Topic: ${topic}. Interface language: ${lang}.
Request: "${message}"

Return ONLY valid JSON. No markdown. No preamble.
Shape:
{
  "title": "schema title",
  "subtitle": "one line objective for this schema",
  "level": "${level}",
  "errors": ["Error frecuente 1: descripción", "Error frecuente 2: descripción"],
  "blocks": [
    {"type":"concept","title":"Objetivo general","body":"What the student will achieve — concrete, not vague"},
    {"type":"concept","title":"Core concept","body":"The essential explanation — dense, pedagogically correct"},
    {"type":"bullets","title":"Conceptos clave","items":["key rule 1","key rule 2","key rule 3"]},
    {"type":"flow","steps":["Step or rule 1","Step or rule 2","Step or rule 3"]},
    {"type":"comparison","left":"CASE A","right":"CASE B","label":"Criterio"},
    {"type":"table","columns":["Form","Example","Context"],"rows":[["form","example","context"]]},
    {"type":"highlight","text":"The single most important rule — the 80/20","tone":"ok","label":"CLAVE 80/20"},
    {"type":"highlight","text":"The most common error — what NOT to do","tone":"danger","label":"ERROR CRÍTICO"},
    {"type":"bullets","title":"Micro tarea","items":["Produce one sentence using this structure","Identify one error from the errores list"]}
  ]
}

MANDATORY RULES:
- Always include: objective concept, 80/20 highlight (tone:ok, green), error highlight (tone:danger, red), micro-task bullets
- errors[]: 2-4 specific, common student errors as descriptive strings
- Tone semantics: ok=key rules (green), danger=errors/risk (red), warn=exceptions (yellow), info=notes (blue), highlight=exam focus (purple)
- Schema must be a DENSE STUDY TOOL, not a light summary
- After delivering this schema, the natural next step is a simulacro — end with student readiness for practice
- Instructions in ${lang}. Spanish for examples and exercises.
- 6-10 blocks total`

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

// ── Detect explicit transcription request ────────────
function isTranscribeRequest(message: string): boolean {
  const m = message.toLowerCase()
  return [
    'transcribe', 'transcripción', 'transcribir', 'transcribe este',
    'qué dice', 'que dice', 'qué se dice', 'what does it say',
    'text from audio', 'texto del audio', 'escribe lo que',
    'pasar a texto', 'convertir a texto',
  ].some(p => m.includes(p))
}

// ── Detect explicit correction request ────────────────
function isCorrectionRequest(message: string): boolean {
  const m = message.toLowerCase()
  // Note: "corrige mi" is intentionally excluded — it captures "corrige mi pronunciación"
  // Pronunciation correction is handled by the audio/pronunciation pipeline
  return [
    'corrige esto', 'corrige este', 'corrígeme', 'corrige este texto',
    'correct this', 'fix this', 'hay errores en', 'hay algún error',
    'está bien escrito', 'revisa esto',
  ].some(p => m.includes(p))
}

// ── Detect explicit translation request ───────────────
function isTranslateRequest(message: string): boolean {
  const m = message.toLowerCase()
  return [
    'traduce', 'translate', 'cómo se dice', 'como se dice',
    'how do you say', 'qué significa', 'que significa', 'what does',
    'en español', 'in english', 'en inglés', 'in spanish',
  ].some(p => m.includes(p))
}

// ── Detect full course request → force structured mode ──────
// Strong course request — explicit full course intent
// These ALWAYS trigger the raw curriculum pipeline
function isStrongCourseRequest(message: string): boolean {
  const m = message.toLowerCase()
  return [
    'curso completo', 'full course', 'complete course',
    'enséñame desde cero', 'teach me from scratch',
    'hazme un curso', 'dame un curso',
    'build me a course', 'programa completo', 'complete program',
    'desde cero hasta', 'from scratch to',
    'curso estructurado', 'structured course',
  ].some(p => m.includes(p))
}

// Soft learning intent — user wants to learn something specific
// Does NOT trigger full curriculum pipeline; goes to lesson/conversation
function isSoftLearningIntent(message: string): boolean {
  const m = message.toLowerCase()
  return [
    'quiero aprender', 'want to learn',
    'enséñame', 'teach me', 'explícame', 'explain to me',
    'curso de', 'course on',
  ].some(p => m.includes(p)) && !isStrongCourseRequest(message)
}

// Combined — for backwards compat in existing guards
function isCourseRequest(message: string): boolean {
  return isStrongCourseRequest(message)
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
          tutorPhase: 'lesson', tokens: (state.tokens ?? 0) + 1, courseActive: true, lastArtifact: 'table_matrix',
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
          tutorPhase: 'lesson', tokens: (state.tokens ?? 0) + 1, courseActive: true, lastArtifact: 'schema_pro',
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
          tutorPhase: 'lesson', tokens: (state.tokens ?? 0) + 1, courseActive: true, lastArtifact: 'table',
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
LANGUAGE RULE: Always respond in the student's interface language for instructions and feedback. Spanish for examples and exercises only.

CORE MANDATE — READ FIRST:
You are NOT answering questions. You are CONSTRUCTING KNOWLEDGE.

Before teaching any topic:
1. Determine the full curriculum structure appropriate for the level
2. Organize it into logical modules with clear progression
3. Execute the teaching sequence step by step — schema → examples → practice → quiz → feedback

You MUST ALWAYS:
- Respect CEFR level progression (A0 → A1 → A2 → B1 → B2 → C1 → C2)
- Choose grammar, vocabulary, and communicative goals appropriate to the level
- Maintain internal curriculum consistency across turns — never repeat a module already covered
- If the student's level is unknown, infer it from their production and calibrate
- If curriculum plan is in context: follow it. If not: build one before teaching.
- If a topic request falls outside Spanish (acupuncture, law, finance, etc.): build the curriculum for that domain using the same pedagogical structure

CURRICULUM AUTONOMY:
If no curriculum guide exists for the requested topic or domain, build one first.
Structure: [Module 1: Foundation] → [Module 2: Core concepts] → ... → [Final module: Mastery validation]
Then execute that structure. Never improvise without structure.

COGNITIVE STRUCTURE — MANDATORY IN EVERY TEACHING RESPONSE:
Every substantive response must follow this sequence. No exceptions.
1. CONTEXT: Why does this matter? Real-world relevance in 1-2 sentences.
2. CONCEPT: The core idea — clear, non-academic, immediately graspable.
3. REAL EXAMPLE: A concrete example from work, daily life, or the student's domain.
4. TRANSFER: How does the student use this right now? Connect to their situation.
5. ACTION: One specific thing the student can do or produce immediately.
If a response can be read without needing the tutor, it has failed.
Definitions alone are forbidden. Tables alone are forbidden. Lists without application are forbidden.

DEPTH RULE — NON-NEGOTIABLE:
Superficial answers are forbidden. Depth is mandatory.
Always expand until the topic is FULLY OPERATIONAL for the student — not just understood conceptually, but usable in real situations.
If the concept has subtleties, exceptions, or common errors: cover them all. Do not summarize where detail is needed.

AUTO-ARTEFACT RULE:
If a visual schema, table, or comparison would improve retention at this moment: generate it. Do not wait to be asked.
Proactively insert visuals when explaining: conjugation patterns, grammar contrasts, vocabulary sets, error comparisons, logical sequences.
This is part of your teaching responsibility, not an option.

MASTERY GATE:
Before advancing to the next module, the student must demonstrate understanding.
Run a short verification: 1-2 targeted questions or a micro-production task.
If student score < 70%: stay in current module with targeted correction. Identify the specific error.
If student score >= 70%: brief positive reinforcement, then advance.
Never skip this gate in structured or pdf_course mode.`

// ─── PDF_COURSE_DIRECTIVE ─────────────────────────
// Mode 3: course material generation + submission evaluation.
const PDF_COURSE_DIRECTIVE = `You are generating a formal Spanish course module (LINGORA PDF Course Mode).
LANGUAGE RULE: Instructions and feedback in student's interface language. Content (theory, exercises) in Spanish.

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
LANGUAGE RULE: Match the student's interface language for all meta-communication. Do not switch to Spanish spontaneously unless the student writes in Spanish.

RULES:
- Respond naturally. No forced structure.
- Correct errors only when they are clear and recurring — weave correction into the conversation, do not interrupt
- Introduce useful vocabulary or structures naturally when relevant
- If the student asks a question, answer it fully
- Insert a table or schema only when it clearly helps the current topic
- Never force a learning sequence
- Match the student's energy and pace

COGNITIVE QUALITY RULE:
Every substantive response must leave the student able to DO something — not just know something.
If you explain a concept, immediately show how to use it in the student's real context.
Definitions without application are forbidden even in free mode.
One actionable output per response: a phrase to try, a correction to internalize, a question to answer.

PROACTIVE GUIDANCE RULE (critical — never be passive):
If the student's message is short (under 10 words), vague, or just a greeting like "hola" or "hello":
- Do NOT wait passively or just return a greeting
- Immediately introduce ONE concrete micro-action relevant to their level and topic
- Always provide: a mini example, a question to spark production, OR a vocabulary/structure invitation
- Example: "Hola! Practiquemos algo concreto — ¿sabes usar el pretérito indefinido? Dime qué hiciste ayer."
- NEVER respond with only a question. Always give something first.
- The student should feel the tutor is present and guiding, not waiting.`


// ─── OpenAI message mapper ─────────────────────────────────────
// Converts ChatMessage[] to OpenAI-compatible role/content format.
// Used by streaming and non-streaming paths to ensure identical context.
function toOpenAIMessages(messages: import('@/lib/contracts').ChatMessage[]): Array<{role:'user'|'assistant'|'system', content:string}> {
  return messages.slice(-10).map(m => ({
    role: ((m as {role?:string}).role ?? (m.sender === 'user' ? 'user' : 'assistant')) as 'user'|'assistant'|'system',
    content: m.text ?? m.html.replace(/<[^>]+>/g, '') ?? '',
  })).filter(m => m.content.trim().length > 0)
}

// ─── Decision point detector ────────────────────────────────────
// Detects if the tutor's text response contains a decision question.
// Used as fallback to generate suggestedActions when backend didn't produce them.
function detectDecisionPoint(text: string): boolean {
  const lower = text.toLowerCase()
  return ['¿quieres', '¿prefieres', 'elige', '¿te gustaría', 'ready to', 'do you want',
    '¿empezamos', '¿continuamos', 'what would you', '¿quieres que'].some(p => lower.includes(p))
}

// ─── Suggested Actions Engine ─────────────────────────────────
// Generates contextually appropriate next-step actions after each response.
// These are rendered as interactive buttons in the UI.
function generateSuggestedActions(
  action:     string,
  activeMode: string,
  lang:       string,
  artifactType?: string,
  score?:     number
): SuggestedAction[] {
  // Localized labels
  const t: Record<string, Record<string, string>> = {
    schema:       { es:'Ver esquema', en:'View schema', no:'Se skjema', fr:'Voir schéma', de:'Schema anzeigen' },
    table:        { es:'Ver tabla', en:'View table', no:'Se tabell', fr:'Voir tableau', de:'Tabelle anzeigen' },
    quiz:         { es:'Hacer simulacro', en:'Take quiz', no:'Ta quiz', fr:'Faire quiz', de:'Quiz machen' },
    retry:        { es:'Repetir simulacro', en:'Retry quiz', no:'Prøv igjen', fr:'Réessayer', de:'Wiederholen' },
    practice:     { es:'Practicar con ejemplos', en:'Practice with examples', no:'Øv med eksempler', fr:'Pratiquer', de:'Mit Beispielen üben' },
    deepen:       { es:'Profundizar más', en:'Go deeper', no:'Gå dypere', fr:'Approfondir', de:'Vertiefen' },
    next:         { es:'Siguiente bloque', en:'Next module', no:'Neste modul', fr:'Module suivant', de:'Nächstes Modul' },
    audio:        { es:'Escuchar pronunciación', en:'Hear pronunciation', no:'Hør uttale', fr:'Écouter', de:'Anhören' },
    image:        { es:'Ver diagrama visual', en:'View diagram', no:'Se diagram', fr:'Voir diagramme', de:'Diagramm anzeigen' },
    pdf:          { es:'Descargar PDF', en:'Download PDF', no:'Last ned PDF', fr:'Télécharger PDF', de:'PDF herunterladen' },
    errors:       { es:'Revisar mis errores', en:'Review my errors', no:'Gjennomgå feil', fr:'Revoir les erreurs', de:'Fehler überprüfen' },
    structured:   { es:'Cambiar a curso estructurado', en:'Switch to structured course', no:'Bytt til strukturert kurs', fr:'Mode structuré', de:'Strukturierter Kurs' },
  }
  const l = (key: string) => t[key]?.[lang] ?? t[key]?.en ?? key

  // After schema/explanation
  if (action === 'schema' || action === 'lesson' || artifactType === 'schema' || artifactType === 'schema_pro') {
    return [
      { id:'sa-table',    label:l('table'),    action:'show_table',        tone:'secondary', emoji:'📊' },
      { id:'sa-quiz',     label:l('quiz'),     action:'start_quiz',        tone:'primary',   emoji:'🧪' },
      { id:'sa-practice', label:l('practice'), action:'practice_examples', tone:'secondary', emoji:'✍️' },
      { id:'sa-audio',    label:l('audio'),    action:'pronunciation_drill',tone:'secondary', emoji:'🔊' },
      { id:'sa-deepen',   label:l('deepen'),   action:'deepen_topic',       tone:'secondary', emoji:'🔬' },
    ]
  }
  // After table
  if (artifactType === 'table' || artifactType === 'table_matrix') {
    return [
      { id:'sa-schema',   label:l('schema'),   action:'show_schema',       tone:'secondary', emoji:'📋' },
      { id:'sa-quiz',     label:l('quiz'),     action:'start_quiz',        tone:'primary',   emoji:'🧪' },
      { id:'sa-practice', label:l('practice'), action:'practice_examples', tone:'secondary', emoji:'✍️' },
      { id:'sa-pdf',      label:l('pdf'),      action:'download_pdf',      tone:'secondary', emoji:'📄' },
    ]
  }
  // After quiz (with score)
  if (action === 'feedback' || artifactType === 'quiz') {
    const passed = (score ?? 0) >= 7
    return [
      passed
        ? { id:'sa-next',   label:l('next'),   action:'next_module',   tone:'primary',   emoji:'▶️' }
        : { id:'sa-retry',  label:l('retry'),  action:'retry_quiz',    tone:'warning',   emoji:'🔄' },
      { id:'sa-errors',   label:l('errors'),   action:'review_errors',  tone:'secondary', emoji:'❌' },
      { id:'sa-deepen',   label:l('deepen'),   action:'deepen_topic',   tone:'secondary', emoji:'🔬' },
    ]
  }
  // After roadmap or guide
  if (action === 'guide' || artifactType === 'roadmap') {
    return [
      { id:'sa-schema',   label:l('schema'),   action:'show_schema',       tone:'primary',   emoji:'📋' },
      { id:'sa-table',    label:l('table'),    action:'show_table',        tone:'secondary', emoji:'📊' },
      { id:'sa-audio',    label:l('audio'),    action:'pronunciation_drill',tone:'secondary', emoji:'🔊' },
    ]
  }
  // After illustration
  if (artifactType === 'illustration') {
    return [
      { id:'sa-schema',   label:l('schema'),   action:'show_schema',       tone:'secondary', emoji:'📋' },
      { id:'sa-quiz',     label:l('quiz'),     action:'start_quiz',        tone:'primary',   emoji:'🧪' },
    ]
  }
  // Conversation/free mode — suggest structure if not already in structured mode
  if (activeMode === 'free' || activeMode === 'interact') {
    return [
      { id:'sa-schema',     label:l('schema'),     action:'show_schema',       tone:'secondary', emoji:'📋' },
      { id:'sa-quiz',       label:l('quiz'),       action:'start_quiz',        tone:'secondary', emoji:'🧪' },
      { id:'sa-structured', label:l('structured'), action:'switch_mode',        tone:'secondary', emoji:'🎓' },
    ]
  }
  return []
}

// ─── Pedagogical image prompt builder ─────────────────────────
// Builds a DALL-E prompt that produces infographics matching LINGORA's
// visual system: dark navy, semantic color blocks, readable hierarchy.
function buildPedagogicalImagePrompt(message: string, state: Partial<SessionState>): string {
  const topic = state.topic ?? 'Spanish'
  const level = state.level ?? 'A1'
  return `Educational infographic for Spanish language learning. Topic: "${message}" (level ${level}, domain: ${topic}).

STYLE — MANDATORY, DO NOT DEVIATE:
- Background: DARK NAVY BLUE (#1a2a4a) — NOT cream, NOT beige, NOT white, NOT light
- Title: white bold sans-serif, large, fully legible at top
- LEFT COLUMN — structured text blocks:
  * GREEN block: Objetivo/Key concepts, dark green bg, white readable text, 2-4 items
  * RED block: Errors/Contrasts, dark red bg, white readable text, 2-4 items
  * BLUE block: Structure/Grammar, dark blue, white text
- RIGHT COLUMN — flow diagram:
  * Rounded pill nodes connected by arrows showing logical flow
  * Each node: SHORT readable label in white, high contrast
- BOTTOM: quote block, italic white text, quotation marks visible
- ALL TEXT fully legible, minimum 16pt equivalent, no blur, no distortion
- Professional educational infographic — structured, hierarchical, study-ready

STRICTLY PROHIBITED:
- NO cartoon illustrations (no churches, cacti, hats, cars, clocks, plants, buildings)
- NO speech bubbles with illegible text
- NO light or cream backgrounds
- NO decorative scenes, landscapes, or characters
- NO blurry or illegible text anywhere
- NO stock photo or watercolor style
- Spell all words correctly (SUBJUNCTIVE not SUBJUNTIVE)`
}

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
    buildSignature:   process.env.LINGORA_BUILD_SIGNATURE ?? 'unset',
    commitHint:       process.env.LINGORA_COMMIT_HINT     ?? 'unset',
    streamingEnabled: process.env.LINGORA_STREAMING_ENABLED === 'true',
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

    // ── INTENT OVERRIDE LAYER (Priority 1) ─────────────
    // Explicit operation commands block ALL mode/lesson/phase interference.
    // Order: transcribe > pronunciation > translate > correct > summarize
    // These are detected on message text BEFORE any routing decision.
    const msgLower = (message ?? '').toLowerCase()
    const requestedOp: RequestedOperation | undefined =
      isTranscribeRequest(msgLower)   ? 'transcribe'   :
      isCorrectionRequest(msgLower)   ? 'correct'      :
      isTranslateRequest(msgLower)    ? 'translate'    :
      enrichedState.requestedOperation ?? undefined

    // Auto-activate structured mode for full course requests
    // activeMode must be read from enrichedState here — enrichedStateWithOp not yet defined
    const activeModeEarly = (enrichedState.activeMode ?? 'interact') as 'interact'|'structured'|'pdf_course'|'free'
    if (!audio && isCourseRequest(message ?? '') && activeModeEarly !== 'structured' && activeModeEarly !== 'pdf_course') {
      // Force structured mode and flag for curriculum generation
      const courseEnrichedState: Partial<SessionState> = { ...enrichedState, activeMode: 'structured', tokens: 0 }
      // Treat as first message in structured mode — will trigger curriculum + roadmap
      const courseRoadmapRes = await (async () => {
        const mentor2 = courseEnrichedState.mentor ?? 'sarah'
        const topic2  = courseEnrichedState.topic  ?? (message ?? '').slice(0, 80)
        const level2  = courseEnrichedState.level  ?? 'A1'
        const lang2   = courseEnrichedState.lang   ?? 'en'

        // RAW INTELLIGENCE FIRST — no JSON coercion, no token cap
        // The model builds the best possible curriculum for this domain
        const rawCurriculumPrompt = `You are a master curriculum designer with deep expertise.
Build the most complete, domain-accurate curriculum for: "${topic2}"
Student level: ${level2}. Interface language: ${lang2}.

Requirements:
- Use domain-specific terminology (not generic "Module 1: Introduction")
- Differentiate mastery levels within the domain
- Include clinical, professional, or practical applications where relevant
- Reference real certification paths or standards if they exist
- Each module: specific title + concrete outcome (what the student will DO)
- Realistic time estimate per phase
- Legal or safety note if the domain requires supervised practice
- End with 2-3 real recommended resources (real titles and authors)

Format: structured text. Use ## for phases, ### for modules.
Produce at the level a domain expert would. No generic outlines. No filler.
If the user's interface language is not Spanish, write instructions in ${lang2} and content examples in Spanish.`

        const rawRes = await openai.chat.completions.create({
          model: 'gpt-4o', temperature: 0.7, max_tokens: 2500,
          messages: [{ role: 'user', content: rawCurriculumPrompt }],
        }).catch(() => null)
        const rawCurriculum = rawRes?.choices?.[0]?.message?.content ?? null

        // Parse module titles from raw text for internal state
        let mods: string[] = []
        if (rawCurriculum) {
          const moduleMatches = rawCurriculum.match(/###\s+[^\n]+/g)
          if (moduleMatches?.length) {
            mods = moduleMatches.slice(0, 10).map((m: string, i: number) => `${i+1}. ${m.replace(/###\s+/, '').trim()}`)
          }
        }
        if (!mods.length) mods = ['1. Foundation', '2. Core concepts', '3. Practice', '4. Advanced']

        // Build typed CurriculumPlan from parsed modules
        const cpData: CurriculumPlan = {
          title: `Curso completo: ${topic2}`,
          topic: topic2, level: level2,
          modules: mods.map((m, i) => ({
            number: i + 1,
            title: m.replace(/^\d+\.\s*/, '').trim(),
            focus: '', skills: [],
          }))
        }

        return ok({
          message: rawCurriculum ?? `Course on ${topic2} — ${mods.length} modules ready.`,
          artifact: null,
          state: { ...courseEnrichedState, curriculumPlan: cpData, curriculumTopic: topic2, currentModule: 1, learningStage: 'schema', tokens: 1, lastAction: 'guide' as PedagogicalAction, tutorPhase: 'guide', courseActive: true }
        })
      })()
      return courseRoadmapRes
    }

    // Persist requestedOperation in session so multi-turn operations stay locked
    const enrichedStateWithOp: Partial<SessionState> = requestedOp
      ? { ...enrichedState, requestedOperation: requestedOp }
      : enrichedState

    // ── HARD INTENT OVERRIDES (before any pedagogical routing) ──
    // Translate and correct are literal commands — execute them now,
    // before resolvePedagogicalAction(), before fast-paths, before everything.
    if (requestedOp === 'translate' || (requestedOp !== 'correct' && isTranslateRequest(message ?? '') && !audio)) {
      // Parse intended target language from the message
      // "traduce al inglés" → 'English', "translate to Spanish" → 'Spanish'
      const msgL = (message ?? '').toLowerCase()
      const langHints: Array<[string, string]> = [
        ['inglés', 'English'], ['english', 'English'], ['al inglés', 'English'],
        ['español', 'Spanish'], ['spanish', 'Spanish'], ['al español', 'Spanish'],
        ['noruego', 'Norwegian'], ['norwegian', 'Norwegian'],
        ['francés', 'French'], ['french', 'French'],
        ['alemán', 'German'], ['german', 'German'],
        ['italiano', 'Italian'], ['italian', 'Italian'],
        ['portugués', 'Portuguese'], ['portuguese', 'Portuguese'],
      ]
      const detectedLang = langHints.find(([hint]) => msgL.includes(hint))?.[1]
      const targetLang = detectedLang ?? (enrichedStateWithOp.lang === 'es' ? 'English' : 'Spanish')
      const translateDirective = `Translate the following to ${targetLang}. Return ONLY the translation. No explanation. No pedagogy. No quiz. No lesson.`
      const translation = await getMentorResponse(message ?? '', enrichedStateWithOp, translateDirective).catch(() => null)
      return ok({ message: translation ?? '', artifact: null, state: { ...enrichedStateWithOp, requestedOperation: undefined, tokens: (enrichedStateWithOp.tokens ?? 0) + 1 } })
    }

    if (requestedOp === 'correct' || isCorrectionRequest(message ?? '')) {
      const correctDirective = `Correct the Spanish in the following text. Return:
1. The corrected version (full text)
2. A numbered list of each specific error with brief explanation
Format in the student's language (${enrichedStateWithOp.lang ?? 'en'}).
No quiz. No lesson. No schema. Just the correction.`
      const correction = await getMentorResponse(message ?? '', enrichedStateWithOp, correctDirective).catch(() => null)
      return ok({ message: correction ?? '', artifact: null, state: { ...enrichedStateWithOp, requestedOperation: undefined, tokens: (enrichedStateWithOp.tokens ?? 0) + 1 } })
    }

    // ── EXPORT CHAT PDF ──────────────────────────────────────────
    if (requestedOp === 'export_chat_pdf') {
      try {
        const msgs = enrichedStateWithOp.messages ?? []
        const transcript = msgs.map(m => {
          const role = m.sender === 'user' ? 'USER' : `${(m.sender ?? 'TUTOR').toUpperCase()}`
          const text = m.text ?? m.html?.replace(/<[^>]+>/g, '') ?? ''
          return `${role}: ${text}`
        }).join('\n\n')
        const title = `LINGORA — ${enrichedStateWithOp.topic ?? 'Session'} — ${new Date().toLocaleDateString()}`
        const pdf = await generatePDF({ title, content: transcript, filename: `lingora-chat-${Date.now()}` })
        if (pdf.success && pdf.url) {
          return ok({ message: '', artifact: { type: 'pdf_chat', url: pdf.url } as import('@/lib/contracts').ArtifactPayload, state: { ...enrichedStateWithOp, requestedOperation: undefined } })
        }
      } catch { /* fall through */ }
      return ok({ message: 'No se pudo generar el PDF. Intenta de nuevo.', artifact: null, state: { ...enrichedStateWithOp, requestedOperation: undefined } })
    }

    // ── GENERATE COURSE PDF ──────────────────────────────────────
    if (requestedOp === 'generate_course_pdf') {
      try {
        const plan = enrichedStateWithOp.curriculumPlan
        const topic = enrichedStateWithOp.topic ?? 'Curso'
        const moduleList = plan?.modules?.map(m => `Módulo ${m.number}: ${m.title}`) ?? []
        const content = [
          `LINGORA — Curso: ${topic}`,
          `Nivel: ${enrichedStateWithOp.level ?? 'A1'}`,
          '',
          '=== PLAN CURRICULAR ===',
          ...moduleList,
          '',
          '=== CONTENIDO ===',
          ...(enrichedStateWithOp.messages?.slice(-20).map(m => {
            const role = m.sender === 'user' ? 'Estudiante' : 'Tutor'
            return `${role}: ${m.text ?? m.html?.replace(/<[^>]+>/g, '') ?? ''}`
          }) ?? []),
        ].join('\n')
        const pdf = await generatePDF({ title: `Curso: ${topic}`, content, filename: `lingora-course-${Date.now()}` })
        if (pdf.success && pdf.url) {
          const courseArt: import('@/lib/contracts').ArtifactPayload = {
            type: 'course_pdf', url: pdf.url,
            title: `Curso: ${topic}`,
            modules: moduleList,
          } as unknown as import('@/lib/contracts').ArtifactPayload
          return ok({ message: '', artifact: courseArt, state: { ...enrichedStateWithOp, requestedOperation: undefined } })
        }
      } catch { /* fall through */ }
      return ok({ message: 'No se pudo generar el PDF del curso.', artifact: null, state: { ...enrichedStateWithOp, requestedOperation: undefined } })
    }

    // ── M. Mode-aware routing setup ──────────────
    // Read activeMode from state, select appropriate directive.
    // Roadmap: if this is the very first chat message (tokens=0) in a mode,
    // return roadmap response immediately before any other processing.
    const activeMode = enrichedStateWithOp.activeMode ?? 'interact'

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

      // Generate real structured curriculum first, then roadmap
      // This is a ONE-TIME call at course init — not repeated each turn
      const curriculumPrompt = `Student level: ${level}. Topic or domain: ${topic}. Interface language: ${lang}.

Generate a structured curriculum for this topic and level.
Return ONLY a JSON object (no markdown, no explanation):
{
  "title": "curriculum title",
  "level": "${level}",
  "totalModules": 8,
  "modules": [
    {"number": 1, "title": "Module title", "focus": "What this module teaches", "skills": ["skill1", "skill2"]},
    {"number": 2, "title": "Module title", "focus": "What this module teaches", "skills": ["skill1"]}
  ],
  "note": "One sentence on the pedagogical approach for this level"
}
Rules:
- 6–10 modules, logical progression from foundation to mastery
- Respect CEFR if topic is language learning (A0/A1 = basics, B1/B2 = intermediate, C1/C2 = advanced)
- If topic is NOT Spanish language (e.g. acupuncture, finance, law): build domain-appropriate curriculum with same rigor
- Module titles must be specific, not generic ("Present tense: ser/estar" not "Grammar module 1")`

      let curriculumData: string | null = null
      try {
        const currRes = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: curriculumPrompt }],
          temperature: 0.7,
          max_tokens: 2500,
        })
        curriculumData = currRes.choices?.[0]?.message?.content ?? null
      } catch { /* curriculum generation failed — roadmap will be generic */ }

      // Parse curriculum for roadmap display
      let moduleList: string[] = []
      try {
        if (curriculumData) {
          // Parse module titles from ### headers in free-text curriculum
          const headerMatches = curriculumData.match(/###\s+[^\n]+/g)
          if (headerMatches?.length) {
            moduleList = headerMatches.slice(0, 10).map((m: string, i: number) =>
              `${i+1}. ${m.replace(/###\s+/, '').trim()}`
            )
          }
          // Fallback: try JSON parse if model still returned JSON
          if (!moduleList.length) {
            const parsed = JSON.parse(curriculumData) as { modules?: Array<{ number: number; title: string }> }
            moduleList = (parsed.modules ?? []).slice(0, 8).map((m: { number: number; title: string }) => `${m.number}. ${m.title}`)
          }
        }
      } catch { /* use fallback */ }
      if (!moduleList.length) {
        moduleList = activeMode === 'structured'
          ? ['1. Esquema completo', '2. Ejemplos guiados', '3. Simulacro DELE/CCSE', '4. Puntuación', '5. Siguiente bloque']
          : ['1. Teoría + ejercicios', '2. Entrega por adjunto', '3. Corrección y puntuación', '4. Siguiente módulo']
      }

      const roadmapPrompt = activeMode === 'structured'
        ? `The student has chosen: mentor=${mentor}, topic=${topic}, level=${level}, mode=Structured Course.
Generate a concise roadmap message in the student's language (${lang}).
Format: present the curriculum below, then ask if ready to start Module 1.
Curriculum modules:
${moduleList.join('\n')}
Keep it under 150 words. No preamble. Start directly with the plan.`
        : `The student has chosen: mentor=${mentor}, topic=${topic}, level=${level}, mode=PDF Course.
Generate a concise roadmap in the student's language (${lang}).
Show the module plan below, then explain the submit-and-correct flow.
Modules:
${moduleList.join('\n')}
Under 150 words. No preamble.`

      try {
        const roadmapText = await getMentorResponse(roadmapPrompt, enrichedState)
        const roadmapNextState: Partial<SessionState> = {
          ...enrichedStateWithOp,
          tokens:          1,
          learningStage:   'schema',
          currentModule:   1,
          courseActive:    true,
          curriculumPlan:  moduleList.length ? {
            title: `Curriculum: ${topic}`, topic, level,
            modules: moduleList.map((m, i) => ({
              number: i + 1,
              title: m.replace(/^\d+\.\s*/, '').trim(),
              focus: '', skills: [],
            }))
          } : undefined,
          curriculumTopic: topic,
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
          buildSignature:   process.env.LINGORA_BUILD_SIGNATURE ?? 'unset',
          commitHint:       process.env.LINGORA_COMMIT_HINT     ?? 'unset',
          streamingEnabled: process.env.LINGORA_STREAMING_ENABLED === 'true',
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

      // ── TRANSCRIPTION OVERRIDE (Priority 1 in audio) ──────────
      // Check against ORIGINAL user message, not the transcribed content.
      // Using transcribed content risks false positives if someone says "transcribe" in Spanish.
      if (isTranscribeRequest(message ?? '') || requestedOp === 'transcribe') {
        const cleanTranscription = transcribed
          .replace(/transcribe(?: este| this| el| la| este audio| this audio)?[:.]?\s*/i, '')
          .trim() || transcribed
        const txNextState: Partial<SessionState> = {
          ...enrichedState,
          requestedOperation: undefined,  // clear after serving
          tokens: (enrichedState.tokens ?? 0) + 1,
        }
        return ok({ message: cleanTranscription, transcription: transcribed, artifact: null, state: txNextState })
      }

      // ── SEEK fix: run fast-paths on transcribed text ──────────
      // Spoken intent must be respected identically to typed intent.
      const audioFastPath = await runFastPaths(transcribed, enrichedStateWithOp)
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

    // ── 3a. Gallery audio intercept ──────────────────
    // Audio files uploaded from gallery (not recorded in-app) enter via files[].
    // Detect audio/* mime type and route same as direct audio input.
    if (files?.length && !audio) {
      const audioFile = files.find(f => f.type?.startsWith('audio/') || f.type === 'video/webm')
      if (audioFile && audioFile.data) {
        // Treat as audio input — transcribe first
        const tx = await transcribeAudio({ data: audioFile.data, format: audioFile.type?.split('/')[1] ?? 'webm' })
        if (tx.success) {
          const transcribed = tx.text
          // Check for transcription override
          if (isTranscribeRequest(message ?? '') || requestedOp === 'transcribe') {
            const cleanTx = transcribed.replace(/transcribe(?: este| this)?[:.]?\s*/i, '').trim() || transcribed
            return ok({ message: cleanTx, transcription: transcribed, artifact: null, state: { ...enrichedState, requestedOperation: undefined, tokens: (enrichedState.tokens ?? 0) + 1 } })
          }
          // Otherwise: treat as conversational audio input
          // Full parity with direct audio branch: fast-paths → pronunciation → conversation + TTS
          const galleryFastPath = await runFastPaths(transcribed, enrichedStateWithOp)
          if (galleryFastPath) return galleryFastPath

          // Pronunciation check for gallery audio
          const galleryEvalKw = ['pronuncia', 'pronunciación', 'pronunciacion', 'califica mi', 'evalúa mi', 'evalua mi', 'cómo sueno', 'como sueno']
          const galleryWantsEval = galleryEvalKw.some(p => (message ?? '').toLowerCase().includes(p))
          if (galleryWantsEval || requestedOp === 'pronunciation') {
            try {
              const evalResult = await evaluatePronunciation(transcribed, transcribed, enrichedStateWithOp.lang)
              if (evalResult.success) {
                const lines = (evalResult.feedbackText ?? '').split('\n')
                const feedbackLine = lines.find((l: string) => l.startsWith('FEEDBACK:'))?.replace('FEEDBACK:', '').trim() ?? ''
                const tipLine = lines.find((l: string) => l.startsWith('TIP:'))?.replace('TIP:', '').trim() ?? ''
                const errorsLine = lines.find((l: string) => l.startsWith('ERRORS:'))?.replace('ERRORS:', '').trim() ?? ''
                const feedbackFull = [feedbackLine, errorsLine && errorsLine !== 'Ninguno detectado' ? errorsLine : ''].filter(Boolean).join(' — ')
                const pronContent = { target: undefined, transcribed, score: evalResult.score ?? 0, feedback: feedbackFull || (evalResult.feedbackText ?? ''), correction: tipLine || undefined }
                const pronArt: ArtifactPayload = { type: 'pronunciation_report', content: pronContent } as unknown as ArtifactPayload
                return ok({ message: '', transcription: transcribed, pronunciationScore: evalResult.score ?? undefined, artifact: pronArt, state: { ...enrichedStateWithOp, tokens: (enrichedStateWithOp.tokens ?? 0) + 1 } })
              }
            } catch { /* fall through to conversation */ }
          }

          // Conversation + TTS
          const { action: gAction, systemDirective: gDir, nextPhase: gPhase, nextLessonIndex: gLesson, nextCourseActive: gCourse } = resolvePedagogicalAction({ message: transcribed, state: enrichedStateWithOp, explicit: null })
          const gText = await getMentorResponse(transcribed, enrichedStateWithOp, gDir).catch(() => null)
          const gNext: Partial<SessionState> = { ...enrichedStateWithOp, tutorPhase: gPhase, lastAction: gAction, lastTask: gAction, lessonIndex: gLesson, courseActive: gCourse, tokens: (enrichedStateWithOp.tokens ?? 0) + 1, samples: [...(enrichedStateWithOp.samples ?? []), transcribed] }
          const wantsGalleryTts = process.env.LINGORA_TTS_ENABLED === 'true' || Boolean(process.env.OPENAI_API_KEY)
          let galleryTtsArt: ArtifactPayload | null = null
          if (wantsGalleryTts && gText) {
            const tts = await generateSpeech(gText, { voice: 'nova' })
            if (tts.success && tts.url) galleryTtsArt = audioArtifact(tts.url)
          }
          return ok({ message: gText ?? `🎤 "${transcribed}"`, transcription: transcribed, artifact: galleryTtsArt, state: gNext })
        }
        // transcription failed — fall through to generic file handler
      }
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

    // ── COURSE REQUEST GUARD (fires before all fast-paths) ────────
    // isCourseRequest() at line ~821 only fires when activeMode !== structured.
    // But once the user IS in structured mode, a full course prompt still
    // arrives here and falls through to schema fast-path, producing a schema
    // artifact instead of a raw intelligence curriculum.
    // This guard intercepts it before schema/table/quiz fast-paths.
    if (isCourseRequest(message ?? '') && !audio) {
      const courseRaw = await openai.chat.completions.create({
        model: 'gpt-4o', temperature: 0.7, max_tokens: 2500,
        messages: [{ role: 'user', content: `You are a master curriculum designer with deep domain expertise.
Build the most complete, domain-accurate curriculum for: "${message ?? ''}"
Student level: ${enrichedState.level ?? 'A1'}. Interface language: ${enrichedState.lang ?? 'en'}.

Requirements:
- Domain-specific terminology and module titles (not generic "Module 1: Introduction")
- Differentiate mastery levels within the domain
- Clinical, professional, or practical applications where relevant
- Real standards or certification paths if they exist
- Each module: specific title + concrete outcome
- Realistic time estimate per phase
- Legal/safety note if the domain requires supervised practice
- End with 2-3 real recommended resources (real titles and authors)

Format: structured text. Use ## for phases, ### for modules.
Write at the level a domain expert would. No generic outlines.` }],
      }).catch(() => null)
      const rawCurriculum = courseRaw?.choices?.[0]?.message?.content ?? null
      if (rawCurriculum) {
        // Parse modules from ### headers
        const headerMatches = rawCurriculum.match(/###\s+[^\n]+/g)
        const mods = headerMatches?.slice(0, 10).map((m: string, i: number) =>
          `${i+1}. ${m.replace(/###\s+/, '').trim()}`) ?? []
        const cpData: CurriculumPlan = {
          title: `Curso: ${enrichedState.topic ?? message?.slice(0, 60) ?? 'curso'}`,
          topic: enrichedState.topic ?? message?.slice(0, 60) ?? '',
          level: enrichedState.level ?? 'A1',
          modules: mods.map((m, i) => ({ number: i+1, title: m.replace(/^\d+\.\s*/, '').trim(), focus: '', skills: [] }))
        }
        const courseNextState: Partial<SessionState> = {
          ...enrichedStateWithOp,
          curriculumPlan: cpData, currentModule: 1, learningStage: 'schema',
          courseActive: true, lastAction: 'guide' as PedagogicalAction,
          tokens: (enrichedStateWithOp.tokens ?? 0) + 1, lastArtifact: 'roadmap',
        }
        return ok({ message: rawCurriculum, artifact: null, state: courseNextState,
          suggestedActions: generateSuggestedActions('guide', activeMode, enrichedStateWithOp.lang ?? 'en', 'roadmap') })
      }
    }

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
            tutorPhase: 'lesson', tokens: (enrichedState.tokens ?? 0) + 1, courseActive: true, lastArtifact: 'table_matrix',
          }
          return ok({ message: matrixContent.title ?? 'Matriz lista:', artifact, state: nextState, suggestedActions: generateSuggestedActions('schema', activeMode, enrichedState.lang ?? 'en', 'table_matrix') })
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
            tutorPhase: 'lesson', tokens: (enrichedState.tokens ?? 0) + 1, courseActive: true, lastArtifact: 'schema_pro',
          }
          return ok({ message: schemaProContent.title + ':', artifact, state: nextState, suggestedActions: generateSuggestedActions('schema', activeMode, enrichedState.lang ?? 'en', 'schema_pro') })
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
            courseActive: true, lastArtifact: 'table',
          }
          console.log(`[ROUTER] table ok title="${tableContent.title}"`)
          return ok({ message: tableContent.title ?? 'Tabla lista:', artifact: tableArtifact, state: nextState, suggestedActions: generateSuggestedActions('schema', activeMode, enrichedState.lang ?? 'en', 'table') })
        }
        // If table generation failed, fall through to schema
        console.log('[ROUTER] table generation failed, falling through to schema')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[ROUTER] table error:', msg)
        // Fall through to full schema
      }
    }

    // ── 5-FAST-TRANSCRIBE. Forced transcription (text message) ────────
    // "Transcribe this audio" as text → user wants to transcribe audio they'll send
    // Give clear instructions to send audio. Do not teach.
    if (isTranscribeRequest(message ?? '') && !audio && !files?.length) {
      const txGuide: Record<string, string> = {
        es: '🎤 Para transcribir, envía el audio usando el botón de micrófono o sube el archivo de audio. Lo convertiré a texto limpio.',
        en: "🎤 To transcribe, send the audio using the microphone button or upload the audio file. I'll convert it to clean text.",
        no: '🎤 For å transkribere, send lyden med mikrofon-knappen eller last opp lydfilen. Jeg konverterer den til ren tekst.',
      }
      const lang = enrichedState.lang ?? 'en'
      const txMsg = txGuide[lang] ?? txGuide.en
      return ok({ message: txMsg, artifact: null, state: enrichedState })
    }

    // ── 5-FAST-C2. Rich content (complex table/content requests) ──────
    // Routes to mentor with uncapped directive — produces benchmark-quality output.
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
        tokens: (nextState.tokens ?? 0) + 1, lastArtifact: 'quiz',
      }
      if (quizArtifact) {
        return ok({ message: quizArtifact.content.title + ':', artifact: quizArtifact, state: nextState, suggestedActions: generateSuggestedActions('feedback', activeMode, enrichedState.lang ?? 'en', 'quiz') })
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
        nextState = { ...nextState, tokens: (nextState.tokens ?? 0) + 1, lastArtifact: `schema:${schemaContent.title}` }
        return ok({
          message:  'Schema listo:',
          artifact: { type: 'schema', content: schemaContent, metadata: { timestamp: Date.now() } },
          state:    nextState,
          suggestedActions: generateSuggestedActions('schema', activeMode, enrichedStateWithOp.lang ?? 'en', 'schema'),
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: `No se pudo generar el schema: ${msg}`, artifact: null, state: nextState })
      }
    }

    // ── 5c. Illustration ──────────────────────────
    if (action === 'illustration') {
      try {
        const pedImagePrompt = buildPedagogicalImagePrompt(message ?? '', nextState)
        const image = await generateImage(pedImagePrompt)
        if (image.success && image.url) {
          nextState = { ...nextState, lastArtifact: 'illustration' }
          return ok({ message: 'Imagen lista:', artifact: { type: 'illustration', url: image.url }, state: nextState, suggestedActions: generateSuggestedActions('schema', activeMode, enrichedState.lang ?? 'en', 'illustration') })
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
      return ok({ message: guideText ?? '', artifact: null, state: nextState, suggestedActions: generateSuggestedActions('guide', activeMode, enrichedState.lang ?? 'en', 'roadmap') })
    }

    // ── 5h. LESSON — explicit branch ──────────────
    if (action === 'lesson') {
      // ── MASTERY GATE: enforce minimum score before module advance ─────
      // If student is in structured mode and current module has low mastery: block advance
      const currMod = enrichedStateWithOp.currentModule ?? 1
      const currMastery = enrichedStateWithOp.masteryByModule?.[currMod]
      const masteryBlocked = (activeMode === 'structured' || activeMode === 'pdf_course') &&
        currMastery !== undefined &&
        currMastery.score < 70 &&
        currMastery.attempts >= 1  // only gate after at least one attempt
      if (masteryBlocked) {
        const retryPrompt = `Student is still in Module ${currMod}. Their current mastery score is ${currMastery!.score}/100 — below the 70% threshold. Do NOT advance to the next module. Instead: identify the specific concept they are struggling with, give a targeted micro-correction, and offer one more focused practice item.`
        const retryText = await getMentorResponse(retryPrompt, enrichedStateWithOp, STRUCTURED_COURSE_DIRECTIVE).catch(() => null)
        const retryState: Partial<SessionState> = { ...enrichedStateWithOp, tokens: (enrichedStateWithOp.tokens ?? 0) + 1 }
        return ok({ message: retryText ?? '', artifact: null, state: retryState })
      }

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
      // Inject curriculum plan for guided modes (structured/pdf_course)
      const depthSuffix = enrichedStateWithOp.depthMode === 'deep'
        ? '\n\nDEPTH MODE: DEEP — expand every concept to mastery level. No shortcuts.'
        : enrichedStateWithOp.depthMode === 'shallow'
        ? '\n\nDEPTH MODE: SHALLOW — brief overview only. Student requested light pass.'
        : ''
      // Inject errorMemory into directive for personalized correction
      // Inject continuity context — tutor always continues, never restarts
      const continuityContext = [
        enrichedStateWithOp.lastConcept  ? `[LAST CONCEPT TAUGHT: ${enrichedStateWithOp.lastConcept}]` : '',
        enrichedStateWithOp.lastUserGoal ? `[STUDENT GOAL: ${enrichedStateWithOp.lastUserGoal}]` : '',
        enrichedStateWithOp.lastMistake  ? `[LAST MISTAKE TO FOLLOW UP: ${enrichedStateWithOp.lastMistake}]` : '',
      ].filter(Boolean).join('\n')

      const errorMemoryContext = (enrichedStateWithOp.errorMemory && (
        (enrichedStateWithOp.errorMemory.grammar?.length ?? 0) > 0 ||
        (enrichedStateWithOp.errorMemory.vocabulary?.length ?? 0) > 0
      )) ? `

[STUDENT ERROR MEMORY — correct these if they reappear]
Grammar errors: ${(enrichedStateWithOp.errorMemory.grammar ?? []).slice(-5).join(', ')}
Vocabulary gaps: ${(enrichedStateWithOp.errorMemory.vocabulary ?? []).slice(-5).join(', ')}` : ''

      const lessonDirective = (activeMode === 'structured' ? STRUCTURED_COURSE_DIRECTIVE : activeMode === 'pdf_course' ? PDF_COURSE_DIRECTIVE : systemDirective) + depthSuffix + (continuityContext ? '\n\n' + continuityContext : '')
      // curriculumPlan is always CurriculumPlan | undefined per contract — never a raw string
      const currPlanStr = enrichedStateWithOp.curriculumPlan
        ? JSON.stringify(enrichedStateWithOp.curriculumPlan, null, 2)
        : null
      const msgWithCurriculum = (currPlanStr && (activeMode === 'structured' || activeMode === 'pdf_course'))
        ? `[CURRICULUM PLAN — follow this structure]\n${currPlanStr}\n\n[CURRENT MODULE: ${enrichedStateWithOp.currentModule ?? 1}]\n\n[STUDENT MESSAGE]\n${msg}`
        : msg
      const lessonText = await getMentorResponse(msgWithCurriculum, nextState, lessonDirective)
      const lessonStage = (activeMode === 'structured' || activeMode === 'pdf_course') && enrichedState.learningStage
        ? nextStage(enrichedState.learningStage as 'diagnosis'|'schema'|'examples'|'quiz'|'score'|'next')
        : enrichedState.learningStage
      // Capture last concept for continuity
      const conceptMatch = (lessonText ?? '').match(/(?:hoy vemos|today we cover|module|módulo)[^.\n]{0,80}/i)
      const extractedConcept = conceptMatch?.[0]?.slice(0, 100) ?? undefined
      nextState = { ...nextState, tokens: (nextState.tokens ?? 0) + 1, ...(lessonStage ? { learningStage: lessonStage } : {}), ...(extractedConcept ? { lastConcept: extractedConcept } : {}) }
      return ok({ message: lessonText ?? '', artifact: null, state: nextState })
    }



    // ── 5i. CONVERSATION (default + free practice) ─
    // Also handles cases where protocol resolves to conversation mode
    // In guided modes, override the system directive with mode-specific one
    // Inject errorMemory into conversation directive
    const convErrorCtx = (enrichedStateWithOp.errorMemory && (enrichedStateWithOp.errorMemory.grammar?.length ?? 0) > 0)
      ? `

[STUDENT ERROR MEMORY]
Grammar: ${(enrichedStateWithOp.errorMemory.grammar ?? []).slice(-5).join(', ')}
Vocabulary: ${(enrichedStateWithOp.errorMemory.vocabulary ?? []).slice(-5).join(', ')}
If relevant: address these errors in your response.`
      : ''

    const modeDirective = getModeDirective()
    const effectiveDirective = ((activeMode !== 'interact' && modeDirective !== RICH_CONTENT_DIRECTIVE)
      ? modeDirective
      : systemDirective) + convErrorCtx

    let ragContext = null
    try { ragContext = await getRagContext(message ?? '') } catch { /* non-critical */ }

    const msgWithContext = ragContext
      ? `${message}\n\n[Contexto de referencia — integrar naturalmente, no citar literalmente:]\n${ragContext.text}`
      : (message ?? '')
    // Inject curriculum for guided modes in conversation branch too
    const msgFinal = (enrichedStateWithOp.curriculumPlan && (activeMode === 'structured' || activeMode === 'pdf_course'))
      ? `[CURRICULUM PLAN]\n${JSON.stringify(enrichedStateWithOp.curriculumPlan, null, 2)}\n\n[CURRENT MODULE: ${enrichedStateWithOp.currentModule ?? 1}]\n\n${msgWithContext}`
      : msgWithContext

    // Humanization: 1.2s pause on first message — tutor feels present, not instant-bot
    if ((enrichedState.tokens ?? 0) <= 1) {
      await new Promise(r => setTimeout(r, 1200))
    }

    const mentorResponse = await getMentorResponse(msgFinal, nextState, effectiveDirective)
    const langFallbacks: Record<string, string> = {
      es: '¿En qué puedo ayudarte?', en: 'How can I help you?',
      no: 'Hvordan kan jeg hjelpe?', fr: 'Comment puis-je vous aider?',
      de: 'Wie kann ich helfen?',    it: 'Come posso aiutarti?',
      pt: 'Como posso ajudar?',      ar: 'كيف يمكنني مساعدتك؟',
      ja: 'どのようにお手伝いできますか？', zh: '我能帮您什么？',
    }
    let finalResponse = (mentorResponse ?? '').trim() || (langFallbacks[enrichedStateWithOp.lang ?? 'en'] ?? 'How can I help you?')

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
    // ── R4: Clear requestedOperation after execution (prevent sticky mode)
    // translate, correct, summarize, conversation: all cleared after single execution
    // transcription and pronunciation are cleared in their own early-return paths
    if (requestedOp && ['translate', 'correct', 'summarize', 'conversation'].includes(requestedOp)) {
      nextState = { ...nextState, requestedOperation: undefined }
    }

    // Extract lastConcept and lastUserGoal from this turn for continuity
    const goalKeywords = ['quiero', 'necesito', 'want to', 'need to', 'mi objetivo', 'my goal']
    const newGoal = goalKeywords.some(k => (message ?? '').toLowerCase().includes(k))
      ? (message ?? '').slice(0, 120)
      : undefined
    if (newGoal) nextState = { ...nextState, lastUserGoal: newGoal }

    // ── TOKEN AUTHORITY: single increment for conversation path only.
    // Early-return paths (roadmap, transcription, gallery, quiz, pdf, schema, etc.)
    // increment tokens inline before returning. They never reach this block.
    // This block is the sole token increment for the conversation fallback path.
    nextState = {
      ...nextState,
      tokens: (nextState.tokens ?? 0) + 1,
      ...(advancedStage ? { learningStage: advancedStage } : {}),
      lastArtifact: null,  // clear so pedagogicalArtifactType doesn't inherit stale artifact
    }

    // Generate suggested actions based on what just happened
    // Pass the pedagogical artifact type (not TTS audio type) to suggestedActions
    const pedagogicalArtifactType = nextState.lastArtifact
      ? nextState.lastArtifact.split(':')[0]
      : undefined
    // If tutor posed a decision and backend hasn't generated actions, produce fallback
    const hasTutorDecision = detectDecisionPoint(finalResponse)
    const suggestedActions = generateSuggestedActions(
      action,
      activeMode,
      enrichedStateWithOp.lang ?? 'en',
      pedagogicalArtifactType,
      undefined
    )
    // Compute finalActions here so BOTH streaming and non-streaming paths use it
    const decisionLabels: Record<string, [string, string, string]> = {
      es: ['Sí, empecemos',     'Ver ejemplos',     'Prefiero practicar'],
      en: ["Yes, let's start",  'Show examples',    "I'd rather practice"],
      no: ['Ja, vi starter',    'Se eksempler',     'Foretrekker å øve'],
      fr: ['Oui, commençons',   'Voir exemples',    'Préférer pratiquer'],
      de: ['Ja, beginnen wir',  'Beispiele zeigen', 'Lieber üben'],
    }
    const [dl1, dl2, dl3] = decisionLabels[enrichedStateWithOp.lang ?? 'en'] ?? decisionLabels.en
    const hasTutorDecision2 = detectDecisionPoint(finalResponse)
    const finalActions = suggestedActions.length ? suggestedActions
      : hasTutorDecision2 ? [
          { id:'sa-yes',   label:dl1, action:'continue_lesson'   as import('@/lib/contracts').SuggestedActionType, tone:'primary'   as const, emoji:'▶️' },
          { id:'sa-ex',    label:dl2, action:'choose_examples'   as import('@/lib/contracts').SuggestedActionType, tone:'secondary' as const, emoji:'📚' },
          { id:'sa-later', label:dl3, action:'practice_examples' as import('@/lib/contracts').SuggestedActionType, tone:'secondary' as const, emoji:'✍️' },
        ]
      : undefined

    // ── STREAMING (SSE) — conversation and lesson path ─────────
    // Fast-paths (schema, table, quiz) already returned above via ok().
    // This branch handles conversational responses only.
    // Streaming gives the "tutor thinking in real time" perception.
    if (process.env.LINGORA_STREAMING_ENABLED === 'true') {
      const encoder = new TextEncoder()
      const streamBody = new ReadableStream({
        async start(controller) {
          try {
            const streamCompletion = await openai.chat.completions.create({
              model: 'gpt-4o',
              messages: [
                { role: 'system' as const, content: effectiveDirective },
                ...toOpenAIMessages(nextState.messages ?? []),
                { role: 'user' as const, content: msgFinal },
              ],
              temperature: 0.7,
              stream: true,
            })
            let streamedText = ''
            for await (const chunk of streamCompletion) {
              const delta = chunk.choices[0]?.delta?.content ?? ''
              if (delta) {
                streamedText += delta
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}

`))
              }
            }
            // Send final chunk with artifact, state, suggestedActions
            const finalChunk = {
              done: true,
              artifact: ttsArtifact,
              state: nextState,
              suggestedActions: finalActions,
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}

`))
            controller.close()
          } catch {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, error: true, state: nextState })}

`))
            controller.close()
          }
        }
      })
      return new Response(streamBody, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-LINGORA': 'v10.2',
        },
      })
    }

    // Non-streaming fallback — finalActions already computed above
    return ok({ message: finalResponse, artifact: ttsArtifact, state: nextState, suggestedActions: finalActions })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CHAT ROUTE] Fatal:', msg)
    return ok({ message: 'Error interno. Por favor intenta de nuevo.', error: msg }, 500)
  }
}
