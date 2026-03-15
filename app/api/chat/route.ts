import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

import { detectIntent }       from '@/server/core/intent-detector'
import { commercialEngine, commercialDebug } from '@/server/core/commercial-engine'
import { evaluateLevel }      from '@/server/core/diagnostics'
import { getMentorResponse }  from '@/server/mentors/mentor-engine'
import { getRagContext, getRagStats } from '@/server/knowledge/rag'
import { generateSchemaContent } from '@/server/tools/schema-generator'
import { generateImage }      from '@/server/tools/image-generator'
import { generatePDF }        from '@/server/tools/pdf-generator'
import { generateSpeech, evaluatePronunciation } from '@/server/tools/audio-toolkit'
import { processAttachment }  from '@/server/tools/attachment-processor'
import type { MessagePayload, ChatResponse, SessionState } from '@/lib/contracts'

export const runtime = 'nodejs'
export const maxDuration = 30

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ─── JSON helper ─────────────────────────────────
function ok(body: ChatResponse, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// ─── MAIN HANDLER ────────────────────────────────
export async function GET() {
  const stats = await getRagStats().catch(() => ({}))
  return NextResponse.json({
    status: 'healthy', version: 'v10.1', system: 'LINGORA', platform: 'vercel-nextjs',
    timestamp: new Date().toISOString(), rag: stats,
    environment: {
      openAIConfigured:  Boolean(process.env.OPENAI_API_KEY),
      storageConfigured: Boolean(process.env.S3_BUCKET),
      awsConfigured:     Boolean(process.env.AWS_ACCESS_KEY_ID),
    },
  })
}

export async function POST(req: NextRequest) {
  try {
    const body: MessagePayload = await req.json()
    const {
      message, state = {} as Partial<SessionState>,
      audio, files,
      diagnostic = false, samples = [],
      ttsRequested = false, pronunciationTarget = null,
    } = body

    // ── Diagnostic trigger ──────────────────────
    if ((message || '').trim() === '*1357*#') {
      const ragStats = await getRagStats().catch(() => ({ error: 'unavailable' }))
      return ok({
        message: 'LINGORA v10.0 · Diagnostico activo',
        diagnostic: {
          system: 'LINGORA', version: 'v10.1', platform: 'vercel-nextjs',
          status: 'operational', timestamp: new Date().toISOString(),
          modules: { schema: true, image: true, audio: true, tts: true, pronunciation: true, rag: true, commercial: true },
          environment: {
            openAIConfigured:  Boolean(process.env.OPENAI_API_KEY),
            storageConfigured: Boolean(process.env.S3_BUCKET),
            awsConfigured:     Boolean(process.env.AWS_ACCESS_KEY_ID),
            ttsEnabled:        process.env.LINGORA_TTS_ENABLED === 'true',
          },
          state: {
            activeMentor: state.mentor || 'unknown',
            level:        state.level  || 'A0',
            tokens:       state.tokens || 0,
            lastTask:     state.lastTask    || null,
            lastArtifact: state.lastArtifact || null,
          },
          rag: ragStats,
          commercial: commercialDebug(state),
        },
      })
    }

    // ── Level diagnostic ────────────────────────
    if (diagnostic) {
      const report = evaluateLevel(samples || state.samples || [])
      return ok({ message: '', diagnostic: report, state })
    }

    // ── File processing ─────────────────────────
    if (files && files.length) {
      console.log('[ROUTER] intent=file-processing files=' + files.length)
      try {
        const result   = await processAttachment(files, state as Record<string, unknown>)
        const extracted = (result.extractedTexts || []).filter(Boolean)

        let analysisMessage = 'File received: ' + result.names.join(', ')

        if (extracted.length > 0) {
          const textContent = extracted.join('\n\n').slice(0, 2500)
          const isHonestFallback = textContent.includes('[OCR not available') ||
                                   textContent.includes('[No text detected') ||
                                   textContent.includes('[Unsupported file type')

          if (isHonestFallback) {
            analysisMessage = 'File received: ' + result.names.join(', ') + '\n\n' + textContent
          } else {
            const prompt = `The student uploaded a file (${result.names.join(', ')}). Extracted content:\n\n${textContent}\n\nAnalyze the content: correct errors if any, provide concrete pedagogical feedback, respond in the student's language if known.`
            const mentorAnalysis = await getMentorResponse(prompt, state).catch(() => null)
            analysisMessage = mentorAnalysis || ('File received: ' + result.names.join(', ') + '\n\n' + textContent.slice(0, 500))
          }
        }

        return ok({ message: analysisMessage, attachments: result.urls, extractedTexts: extracted, state: result.state as Partial<SessionState> })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[ROUTER] file-processing error:', msg)
        return ok({ message: 'Could not process file: ' + msg, state })
      }
    }

    // ── Intent routing ──────────────────────────
    const intent   = detectIntent(message || '')
    let nextState  = { ...state } as Partial<SessionState>

    // ── PRONUNCIATION ───────────────────────────
    if (intent.type === 'pronunciation') {
      console.log('[ROUTER] intent=pronunciation')
      try {
        const mentorText = await getMentorResponse(message || '', nextState)
        const tts = await generateSpeech(mentorText || message || '', { voice: 'nova', speed: 0.9 })
        nextState.lastTask = 'pronunciation'
        return ok({
          message:      mentorText || 'Here is pronunciation guidance.',
          artifact:     tts.success ? { type: 'audio', url: tts.url!, method: tts.method } as import('@/lib/contracts').AudioArtifact : null,
          ttsAvailable: tts.success,
          ttsError:     tts.success ? null : tts.message,
          state:        nextState,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: 'Could not generate pronunciation guide: ' + msg, state: nextState })
      }
    }

    // ── SCHEMA ──────────────────────────────────
    if (intent.type === 'schema') {
      console.log('[ROUTER] intent=schema tool=schema-generator')
      try {
        const schemaContent = await generateSchemaContent({
          topic:       message || '',
          level:       nextState.level || 'A1',
          uiLanguage:  nextState.lang  || 'en',
        })
        if (!schemaContent?.title) throw new Error('Invalid schema structure')
        nextState.tokens      = (nextState.tokens || 0) + 10
        nextState.lastTask    = 'schema'
        nextState.lastArtifact = 'schema:' + schemaContent.title
        console.log('[ROUTER] result=ok schema title=' + schemaContent.title)
        return ok({ message: 'Schema ready:', artifact: { type: 'schema', content: schemaContent, metadata: { timestamp: Date.now() } }, state: nextState })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[ROUTER] schema error:', msg)
        return ok({ message: 'Could not generate schema: ' + msg, artifact: null, state: nextState })
      }
    }

    // ── IMAGE ───────────────────────────────────
    if (intent.type === 'illustration') {
      console.log('[ROUTER] intent=illustration tool=image-generator')
      try {
        const image = await generateImage(message || '')
        if (image.success && image.url) {
          nextState.lastTask = 'illustration'
          nextState.lastArtifact = 'illustration'
          return ok({ message: 'Image ready:', artifact: { type: 'illustration', url: image.url }, state: nextState })
        }
        return ok({ message: 'Could not generate image: ' + (image.message || 'unknown'), artifact: null, state: nextState })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: 'Image generation error: ' + msg, artifact: null, state: nextState })
      }
    }

    // ── PDF ─────────────────────────────────────
    if (intent.type === 'pdf') {
      console.log('[ROUTER] intent=pdf tool=pdf-generator')
      try {
        const contentCompletion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'Eres un asistente pedagogico de LINGORA. Genera contenido educativo estructurado en espanol sobre el tema pedido. Empieza con el titulo en la primera linea, luego secciones separadas por linea en blanco. Maximo 600 palabras. Texto limpio.' },
            { role: 'user',   content: message || '' },
          ],
          temperature: 0.4,
          max_tokens:  800,
        })
        const pdfContent = contentCompletion.choices?.[0]?.message?.content || message || ''
        const titleLine  = pdfContent.split('\n')[0].slice(0, 80).trim()
        const pdf = await generatePDF({ title: titleLine || 'Material LINGORA', content: pdfContent, filename: 'lingora-' + Date.now() })
        if (pdf.success && pdf.url) {
          nextState.lastTask = 'pdf'
          nextState.lastArtifact = 'pdf:' + titleLine
          return ok({ message: 'PDF ready:', artifact: { type: 'pdf', url: pdf.url }, state: nextState })
        }
        return ok({ message: 'Could not generate PDF: ' + (pdf.message || 'unknown'), artifact: null, state: nextState })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return ok({ message: 'PDF generation error: ' + msg, artifact: null, state: nextState })
      }
    }

    // ── CONVERSATION ────────────────────────────
    console.log('[ROUTER] intent=conversation tool=mentor')
    let ragContext = null
    try { ragContext = await getRagContext(message || '') } catch { /* non-critical */ }

    const messageWithContext = ragContext
      ? `${message}\n\n[Reference context — integrate naturally, do not quote verbatim:]\n${ragContext.text}`
      : (message || '')

    const mentorResponse = await getMentorResponse(messageWithContext, nextState)
    let finalResponse    = (mentorResponse || '').trim() || 'How can I help you?'

    try {
      const commercial = commercialEngine(message || '', nextState)
      if (commercial.trigger) finalResponse += '\n\n' + commercial.trigger.message
      if (commercial.state)   nextState = { ...nextState, ...commercial.state }
    } catch { /* non-critical */ }

    // Optional TTS for conversation
    const wantTts = ttsRequested || process.env.LINGORA_TTS_ENABLED === 'true'
    let ttsArtifact = null
    if (wantTts && finalResponse) {
      const tts = await generateSpeech(finalResponse, { voice: 'nova' })
      if (tts.success) ttsArtifact = { type: 'audio' as const, url: tts.url!, method: tts.method! }
    }

    return ok({ message: finalResponse, artifact: ttsArtifact, state: nextState })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CHAT ROUTE] Fatal:', msg)
    return ok({ message: 'Internal server error. Please try again.', error: msg }, 500)
  }
}
