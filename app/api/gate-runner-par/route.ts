// DIAGNOSTIC 7.4 — diagnostic branch only. stream:false parity against the candidate preview's real /api/chat.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const S0: any = { activeMode: 'interact', tutorPhase: 'guide', tokens: 0, interfaceLanguage: 'es', masteryByModule: {}, depthMode: 'standard', explanatoryLanguage: 'es', mentorProfile: 'alex' }

async function post(base: string, share: string, body: any) {
  const t0 = Date.now()
  const r = await fetch(`https://${base}/api/chat?_vercel_share=${share}`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const ct = r.headers.get('content-type') || ''
  const raw = await r.text()
  let json: any = null
  try { json = JSON.parse(raw) } catch {}
  let sse = ''
  let sseState: any = null
  if (ct.includes('event-stream')) {
    for (const blk of raw.split('\n\n')) {
      const l = blk.split('\n').find(x => x.startsWith('data:'))
      if (!l) continue
      let p: any; try { p = JSON.parse(l.slice(5)) } catch { continue }
      if (typeof p.delta === 'string') sse += p.delta
      if (p.done) sseState = p.state
    }
  }
  return { status: r.status, ct, json, sse, sseState, ms: Date.now() - t0 }
}

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === 'production') return NextResponse.json({ error: 'disabled' }, { status: 404 })
  const u = new URL(req.url)
  const base = u.searchParams.get('target') || '', share = u.searchParams.get('share') || ''
  if (!/^lingora-[a-z0-9-]+-adolfobalaguer7-1860s-projects\.vercel\.app$/.test(base) || !share) return NextResponse.json({ error: 'bad target' }, { status: 400 })
  const msg = 'Hola, soy Zakia, soy médica. Mi objetivo es el examen DELE A2 y lo hago en diciembre. Recuérdalo, por favor.'
  try {
    const ns = await post(base, share, { message: msg, state: S0, conversationHistory: [], stream: false })
    const st = await post(base, share, { message: msg, state: S0, conversationHistory: [] })
    const nsMem = ns.json?.state?.tutorMemory ?? null
    const stMem = st.sseState?.tutorMemory ?? null
    const results = [
      { name: 'stream:false devuelve JSON (no SSE) con message', ok: ns.status === 200 && ns.ct.includes('json') && typeof ns.json?.message === 'string' && ns.json.message.length > 20, ct: ns.ct, len: ns.json?.message?.length ?? 0, ms: ns.ms, reply: String(ns.json?.message ?? '').slice(0, 160) },
      { name: 'stream:false conserva tutorMemory tipada (paridad con stream)', ok: Array.isArray(nsMem) && nsMem.length > 0 && Array.isArray(stMem) && stMem.length > 0, nonStream: nsMem, stream: stMem },
      { name: 'stream:true sigue siendo SSE', ok: st.ct.includes('event-stream') && st.sse.length > 20, ct: st.ct, len: st.sse.length },
    ]
    return NextResponse.json({ gate: 'PAR', pass: results.filter(x => x.ok).length, total: results.length, results })
  } catch (e: any) { return NextResponse.json({ gate: 'PAR', error: String(e?.message ?? e) }, { status: 500 }) }
}
