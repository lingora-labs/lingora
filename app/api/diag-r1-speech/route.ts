import { NextResponse } from 'next/server'
import OpenAI, { toFile } from 'openai'

// 7.6 R1 — TEMPORARY, preview-only diagnostic. Fixed texts and a closed list of models: no user input reaches the
// provider. Measures whether a candidate speech model reads the given text verbatim and how fast the first audio
// byte arrives. To be removed before any merge (R1 evidence only).
export const runtime = 'nodejs'
export const maxDuration = 60

const TEXTS = [
  'Muy bien, Ana. Ahora dime con tus propias palabras qué hiciste ayer por la tarde.',
  'Recuerda: se dice «tengo treinta y cuatro años», no «soy treinta y cuatro años». ¿Lo repites?',
]
const MODELS = ['gpt-4o-mini-tts', 'gpt-realtime-2.1-mini', 'gpt-realtime-2.1', 'gpt-realtime-mini']
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
function wordDiff(a: string[], b: string[]) {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

export async function GET() {
  if (process.env.VERCEL_ENV === 'production') return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'no_key' }, { status: 503 })
  const api = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const out: unknown[] = []
  for (const model of MODELS) {
    for (const text of TEXTS) {
      const t0 = Date.now()
      try {
        const res = await api.audio.speech.create({ model, voice: 'nova', input: text, response_format: 'mp3' })
        const reader = res.body ? (res.body as unknown as ReadableStream<Uint8Array>).getReader() : null
        if (!reader) { out.push({ model, ok: false, error: 'no_body' }); continue }
        const chunks: Uint8Array[] = []; let first = -1
        for (;;) { const { done, value } = await reader.read(); if (done) break; if (first < 0) first = Date.now() - t0; chunks.push(value) }
        const total = Date.now() - t0
        const bytes = Buffer.concat(chunks)
        let heard = '', diff: number | null = null
        try {
          const r = await api.audio.transcriptions.create({ file: await toFile(bytes, 'speech.mp3', { type: 'audio/mpeg' }), model: 'gpt-4o-transcribe', language: 'es' })
          heard = (r.text ?? '').trim(); diff = wordDiff(norm(text), norm(heard))
        } catch (e) { heard = 'asr_check_failed:' + ((e as { status?: number }).status ?? '?') }
        out.push({ model, ok: true, firstByteMs: first, totalMs: total, bytes: bytes.length, words: norm(text).length, wordDiff: diff, heard })
      } catch (e) {
        const x = e as { status?: number; code?: string | null; message?: string }
        out.push({ model, ok: false, status: x.status ?? null, code: x.code ?? null, message: String(x.message ?? '').slice(0, 160) })
      }
    }
  }
  return NextResponse.json({ at: new Date().toISOString(), sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null, results: out })
}
