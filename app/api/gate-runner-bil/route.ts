// DIAGNOSTIC 7.4.1 — diagnostic branch only. Real Tutor request (Arabic/Spanish SER/ESTAR, PDF+HTML) against a candidate preview, then idempotent retry.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const S0: any = { activeMode: 'interact', tutorPhase: 'guide', tokens: 0, interfaceLanguage: 'es', masteryByModule: {}, depthMode: 'standard', explanatoryLanguage: 'ar', mentorProfile: 'sarah' }
const ASK = 'Soy Zakia, hablo árabe y quiero aprender español para el examen DELE A2. Explícame en árabe la diferencia entre SER y ESTAR con ejemplos, tablas, ejercicios y respuestas, y dame ese mismo material en PDF y en HTML interactivo.'

// same projection as server/tools/pdf/documentFidelity.ts#fidelityTokens
const tok = (v: string): string[] => v.replace(/[*_\x60]/g, '').toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []
const textOfHtml = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<\/?(?:bdi|strong|em|span|b|i)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const strip = (t: string) => t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')

async function post(base: string, share: string, body: any) {
  const t0 = Date.now()
  const r = await fetch(`https://${base}/api/chat?_vercel_share=${share}`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const raw = await r.text()
  let json: any = null
  try { json = JSON.parse(raw) } catch {}
  return { status: r.status, ct: r.headers.get('content-type') || '', json, raw, ms: Date.now() - t0 }
}

async function bytesOf(url: string, base: string, share: string): Promise<Buffer | null> {
  try {
    if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), url.includes(';base64') ? 'base64' : 'utf8')
    const abs = url.startsWith('http') ? url : `https://${base}${url}`
    const u = new URL(abs); if (!u.searchParams.has('_vercel_share') && u.host === base) u.searchParams.set('_vercel_share', share)
    const r = await fetch(u.toString(), { cache: 'no-store' }); if (!r.ok) return null
    return Buffer.from(await r.arrayBuffer())
  } catch { return null }
}

function lostTokens(source: string, html: string) {
  const rem = new Map<string, number>()
  for (const w of tok(textOfHtml(html))) rem.set(w, (rem.get(w) ?? 0) + 1)
  const src = tok(strip(source)); const lost: string[] = []
  for (const w of src) { const c = rem.get(w) ?? 0; if (c > 0) rem.set(w, c - 1); else lost.push(w) }
  return { source: src.length, lost: lost.length, sample: lost.slice(0, 8) }
}

async function inspect(arts: any[], source: string, base: string, share: string) {
  const out: any[] = []
  for (const a of arts || []) {
    const rec: any = { type: a?.type, title: a?.title, hasUrl: !!a?.url, hasWebUrl: !!a?.webUrl }
    if (a?.url) { const b = await bytesOf(a.url, base, share); rec.pdfBytes = b?.length ?? null; rec.pdfMagic = b ? b.slice(0, 5).toString() : null; rec.pdfPages = b ? (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length : null }
    if (a?.webUrl) {
      const b = await bytesOf(a.webUrl, base, share); const h = b ? b.toString('utf8') : ''
      rec.htmlBytes = b?.length ?? null; rec.htmlInteractive = /<details class="ln-sec"/.test(h) && /id="ln-collapse"/.test(h); rec.htmlTables = (h.match(/<table class="ln-table"/g) || []).length
      rec.htmlFidelity = lostTokens(source, h); rec.htmlExternalRefs = /(?:src|href)="https?:/.test(h)
    }
    out.push(rec)
  }
  return out
}

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === 'production') return NextResponse.json({ error: 'disabled' }, { status: 404 })
  const u = new URL(req.url)
  const base = u.searchParams.get('target') || '', share = u.searchParams.get('share') || ''
  if (!/^lingora-[a-z0-9-]+-adolfobalaguer7-1860s-projects\.vercel\.app$/.test(base) || !share) return NextResponse.json({ error: 'bad target' }, { status: 400 })
  const step = u.searchParams.get('step') || 'ask'
  try {
    if (step === 'ask') {
      const r = await post(base, share, { message: ASK, state: S0, conversationHistory: [], stream: false })
      const j = r.json || {}
      const text = String(j.message ?? '')
      const arts = Array.isArray(j.artifacts) ? j.artifacts : []
      const insp = await inspect(arts, text, base, share)
      const pdf = insp.find(x => x.type === 'pdf')
      return NextResponse.json({
        gate: 'BIL-ask', status: r.status, ms: r.ms, textChars: text.length, textHead: text.slice(0, 160),
        artifacts: insp, artifactFailures: j.artifactFailures ?? null, artifactSignals: j.artifactSignals ?? null, suggestedActions: (j.suggestedActions ?? []).map((a: any) => a?.action || a?.type),
        pass: r.status === 200 && text.length > 800 && !!pdf && pdf.pdfMagic === '%PDF-' && (pdf.pdfPages ?? 0) >= 1 && pdf.hasWebUrl && pdf.htmlInteractive === true && pdf.htmlFidelity?.lost === 0 && !(j.artifactFailures?.length),
      })
    }
    if (step === 'retry') {
      // 1 real Tutor turn to obtain the genuine visible Tutor text, then the user-side retry twice (no model call on retry).
      const ask = await post(base, share, { message: ASK, state: S0, conversationHistory: [], stream: false })
      const text = String(ask.json?.message ?? '')
      const sig = (ask.json?.artifactSignals ?? [])[0] ?? { type: 'emit_pdf', trigger: 'explicit_user_request', subject: 'الفرق بين SER و ESTAR', format: 'pdf_html' }
      const body = { message: 'Reintentar entrega', state: S0, conversationHistory: [], uiAction: 'retry_delivery', retrySignals: [sig], materialText: text }
      const a = await post(base, share, body); const b = await post(base, share, body)
      const ia = await inspect(a.json?.artifacts || [], text, base, share), ib = await inspect(b.json?.artifacts || [], text, base, share)
      const shape = (x: any[]) => JSON.stringify(x.map(y => [y.type, y.pdfMagic, y.pdfPages, y.htmlTables, y.htmlFidelity?.lost]))
      return NextResponse.json({
        gate: 'BIL-retry', textLen: text.length, askMs: ask.ms,
        first: { status: a.status, retryOf: a.json?.retryOf, message: a.json?.message, failures: a.json?.artifactFailures ?? null, arts: ia, ms: a.ms },
        second: { status: b.status, message: b.json?.message, arts: ib, ms: b.ms }, idempotentShape: shape(ia) === shape(ib),
        pass: a.status === 200 && a.json?.retryOf === true && ia.length === 1 && ia[0].pdfMagic === '%PDF-' && ia[0].htmlFidelity?.lost === 0 && shape(ia) === shape(ib) && a.ms < 60000,
      })
    }
    return NextResponse.json({ error: 'bad step' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ gate: 'BIL', error: String(e?.message ?? e) }, { status: 500 }) }
}
