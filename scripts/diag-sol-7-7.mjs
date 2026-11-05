// 7.7-SOL — TEMPORARY. Evaluation preview build only (never production). Never prints secrets.
// Runs the REAL Tutor engine (getMentorResponseStream, real prompt, real tools, real identity gate) against the real provider with the
// project's own credentials, for fixed representative student messages, in three configurations:
//   A  gpt-5.6-sol  Chat Completions, reasoning none, temperature 0.7   (production pin, baseline)
//   B  gpt-6.1-sol  Responses, reasoning low
//   C  gpt-6.1-sol  Responses, reasoning medium
// and prints, per call, time to first text, total time, served model, tokens (incl. reasoning), tools declared, and a cost computed only
// from prices read in the provider docs on 5 Nov 2026 (gpt-6.1-sol: $2.00 in / $0.10 cached / $10.00 out per 1M). The gpt-5.6-sol price is
// NOT verified here: tokens are reported and its cost is shown only as "at the quoted $5/$0.50/$30 (unverified)".
// Remove this file and vercel.json before any merge.
import { load } from '../tests/_ts-loader.mjs'
if (process.env.VERCEL_ENV !== 'preview' || !process.env.OPENAI_API_KEY || !/^ae\/7-7-sol-6-1-evaluation/.test(process.env.VERCEL_GIT_COMMIT_REF ?? '')) { console.log('[sol77] skipped'); process.exit(0) }
const RUNS = Number(process.env.SOL77_RUNS || 2)
const { DEFAULT_SESSION_STATE } = load('lib/contracts.ts')
const M = load('server/mentors/mentor-engine.ts')
const PREVIEW = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF }
const MESSAGES = [
  ['conversación', 'Hola Sarah, ayer fui al mercado con mi hermana y compramos frutas para la cena.'],
  ['gramática', '¿Cuál es la diferencia entre ser y estar? Explícamelo con ejemplos.'],
  ['artifact', 'Hazme una tabla comparando ser y estar y descárgala en PDF.'],
  ['conocimiento', 'Cuéntame algo de acupuntura, ¿cómo funciona?'],
  ['aclaración', 'No entendí lo del pretérito indefinido, ¿puedes repetirlo más simple?'],
  ['inglés', 'I want to practice ordering food in a restaurant in Spanish.'],
]
const CONFIGS = [
  { id: 'A 5.6-sol none', prod: true, effort: undefined },
  { id: 'B 6.1-sol low', prod: false, effort: 'low' },
  { id: 'C 6.1-sol medium', prod: false, effort: 'medium' },
]
const PRICE = { 'gpt-6.1-sol': [2.0, 0.1, 10.0], 'gpt-5.6-sol (quoted, unverified)': [5.0, 0.5, 30.0] }
const cost = (p, u) => ((u.prompt - u.cached) * p[0] + u.cached * p[1] + u.completion * p[2]) / 1e6
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null }
const rows = []
// A hung provider can never hang the build: global watchdog (20 min) and 120 s per call.
setTimeout(() => { console.log('[sol77] watchdog: exiting'); process.exit(0) }, 20 * 60 * 1000).unref()
const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'Timeout' })), ms))])
console.log('[sol77] start', JSON.stringify({ sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null, runs: RUNS, node: process.version }))
for (const [kind, message] of MESSAGES) for (let run = 0; run < RUNS; run++) for (const cfg of CONFIGS) {
  if (cfg.prod) { delete process.env.VERCEL_ENV; delete process.env.VERCEL_GIT_COMMIT_REF } else Object.assign(process.env, PREVIEW)
  process.env.OPENAI_MAIN_MODEL = 'gpt-5.6-sol'
  if (cfg.effort) process.env.TUTOR_REASONING_EFFORT = cfg.effort; else delete process.env.TUTOR_REASONING_EFFORT
  const t0 = performance.now(); let ttft = null, text = '', row
  try {
    const state = { ...DEFAULT_SESSION_STATE, sessionId: 'diag-' + run, tokens: 4, interfaceLanguage: 'es', activeMode: 'interact', level: 'A2' }
    const s = await within(M.getMentorResponseStream({ request: { message }, state }), 120000)
    const opened = performance.now() - t0
    await within((async () => { for await (const d of s) { if (ttft === null) ttft = performance.now() - t0; text += d } })(), 120000)
    const total = performance.now() - t0
    const u = s.usage ?? { prompt: 0, completion: 0, cached: 0, calls: 0 }
    row = { cfg: cfg.id, kind, run, ok: !s.deliveryFailure, failure: s.deliveryFailures ?? null, served: s.servedModel ?? null, openedMs: Math.round(opened), ttftMs: ttft === null ? null : Math.round(ttft), totalMs: Math.round(total),
      chars: text.length, prompt: u.prompt, cached: u.cached, completion: u.completion, reasoning: u.reasoning ?? null, calls: u.calls,
      tools: { signals: s.artifactSignals?.map(x => x.type) ?? [], deliveries: s.textDeliveries?.map(x => x.kind) ?? [], lang: s.explanatoryLanguage ?? null, memory: s.memoryOps?.length ?? 0, facts: s.learningFacts?.length ?? 0 },
      usd: cfg.prod ? null : Number(cost(PRICE['gpt-6.1-sol'], u).toFixed(5)), usdQuoted56: cfg.prod ? Number(cost(PRICE['gpt-5.6-sol (quoted, unverified)'], u).toFixed(5)) : null,
      head: text.replace(/\s+/g, ' ').slice(0, 260) }
  } catch (e) { row = { cfg: cfg.id, kind, run, ok: false, error: String(e?.name ?? 'Error') + ':' + String(e?.status ?? '') + ':' + String(e?.code ?? '') } }
  rows.push(row); console.log('[sol77]', JSON.stringify(row))
}
console.log('[sol77] SUMMARY')
for (const cfg of CONFIGS) {
  const r = rows.filter(x => x.cfg === cfg.id), ok = r.filter(x => x.ok)
  const usd = ok.map(x => x.usd ?? x.usdQuoted56)
  console.log('[sol77]', JSON.stringify({ cfg: cfg.id, calls: r.length, ok: ok.length, served: [...new Set(ok.map(x => x.served))],
    ttftMedianMs: median(ok.map(x => x.ttftMs).filter(Number.isFinite)), ttftMaxMs: Math.max(0, ...ok.map(x => x.ttftMs ?? 0)), totalMedianMs: median(ok.map(x => x.totalMs)), totalMaxMs: Math.max(0, ...ok.map(x => x.totalMs)),
    promptMedian: median(ok.map(x => x.prompt)), completionMedian: median(ok.map(x => x.completion)), reasoningMedian: median(ok.map(x => x.reasoning ?? 0)),
    usdPerTurnMedian: median(usd), usdPerTurnMean: usd.length ? Number((usd.reduce((a, b) => a + b, 0) / usd.length).toFixed(5)) : null, usdIsQuotedUnverified: cfg.prod }))
}
process.exit(0)
