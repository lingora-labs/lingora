// ================================================
// FILE: app/api/chat/route.ts
// LINGORA 10.2 — ROUTER (VALID)
// Full replacement — typed and build-safe
// ================================================

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

import { detectIntent } from '@/server/core/intent-detector'
import { commercialEngine, commercialDebug } from '@/server/core/commercial-engine'
import { evaluateLevel } from '@/server/core/diagnostics'
import { getMentorResponse } from '@/server/mentors/mentor-engine'
import { getRagContext, getRagStats } from '@/server/knowledge/rag'
import { generateSchemaContent } from '@/server/tools/schema-generator'
import { generateImage } from '@/server/tools/image-generator'
import { generatePDF } from '@/server/tools/pdf-generator'
import {
  generateSpeech,
  evaluatePronunciation,
  transcribeAudio,
} from '@/server/tools/audio-toolkit'
import { processAttachment } from '@/server/tools/attachment-processor'
import {
  resolvePedagogicalAction,
  resolveTutorMode,
  type PedagogicalAction,
  type TutorPhase,
} from '@/lib/tutorProtocol'
import type {
  MessagePayload,
  ChatResponse,
  SessionState,
  ArtifactPayload,
  AudioArtifact,
  QuizArtifact,
  QuizItem,
  TableArtifact,
  TableContent,
  TableMatrixArtifact,
  TableMatrixContent,
  SchemaProArtifact,
  SchemaProContent,
} from '@/lib/contracts'

export const runtime = 'nodejs'
export const maxDuration = 30

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function ok(body: ChatResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-LINGORA': 'v10.2',
    },
  })
}

function audioArtifact(url: string): AudioArtifact {
  return {
    type: 'audio',
    url,
    method: url.startsWith('data:') ? 'dataurl' : 's3',
  }
}

function buildState(
  base: Partial<SessionState>,
  updates: Partial<SessionState>
): Partial<SessionState> {
  return {
    ...base,
    ...updates,
    tutorPhase: updates.tutorPhase as TutorPhase | undefined,
  }
}

function intentToAction(intentType: string): PedagogicalAction | null {
  const map: Partial<Record<string, PedagogicalAction>> = {
    schema: 'schema',
    table: 'schema',
    illustration: 'illustration',
    pdf: 'pdf',
    pronunciation: 'pronunciation',
  }
  return map[intentType] ?? null
}

