// LINGORA 7.5 P1-A — the speech capabilities of the voice conversation. Instruments only: they hear and they
// speak; the Tutor Maestro alone decides what is said. Each call reports the provider model that served it.
//
// Recognition: a transcription model with a language hint and conversational context, confidence kept as
// `uncertain` fragments; silence and recognizer artefacts are "nothing heard", never an invented utterance.
// Synthesis: the exact visible text of one sentence, streamed back as audio while it is produced.
// Model choice: an explicit setting (LINGORA_ASR_MODEL / LINGORA_TTS_MODEL) or the candidates below in order;
// a model the provider refuses is skipped for this instance and the next candidate serves. That fallback is
// for the instruments only — the Tutor model stays pinned (server/mentors/mentor-engine.ts).
import OpenAI, { toFile } from 'openai'
import { audioFileName, uncertainFromLogprobs, factsFromSegments, looksLikeAsrArtefact } from '../../lib/voice/asr-facts'

// Created on first use: a build (or a route that is never called) must not need the provider key.
let client: OpenAI | null = null
const provider = () => (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))

const refused = new Set<string>()
const candidates = (env: string | undefined, defaults: string[]) => (env?.trim() ? [env.trim()] : defaults).filter(m => !refused.has(m))
const isModelRefusal = (e: unknown) => {
  const x = e && typeof e === 'object' ? e as { status?: number; code?: string | null } : {}
  return x.status === 404 || x.status === 403 || (x.status === 400 && typeof x.code === 'string' && /model/i.test(x.code)) || (typeof x.code === 'string' && /model_not_found/.test(x.code))
}
const errInfo = (e: unknown) => { const x = e && typeof e === 'object' ? e as { status?: number; code?: string | null; name?: string } : {}; return { status: x.status ?? null, code: x.code ?? null, class: x.name ?? 'Error' } }

export const ASR_MODELS = ['gpt-4o-transcribe', 'whisper-1']
export const TTS_MODELS = ['gpt-4o-mini-tts', 'tts-1']

export type Recognition =
  | { ok: true; text: string; uncertain: string[]; model: string; ms: number }
  | { ok: false; reason: 'nothing_heard' | 'unreadable_audio' | 'asr_unavailable'; model: string | null; ms: number }

export async function recognizeSpeech(audio: { base64: string; mime?: string }, opts: { languageHint?: string; context?: string } = {}): Promise<Recognition> {
  const t0 = Date.now()
  const bytes = Buffer.from(audio.base64, 'base64')
  if (bytes.length < 1200) return { ok: false, reason: 'nothing_heard', model: null, ms: 0 }
  const { name, type } = audioFileName(audio.mime)
  let lastModel: string | null = null
  for (const model of candidates(process.env.LINGORA_ASR_MODEL, ASR_MODELS)) {
    lastModel = model
    try {
      const file = await toFile(bytes, name, { type })
      const base = { file, model, ...(opts.languageHint ? { language: opts.languageHint } : {}), ...(opts.context ? { prompt: opts.context } : {}) }
      if (model.startsWith('whisper')) {
        const r = await provider().audio.transcriptions.create({ ...base, response_format: 'verbose_json' }) as unknown as { text?: string; segments?: Array<{ text?: string; avg_logprob?: number; no_speech_prob?: number }> }
        const text = (r.text ?? '').trim(), f = factsFromSegments(r.segments)
        if (f.noSpeech || looksLikeAsrArtefact(text)) return { ok: false, reason: 'nothing_heard', model, ms: Date.now() - t0 }
        return { ok: true, text, uncertain: f.uncertain, model, ms: Date.now() - t0 }
      }
      const r = await provider().audio.transcriptions.create({ ...base, response_format: 'json', include: ['logprobs'] } as never) as unknown as { text?: string; logprobs?: Array<{ token: string; logprob: number }> }
      const text = (r.text ?? '').trim()
      if (looksLikeAsrArtefact(text)) return { ok: false, reason: 'nothing_heard', model, ms: Date.now() - t0 }
      return { ok: true, text, uncertain: uncertainFromLogprobs(r.logprobs), model, ms: Date.now() - t0 }
    } catch (e) {
      console.error('[asr]', JSON.stringify({ model, ...errInfo(e) }))
      if (isModelRefusal(e)) { refused.add(model); continue }
      const x = e && typeof e === 'object' ? e as { status?: number } : {}
      return { ok: false, reason: x.status === 400 ? 'unreadable_audio' : 'asr_unavailable', model, ms: Date.now() - t0 }
    }
  }
  return { ok: false, reason: 'asr_unavailable', model: lastModel, ms: Date.now() - t0 }
}

const VOICE_STYLE = 'Habla con voz natural, cálida y clara, a ritmo conversacional. Pronuncia el español con claridad para un estudiante; lee los ejemplos en otros idiomas con su pronunciación.'
export const SPEECH_TEXT_LIMIT = 1500

/** One sentence (or short paragraph) of the Tutor's visible text, as an MP3 stream. */
export async function synthesizeSpeech(text: string, voice: string): Promise<{ ok: true; body: ReadableStream<Uint8Array>; model: string } | { ok: false; reason: 'speech_empty' | 'speech_too_long' | 'speech_unavailable' }> {
  const input = text.trim()
  if (!input) return { ok: false, reason: 'speech_empty' }
  if (input.length > SPEECH_TEXT_LIMIT) return { ok: false, reason: 'speech_too_long' }
  for (const model of candidates(process.env.LINGORA_TTS_MODEL, TTS_MODELS)) {
    try {
      const res = await provider().audio.speech.create({ model, voice: voice as 'nova', input, response_format: 'mp3', ...(model.startsWith('gpt-') ? { instructions: VOICE_STYLE } : {}) })
      if (!res.body) throw Object.assign(new Error('no body'), { status: 502 })
      return { ok: true, body: res.body as unknown as ReadableStream<Uint8Array>, model }
    } catch (e) {
      console.error('[tts]', JSON.stringify({ model, ...errInfo(e) }))
      if (isModelRefusal(e)) { refused.add(model); continue }
      return { ok: false, reason: 'speech_unavailable' }
    }
  }
  return { ok: false, reason: 'speech_unavailable' }
}
