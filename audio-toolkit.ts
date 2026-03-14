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
    const clean = String(text || '').slice(0, 4096)

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