// ─── Quiz generator ──────────────────────────────
async function generateQuizContent(
  message: string,
  state: Partial<SessionState>
): Promise<QuizArtifact | null> {
  const level = state.level ?? 'A1'
  const topic = state.topic ?? 'Spanish'
  const lang = state.lang ?? 'en'

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
- 1 question only
- options: exactly 4 items
- correct: 0-based index
- question must end with ?
- options must be meaningfully different
- explanation: 1 sentence max, in the user's interface language
- difficulty: appropriate for ${level} level`

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    })

    const raw = res.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as { title: string; questions: QuizItem[] }

    if (!parsed.questions?.length) return null
    const q = parsed.questions[0]
    if (!q.question || !q.options?.length || typeof q.correct !== 'number') return null

    return {
      type: 'quiz',
      content: {
        title: parsed.title ?? `Quiz: ${topic}`,
        topic,
        level,
        questions: [{ ...q, options: q.options.slice(0, 4) }],
      },
    }
  } catch {
    return null
  }
}

// ─── Table generator ─────────────────────────────
async function generateTableContent(
  message: string,
  state: Partial<SessionState>
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
- columns: 2-4 headers maximum
- rows: 3-8 rows maximum
- cells: concise (1-5 words each)
- include emojis in cells where natural
- tone: pick the most appropriate one
- If verb conjugation, tone = "conjugation", columns = ["Persona", "Forma", "Ejemplo"]
- If comparison, tone = "comparison"
- If vocabulary, tone = "vocabulary"`

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 600,
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

function isTableRequest(message: string): boolean {
  const m = message.toLowerCase()
  return [
    'tabla', 'table', 'cuadro', 'cuadrito', 'cuadro simple', 'cuadro pequeño',
    'compárame', 'comparame', 'compara', 'diferencias entre', 'diferencia entre',
    'resumen en tabla', 'resume en tabla', 'en tabla', 'en un cuadro',
    'conjugación de', 'conjugacion de', 'conjuga el verbo', 'conjuga ',
    'vocabulario de', 'lista de', 'comparison', 'versus', ' vs ',
    'cuadros visuales', 'cuadro visual', 'cuadro del verbo', 'tabla del verbo',
    'haz un cuadro', 'dame un cuadro', 'dame una tabla', 'hazme una tabla',
    'cuadro de', 'tabla de',
  ].some(p => m.includes(p))
}

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

function isSchemaProRequest(message: string): boolean {
  const m = message.toLowerCase()
  return [
    'esquema completo', 'esquema visual', 'mapa conceptual',
    'esquema del verbo', 'esquema de la', 'esquema del',
    'estructura del', 'diagrama de', 'organiza', 'bloque visual',
    'bloques de', 'lección visual', 'mapa de',
  ].some(p => m.includes(p))
}

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

// ─── Matrix generator ────────────────────────────
async function generateTableMatrix(
  message: string,
  state: Partial<SessionState>
): Promise<TableMatrixContent | null> {
  const level = state.level ?? 'A1'
  const lang = state.lang ?? 'en'

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
- tone values: ok, warn, danger, info, neutral
- use icons where semantically meaningful
- bold first column cells`

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    })

    const raw = res.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as TableMatrixContent
    if (!parsed.columns?.length || !parsed.rows?.length) return null
    return parsed
  } catch {
    return null
  }
}

// ─── Schema Pro generator ────────────────────────
async function generateSchemaPro(
  message: string,
  state: Partial<SessionState>
): Promise<SchemaProContent | null> {
  const level = state.level ?? 'A1'
  const topic = state.topic ?? 'Spanish'
  const lang = state.lang ?? 'en'

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
- include at least one 'highlight' block
- include 'bullets' for key concepts
- use 'comparison' only when comparing two things
- use 'flow' for sequences
- use 'table' only for compact data`

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    })

    const raw = res.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as SchemaProContent
    if (!parsed.blocks?.length) return null
    return parsed
  } catch {
    return null
  }
}

function buildAutoSchemaPrompt(state: Partial<SessionState>): string {
  const topic = state.topic ?? 'conversación'
  const level = state.level ?? 'A1'
  const samples = state.samples ?? []
  const recent = samples.slice(-3).join(' ').slice(0, 200)

  return `[SISTEMA: SCHEMA PEDAGÓGICO AUTOMÁTICO — NO MOSTRAR AL USUARIO]
Genera un esquema de refuerzo compacto para: tema="${topic}", nivel=${level}.
${recent.length > 20 ? `Contexto reciente del estudiante: "${recent}".` : ''}
El esquema debe reforzar el concepto gramatical o vocabulario más relevante del contexto.
No debe repetir literalmente lo último discutido.`
}

// ─── GET ─────────────────────────────────────────
export async function GET() {
  const rag = await getRagStats().catch(() => ({}))
  return NextResponse.json({
    status: 'healthy',
    version: 'v10.2',
    system: 'LINGORA',
    platform: 'vercel-nextjs',
    timestamp: new Date().toISOString(),
    rag,
    tutorProtocol: 'v1.1',
    environment: {
      openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
      storageConfigured: Boolean(process.env.S3_BUCKET),
      awsConfigured: Boolean(process.env.AWS_ACCESS_KEY_ID),
      ttsEnabled:
        process.env.LINGORA_TTS_ENABLED === 'true' ||
        Boolean(process.env.OPENAI_API_KEY),
    },
  })
}

