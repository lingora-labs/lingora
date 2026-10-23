// LINGORA 7.5 — acceptance runner (PREVIEW ONLY).
//
// Purpose: run a FIXED catalogue of acceptance scenarios against the real /api/chat
// handler with the real Tutor model, and the SAME captured request to the same model
// without LINGORA's tool layer ("native" arm). It measures loss per layer:
//   L0 raw model output (captured from the provider stream) → L1 tool contract →
//   L2 validators/materialization → delivered artifacts and visible failures.
//
// Safety: refuses unless VERCEL_ENV === 'preview' AND LINGORA_ACCEPTANCE_RUNNER === 'enabled'
// (branch-scoped variable). Preview deployments are additionally behind Vercel
// Authentication. No arbitrary prompt input: scenarios are a closed list, so cost is
// bounded. Never returns credentials. Not part of the student product.
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Turn = { message: string; uiAction?: string; materialText?: string; audio?: string }
type Scenario = { id: string; title: string; state: Record<string, unknown>; turns: Turn[] }

const BASE = { mentorProfile: 'sarah', interfaceLanguage: 'es', activeMode: 'free', tokens: 4, userLevel: 'A2' }

const SCENARIOS: Scenario[] = [
  { id: 'table100', title: 'Tabla extensa bilingüe con color (>80 filas)', state: BASE, turns: [{ message:
    'Soy jefa de cocina y estudio para el DELE A2. Hazme una tabla de 100 palabras del vocabulario de cocina profesional con columnas: español, árabe, categoría y un ejemplo corto. Colorea cada fila según la categoría. Quiero verla como tabla, no como lista.' }] },
  { id: 'quiz30', title: 'Quiz táctil de 30 preguntas', state: BASE, turns: [{ message:
    'Hazme un quiz táctil de 30 preguntas de opción múltiple sobre ser y estar para el DELE A2, con 4 opciones cada una. Quiero contestarlo tocando las opciones.' }] },
  { id: 'quiz12x5', title: 'Quiz táctil de 12 preguntas con 5 opciones', state: BASE, turns: [{ message:
    'Hazme un quiz táctil de 12 preguntas sobre preposiciones (por, para, en, a, de) con 5 opciones (A–E) cada una.' }] },
  { id: 'flow6', title: 'Diagrama de flujo con decisión de 6 salidas', state: BASE, turns: [{ message:
    'Hazme un diagrama de flujo para elegir el tiempo verbal del pasado en español. La primera decisión debe tener seis salidas: pretérito indefinido, imperfecto, pluscuamperfecto, pretérito perfecto, condicional de probabilidad y futuro de probabilidad. Usa etiquetas completas en las ramas.' }] },
  { id: 'info8', title: 'Infografía de 8 secciones', state: BASE, turns: [{ message:
    'Hazme una infografía de 8 secciones sobre la historia de la acupuntura china, desde sus orígenes hasta la OMS. Incluye cifras solo si las explicas también en el texto.' }] },
  { id: 'doc', title: 'Documento PDF+HTML con Markdown rico y árabe', state: BASE, turns: [{ message:
    'Prepárame un documento descargable en PDF y en HTML sobre ser y estar para hablantes de árabe. Debe tener: una tabla comparativa, listas anidadas, un enlace a la RAE, un pequeño bloque de código Python que conjugue «ser» y «estar» en presente, una fórmula sencilla tipo ser = identidad, y ejemplos bilingües español–árabe.' }] },
  { id: 'acu', title: 'Inteligencia general: acupuntura en profundidad', state: BASE, turns: [{ message:
    'Explícame en profundidad la teoría de los cinco elementos en la acupuntura china y su relación con los meridianos. No quiero una clase de español ahora, quiero entender la teoría.' }] },
  { id: 'continuity', title: 'Cambio de tema y regreso al aprendizaje', state: BASE, turns: [
    { message: 'Quiero practicar ser y estar. Dame un ejercicio corto.' },
    { message: 'Antes de seguir: ¿cómo funciona la fotosíntesis? Explícamelo en dos párrafos.' },
    { message: 'Gracias. Volvamos a lo que estábamos haciendo.' }] },
  { id: 'audio', title: 'Voz → texto → Tutor → voz', state: BASE, turns: [
    { message: '', audio: 'Hola, soy Zakia. Quiero practicar la diferencia entre ser y estar en el restaurante.' }] },
  { id: 'zakia', title: 'Zakia replay (6 turnos)', state: { ...BASE, tokens: 0, userLevel: undefined }, turns: [
    { message: 'Hola, soy Zakia. Trabajo en un restaurante y quiero aprender español para la ciudadanía española.' },
    { message: 'No sé en qué nivel estoy, nunca he estudiado español formalmente.' },
    { message: 'Soy Zakia soy Marruecos. Soy cocina lider en el restaurante.' },
    { message: 'Quiero hacer ejercicios parecidos al examen DELE.' },
    { message: 'Aquí está mi respuesta: 1-B / 2-C / 3-B.' },
    { message: 'Quiero algo que pueda imprimir y usar sola para seguir preparando el DELE A2, con ejemplos que me sirvan también en mi trabajo en el restaurante.' }] },
]

