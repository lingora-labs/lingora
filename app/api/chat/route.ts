import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

import { detectIntent }                      from '@/server/core/intent-detector'
import { commercialEngine, commercialDebug } from '@/server/core/commercial-engine'
import { evaluateLevel }                     from '@/server/core/diagnostics'
import { getMentorResponse }                 from '@/server/mentors/mentor-engine'
import { getRagContext, getRagStats }        from '@/server/knowledge/rag'
import { generateSchemaContent }             from '@/server/tools/schema-generator'
import { generateImage }                     from '@/server/tools/image-generator'
import { generatePDF }                       from '@/server/tools/pdf-generator'
import { generateSpeech, evaluatePronunciation, transcribeAudio } from '@/server/tools/audio-toolkit'
import { processAttachment }                 from '@/server/tools/attachment-processor'
import type {
  MessagePayload, ChatResponse, SessionState,
  ArtifactPayload, AudioArtifact,
} from '@/lib/contracts'

export const runtime = 'nodejs'
export const maxDuration = 30

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function ok(body: ChatResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-LINGORA': 'v10.2' },
  })
}

function audioArtifact(url: string): AudioArtifact {
  return { type: 'audio', url, method: url.startsWith('data:') ? 'dataurl' : 's3' }
}

function buildAutoSchemaPrompt(state: Partial<SessionState>): string {
  const topic = state.topic || 'conversación'
  const level = state.level || 'A1'
  const samples = state.samples ?? []
  const lastTask = state.lastTask || ''

  const recentContext = samples.slice(-3).join(' ').slice(0, 200)
  const themeHint = recentContext.length > 20 ? `Contexto reciente: "${recentContext}".` : ''

  return `[SISTEMA: SCHEMA PEDAGÓGICO AUTOMÁTICO — NO MOSTRAR AL USUARIO]
Genera un esquema de refuerzo compacto y relevante para el progreso actual.
Tema base: ${topic}. Nivel: ${level}. ${themeHint}
El schema debe reforzar el punto gramatical o vocabulario más relevante del contexto.
No debe repetir lo último discutido palabra a palabra.
No debe parecer generado automáticamente en el contenido.
${lastTask ? `Última tarea del estudiante: ${lastTask}.` : ''}`
}

