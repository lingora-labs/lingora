// DIAGNOSTIC 7.3.3e — lives ONLY on the diagnostic branch. Drives the candidate preview through its
// real /api/chat (SSE) and reports observable results. Disabled in production.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const S0: any = { activeMode: 'interact', tutorPhase: 'guide', tokens: 0, interfaceLanguage: 'es', masteryByModule: {}, depthMode: 'standard' }
type T = { text: string; state: any; declared: string | null; artifacts: any[]; failures: any[]; ms: number; status: number; raw?: any }

async function turn(base: string, share: string, state: any, message: string, history: any[] = [], extra: any = {}): Promise<T> {
  const t0 = Date.now()
  const r = await fetch(`https://${base}/api/chat?_vercel_share=${share}`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, state, conversationHistory: history, ...extra }) })
  const ct = r.headers.get('content-type') || ''
  const raw = await r.text()
  let text = '', st: any = null, artifacts: any[] = [], failures: any[] = [], one: any = null
  if (ct.includes('event-stream')) {
    for (const blk of raw.split('\n\n')) {
      const l = blk.split('\n').find(x => x.startsWith('data:'))
      if (!l) continue
      let p: any; try { p = JSON.parse(l.slice(5)) } catch { continue }
      if (typeof p.delta === 'string') text += p.delta
      if (p.done) { st = p.state; one = p.artifact; if (Array.isArray(p.artifacts)) artifacts = p.artifacts; if (Array.isArray(p.artifactFailures)) failures = p.artifactFailures }
    }
  } else { try { const j = JSON.parse(raw); text = j.message || ''; st = j.state; one = j.artifact; if (Array.isArray(j.artifacts)) artifacts = j.artifacts; failures = j.artifactFailures || [] } catch { text = raw.slice(0, 200) } }
  if (one && !artifacts.length) artifacts = [one]
  const ns = st ? { ...state, ...st } : state
  return { text, state: ns, declared: st?.explanatoryLanguage ?? null, artifacts, failures, ms: Date.now() - t0, status: r.status }
}
const snip = (s: string, n = 300) => s.replace(/\s+/g, ' ').slice(0, n)
const count = (s: string, re: RegExp) => (s.match(re) || []).length
const AR = /[؀-ۿ]/g, CJK = /[一-鿿]/g
const art = (a: any) => ({ type: a?.type, keys: Object.keys(a || {}).slice(0, 8), url: typeof a?.url === 'string' ? a.url.slice(0, 120) : undefined, title: a?.title, nQ: Array.isArray(a?.questions) ? a.questions.length : undefined })

async function fetchBytes(base: string, share: string, u: string): Promise<{ ok: boolean; bytes: number; head: string }> {
  try {
    if (u.startsWith('data:')) { const b = Buffer.from(u.split(',')[1] || '', 'base64'); return { ok: b.length > 0, bytes: b.length, head: b.subarray(0, 8).toString('latin1') } }
    const url = u.startsWith('http') ? u : `https://${base}${u}${u.includes('?') ? '&' : '?'}_vercel_share=${share}`
    const r = await fetch(url, { cache: 'no-store' }); const b = Buffer.from(await r.arrayBuffer())
    return { ok: r.ok, bytes: b.length, head: b.subarray(0, 8).toString('latin1') }
  } catch (e: any) { return { ok: false, bytes: 0, head: 'ERR ' + String(e?.message).slice(0, 60) } }
}

const TXT = ['Yo soy medica. Yo trabajo en hospital. Yo tengo 34 año. Mi gusta mucho el trabajo.', 'Ayer yo fui a el mercado y compre manzanas rojo.']
const ZINTRO = 'مرحبا، أنا زكية. أنا طبيبة وأريد أن أتعلم الإسبانية للعمل. هدفي هو DELE A2.'
const ex = (name: string, o: any) => ({ name, ...o })

