import OpenAI, { toFile } from 'openai'
import { uploadToS3 } from './storage'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ─── STT: Whisper transcription ────────────────────
export async function transcribeAudio(audio: { data: string; format?: string }) {
  try {
    const format = audio?.format || 'webm'
    const buffer = Buffer.from(audio.data, 'base64')
    const file   = await toFile(buffer, `recording.${format}`, { type: `audio/${format}` })

    const transcription = await openai.audio.transcriptions.create({
      file,
      model:           'whisper-1',
      response_format: 'verbose_json',
    }) as { text: string; language?: string; segments?: unknown[] }

    return {
      success:  true,
      text:     transcription.text,
      language: transcription.language || null,
      segments: transcription.segments || [],
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[AUDIO] Transcription error:', msg)
    return { success: false, text: '', error: 'transcription_failed', message: msg }
  }
}

// ─── TTS: OpenAI speech synthesis ─────────────────
const TTS_REQUEST_CHARS = 4096
/** One response carries the audio inline; above this the student gets a visible failure, not a cut. */
export const TTS_RESOURCE_LIMITS = { chunkChars: 3800, maxBytes: 3_200_000 } as const

/** Split at paragraph, then sentence, then word boundaries; never drops a character. */
export function splitForSpeech(text: string, max: number = TTS_RESOURCE_LIMITS.chunkChars): string[] {
  const out: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let at = window.lastIndexOf('\n\n')
    if (at < max * 0.4) { const m = [...window.matchAll(/[.!?…。؟](?=\s)/g)].pop(); at = m ? (m.index ?? 0) + 1 : -1 }
    if (at < max * 0.4) at = window.lastIndexOf(' ')
    if (at <= 0) at = max
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) out.push(rest)
  return out
}

/**
 * Speak what the student SEES of a Tutor text: the canonical rendering's visible text (no Markdown
 * syntax read aloud), complete, in order. Long text is synthesized in consecutive parts and joined
 * into one MP3. 7.4 cut every reply at 3000–4096 characters without saying so.
 */
export async function speakTutorText(
  source: string,
  options: { voice?: string; speed?: number; model?: string } = {},
): Promise<{ success: boolean; url?: string; method?: string; error?: string; message?: string; parts?: number }> {
  const { renderTutorMarkdown, visibleText } = await import('../../lib/content/markdown')
  const spoken = visibleText(renderTutorMarkdown(source)).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
  if (!spoken) return { success: false, error: 'tts_empty', message: 'no hay texto que leer' }
  if (!process.env.OPENAI_API_KEY) return { success: false, error: 'no_api_key', message: 'TTS not available: API key not configured.' }
  const parts = splitForSpeech(spoken)
  const buffers: Buffer[] = []
  try {
    for (const part of parts) {
      const response = await openai.audio.speech.create({ model: options.model || 'tts-1', voice: (options.voice || 'nova') as 'nova', input: part, speed: options.speed || 1.0, response_format: 'mp3' })
      buffers.push(Buffer.from(await response.arrayBuffer()))
      const size = buffers.reduce((n, b) => n + b.length, 0)
      if (size > TTS_RESOURCE_LIMITS.maxBytes && !process.env.S3_BUCKET)
        return { success: false, error: 'tts_too_large', message: `el audio completo superaría ${Math.round(TTS_RESOURCE_LIMITS.maxBytes / 1e6)} MB, el máximo que se puede entregar en una respuesta; pide la lectura por partes` }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[TTS] Error:', msg)
    return { success: false, error: 'tts_failed', message: msg }
  }
  const buffer = Buffer.concat(buffers)
  const s3Url = await uploadToS3(buffer, `tts/${Date.now()}.mp3`, 'audio/mpeg')
  if (s3Url) return { success: true, url: s3Url, method: 's3', parts: parts.length }
  return { success: true, url: `data:audio/mpeg;base64,${buffer.toString('base64')}`, method: 'dataurl', parts: parts.length }
}
export async function generateSpeech(
  text: string,
  options: { voice?: string; speed?: number; model?: string } = {}
): Promise<{ success: boolean; url?: string; method?: string; error?: string; message?: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { success: false, error: 'no_api_key', message: 'TTS not available: API key not configured.' }
  }
  try {
    const voice = options.voice || 'nova'
    const model = options.model || 'tts-1'
    const speed = options.speed || 1.0
    // The provider accepts at most 4096 characters per request; speakTutorText() splits longer text.
    // Never cut silently here: a caller that sends more gets an explicit failure.
    const clean = String(text || '')
    if (clean.length > TTS_REQUEST_CHARS) return { success: false, error: 'tts_too_long', message: `texto de ${clean.length} caracteres en una sola petición de voz` }

    const response = await openai.audio.speech.create({
      model, voice, input: clean, speed,
      response_format: 'mp3',
    })

    const buffer = Buffer.from(await response.arrayBuffer())
    const key    = `tts/${Date.now()}.mp3`

    const s3Url = await uploadToS3(buffer, key, 'audio/mpeg')
    if (s3Url) return { success: true, url: s3Url, method: 's3' }

    return {
      success: true,
      url:    `data:audio/mpeg;base64,${buffer.toString('base64')}`,
      method: 'dataurl',
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[TTS] Error:', msg)
    return { success: false, error: 'tts_failed', message: msg }
  }
}

// ─── Pronunciation evaluation ─────────────────────
export async function evaluatePronunciation(
  transcribedText: string,
  targetText: string,
  userLang?: string | null
) {
  if (!transcribedText || !targetText) {
    return {
      success: false,
      error:   'missing_input',
      message: 'Both transcribed text and target text are required.',
    }
  }
  try {
    const lang = userLang || 'en'
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Eres un coach de pronunciacion de espanol nativo. Analiza la pronunciacion del estudiante comparando lo que dijo con lo que debia decir.
Responde en el idioma del estudiante (${lang}) para el feedback, pero usa ejemplos en espanol.
Se concreto, amable y practico. Maximo 120 palabras.
Formato exacto:
SCORE: [numero 1-10]
FEEDBACK: [observacion principal]
ERRORS: [errores especificos si los hay, o "Ninguno detectado"]
TIP: [un consejo practico concreto]`,
        },
        {
          role: 'user',
          content: `Texto objetivo: "${targetText}"\nTexto transcrito: "${transcribedText}"`,
        },
      ],
      temperature: 0.3,
      max_tokens:  200,
    })

    const feedbackText = completion.choices?.[0]?.message?.content || ''
    const scoreMatch   = feedbackText.match(/SCORE:\s*(\d+)/)
    const score        = scoreMatch ? parseInt(scoreMatch[1]) : null

    const spokenLines = feedbackText
      .split('\n')
      .filter(l => l.startsWith('FEEDBACK:') || l.startsWith('TIP:'))
      .map(l => l.replace(/^(FEEDBACK:|TIP:)\s*/, ''))
      .join('. ')

    const tts = await generateSpeech(spokenLines || feedbackText, { voice: 'nova', speed: 0.95 })

    return {
      success:       true,
      score,
      feedbackText,
      audioFeedback: tts.success ? { url: tts.url!, method: tts.method! } : null,
      ttsAvailable:  tts.success,
      ttsError:      tts.success ? null : tts.message,
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[PRONUNCIATION] Error:', msg)
    return { success: false, error: 'evaluation_failed', message: msg }
  }
}
