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
  type PedagogicalAction,
} from '@/lib/tutorProtocol'
import type {
  MessagePayload, ChatResponse, SessionState,
  ArtifactPayload, AudioArtifact, QuizArtifact, QuizItem,
  TableArtifact, TableContent,
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
function parseQuizFromText(text: string, topic: string, level: string): QuizArtifact | null {
  if (!text || text.length < 20) return null

  // Step 1: Find the question — last sentence ending in ?
  // (mentor may include intro text before the actual question)
  const sentences = text.split(/\n+/).map(s => s.trim()).filter(Boolean)
  const questionLine = [...sentences].reverse().find(s => s.endsWith('?'))
    ?? sentences.find(s => s.includes('?'))
  if (!questionLine) return null
  const question = questionLine.replace(/^\d+[.)]\s*/, '').replace(/^\*+/, '').trim()

  // Step 2: Find options — support A) A. 1) 1. - * formats
  // Also handles bold markdown: **A)** text
  const optionPattern = /(?:^|\n)\s*(?:\*{0,2}[A-D1-4][).:]?\*{0,2}[\s.)-]+)([^\n]{3,100})/gm
  const matches = [...text.matchAll(optionPattern)]

  // Fallback: try line-by-line if regex didn't find enough
  let options: string[] = matches.map(m => m[1].replace(/\*+/g, '').trim()).filter(Boolean)

  if (options.length < 2) {
    // Fallback: look for lines that start with letter/number indicators
    options = sentences
      .filter(s => /^[\*]*[A-D1-4][\s\).\-:]/.test(s))
      .map(s => s.replace(/^[\*]*[A-D1-4][\s\).\-:]+/, '').replace(/\*+/g, '').trim())
      .filter(s => s.length > 2)
  }

  if (options.length < 2) return null  // Need at least 2 options to be a real quiz

  const questions: QuizItem[] = [{
    question,
    options: options.slice(0, 4),  // Max 4 options
    correct: 0,  // Placeholder — route sets awaitingQuizAnswer; correct answer revealed in feedback
  }]

  return {
    type:    'quiz',
    content: { title: `Quiz: ${topic}`, topic, level, questions },
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
- columns: 2-4 headers maximum
- rows: 3-8 rows maximum
- cells: concise (1-5 words each)
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
      max_tokens:      600,
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
  ].some(p => m.includes(p))
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
    const tutorMode     = resolveTutorMode(state.topic ?? null, state.mentor ?? null)
    const enrichedState: Partial<SessionState> = { ...state, tutorMode }

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

      if (pronunciationTarget) {
        const evalResult = await evaluatePronunciation(transcribed, pronunciationTarget, state.lang)
        if (evalResult.success) {
          return ok({
            message:            evalResult.feedbackText ?? '',
            transcription:      transcribed,
            pronunciationScore: evalResult.score ?? undefined,
            artifact:           evalResult.audioFeedback ? audioArtifact(evalResult.audioFeedback.url) : null,
            ttsAvailable:       evalResult.ttsAvailable,
            state:              enrichedState,
          })
        }
        return ok({ message: `"${transcribed}"\n\n${evalResult.message ?? ''}`, transcription: transcribed, state: enrichedState })
      }

      const {
        action: audioAction,
        systemDirective: audioDirective,
        nextPhase: audioPhase,
        nextLessonIndex: audioLesson,
        nextCourseActive: audioCourse,
      } = resolvePedagogicalAction({ message: transcribed, state: enrichedState, explicit: null })

      // Audio mode: governed conversation with protocol directive.
      // The mentor receives the correct directive for the current phase (guide/lesson/quiz/feedback),
      // but audio does NOT branch into artifact-generating paths (quiz, schema, pdf, image).
      // This is intentional — audio is simplified mode in v1.
      // Full branch parity (audio producing QuizArtifact etc.) is v2 scope.
      // The protocol state (phase, tokens, lessonIndex) DOES advance correctly.
      const mentorText   = await getMentorResponse(transcribed, enrichedState, audioDirective).catch(() => null)
      const responseText = mentorText ?? `🎤 "${transcribed}"`

      // Build nextState — audio must advance the protocol just like text
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
    const messageIsTable = isTableRequest(message ?? '')
    if (messageIsTable) {
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

    const {
      action, systemDirective, nextPhase,
      nextLessonIndex, nextCourseActive,
    } = resolvePedagogicalAction({ message: message ?? '', state: enrichedState, explicit })

    console.log(`[ROUTER] intent=${intent.type} action=${action} mode=${tutorMode} phase=${nextPhase} lesson=${nextLessonIndex}`)

    // Base next state — always sync both lastTask (legacy) and lastAction
    let nextState: Partial<SessionState> = {
      ...enrichedState,
      tutorMode,
      tutorPhase:    nextPhase,
      lastAction:    action,
      lastTask:      action,   // keep legacy field in sync during transition
      lessonIndex:   nextLessonIndex,
      courseActive:  nextCourseActive,
    }

    // ── 5a. Pronunciation ─────────────────────────
    if (action === 'pronunciation') {
      try {
        const mentorText = await getMentorResponse(message ?? '', nextState, systemDirective)
        const tts = await generateSpeech(mentorText ?? '', { voice: 'nova', speed: 0.9 })
        nextState = { ...nextState, tokens: (nextState.tokens ?? 0) + 1 }
        return ok({
          message:      mentorText ?? 'Pronunciation guidance:',
          artifact:     tts.success && tts.url ? audioArtifact(tts.url) : null,
          ttsAvailable: tts.success,
          ttsError:     tts.success ? null : tts.message,
          state:        nextState,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: `No se pudo generar la guía de pronunciación: ${msg}`, state: nextState })
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
        // Get quiz question from mentor (structured text output)
        const quizText = await getMentorResponse(message ?? '', nextState, systemDirective)

        // Try to parse a structured quiz from the text
        const quizArtifact = parseQuizFromText(
          quizText ?? '',
          nextState.topic  ?? 'Spanish',
          nextState.level  ?? 'A1'
        )

        if (quizArtifact) {
          // Set awaitingQuizAnswer flag — protocol won't advance until feedback
          nextState = { ...nextState, awaitingQuizAnswer: true, tokens: (nextState.tokens ?? 0) + 1 }
          return ok({
            message:  quizArtifact.content.title + ':',
            artifact: quizArtifact,
            state:    nextState,
          })
        }

        // Fallback: return as text if parsing fails (model may include extra context)
        nextState = { ...nextState, awaitingQuizAnswer: true, tokens: (nextState.tokens ?? 0) + 1 }
        return ok({ message: quizText ?? 'Quiz:', artifact: null, state: nextState })

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
      let ragContext = null
      try { ragContext = await getRagContext(message ?? '') } catch { /* non-critical */ }
      const msg = ragContext
        ? `${message}\n\n[Contexto de referencia — integrar naturalmente:]\n${ragContext.text}`
        : (message ?? '')
      const lessonText = await getMentorResponse(msg, nextState, systemDirective)
      nextState = { ...nextState, tokens: (nextState.tokens ?? 0) + 1 }
      return ok({ message: lessonText ?? '', artifact: null, state: nextState })
    }

    // ── 5i. CONVERSATION (default + free practice) ─
    // Also handles cases where protocol resolves to conversation mode
    let ragContext = null
    try { ragContext = await getRagContext(message ?? '') } catch { /* non-critical */ }

    const msgWithContext = ragContext
      ? `${message}\n\n[Contexto de referencia — integrar naturalmente, no citar literalmente:]\n${ragContext.text}`
      : (message ?? '')

    const mentorResponse = await getMentorResponse(msgWithContext, nextState, systemDirective)
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
    nextState = { ...nextState, tokens: (nextState.tokens ?? 0) + 1 }

    return ok({ message: finalResponse, artifact: ttsArtifact, state: nextState })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CHAT ROUTE] Fatal:', msg)
    return ok({ message: 'Error interno. Por favor intenta de nuevo.', error: msg }, 500)
  }
}
