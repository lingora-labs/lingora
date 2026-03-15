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
import { generateSpeech, evaluatePronunciation, transcribeAudio } from '@/server/tools/audio-toolkit'
import { processAttachment } from '@/server/tools/attachment-processor'
import type {
  MessagePayload,
  ChatResponse,
  SessionState,
  ArtifactPayload,
  AudioArtifact,
} from '@/lib/contracts'

export const runtime = 'nodejs'
export const maxDuration = 30

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function ok(body: ChatResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-LINGORA-Version': 'v10.1'
    }
  })
}

function audioArtifact(url: string): AudioArtifact {
  return {
    type: 'audio',
    url,
    method: url.startsWith('data:') ? 'dataurl' : 's3'
  }
}

export async function GET() {
  const rag = await getRagStats().catch(() => ({}))

  return NextResponse.json({
    status: 'healthy',
    version: 'v10.1',
    system: 'LINGORA',
    platform: 'vercel-nextjs',
    timestamp: new Date().toISOString(),
    rag,
    environment: {
      openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
      storageConfigured: Boolean(process.env.S3_BUCKET),
      awsConfigured: Boolean(process.env.AWS_ACCESS_KEY_ID),
      ttsEnabled: process.env.LINGORA_TTS_ENABLED === 'true'
    }
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
      ttsRequested = false,
      pronunciationTarget = null
    } = body

    if ((message || '').trim() === '*1357*#') {
      const ragStats = await getRagStats().catch(() => ({ error: 'unavailable' }))

      return ok({
        message: 'LINGORA v10.1 · Diagnostico activo',
        diagnostic: {
          system: 'LINGORA',
          version: 'v10.1',
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
            commercial: true
          },
          environment: {
            openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
            storageConfigured: Boolean(process.env.S3_BUCKET),
            awsConfigured: Boolean(process.env.AWS_ACCESS_KEY_ID),
            ttsEnabled: process.env.LINGORA_TTS_ENABLED === 'true'
          },
          state: {
            activeMentor: state.mentor ?? 'unknown',
            level: state.level ?? 'A0',
            tokens: state.tokens ?? 0,
            lastTask: state.lastTask ?? null,
            lastArtifact: state.lastArtifact ?? null
          },
          rag: ragStats,
          commercial: commercialDebug(state)
        }
      })
    }

    if (diagnostic) {
      const report = evaluateLevel(samples.length ? samples : (state.samples ?? []))
      return ok({ message: '', diagnostic: report, state })
    }

    if (audio) {
      const tx = await transcribeAudio(audio)

      if (!tx.success) {
        return ok({
          message: `Could not transcribe audio: ${tx.message ?? 'unknown error'}`,
          state
        })
      }

      const transcribed = tx.text

      if (pronunciationTarget) {
        const evalResult = await evaluatePronunciation(
          transcribed,
          pronunciationTarget,
          state.lang ?? 'en'
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
            state
          })
        }

        return ok({
          message: `Transcription: "${transcribed}"\n\n${evalResult.message ?? 'Could not evaluate pronunciation.'}`,
          transcription: transcribed,
          state
        })
      }

      const mentorText = await getMentorResponse(transcribed, state).catch(() => null)
      const responseText = mentorText ?? `🎤 "${transcribed}"`

      const wantsTts = ttsRequested || process.env.LINGORA_TTS_ENABLED === 'true'

      let ttsArt: ArtifactPayload | null = null

      if (wantsTts && mentorText) {
        const tts = await generateSpeech(mentorText, { voice: 'nova' })
        if (tts.success && tts.url) {
          ttsArt = audioArtifact(tts.url)
        }
      }

      return ok({
        message: responseText,
        transcription: transcribed,
        artifact: ttsArt,
        state
      })
    }

    if (files?.length) {
      try {
        const result = await processAttachment(files, state as Record<string, unknown>)
        const extracted = (result.extractedTexts ?? []).filter(Boolean)

        let analysisMessage = `File received: ${result.names.join(', ')}`

        if (extracted.length > 0) {
          const textContent = extracted.join('\n\n').slice(0, 2500)

          const prompt = `The student uploaded a file (${result.names.join(', ')}). Extracted content:\n\n${textContent}\n\nAnalyze the content: correct errors if any and provide pedagogical feedback.`

          const mentorAnalysis = await getMentorResponse(prompt, state).catch(() => null)

          analysisMessage =
            mentorAnalysis ??
            `File received: ${result.names.join(', ')}\n\n${textContent.slice(0, 500)}`
        }

        return ok({
          message: analysisMessage,
          attachments: result.urls,
          extractedTexts: extracted,
          state: result.state as Partial<SessionState>
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: `Could not process file: ${msg}`, state })
      }
    }

    const intent = detectIntent(message ?? '')
    let nextState: Partial<SessionState> = { ...state }

    if (intent.type === 'schema') {
      const schemaContent = await generateSchemaContent({
        topic: message ?? '',
        level: nextState.level ?? 'A1',
        uiLanguage: nextState.lang ?? 'en'
      })

      nextState = {
        ...nextState,
        tokens: (nextState.tokens ?? 0) + 10,
        lastTask: 'schema',
        lastArtifact: `schema:${schemaContent.title}`
      }

      return ok({
        message: 'Schema ready:',
        artifact: { type: 'schema', content: schemaContent },
        state: nextState
      })
    }

    if (intent.type === 'illustration') {
      const image = await generateImage(message ?? '')

      if (image.success && image.url) {
        return ok({
          message: 'Image ready:',
          artifact: { type: 'illustration', url: image.url },
          state: nextState
        })
      }

      return ok({
        message: `Could not generate image`,
        state: nextState
      })
    }

    const mentorResponse = await getMentorResponse(message ?? '', nextState)

    let finalResponse = (mentorResponse ?? '').trim() || 'How can I help you?'

    try {
      const commercial = commercialEngine(message ?? '', nextState)

      if (commercial.trigger) {
        finalResponse += `\n\n${commercial.trigger.message}`
      }

      if (commercial.state) {
        nextState = { ...nextState, ...commercial.state }
      }
    } catch {}

    const wantsTts = ttsRequested || process.env.LINGORA_TTS_ENABLED === 'true'

    let ttsArtifact: ArtifactPayload | null = null

    if (wantsTts && finalResponse) {
      const tts = await generateSpeech(finalResponse, { voice: 'nova' })
      if (tts.success && tts.url) {
        ttsArtifact = audioArtifact(tts.url)
      }
    }

    return ok({
      message: finalResponse,
      artifact: ttsArtifact,
      state: nextState
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)

    return ok({
      message: 'Internal server error. Please try again.',
      error: msg
    }, 500)
  }
}
