// app/api/willy/route.ts
//
// FREE WILLY — isolated preview route. See lib/willy-motor.ts for the scope
// note (authority: directiva CEO/AE "FREE WILLY — LIBERACIÓN DEL MOTOR
// COGNITIVO", 15.10.2026; branch free-willy-preview; not merged to main).
//
// Deliberately independent of server/core (SEEK orchestrator/execution
// engine/intent router) and of lib/engineering (the GATE-01 harness, which
// has GitHub write access). This route has no write capability of any kind:
// no filesystem, no GitHub, no S3, no PDF/audio generation. It only reads
// OPENAI_API_KEY / OPENAI_MAIN_MODEL, the same environment variables the
// existing /api/chat route already reads — no new secret was introduced.

import { NextResponse } from 'next/server';
import { runWillyMotor, type WillyMessage, type WillyStatePack } from '../../../lib/willy-motor';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { message?: unknown; history?: unknown; statePack?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message : '';
  const historyRaw = Array.isArray(body.history) ? body.history : [];
  const history: WillyMessage[] = historyRaw
    .filter((h): h is WillyMessage =>
      h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    .slice(-30);
  const statePack: WillyStatePack = (body.statePack && typeof body.statePack === 'object') ? body.statePack as WillyStatePack : {};

  if (!message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  try {
    const result = await runWillyMotor(history, message, statePack);
    return NextResponse.json({
      message: result.message,
      model: result.model,
      durationMs: result.durationMs,
      preview: true,
      pipeline: 'willy-motor-isolated',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `WILLY MOTOR preview error: ${msg}` }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  // Diagnostic-only GET path: identical cognitive function as POST, exposed
  // via query string so this isolated preview can be validated from an
  // environment that can only issue GET requests to it (e.g. a sandboxed
  // fetch tool without POST/body support). No new capability, no write
  // operation — same runWillyMotor() call as POST, same env vars.
  if (q && q.trim()) {
    const historyParam = searchParams.get('h');
    let history: WillyMessage[] = [];
    if (historyParam) {
      try {
        const parsed = JSON.parse(historyParam);
        if (Array.isArray(parsed)) {
          history = parsed.filter((h): h is WillyMessage =>
            h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string').slice(-30);
        }
      } catch { /* ignore malformed history, proceed with empty */ }
    }
    try {
      const result = await runWillyMotor(history, q, {});
      return NextResponse.json({
        message: result.message,
        model: result.model,
        durationMs: result.durationMs,
        preview: true,
        pipeline: 'willy-motor-isolated',
        mode: 'diagnostic-get',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `WILLY MOTOR preview error: ${msg}` }, { status: 500 });
    }
  }

  return NextResponse.json({
    status: 'ok',
    pipeline: 'willy-motor-isolated',
    note: 'Isolated FREE WILLY preview route. No SEEK, no GATE-01 engineering tool access, no write operations.',
    openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
}