// ─── POST ────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body: MessagePayload = await req.json()
    const {
      message,
      state = {} as Partial<SessionState>,
      audio,
      files,
      diagnostic = false,
      samples = [],
      autoSchema = false,
      ttsRequested = false,
      pronunciationTarget = null,
    } = body

    const tutorMode = resolveTutorMode(state.topic ?? null, state.mentor ?? null)
    const enrichedState: Partial<SessionState> = { ...state, tutorMode }

    // ── 0. Diagnostic trigger ─────────────────────
    if ((message ?? '').trim() === '*1357*#') {
      const ragStats = await getRagStats().catch(() => ({ error: 'unavailable' }))
      return ok({
        message: 'LINGORA v10.2 · Diagnostico activo',
        diagnostic: {
          system: 'LINGORA',
          version: 'v10.2',
          tutorProtocol: 'v1.1',
          platform: 'vercel-nextjs',
          status: 'operational',
          timestamp: new Date().toISOString(),
          modules: {
            schema: true,
            image: true,
            audio: true,
            tts: true,
            pronunciation: true,
            rag: true,
            commercial: true,
            quiz: true,
            tutorProtocol: true,
            autoSchema: true,
          },
          environment: {
            openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
            storageConfigured: Boolean(process.env.S3_BUCKET),
            awsConfigured: Boolean(process.env.AWS_ACCESS_KEY_ID),
            ttsEnabled:
              process.env.LINGORA_TTS_ENABLED === 'true' ||
              Boolean(process.env.OPENAI_API_KEY),
          },
          state: {
            activeMentor: state.mentor ?? 'unknown',
            level: state.level ?? 'A0',
            tokens: state.tokens ?? 0,
            tutorMode,
            tutorPhase: state.tutorPhase ?? 'idle',
            lessonIndex: state.lessonIndex ?? 0,
            courseActive: state.courseActive ?? false,
            lastAction: state.lastAction ?? null,
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

    // ── 2. Auto-schema ────────────────────────────
    if (autoSchema) {
      const tokenCount = state.tokens ?? 0
      const sampleCount = (state.samples ?? []).length

      if (tokenCount < 4 || sampleCount < 2) {
        return ok({ message: '', artifact: null, state: enrichedState })
      }

      try {
        const schemaContent = await generateSchemaContent({
          topic: buildAutoSchemaPrompt(enrichedState),
          level: enrichedState.level ?? 'A1',
          uiLanguage: enrichedState.lang ?? 'en',
        })

        if (!schemaContent?.title) {
          return ok({ message: '', artifact: null, state: enrichedState })
        }

        const nextState = buildState(enrichedState, {
          lastTask: 'schema',
          lastAction: 'schema',
          lastArtifact: `schema:${schemaContent.title}`,
        })

        return ok({
          message: 'Refuerzo pedagógico listo:',
          artifact: {
            type: 'schema',
            content: schemaContent,
            metadata: { timestamp: Date.now(), auto: true },
          },
          state: nextState,
        })
      } catch {
        return ok({ message: '', artifact: null, state: enrichedState })
      }
    }

    // ── 3. Audio ──────────────────────────────────
    if (audio) {
      const tx = await transcribeAudio(audio)

      if (!tx.success) {
        return ok({
          message: `No se pudo transcribir el audio: ${tx.message ?? 'error desconocido'}`,
          state: enrichedState,
        })
      }

      const transcribed = tx.text

      if (pronunciationTarget) {
        const evalResult = await evaluatePronunciation(
          transcribed,
          pronunciationTarget,
          state.lang
        )

        if (evalResult.success) {
          return ok({
            message: evalResult.feedbackText ?? '',
            transcription: transcribed,
            pronunciationScore: evalResult.score ?? undefined,
            artifact: evalResult.audioFeedback
              ? audioArtifact(evalResult.audioFeedback.url)
              : null,
            ttsAvailable: evalResult.ttsAvailable,
            state: enrichedState,
          })
        }

        return ok({
          message: `"${transcribed}"\n\n${evalResult.message ?? ''}`,
          transcription: transcribed,
          state: enrichedState,
        })
      }

      const {
        action: audioAction,
        systemDirective: audioDirective,
        nextPhase: audioPhase,
        nextLessonIndex: audioLesson,
        nextCourseActive: audioCourse,
      } = resolvePedagogicalAction({
        message: transcribed,
        state: enrichedState,
        explicit: null,
      })

      const mentorText = await getMentorResponse(
        transcribed,
        enrichedState,
        audioDirective
      ).catch(() => null)

      const responseText = mentorText ?? `🎤 "${transcribed}"`

      const audioNextState = buildState(enrichedState, {
        tutorPhase: audioPhase,
        lastAction: audioAction,
        lastTask: audioAction,
        lessonIndex: audioLesson,
        courseActive: audioCourse,
        tokens: (enrichedState.tokens ?? 0) + 1,
        samples: [...(enrichedState.samples ?? []), transcribed],
      })

      const wantsTts =
        ttsRequested ||
        process.env.LINGORA_TTS_ENABLED === 'true' ||
        Boolean(process.env.OPENAI_API_KEY)

      let ttsArt: ArtifactPayload | null = null
      if (wantsTts && mentorText) {
        const tts = await generateSpeech(mentorText, { voice: 'nova' })
        if (tts.success && tts.url) ttsArt = audioArtifact(tts.url)
      }

      return ok({
        message: responseText,
        transcription: transcribed,
        artifact: ttsArt,
        state: audioNextState,
      })
    }

    // ── 4. Files ──────────────────────────────────
    if (files?.length) {
      const firstFile = files[0]
      const isImage = firstFile?.type?.startsWith('image/')

      if (isImage && firstFile.data) {
        console.log('[ROUTER] intent=vision file=' + firstFile.name)

        try {
          const userText = (message ?? '').trim()
          const prompt = userText
            ? userText
            : 'Analyze this image in the context of Spanish language learning. Describe what you see, identify any Spanish text or educational content, and provide relevant pedagogical feedback.'

          const visionRes = await openai.chat.completions.create({
            model: 'gpt-4o',
            max_tokens: 800,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${firstFile.type};base64,${firstFile.data}`,
                      detail: 'auto',
                    },
                  },
                ],
              },
            ],
          })

          const visionText = visionRes.choices?.[0]?.message?.content ?? ''
          const nextState = buildState(enrichedState, {
            lastTask: 'vision',
            lastAction: 'conversation',
            tokens: (enrichedState.tokens ?? 0) + 1,
          })

          return ok({
            message: visionText || 'He analizado la imagen.',
            state: nextState,
          })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[ROUTER] vision error:', msg)
        }
      }

      try {
        const result = await processAttachment(files, enrichedState as Record<string, unknown>)
        const extracted = (result.extractedTexts ?? []).filter(Boolean)
        let analysisMessage = `Archivo recibido: ${result.names.join(', ')}`

        if (extracted.length > 0) {
          const textContent = extracted.join('\n\n').slice(0, 2500)
          const isHonest =
            textContent.includes('[OCR not available') ||
            textContent.includes('[No text detected') ||
            textContent.includes('[Unsupported file type')

          if (isHonest) {
            analysisMessage = `Archivo recibido: ${result.names.join(', ')}\n\n${textContent}`
          } else {
            const prompt = `El estudiante subió: ${result.names.join(', ')}.\n\nContenido:\n${textContent}\n\nAnaliza, corrige errores si los hay, y da feedback pedagógico concreto. Responde en el idioma del estudiante.`
            const analysis = await getMentorResponse(prompt, enrichedState).catch(() => null)
            analysisMessage =
              analysis ??
              `Archivo recibido: ${result.names.join(', ')}\n\n${textContent.slice(0, 500)}`
          }
        }

        return ok({
          message: analysisMessage,
          attachments: result.urls,
          extractedTexts: extracted,
          state: result.state as Partial<SessionState>,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({
          message: `No se pudo procesar el archivo: ${msg}`,
          state: enrichedState,
        })
      }
    }

    // ── 5. Text routing ───────────────────────────
    const intent = detectIntent(message ?? '')
    const explicit = intentToAction(intent.type)

    const messageIsTable = isTableRequest(message ?? '')
    const messageIsMatrix = isMatrixRequest(message ?? '')
    const messageIsSchemaPro = isSchemaProRequest(message ?? '')
    const messageIsQuiz = isQuizRequest(message ?? '')
    const messageIsLevel = isLevelRequest(message ?? '')

    let nextState = buildState(enrichedState, {
      tutorMode,
      tutorPhase: state.tutorPhase,
      lastAction: state.lastAction,
      lastTask: state.lastTask,
      lessonIndex: state.lessonIndex,
      courseActive: state.courseActive,
    })

    // ── Quiz override ─────────────────────────────
    if (messageIsQuiz) {
      console.log('[ROUTER] explicit-quiz-override')

      const quizArtifact = await generateQuizContent(message ?? '', nextState)

      nextState = buildState(nextState, {
        lastAction: 'feedback',
        lastTask: 'feedback',
        tutorPhase: 'feedback',
        awaitingQuizAnswer: false,
        tokens: (nextState.tokens ?? 0) + 1,
      })

      if (quizArtifact) {
        return ok({
          message: `${quizArtifact.content.title}:`,
          artifact: quizArtifact,
          state: nextState,
        })
      }
    }

    // ── Level override ────────────────────────────
    if (messageIsLevel) {
      console.log('[ROUTER] explicit-level-assessment')
      const report = evaluateLevel((enrichedState.samples ?? []) as string[])
      return ok({ message: '', diagnostic: report, state: enrichedState })
    }

    // ── Matrix fast path ──────────────────────────
    if (messageIsMatrix) {
      console.log('[ROUTER] fast-path=table_matrix')
      try {
        const matrixContent = await generateTableMatrix(message ?? '', enrichedState)

        if (matrixContent) {
          const artifact: TableMatrixArtifact = {
            type: 'table_matrix',
            content: matrixContent,
          }

          const matrixState = buildState(enrichedState, {
            lastTask: 'table',
            lastAction: 'schema',
            tutorPhase: 'lesson',
            tokens: (enrichedState.tokens ?? 0) + 1,
            courseActive: true,
          })

          return ok({
            message: matrixContent.title ?? 'Matriz lista:',
            artifact,
            state: matrixState,
          })
        }
      } catch {}
    }

    // ── Schema Pro fast path ──────────────────────
    if (messageIsSchemaPro) {
      console.log('[ROUTER] fast-path=schema_pro')
      try {
        const schemaProContent = await generateSchemaPro(message ?? '', enrichedState)

        if (schemaProContent) {
          const artifact: SchemaProArtifact = {
            type: 'schema_pro',
            content: schemaProContent,
          }

          const schemaProState = buildState(enrichedState, {
            lastTask: 'schema',
            lastAction: 'schema',
            tutorPhase: 'lesson',
            tokens: (enrichedState.tokens ?? 0) + 1,
            courseActive: true,
          })

          return ok({
            message: `${schemaProContent.title}:`,
            artifact,
            state: schemaProState,
          })
        }
      } catch {}
    }

    // ── Table fast path ───────────────────────────
    if (messageIsTable) {
      console.log('[ROUTER] fast-path=table')
      try {
        const tableContent = await generateTableContent(message ?? '', enrichedState)

        if (tableContent) {
          const tableArtifact: TableArtifact = {
            type: 'table',
            content: tableContent,
          }

          const tableState = buildState(enrichedState, {
            lastTask: 'table',
            lastAction: 'schema',
            tutorPhase: 'lesson',
            tokens: (enrichedState.tokens ?? 0) + 1,
            courseActive: true,
          })

          console.log(`[ROUTER] table ok title="${tableContent.title}"`)

          return ok({
            message: tableContent.title ?? 'Tabla lista:',
            artifact: tableArtifact,
            state: tableState,
          })
        }

        console.log('[ROUTER] table generation failed, falling through to schema')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[ROUTER] table error:', msg)
      }
    }

    // ── Protocol route ────────────────────────────
    const {
      action,
      systemDirective,
      nextPhase,
      nextLessonIndex,
      nextCourseActive,
    } = resolvePedagogicalAction({
      message: message ?? '',
      state: enrichedState,
      explicit,
    })

    console.log(
      `[ROUTER] intent=${intent.type} action=${action} mode=${tutorMode} phase=${nextPhase} lesson=${nextLessonIndex}`
    )

    nextState = buildState(enrichedState, {
      tutorMode,
      tutorPhase: nextPhase,
      lastAction: action,
      lastTask: action,
      lessonIndex: nextLessonIndex,
      courseActive: nextCourseActive,
    })

    // ── Pronunciation ─────────────────────────────
    if (action === 'pronunciation') {
      try {
        const mentorText = await getMentorResponse(message ?? '', nextState, systemDirective)
        const tts = await generateSpeech(mentorText ?? '', { voice: 'nova', speed: 0.9 })

        nextState = buildState(nextState, {
          tokens: (nextState.tokens ?? 0) + 1,
        })

        return ok({
          message: mentorText ?? 'Pronunciation guidance:',
          artifact: tts.success && tts.url ? audioArtifact(tts.url) : null,
          ttsAvailable: tts.success,
          ttsError: tts.success ? null : tts.message,
          state: nextState,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({
          message: `No se pudo generar la guía de pronunciación: ${msg}`,
          state: nextState,
        })
      }
    }

    // ── Schema ────────────────────────────────────
    if (action === 'schema') {
      try {
        const schemaContent = await generateSchemaContent({
          topic: message ?? '',
          level: nextState.level ?? 'A1',
          uiLanguage: nextState.lang ?? 'en',
        })

        if (!schemaContent?.title) {
          throw new Error('Invalid schema structure')
        }

        nextState = buildState(nextState, {
          tokens: (nextState.tokens ?? 0) + 10,
          lastArtifact: `schema:${schemaContent.title}`,
        })

        return ok({
          message: 'Schema listo:',
          artifact: {
            type: 'schema',
            content: schemaContent,
            metadata: { timestamp: Date.now() },
          },
          state: nextState,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({
          message: `No se pudo generar el schema: ${msg}`,
          artifact: null,
          state: nextState,
        })
      }
    }

    // ── Illustration ──────────────────────────────
    if (action === 'illustration') {
      try {
        const image = await generateImage(message ?? '')

        if (image.success && image.url) {
          nextState = buildState(nextState, {
            lastArtifact: 'illustration',
          })

          return ok({
            message: 'Imagen lista:',
            artifact: { type: 'illustration', url: image.url },
            state: nextState,
          })
        }

        return ok({
          message: `No se pudo generar la imagen: ${image.message ?? 'error desconocido'}`,
          artifact: null,
          state: nextState,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({
          message: `Error de imagen: ${msg}`,
          artifact: null,
          state: nextState,
        })
      }
    }

    // ── PDF ───────────────────────────────────────
    if (action === 'pdf') {
      try {
        const contentRes = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content:
                'Genera contenido educativo estructurado en español. Primera línea = título. Secciones separadas por línea en blanco. Máximo 600 palabras. Sin markdown.',
            },
            { role: 'user', content: message ?? '' },
          ],
          temperature: 0.4,
          max_tokens: 800,
        })

        const pdfContent = contentRes.choices?.[0]?.message?.content ?? message ?? ''
        const titleLine = pdfContent.split('\n')[0].slice(0, 80).trim()

        const pdf = await generatePDF({
          title: titleLine || 'Material LINGORA',
          content: pdfContent,
          filename: `lingora-${Date.now()}`,
        })

        if (pdf.success && pdf.url) {
          nextState = buildState(nextState, {
            lastArtifact: `pdf:${titleLine}`,
          })

          return ok({
            message: 'PDF listo:',
            artifact: { type: 'pdf', url: pdf.url },
            state: nextState,
          })
        }

        return ok({
          message: `No se pudo generar el PDF: ${pdf.message ?? 'error desconocido'}`,
          artifact: null,
          state: nextState,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({
          message: `Error de PDF: ${msg}`,
          artifact: null,
          state: nextState,
        })
      }
    }

    // ── Quiz ──────────────────────────────────────
    if (action === 'quiz') {
      try {
        const quizArtifact = await generateQuizContent(message ?? '', nextState)

        nextState = buildState(nextState, {
          lastAction: 'feedback',
          lastTask: 'feedback',
          tutorPhase: 'feedback',
          awaitingQuizAnswer: false,
          tokens: (nextState.tokens ?? 0) + 1,
        })

        if (quizArtifact) {
          return ok({
            message: `${quizArtifact.content.title}:`,
            artifact: quizArtifact,
            state: nextState,
          })
        }

        const fallbackText = await getMentorResponse(
          message ?? '',
          nextState,
          systemDirective
        ).catch(() => null)

        return ok({
          message: fallbackText ?? 'Pregunta de práctica:',
          artifact: null,
          state: nextState,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({
          message: `Error al generar el quiz: ${msg}`,
          state: nextState,
        })
      }
    }

    // ── Feedback ──────────────────────────────────
    if (action === 'feedback') {
      const feedbackText = await getMentorResponse(message ?? '', nextState, systemDirective)

      nextState = buildState(nextState, {
        awaitingQuizAnswer: false,
        tokens: (nextState.tokens ?? 0) + 1,
      })

      return ok({
        message: feedbackText ?? '',
        artifact: null,
        state: nextState,
      })
    }

    // ── Guide ─────────────────────────────────────
    if (action === 'guide') {
      const guideText = await getMentorResponse(message ?? '', nextState, systemDirective)

      nextState = buildState(nextState, {
        tokens: (nextState.tokens ?? 0) + 1,
      })

      return ok({
        message: guideText ?? '',
        artifact: null,
        state: nextState,
      })
    }

    // ── Lesson ────────────────────────────────────
    if (action === 'lesson') {
      let ragContext = null
      try {
        ragContext = await getRagContext(message ?? '')
      } catch {}

      const msg = ragContext
        ? `${message}\n\n[Contexto de referencia — integrar naturalmente:]\n${ragContext.text}`
        : (message ?? '')

      const lessonText = await getMentorResponse(msg, nextState, systemDirective)

      nextState = buildState(nextState, {
        tokens: (nextState.tokens ?? 0) + 1,
      })

      return ok({
        message: lessonText ?? '',
        artifact: null,
        state: nextState,
      })
    }

    // ── Conversation default ──────────────────────
    let ragContext = null
    try {
      ragContext = await getRagContext(message ?? '')
    } catch {}

    const msgWithContext = ragContext
      ? `${message}\n\n[Contexto de referencia — integrar naturalmente, no citar literalmente:]\n${ragContext.text}`
      : (message ?? '')

    if ((enrichedState.tokens ?? 0) <= 1) {
      await new Promise(resolve => setTimeout(resolve, 1200))
    }

    const mentorResponse = await getMentorResponse(
      msgWithContext,
      nextState,
      systemDirective
    )

    let finalResponse = (mentorResponse ?? '').trim() || 'How can I help you?'

    try {
      const commercial = commercialEngine(message ?? '', nextState)
      if (commercial.trigger) finalResponse += `\n\n${commercial.trigger.message}`
      if (commercial.state) nextState = buildState(nextState, commercial.state)
    } catch {}

    const wantsTts =
      ttsRequested ||
      process.env.LINGORA_TTS_ENABLED === 'true' ||
      Boolean(process.env.OPENAI_API_KEY)

    let ttsArtifact: ArtifactPayload | null = null
    if (wantsTts && finalResponse) {
      const tts = await generateSpeech(finalResponse, { voice: 'nova' })
      if (tts.success && tts.url) ttsArtifact = audioArtifact(tts.url)
    }

    nextState = buildState(nextState, {
      tokens: (nextState.tokens ?? 0) + 1,
    })

    return ok({
      message: finalResponse,
      artifact: ttsArtifact,
      state: nextState,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CHAT ROUTE] Fatal:', msg)

    return ok(
      {
        message: 'Error interno. Por favor intenta de nuevo.',
        error: msg,
      },
      500
    )
  }
        }