type Capture = { url: string; requestModel?: string; tools: string[]; messages?: unknown[]; servedModel?: string; content: string;
  toolCalls: Record<number, { name: string; args: string }>; usage?: unknown; ms: number }

function parseSse(text: string, cap: Capture) {
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
    try {
      const c = JSON.parse(line.slice(6))
      if (c.model) cap.servedModel = c.model
      if (c.usage) cap.usage = c.usage
      const d = c.choices?.[0]?.delta
      if (typeof d?.content === 'string') cap.content += d.content
      for (const t of d?.tool_calls ?? []) {
        const slot = cap.toolCalls[t.index] ?? (cap.toolCalls[t.index] = { name: '', args: '' })
        slot.name += t.function?.name ?? ''
        slot.args += t.function?.arguments ?? ''
      }
    } catch { /* partial chunk */ }
  }
}

// The OpenAI SDK captures its fetch implementation at load time, so patching the global
// fetch would observe nothing. The SDK routes every request through
// APIClient.prototype.fetchWithTimeout; wrapping it (for this invocation only) records
// the real provider request and response without touching product code.
async function withProviderCapture<T>(fn: () => Promise<T>): Promise<{ value: T; captures: Capture[] }> {
  const OpenAI = (await import('openai')).default
  const proto = Object.getPrototypeOf(OpenAI.prototype) as { fetchWithTimeout: (...a: unknown[]) => Promise<Response> }
  const original = proto.fetchWithTimeout
  const captures: Capture[] = []
  const pending: Promise<void>[] = []
  proto.fetchWithTimeout = async function (this: unknown, ...args: unknown[]) {
    const url = String(args[0])
    const init = (args[1] ?? {}) as { body?: unknown }
    if (!/\/chat\/completions/.test(url)) return original.apply(this, args)
    const cap: Capture = { url, tools: [], content: '', toolCalls: {}, ms: 0 }
    try {
      const body = JSON.parse(String(init.body ?? '{}'))
      cap.requestModel = body.model
      cap.tools = (body.tools ?? []).map((t: { function?: { name?: string } }) => t.function?.name ?? '?')
      cap.messages = body.messages
    } catch { /* opaque body */ }
    const t0 = Date.now()
    const res = await original.apply(this, args)
    captures.push(cap)
    pending.push(res.clone().text().then((text: string) => {
      cap.ms = Date.now() - t0
      if (text.trimStart().startsWith('{')) {
        try { const j = JSON.parse(text); cap.servedModel = j.model; cap.usage = j.usage; cap.content = j.choices?.[0]?.message?.content ?? '' } catch { /* */ }
      } else parseSse(text, cap)
    }).catch(() => undefined))
    return res
  }
  try {
    const value = await fn()
    await Promise.all(pending)
    return { value, captures }
  } finally { proto.fetchWithTimeout = original }
}

async function pdfFacts(url: string) {
  const m = /^data:application\/pdf;base64,(.+)$/.exec(url)
  if (!m) return { url: url.slice(0, 80) }
  const bytes = Buffer.from(m[1], 'base64')
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes)
  return { bytes: bytes.length, pages: doc.getPageCount(), sha256: createHash('sha256').update(bytes).digest('hex') }
}

async function summarizeArtifacts(list: unknown[]) {
  const out = []
  for (const a of list as Array<Record<string, unknown>>) {
    const item: Record<string, unknown> = { type: a.type, title: a.title }
    if (typeof a.url === 'string' && a.url.startsWith('data:application/pdf')) Object.assign(item, await pdfFacts(a.url))
    else if (typeof a.url === 'string') item.url = a.url.slice(0, 60)
    if (typeof a.html === 'string') item.htmlBytes = a.html.length
    if (typeof a.dataUrl === 'string') item.dataUrlBytes = a.dataUrl.length
    if (a.content && typeof a.content === 'object') {
      const c = a.content as Record<string, unknown>
      item.content = {
        rows: Array.isArray(c.rows) ? c.rows.length : undefined,
        columns: Array.isArray(c.columns) ? c.columns.length : undefined,
        questions: Array.isArray(c.questions) ? c.questions.length : undefined,
        optionsPerQuestion: Array.isArray(c.questions) ? (c.questions as Array<{ options?: unknown[] }>).map(q => q.options?.length ?? 0) : undefined,
        nodes: Array.isArray(c.nodes) ? c.nodes.length : undefined,
        sections: Array.isArray(c.sections) ? c.sections.length : undefined,
        categories: Array.isArray(c.categories) ? c.categories.length : undefined,
      }
      item.contentJson = JSON.stringify(c)
    }
    out.push(item)
  }
  return out
}

