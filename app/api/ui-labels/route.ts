import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { UI_LABEL_KEYS } from '@/app/beta/seed-locale-data'

// One bounded translation of fixed UI chrome per locale. No user text, student memory, Tutor
// decisions, or curriculum passes through this auxiliary presentation-only service.
export const runtime = 'nodejs'
const MODEL = 'gpt-5.6-sol'
const cache = new Map<string, Record<string, string>>()
const pending = new Map<string, Promise<Record<string, string>>>()
const calls: number[] = []
const langRE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/
const required = [...UI_LABEL_KEYS]
const maxLength = 200
const api = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1, timeout: 25000 })

async function translate(language: string) {
  if (process.env.OPENAI_MAIN_MODEL !== MODEL) throw Error('model_config_invalid')
  const now = Date.now()
  while (calls.length && calls[0] < now - 3600_000) calls.shift()
  if (calls.length >= 16) throw Error('translation_budget_exhausted')
  calls.push(now)
  const response = await api.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 9000,
    reasoning_effort: 'none',
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You translate only static buttons, status labels and control text in a language-learning web application. Preserve the semantic function of each control. Output one valid JSON object whose keys are EXACTLY the source Spanish keys provided and values are fluent translations in the requested BCP-47 language. Never change a key, omit a key, add a key, include explanations, or translate product names, code identifiers or ISO language codes. Security, deletion and local-only storage statements must retain their full meaning. No markdown.' },
      { role: 'user', content: JSON.stringify({ language, keys: required }) },
    ],
  })
  if (response.model !== MODEL) throw Error('model_identity_unverified')
  const msg = response.choices[0]?.message?.content
  if (!msg) throw Error('translation_empty')
  const raw: unknown = JSON.parse(msg)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('translation_invalid')
  const data = raw as Record<string, unknown>
  if (Object.keys(data).length !== required.length) throw Error('translation_wrong_cardinality')
  const result: Record<string, string> = {}
  for (const key of required) {
    const v = data[key]
    if (typeof v !== 'string' || v.length === 0 || v.length > maxLength * 3) throw Error('translation_missing_key')
    result[key] = v
  }
  cache.set(language, result)
  return result
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (origin && new URL(origin).host !== request.nextUrl.host) return NextResponse.json({ error: 'cross_origin' }, { status: 403 })
  let input: unknown
  try { input = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const code = input && typeof input === 'object' ? (input as Record<string, unknown>).language : null
  if (typeof code !== 'string' || !langRE.test(code)) return NextResponse.json({ error: 'invalid_language' }, { status: 400 })
  const language = code.toLowerCase()
  if (language === 'es' || language.startsWith('es-')) return NextResponse.json({ language, labels: Object.fromEntries(required.map(k => [k, k])) })
  let work = pending.get(language)
  if (!work) {
    if (cache.has(language)) return NextResponse.json({ language, labels: cache.get(language) })
    work = translate(language).finally(() => { pending.delete(language) })
    pending.set(language, work)
  }
  try { return NextResponse.json({ language, labels: await work }) }
  catch (error) {
    const reason = error instanceof Error ? error.message : 'translation_failed'
    console.warn('[ui-locale]', reason)
    return NextResponse.json({ error: 'locale_unavailable' }, { status: 503 })
  }
}