export async function GET() {
  const rag = await getRagStats().catch(() => ({}))
  return NextResponse.json({
    status: 'healthy',
    version: 'v10.2',
    system: 'LINGORA',
    platform: 'vercel-nextjs',
    timestamp: new Date().toISOString(),
    rag,
    environment: {
      openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
      storageConfigured: Boolean(process.env.S3_BUCKET),
      awsConfigured: Boolean(process.env.AWS_ACCESS_KEY_ID),
      ttsEnabled: process.env.LINGORA_TTS_ENABLED === 'true',
    },
  })
}

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

    if ((message ?? '').trim() === '*1357*#') {
      const ragStats = await getRagStats().catch(() => ({ error: 'unavailable' }))
      return ok({
        message: 'LINGORA v10.2 · Diagnostico activo',
        diagnostic: {
          system: 'LINGORA',
          version: 'v10.2',
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
            autoSchema: true,
          },
          environment: {
            openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
            storageConfigured: Boolean(process.env.S3_BUCKET),
            awsConfigured: Boolean(process.env.AWS_ACCESS_KEY_ID),
            ttsEnabled: process.env.LINGORA_TTS_ENABLED === 'true',
          },
          state: {
            activeMentor: state.mentor ?? 'unknown',
            level: state.level ?? 'A0',
            tokens: state.tokens ?? 0,
            lastTask: state.lastTask ?? null,
            lastArtifact: state.lastArtifact ?? null,
          },
          rag: ragStats,
          commercial: commercialDebug(state),
        },
      })
    }

    if (diagnostic) {
      const report = evaluateLevel(samples.length ? samples : (state.samples ?? []))
      return ok({ message: '', diagnostic: report, state })
    }

    if (autoSchema) {
      const tokenCount = state.tokens ?? 0
      const sampleCount = (state.samples ?? []).length

      if (tokenCount < 3 || sampleCount < 2) {
        return ok({ message: '', artifact: null, state })
      }

      const autoPrompt = buildAutoSchemaPrompt(state)

      try {
        const schemaContent = await generateSchemaContent({
          topic: autoPrompt,
          level: state.level ?? 'A1',
          uiLanguage: state.lang ?? 'en',
        })

        if (!schemaContent?.title) {
          return ok({ message: '', artifact: null, state })
        }

        const nextState: Partial<SessionState> = {
          ...state,
          lastTask: 'schema',
          lastArtifact: `schema:${schemaContent.title}`,
        }

        return ok({
          message: '📋 Refuerzo pedagógico:',
          artifact: {
            type: 'schema',
            content: schemaContent,
            metadata: { timestamp: Date.now() },
          },
          state: nextState,
        })
      } catch {
        return ok({ message: '', artifact: null, state })
      }
    }

    if (audio) {
      const tx = await transcribeAudio(audio)

      if (!tx.success) {
        return ok({
          message: `No se pudo transcribir el audio: ${tx.message ?? 'error desconocido'}`,
          state,
        })
      }

      const transcribed = tx.text

      if (pronunciationTarget) {
        const evalResult = await evaluatePronunciation(transcribed, pronunciationTarget, state.lang)

        if (evalResult.success) {
          return ok({
            message: evalResult.feedbackText ?? '',
            transcription: transcribed,
            pronunciationScore: evalResult.score ?? undefined,
            artifact: evalResult.audioFeedback
              ? audioArtifact(evalResult.audioFeedback.url)
              : null,
            ttsAvailable: evalResult.ttsAvailable,
            state,
          })
        }

        return ok({
          message: `"${transcribed}"\n\n${evalResult.message ?? 'No se pudo evaluar pronunciación.'}`,
          transcription: transcribed,
          state,
        })
      }

      const mentorText = await getMentorResponse(transcribed, state).catch(() => null)
      const responseText = mentorText ?? `🎤 "${transcribed}"`
      const wantsTts = ttsRequested || process.env.LINGORA_TTS_ENABLED === 'true'
      let ttsArt: ArtifactPayload | null = null

      if (wantsTts && mentorText) {
        const tts = await generateSpeech(mentorText, { voice: 'nova' })
        if (tts.success && tts.url) ttsArt = audioArtifact(tts.url)
      }

      return ok({
        message: responseText,
        transcription: transcribed,
        artifact: ttsArt,
        state,
      })
    }

    if (files?.length) {
      console.log(`[ROUTER] intent=file-processing files=${files.length}`)

      try {
        const result = await processAttachment(files, state as Record<string, unknown>)
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
            const prompt = `El estudiante subió un archivo (${result.names.join(', ')}). Contenido extraído:\n\n${textContent}\n\nAnaliza el contenido: corrige errores si los hay, da feedback pedagógico concreto. Responde en el idioma del estudiante.`
            const mentorAnalysis = await getMentorResponse(prompt, state).catch(() => null)
            analysisMessage =
              mentorAnalysis ??
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
        console.error('[ROUTER] file-processing error:', msg)
        return ok({ message: `No se pudo procesar el archivo: ${msg}`, state })
      }
    }

    const intent = detectIntent(message ?? '')
    let nextState: Partial<SessionState> = { ...state }

    if (intent.type === 'pronunciation') {
      console.log('[ROUTER] intent=pronunciation')

      try {
        const mentorText = await getMentorResponse(message ?? '', nextState)
        const tts = await generateSpeech(mentorText ?? message ?? '', { voice: 'nova', speed: 0.9 })
        nextState = { ...nextState, lastTask: 'pronunciation' }

        return ok({
          message: mentorText ?? 'Aquí está la guía de pronunciación.',
          artifact: tts.success && tts.url ? audioArtifact(tts.url) : null,
          ttsAvailable: tts.success,
          ttsError: tts.success ? null : tts.message,
          state: nextState,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: `No se pudo generar la guía de pronunciación: ${msg}`, state: nextState })
      }
    }

    if (intent.type === 'schema') {
      console.log('[ROUTER] intent=schema tool=schema-generator')

      try {
        const schemaContent = await generateSchemaContent({
          topic: message ?? '',
          level: nextState.level ?? 'A1',
          uiLanguage: nextState.lang ?? 'en',
        })

        if (!schemaContent?.title) throw new Error('Estructura de schema inválida')

        nextState = {
          ...nextState,
          tokens: (nextState.tokens ?? 0) + 10,
          lastTask: 'schema',
          lastArtifact: `schema:${schemaContent.title}`,
        }

        console.log(`[ROUTER] result=ok schema="${schemaContent.title}"`)

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
        console.error('[ROUTER] schema error:', msg)
        return ok({ message: `No se pudo generar el schema: ${msg}`, artifact: null, state: nextState })
      }
    }

    if (intent.type === 'illustration') {
      console.log('[ROUTER] intent=illustration tool=image-generator')

      try {
        const image = await generateImage(message ?? '')

        if (image.success && image.url) {
          nextState = { ...nextState, lastTask: 'illustration', lastArtifact: 'illustration' }
          return ok({
            message: 'Imagen lista:',
            artifact: { type: 'illustration', url: image.url },
            state: nextState,
          })
        }

        return ok({
          message: `No se pudo generar la imagen: ${image.message ?? 'desconocido'}`,
          artifact: null,
          state: nextState,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: `Error al generar imagen: ${msg}`, artifact: null, state: nextState })
      }
    }

    if (intent.type === 'pdf') {
      console.log('[ROUTER] intent=pdf tool=pdf-generator')

      try {
        const contentRes = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'Eres un asistente pedagógico de LINGORA. Genera contenido educativo estructurado en español sobre el tema pedido. Empieza con el título en la primera línea, luego secciones separadas por línea en blanco. Máximo 600 palabras. Texto limpio sin markdown.',
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
          nextState = { ...nextState, lastTask: 'pdf', lastArtifact: `pdf:${titleLine}` }
          return ok({
            message: 'PDF listo:',
            artifact: { type: 'pdf', url: pdf.url },
            state: nextState,
          })
        }

        return ok({
          message: `No se pudo generar el PDF: ${pdf.message ?? 'desconocido'}`,
          artifact: null,
          state: nextState,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: `Error al generar PDF: ${msg}`, artifact: null, state: nextState })
      }
    }

    console.log('[ROUTER] intent=conversation tool=mentor')

    let ragContext = null
    try {
      ragContext = await getRagContext(message ?? '')
    } catch {
      // non-critical
    }

    const messageWithContext = ragContext
      ? `${message}\n\n[Contexto de referencia — integrar naturalmente, no citar literalmente:]\n${ragContext.text}`
      : (message ?? '')

    const mentorResponse = await getMentorResponse(messageWithContext, nextState)
    let finalResponse = (mentorResponse ?? '').trim() || 'Hola. ¿En qué puedo ayudarte?'

    try {
      const commercial = commercialEngine(message ?? '', nextState)
      if (commercial.trigger) finalResponse += `\n\n${commercial.trigger.message}`
      if (commercial.state) nextState = { ...nextState, ...commercial.state }
    } catch {
      // non-critical
    }

    const wantsTts = ttsRequested || process.env.LINGORA_TTS_ENABLED === 'true'
    let ttsArtifact: ArtifactPayload | null = null

    if (wantsTts && finalResponse) {
      const tts = await generateSpeech(finalResponse, { voice: 'nova' })
      if (tts.success && tts.url) ttsArtifact = audioArtifact(tts.url)
    }

    return ok({ message: finalResponse, artifact: ttsArtifact, state: nextState })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CHAT ROUTE] Fatal:', msg)
    return ok({ message: 'Error interno. Por favor intenta de nuevo.', error: msg }, 500)
  }
}