function slimCapture(c: Capture) {
  return {
    requestModel: c.requestModel, servedModel: c.servedModel, tools: c.tools, ms: c.ms, usage: c.usage,
    contentChars: c.content.length, content: c.content,
    toolCalls: Object.values(c.toolCalls).map(t => ({ name: t.name, argsChars: t.args.length, args: t.args })),
  }
}

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.LINGORA_ACCEPTANCE_RUNNER !== 'enabled') {
    return new NextResponse('Not found', { status: 404 })
  }
  const id = req.nextUrl.searchParams.get('s') ?? ''
  const native = req.nextUrl.searchParams.get('native') !== '0'
  if (id === 'list') return NextResponse.json({ scenarios: SCENARIOS.map(s => ({ id: s.id, title: s.title, turns: s.turns.length })) })
  const sc = SCENARIOS.find(s => s.id === id)
  if (!sc) return NextResponse.json({ error: 'unknown scenario' }, { status: 400 })

  const { POST } = await import('../../../server/api/chat-entry')
  let state: Record<string, unknown> = { ...sc.state }
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  const turns = []
  for (const turn of sc.turns) {
    const body: Record<string, unknown> = { message: turn.message, state, stream: false, conversationHistory: [...history] }
    if (turn.uiAction) { body.uiAction = turn.uiAction; body.materialText = turn.materialText }
    if (turn.audio) {
      const { generateSpeech } = await import('../../../server/tools/audio-toolkit')
      const tts = await generateSpeech(turn.audio, { voice: 'nova' })
      body.audioDataUrl = tts.url; body.audioMimeType = 'audio/mpeg'
    }
    const t0 = Date.now()
    const { value: res, captures } = await withProviderCapture(async () => {
      const r = await POST(new NextRequest('http://acceptance.local/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
      return (await r.json()) as Record<string, unknown>
    })
    const wallMs = Date.now() - t0
    const artifacts = Array.isArray(res.artifacts) ? res.artifacts : res.artifact ? [res.artifact] : []
    const delivered = await summarizeArtifacts(artifacts)
    let nativeArm: Record<string, unknown> | undefined
    const tutorCall = captures.find(c => c.tools.length > 0 && Array.isArray(c.messages))
    if (native && tutorCall?.messages) {
      // SAME model, SAME messages (system prompt, history, user turn, language note); NO tools.
      const { value: nres, captures: ncap } = await withProviderCapture(async () => {
        const OpenAI = (await import('openai')).default
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        const { buildModelParams } = await import('../../../server/mentors/mentor-engine')
        const model = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini'
        const t1 = Date.now()
        const c = await openai.chat.completions.create({ ...buildModelParams(model, 8192, 0.7, 0.88), messages: tutorCall.messages as never })
        return { ms: Date.now() - t1, content: c.choices?.[0]?.message?.content ?? '', model: c.model, usage: c.usage }
      })
      void ncap
      nativeArm = { servedModel: nres.model, ms: nres.ms, usage: nres.usage, contentChars: nres.content.length, content: nres.content }
    }
    const message = typeof res.message === 'string' ? res.message : ''
    turns.push({
      sent: turn.message || '(audio) ' + turn.audio, wallMs,
      provider: captures.map(slimCapture),
      delivered: { messageChars: message.length, message, artifacts: delivered,
        artifactFailures: res.artifactFailures ?? [], transcript: res.transcript, suggestedActions: res.suggestedActions },
      native: nativeArm,
    })
    if (res.state && typeof res.state === 'object') state = res.state as Record<string, unknown>
    history.push({ role: 'user', content: turn.message || turn.audio || '' }, { role: 'assistant', content: message })
  }
  return NextResponse.json({
    scenario: sc.id, title: sc.title,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local', deployment: process.env.VERCEL_DEPLOYMENT_ID ?? 'local',
    configuredModel: process.env.OPENAI_MAIN_MODEL ?? '(unset → code default)',
    turns,
  })
}
