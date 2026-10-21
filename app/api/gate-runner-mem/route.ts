// DIAGNOSTIC 7.3.3f — diagnostic branch only. Memory gates against the candidate preview's real /api/chat.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const S0: any = { activeMode: 'interact', tutorPhase: 'guide', tokens: 0, interfaceLanguage: 'es', masteryByModule: {}, depthMode: 'standard', explanatoryLanguage: 'es', mentorProfile: 'alex' }

async function turn(base: string, share: string, state: any, message: string, history: any[] = []) {
  const t0 = Date.now()
  const r = await fetch(`https://${base}/api/chat?_vercel_share=${share}`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, state, conversationHistory: history }) })
  const raw = await r.text()
  let text = '', st: any = null
  if ((r.headers.get('content-type') || '').includes('event-stream')) {
    for (const blk of raw.split('\n\n')) {
      const l = blk.split('\n').find(x => x.startsWith('data:'))
      if (!l) continue
      let p: any; try { p = JSON.parse(l.slice(5)) } catch { continue }
      if (typeof p.delta === 'string') text += p.delta
      if (p.done) st = p.state
    }
  } else { try { const j = JSON.parse(raw); text = j.message || ''; st = j.state } catch { text = raw.slice(0, 200) } }
  return { text, state: st ? { ...state, ...st } : state, mem: (st?.tutorMemory ?? null) as any[] | null, ms: Date.now() - t0, status: r.status }
}
const snip = (s: string, n = 260) => s.replace(/\s+/g, ' ').slice(0, n)
const ex = (name: string, o: any) => ({ name, ...o })
const FILL = ['Hoy trabajo en el hospital.', 'Mañana voy al mercado.', 'Me gusta el café.', 'Ayer estudié mucho.', 'Tengo una hermana.', 'Vivo en Oslo.']
const Q = '¿Recuerdas para qué examen me preparo y en qué mes lo hago? Respóndeme en una frase.'
const recalls = (t: string) => /DELE|A2/i.test(t) && /diciembre|ديسمبر|december|desember/i.test(t)

async function gateM2(b: string, s: string) {
  const out: any[] = []
  let state: any = { ...S0 }
  let hist: any[] = []
  const first = 'Hola, soy Zakia, soy médica. Mi objetivo es el examen DELE A2 y lo hago en diciembre. Recuérdalo, por favor.'
  const r1 = await turn(b, s, state, first, hist)
  hist = [{ role: 'user', content: first }, { role: 'assistant', content: r1.text }]; state = r1.state
  out.push(ex('turno 1: el Tutor guarda el dato en tutorMemory', { ok: Array.isArray(r1.mem) && r1.mem.length > 0, mem: r1.mem, ms: r1.ms, reply: snip(r1.text, 160) }))
  for (const f of FILL) { const r = await turn(b, s, state, f, hist); hist = [...hist, { role: 'user', content: f }, { role: 'assistant', content: r.text }]; state = r.state }
  out.push(ex('memoria sobrevive 6 turnos', { ok: Array.isArray(state.tutorMemory) && state.tutorMemory.length > 0, mem: state.tutorMemory, histLen: hist.length }))
  const trimmed = hist.slice(-4)
  const withMem = await turn(b, s, state, Q, trimmed)
  out.push(ex('historial recortado a 4 + memoria: recuerda', { ok: recalls(withMem.text), ms: withMem.ms, reply: snip(withMem.text) }))
  const { tutorMemory, ...noMem } = state
  const control = await turn(b, s, noMem, Q, trimmed)
  out.push(ex('control: recortado a 4 SIN memoria (debe fallar)', { ok: !recalls(control.text), recalled: recalls(control.text), ms: control.ms, reply: snip(control.text) }))
  return out
}
async function gateM3(b: string, s: string) {
  const out: any[] = []
  let state: any = { ...S0 }
  const r1 = await turn(b, s, state, 'Hola, soy Zakia. Mi examen DELE A2 es en diciembre.', []); state = r1.state
  const r2 = await turn(b, s, state, 'Corrección: me cambiaron la fecha, mi examen DELE A2 es ahora en febrero.', [{ role: 'user', content: 'x' }]); state = r2.state
  const txt = JSON.stringify(state.tutorMemory ?? [])
  out.push(ex('update: la nota refleja febrero', { ok: /febrero|february/i.test(txt) && !/diciembre/i.test(txt), mem: state.tutorMemory, reply: snip(r2.text, 160) }))
  const r3 = await turn(b, s, state, 'Olvida lo del examen, ya no lo voy a hacer. No lo recuerdes más.', []); state = r3.state
  const left = JSON.stringify(state.tutorMemory ?? [])
  out.push(ex('forget: la nota del examen desaparece', { ok: !/DELE|examen/i.test(left), mem: state.tutorMemory ?? [], reply: snip(r3.text, 160) }))
  return out
}
async function gateM4(b: string, s: string) {
  const out: any[] = []
  const hist: any[] = [{ role: 'user', content: 'Mi examen es el DELE A2 y lo hago en diciembre.' }, { role: 'assistant', content: 'Perfecto, nos preparamos para el DELE A2 de diciembre.' }]
  for (let i = 0; i < 20; i++) { hist.push({ role: 'user', content: 'Frase de práctica número ' + i + ': hoy como pan.' }, { role: 'assistant', content: 'Muy bien, "hoy como pan" es correcto.' }) }
  const r = await turn(b, s, { ...S0 }, Q, hist)
  out.push(ex('hilo de 42 mensajes enviado entero (sin memoria): recuerda el dato del mensaje 1', { ok: recalls(r.text), histLen: hist.length, ms: r.ms, reply: snip(r.text) }))
  return out
}

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === 'production') return NextResponse.json({ error: 'disabled' }, { status: 404 })
  const u = new URL(req.url)
  const base = u.searchParams.get('target') || '', share = u.searchParams.get('share') || '', gate = u.searchParams.get('gate') || ''
  if (!/^lingora-[a-z0-9-]+-adolfobalaguer7-1860s-projects\.vercel\.app$/.test(base) || !share) return NextResponse.json({ error: 'bad target' }, { status: 400 })
  const G: Record<string, () => Promise<any[]>> = { M2: () => gateM2(base, share), M3: () => gateM3(base, share), M4: () => gateM4(base, share) }
  if (!G[gate]) return NextResponse.json({ error: 'bad gate' }, { status: 400 })
  try { const r = await G[gate](); return NextResponse.json({ gate, pass: r.filter(x => x.ok).length, total: r.length, results: r }) }
  catch (e: any) { return NextResponse.json({ gate, error: String(e?.message ?? e) }, { status: 500 }) }
}
