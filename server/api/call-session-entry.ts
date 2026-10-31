// LINGORA 7.6 R2 — CALL MODE session. Mints two short-lived client secrets (listening, speaking) so the browser
// talks to the speech services directly: no gateway, no long-lived key in the client, no model deciding content.
// Errors carry a code only (no provider text, model id or configuration).
import { NextRequest, NextResponse } from 'next/server'
import { callVoiceFor, sttSessionConfig, ttsSessionConfig } from '../../lib/voice/call/protocol'

const SECRET_URL = 'https://api.openai.com/v1/realtime/client_secrets'
const TTL_SECONDS = 300

async function mint(session: unknown, key: string): Promise<string | null> {
  try {
    const r = await fetch(SECRET_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: TTL_SECONDS }, session }) })
    if (!r.ok) return null
    const j = await r.json() as { value?: unknown }
    return typeof j.value === 'string' ? j.value : null
  } catch { return null }
}

function sameOrigin(req: NextRequest): boolean {
  const o = req.headers.get('origin'); if (!o) return true
  try { return new URL(o).host === (req.headers.get('x-forwarded-host') || req.headers.get('host')) } catch { return false }
}

// Light per-instance throttle: a call needs one session per ~5 minutes.
const hits = new Map<string, number[]>()
function throttled(ip: string): boolean {
  const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < 60_000)
  a.push(now); hits.set(ip, a); return a.length > 12
}

export async function POST(req: NextRequest): Promise<Response> {
  const h = { 'Cache-Control': 'no-store' }
  if (!sameOrigin(req)) return NextResponse.json({ error: 'call_forbidden' }, { status: 403, headers: h })
  const key = process.env.OPENAI_API_KEY
  if (!key) return NextResponse.json({ error: 'call_unavailable' }, { status: 503, headers: h })
  if (throttled((req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim())) return NextResponse.json({ error: 'call_rate_limited' }, { status: 429, headers: h })
  let body: { mentor?: unknown; language?: unknown } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  const language = typeof body.language === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(body.language) ? body.language.slice(0, 2) : undefined
  const voice = callVoiceFor(body.mentor)
  const [stt, tts] = await Promise.all([mint(sttSessionConfig(language), key), mint(ttsSessionConfig(voice), key)])
  if (!stt || !tts) return NextResponse.json({ error: 'call_unavailable' }, { status: 502, headers: h })
  return NextResponse.json({ stt, tts, voice, expiresInSeconds: TTL_SECONDS }, { headers: h })
}
