// TEMPORARY 7.4.2 live validation runner. Lives only on dae/7-4-2-vivo; never merged.
import { NextRequest, NextResponse } from 'next/server'
import { POST } from '../../../server/api/chat-entry'

export const runtime = 'nodejs'
export const maxDuration = 300

const DATA = 'Mes: Enero, visitas 120, conversión 3%. Febrero 180, 4%. Marzo 240, 5%. Abril 300, 6%. Mayo 420, 8%. Junio 380, 7%.'
const SCEN: Record<string, string> = {
  a: 'Corrige esto:\nYo fue a la tienda y compro pan ayer.\nElla no tiene hambre y quiere ir al cine.',
  b: 'Tengo estos datos de una web: ' + DATA + ' Hazme una tabla con los seis meses y un gráfico de barras de las visitas y una línea con la conversión.',
  c: 'Hazme un PDF y una versión HTML sobre la diferencia entre SER y ESTAR, explicado en árabe, con los ejemplos en español, ejercicios y respuestas.',
}

export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get('t') ?? 'a'
  const message = SCEN[t]
  if (!message) return NextResponse.json({ error: 'unknown scenario' }, { status: 400 })
  const state = { mentorProfile: 'Sarah', nativeLanguage: 'ar', userLevel: 'A2', interfaceLanguage: 'es', tokens: 1 }
  const started = Date.now()
  const r = new NextRequest('http://localhost/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, state, stream: false }) })
  const res = await POST(r)
  const j = (await res.json()) as Record<string, unknown>
  const arts = ([] as Array<Record<string, unknown>>).concat((j.artifacts as Array<Record<string, unknown>>) ?? [], j.artifact ? [j.artifact as Record<string, unknown>] : [])
  const summary = arts.map(a => {
    const url = typeof a.url === 'string' ? a.url : ''
    const web = typeof a.webUrl === 'string' ? a.webUrl : ''
    let webHtml = ''
    if (web.startsWith('data:text/html')) { try { const m = /^data:text\/html[^,]*?(;base64)?,(.*)$/s.exec(web); webHtml = m ? (m[1] ? Buffer.from(m[2], 'base64').toString('utf8') : decodeURIComponent(m[2])) : '' } catch { webHtml = '' } }
    let pdfPages = 0, pdfBytes = 0
    if (url.startsWith('data:application/pdf')) { const b = Buffer.from(url.split(',')[1] ?? '', 'base64'); pdfBytes = b.length; pdfPages = (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length }
    return { type: a.type, title: a.title, content: a.type === 'chart' || a.type === 'table_matrix' ? a.content : undefined, urlKind: url.slice(0, 24), pdfBytes, pdfPages, webHtmlLen: webHtml.length, webHtmlDirs: webHtml ? { rtl: (webHtml.match(/dir="rtl"/g) ?? []).length, ltr: (webHtml.match(/dir="ltr"/g) ?? []).length, bdi: (webHtml.match(/<bdi/g) ?? []).length, tables: (webHtml.match(/<table/g) ?? []).length, lis: (webHtml.match(/<li/g) ?? []).length } : undefined }
  })
  const msg = String(j.message ?? '')
  return NextResponse.json({ scenario: t, ms: Date.now() - started, status: res.status, messageLen: msg.length, message: msg.slice(0, 3500), tail: msg.slice(-160), artifactFailures: j.artifactFailures, artifacts: summary, keys: Object.keys(j) })
}
