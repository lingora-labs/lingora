// DIAGNOSTIC 7.3.3d — temporary, diagnostic branch only. Runs AE's battery server-side through
// the real /api/chat handler (same prompt, tools, state merge). Disabled in production.
import { NextRequest, NextResponse } from 'next/server'
import { POST as chatPOST } from '../../../server/api/chat-entry'

export const runtime = 'nodejs'
export const maxDuration = 300

const MODELS = ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.6-sol']
const S0 = { activeMode: 'interact', tutorPhase: 'guide', tokens: 2, interfaceLanguage: 'es', masteryByModule: {}, depthMode: 'standard', explanatoryLanguage: 'ar' }
const TXT = [
  'Yo soy medica. Yo trabajo en hospital. Yo tengo 34 año. Mi gusta mucho el trabajo.',
  'Ayer yo fui a el mercado y compre manzanas rojo.',
]
const EXPECT: RegExp[][] = [
  [/soy m[eé]dica/i, /tengo 34 años/i],
  [/al mercado/i, /rojas/i],
]
const HIST = [
  { role: 'user', content: 'مرحبا، أنا زكية. أنا طبيبة وأريد أن أتعلم الإسبانية للعمل. هدفي هو DELE A2.' },
  { role: 'assistant', content: 'مرحبا زكية! يسعدني أن أساعدك في تعلم الإسبانية للعمل في المجال الطبي. لنبدأ: اكتبي لي جملتين بسيطتين بالإسبانية عن نفسك، مثلا: "Me llamo ___" و"Trabajo en ___".' },
]

async function one(model: string, sc: string, i: number) {
  const idx = i % 2
  const message = TXT[idx]
  const state: Record<string, unknown> = { ...S0, _lx: `model=${model};rx=none;r=${model}-${sc}-${i}` }
  if (sc === 'F') state.activeMode = 'structured'
  const body = { message, state, conversationHistory: sc === 'B2' ? HIST : [] }
  const t0 = Date.now()
  const res = await chatPOST(new NextRequest('http://localhost/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  const raw = await res.text()
  let text = ''
  let declared: string | null = null
  if ((res.headers.get('content-type') || '').includes('event-stream')) {
    for (const blk of raw.split('\n\n')) {
      const l = blk.split('\n').find(x => x.startsWith('data:'))
      if (!l) continue
      try {
        const p = JSON.parse(l.slice(5))
        if (typeof p.delta === 'string') text += p.delta
        if (p.state?.explanatoryLanguage) declared = p.state.explanatoryLanguage
      } catch { /* ignore */ }
    }
  } else text = raw.slice(0, 300)
  const ar = (text.match(/[؀-ۿ]/g) || []).length
  const err = /\[\[PROVIDER_ERROR/.test(text)
  const ped = EXPECT[idx].every(r => r.test(text))
  return { i, sc, model, ms: Date.now() - t0, status: res.status, err, arChars: ar, langPass: !err && ar >= 40, pedPass: !err && ped, declared, len: text.length, reply: text.replace(/\s+/g, ' ').slice(0, 260) }
}

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === 'production') return NextResponse.json({ error: 'disabled' }, { status: 404 })
  const u = new URL(req.url)
  const model = u.searchParams.get('model') || ''
  const sc = u.searchParams.get('sc') || ''
  const from = Number(u.searchParams.get('from') || 0)
  const n = Math.min(Number(u.searchParams.get('n') || 1), 10)
  const par = Math.min(Number(u.searchParams.get('par') || 5), 10)
  if (!MODELS.includes(model) || !['B', 'B2', 'F'].includes(sc)) return NextResponse.json({ error: 'bad params' }, { status: 400 })
  const idxs = Array.from({ length: n }, (_, k) => from + k)
  const out: Awaited<ReturnType<typeof one>>[] = []
  for (let k = 0; k < idxs.length; k += par) {
    out.push(...await Promise.all(idxs.slice(k, k + par).map(i => one(model, sc, i).catch(e => ({ i, sc, model, ms: 0, status: 0, err: true, arChars: 0, langPass: false, pedPass: false, declared: null, len: 0, reply: 'EXC ' + String(e?.message ?? e).slice(0, 160) })))))
  }
  return NextResponse.json({ model, sc, summary: { n: out.length, lang: out.filter(r => r.langPass).length, ped: out.filter(r => r.pedPass).length, err: out.filter(r => r.err).length, avgMs: Math.round(out.reduce((a, r) => a + r.ms, 0) / Math.max(1, out.length)) }, runs: out })
}
