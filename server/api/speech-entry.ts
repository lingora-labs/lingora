// LINGORA 7.5 P1-A — speak one segment of text the Tutor ALREADY wrote and the student sees.
// No model decides anything here: the text is spoken as given, streamed back while it is synthesized,
// with the voice of the active mentor. The serving speech model travels in X-Lingora-Speech-Model.
// Errors carry a code only: no provider text, model id or configuration reaches the student.
import { NextRequest, NextResponse } from 'next/server'
import { synthesizeSpeech, SPEECH_TEXT_LIMIT } from '../tools/voice'
import { voiceFor } from '../core/artifact-side-effect'

export async function POST(req: NextRequest): Promise<Response> {
  let body: { text?: unknown; mentor?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'speech_bad_request' }, { status: 400 }) }
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim() || text.length > SPEECH_TEXT_LIMIT) return NextResponse.json({ error: text.trim() ? 'speech_too_long' : 'speech_empty' }, { status: 400 })
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'speech_unavailable' }, { status: 503 })
  const t0 = Date.now()
  const out = await synthesizeSpeech(text, voiceFor(body.mentor))
  if (!out.ok) return NextResponse.json({ error: out.reason }, { status: out.reason === 'speech_unavailable' ? 502 : 400 })
  return new Response(out.body, {
    headers: {
      'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store',
      'X-Lingora-Speech-Model': out.model, 'X-Lingora-Speech-Start-Ms': String(Date.now() - t0),
      'Access-Control-Expose-Headers': 'X-Lingora-Speech-Model, X-Lingora-Speech-Start-Ms',
    },
  })
}
