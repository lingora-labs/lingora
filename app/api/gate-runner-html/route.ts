// DIAGNOSTIC 7.3.3f — audits what the product really delivers for an HTML request: artifact shape, webUrl, and the document behind it.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === 'production') return NextResponse.json({ error: 'disabled' }, { status: 404 })
  const u = new URL(req.url)
  const base = u.searchParams.get('target') || '', share = u.searchParams.get('share') || ''
  if (!/^lingora-[a-z0-9-]+-adolfobalaguer7-1860s-projects\.vercel\.app$/.test(base) || !share) return NextResponse.json({ error: 'bad target' }, { status: 400 })
  const state = { activeMode: 'interact', tutorPhase: 'guide', tokens: 0, interfaceLanguage: 'es', masteryByModule: {}, depthMode: 'standard', explanatoryLanguage: 'es', mentorProfile: 'sarah' }
  const msg = u.searchParams.get('msg') || 'Quiero un resumen visual en HTML interactivo de los verbos irregulares más comunes.'
  try {
    const r = await fetch(`https://${base}/api/chat?_vercel_share=${share}`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: msg, state, conversationHistory: [] }) })
    const raw = await r.text()
    let done: any = null, text = ''
    for (const blk of raw.split('\n\n')) {
      const l = blk.split('\n').find(x => x.startsWith('data:')); if (!l) continue
      let p: any; try { p = JSON.parse(l.slice(5)) } catch { continue }
      if (typeof p.delta === 'string') text += p.delta
      if (p.done) done = p
    }
    const arts: any[] = Array.isArray(done?.artifacts) ? done.artifacts : done?.artifact ? [done.artifact] : []
    const out: any[] = []
    for (const a of arts) {
      const meta: any = { type: a.type, keys: Object.keys(a), composerStatus: a.composerStatus, renderValidated: a.renderValidated, pdfByteLength: a.pdfByteLength }
      const w = a.webUrl
      meta.webUrlKind = typeof w === 'string' ? (w.startsWith('data:') ? 'data-url' : w.startsWith('http') ? 'http' : w.startsWith('/') ? 'path' : 'other') : typeof w
      if (typeof w === 'string') {
        meta.webUrlHead = w.slice(0, 60)
        let html = ''
        try {
          if (w.startsWith('data:')) { const [h, d] = [w.slice(0, w.indexOf(',')), w.slice(w.indexOf(',') + 1)]; meta.dataMime = h; html = /base64/.test(h) ? Buffer.from(d, 'base64').toString('utf8') : decodeURIComponent(d) }
          else { const url = w.startsWith('http') ? w : `https://${base}${w}${w.includes('?') ? '&' : '?'}_vercel_share=${share}`; const f = await fetch(url, { cache: 'no-store' }); meta.fetchStatus = f.status; meta.fetchType = f.headers.get('content-type'); html = await f.text() }
        } catch (e: any) { meta.fetchError = String(e?.message).slice(0, 80) }
        meta.htmlLen = html.length
        meta.isHtmlDoc = /^\s*<!doctype html|^\s*<html/i.test(html)
        meta.hasScript = /<script/i.test(html)
        meta.hasStyle = /<style/i.test(html)
        meta.textChars = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length
        meta.htmlHead = html.slice(0, 200).replace(/\s+/g, ' ')
      }
      out.push(meta)
    }
    return NextResponse.json({ status: r.status, replyLen: text.length, nArtifacts: arts.length, failures: done?.artifactFailures ?? [], artifacts: out })
  } catch (e: any) { return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 }) }
}