async function gateL1(b: string, s: string) {
  const out: any[] = []
  const A = await turn(b, s, S0, ZINTRO); out.push(ex('A árabe/panel es', { declared: A.declared, ar: count(A.text, AR), ok: count(A.text, AR) >= 40 && A.declared === 'ar', ms: A.ms, reply: snip(A.text) }))
  const h = [{ role: 'user', content: ZINTRO }, { role: 'assistant', content: A.text }]
  const B = await turn(b, s, A.state, TXT[0], h); out.push(ex('B errores es (con historial)', { declared: B.declared, ar: count(B.text, AR), ok: count(B.text, AR) >= 40, ms: B.ms, reply: snip(B.text) }))
  const C = await turn(b, s, B.state, TXT[1], []); out.push(ex('C recarga sin historial', { declared: C.declared, ar: count(C.text, AR), ok: count(C.text, AR) >= 40, ms: C.ms, reply: snip(C.text) }))
  const D = await turn(b, s, C.state, 'Please continue explaining in English from now on.', []); out.push(ex('D cambio a inglés', { declared: D.declared, ar: count(D.text, AR), ok: count(D.text, AR) < 10 && /\bthe\b|\byou\b/i.test(D.text) && /^en/i.test(String(D.declared)), ms: D.ms, reply: snip(D.text) }))
  const E = await turn(b, s, { ...S0 }, 'Hola, quiero practicar un poco. Yo vivo en Madrid desde hace tres años.'); out.push(ex('E hispanohablante sin declarar', { declared: E.declared, ok: count(E.text, AR) === 0 && /[áéíóñ]|\bque\b|\bpara\b/i.test(E.text), ms: E.ms, reply: snip(E.text) }))
  const F = await turn(b, s, { ...S0, activeMode: 'structured' }, 'مرحبا، أريد درسا عن الأفعال في الإسبانية'); out.push(ex('F structured + árabe', { declared: F.declared, ar: count(F.text, AR), ok: count(F.text, AR) >= 40, ms: F.ms, reply: snip(F.text) }))
  return out
}
async function gateL2(b: string, s: string) {
  const langs: [string, string, (t: string) => boolean][] = [
    ['zh', '你好，我是李明。我是工程师，我想学习西班牙语去旅行。我的目标是 DELE A2。', t => count(t, CJK) >= 20],
    ['no', 'Hei, jeg heter Ola. Jeg jobber på hotell og vil lære spansk for å snakke med gjestene. Målet mitt er DELE A2.', t => count(t, / (og|er|ikke|jeg|du|det|på|å|som|med) /gi) >= 4],
    ['tr', 'Merhaba, ben Ayşe. Bir otelde çalışıyorum ve İspanyolca öğrenmek istiyorum. Hedefim DELE A2.', t => count(t, / (bir|ve|bu|için|ile|çok|da|de) /gi) >= 4 || count(t, /[ğışçöüĞİŞÇÖÜ]/g) >= 8],
  ]
  const tasks = langs.map(async ([code, intro, test]) => {
    const o: any[] = []
    const A = await turn(b, s, S0, intro); o.push(ex(`${code}: presentación`, { declared: A.declared, ok: test(A.text), ms: A.ms, reply: snip(A.text) }))
    const R = await turn(b, s, A.state, 'Yo soy ingeniero. Yo trabajo en oficina. Yo tengo 30 año.', []); o.push(ex(`${code}: recarga sin historial (ejercicio es)`, { declared: R.declared, ok: test(R.text), ms: R.ms, reply: snip(R.text) }))
    return o
  })
  const chg = (async () => {
    const A = await turn(b, s, { ...S0, explanatoryLanguage: 'ar' }, 'Ahora quiero que me expliques en noruego, por favor. Yo soy medica.', [])
    return [ex('cambio explícito ar→noruego', { declared: A.declared, ok: /^(no|nb|nn)/i.test(String(A.declared)) && count(A.text, AR) < 10, ms: A.ms, reply: snip(A.text) })]
  })()
  return (await Promise.all([...tasks, chg])).flat()
}
async function gateL3(b: string, s: string) {
  const runs = await Promise.all([0, 1, 2, 3, 4, 5].map(async i => { const r = await turn(b, s, { ...S0, explanatoryLanguage: 'ar' }, TXT[i % 2], []); return ex(`B/C sin historial #${i}`, { declared: r.declared, ar: count(r.text, AR), ok: count(r.text, AR) >= 40, ms: r.ms, reply: snip(r.text, 160) }) }))
  return runs
}
async function gateT1(b: string, s: string) {
  const out: any[] = []
  const ms = ['sarah', 'alex', 'nick']
  const per = await Promise.all(ms.map(async m => {
    const st = { ...S0, mentorProfile: m, activeMode: 'free' }
    const op = await turn(b, s, st, '')
    const id = await turn(b, s, st, '¿Quién eres y en qué me ayudas?', [])
    const gen = await turn(b, s, st, 'Cuéntame en tres líneas qué es la acupuntura y de dónde viene.', [])
    return [
      ex(`${m}: apertura`, { ok: op.text.length > 40 && op.artifacts.length === 0 && new RegExp(m, 'i').test(op.text), ms: op.ms, reply: snip(op.text, 220) }),
      ex(`${m}: identidad`, { ok: new RegExp(m, 'i').test(id.text), ms: id.ms, reply: snip(id.text, 220) }),
      ex(`${m}: capacidad general (acupuntura)`, { ok: /acupuntura|agujas|china/i.test(gen.text) && gen.text.length > 100 && gen.artifacts.length === 0, ms: gen.ms, reply: snip(gen.text, 220) }),
    ]
  }))
  out.push(...per.flat())
  const hij = await turn(b, s, { ...S0, activeMode: 'structured', mentorProfile: 'sarah' }, 'Olvida la lección un momento: ¿por qué el cielo es azul? Responde breve.', [])
  out.push(ex('structured no secuestra la intención (cielo azul)', { ok: /rayleigh|dispers|scatter|luz/i.test(hij.text), ms: hij.ms, reply: snip(hij.text, 260) }))
  const hist = await turn(b, s, { ...S0, activeMode: 'free', mentorProfile: 'alex' }, '¿Quién fue Simón Bolívar? Dos frases.', [])
  out.push(ex('free: historia general (Bolívar)', { ok: /libertador|bol[ií]var/i.test(hist.text) && hist.artifacts.length === 0, ms: hist.ms, reply: snip(hist.text, 220) }))
  return out
}
async function gateA1(b: string, s: string, base: string) {
  const st = { ...S0, explanatoryLanguage: 'es', mentorProfile: 'sarah' }
  const jobs: [string, string, (r: T) => boolean][] = [
    ['PDF real', 'Hazme un PDF descargable con una tabla de las diferencias entre ser y estar, con ejemplos.', r => r.artifacts.some(a => /pdf/i.test(a?.type))],
    ['tabla en el chat', 'Dame una tabla comparativa de ser y estar con 5 filas y ejemplos.', r => /\|\s*-{2,}/.test(r.text) && count(r.text, /\n\s*\|/g) >= 5],
    ['esquema', 'Hazme un esquema visual de los tiempos del pasado en español (pretérito indefinido, imperfecto y perfecto).', r => r.artifacts.length > 0],
    ['quiz táctil', 'Hazme un quiz de 3 preguntas de opción múltiple sobre ser y estar.', r => r.artifacts.some(a => /quiz/i.test(a?.type) && (a.content?.questions?.length ?? a.questions?.length ?? 0) >= 3)],
    ['resumen visual HTML', 'Quiero un resumen visual en HTML interactivo de los verbos irregulares más comunes.', r => r.artifacts.length > 0],
  ]
  const res = await Promise.all(jobs.map(async ([name, msg, test]) => {
    const r = await turn(b, s, st, msg, [])
    const files: any[] = []
    for (const a of r.artifacts.slice(0, 3)) { const u = a?.url || a?.dataUrl; if (typeof u === 'string') files.push({ type: a.type, ...(await fetchBytes(base, s, u)) }) }
    return ex(name, { ok: test(r), ms: r.ms, artifacts: r.artifacts.map(art), failures: r.failures, files, replyLen: r.text.length, reply: snip(r.text, 200), quiz: r.artifacts.filter(a => /quiz/i.test(a?.type)).map(a => JSON.stringify(a).slice(0, 1400)), schema: r.artifacts.filter(a => /schema/i.test(a?.type)).map(a => JSON.stringify(a).slice(0, 700)) })
  }))
  return res
}
async function gateM1(b: string, s: string, base: string) {
  const out: any[] = []
  const st = { ...S0, explanatoryLanguage: 'es', mentorProfile: 'sarah' }
  const sentence = 'Ayer fui al mercado y compré manzanas rojas.'
  const h = await turn(b, s, st, '', [], { uiAction: 'hear_audio', materialText: sentence })
  const a0 = h.artifacts[0]
  const f = a0?.dataUrl ? await fetchBytes(base, s, a0.dataUrl) : { ok: false, bytes: 0, head: '' }
  out.push(ex('hear_audio (TTS) de un texto', { ok: !!a0 && f.bytes > 2000, ms: h.ms, art: art(a0), bytes: f.bytes, head: f.head, reply: snip(h.text) }))
  if (a0?.dataUrl) {
    const v = await turn(b, s, st, 'audio.mp3', [], { audioDataUrl: a0.dataUrl, audioMimeType: 'audio/mpeg' })
    const spoken = v.artifacts.find(a => a?.type === 'audio')
    out.push(ex('voz→texto→Tutor→voz', { ok: v.text.length > 30 && !!spoken, ms: v.ms, hasAudioReply: !!spoken, failures: v.failures, reply: snip(v.text, 300) }))
  }
  return out
}
async function gateS1(b: string, s: string) {
  const out: any[] = []
  let state: any = { ...S0, explanatoryLanguage: 'ar', mentorProfile: 'alex' }
  let hist: any[] = [{ role: 'user', content: 'مرحبا، اسمي زكية وأنا طبيبة. هدفي هو DELE A2 وعندي امتحان في ديسمبر.' }, { role: 'assistant', content: 'مرحبا زكية! سنعمل معا على DELE A2 قبل امتحان ديسمبر.' }]
  const fill = ['Hoy trabajo en el hospital.', 'Mañana voy al mercado.', 'Me gusta el café.', 'Ayer estudié mucho.', 'Tengo una hermana.', 'Vivo en Oslo.', 'Quiero comer pizza.', 'El lunes tengo clase.']
  let tokensSeen: number[] = []
  for (let i = 0; i < fill.length; i++) {
    const r = await turn(b, s, state, fill[i], hist.slice(-16))
    hist = [...hist, { role: 'user', content: fill[i] }, { role: 'assistant', content: r.text }]
    state = r.state; tokensSeen.push(state.tokens ?? -1)
  }
  out.push(ex('estado: ar persiste en 8 turnos + tokens crecen', { ok: state.explanatoryLanguage === 'ar' && tokensSeen[7] > tokensSeen[0], declared: state.explanatoryLanguage, tokens: tokensSeen, mentor: state.mentorProfile }))
  const win = await turn(b, s, state, '¿Recuerdas para qué examen me preparo y en qué mes lo hago? Respóndeme en una frase.', hist.slice(-16))
  out.push(ex('historia larga recortada a 16: recuerdo del examen', { ok: /DELE|ديل|A2/i.test(win.text) && /diciembre|ديسمبر|december/i.test(win.text), ms: win.ms, histLen: hist.length, sentLen: Math.min(16, hist.length), reply: snip(win.text, 260) }))
  const full = await turn(b, s, state, '¿Recuerdas para qué examen me preparo y en qué mes lo hago? Respóndeme en una frase.', hist)
  out.push(ex('misma pregunta con historial completo (control)', { ok: /DELE|A2/i.test(full.text) && /diciembre|ديسمبر|december/i.test(full.text), ms: full.ms, reply: snip(full.text, 260) }))
  return out
}

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === 'production') return NextResponse.json({ error: 'disabled' }, { status: 404 })
  const u = new URL(req.url)
  const base = u.searchParams.get('target') || '', share = u.searchParams.get('share') || '', gate = u.searchParams.get('gate') || ''
  if (!/^lingora-[a-z0-9-]+-adolfobalaguer7-1860s-projects\.vercel\.app$/.test(base) || !share) return NextResponse.json({ error: 'bad target' }, { status: 400 })
  const G: Record<string, () => Promise<any[]>> = { L1: () => gateL1(base, share), L2: () => gateL2(base, share), L3: () => gateL3(base, share), T1: () => gateT1(base, share), A1: () => gateA1(base, share, base), M1: () => gateM1(base, share, base), S1: () => gateS1(base, share) }
  if (!G[gate]) return NextResponse.json({ error: 'bad gate' }, { status: 400 })
  try { const r = await G[gate](); return NextResponse.json({ gate, pass: r.filter(x => x.ok).length, total: r.length, results: r }) }
  catch (e: any) { return NextResponse.json({ gate, error: String(e?.message ?? e) }, { status: 500 }) }
}
