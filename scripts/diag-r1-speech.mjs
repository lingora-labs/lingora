// 7.6 R1 — TEMPORARY. Preview build only. Fixed texts, closed list of models, no user input.
// Prints the result between markers in the build log; never fails the build. Remove before any merge.
if (process.env.VERCEL_ENV !== 'preview' || !process.env.OPENAI_API_KEY) { console.log('[r1-diag] skipped'); process.exit(0) }
const KEY = process.env.OPENAI_API_KEY
const TEXTS = [
  'Muy bien, Ana. Ahora dime con tus propias palabras qué hiciste ayer por la tarde.',
  'Recuerda: se dice «tengo treinta y cuatro años», no «soy treinta y cuatro años». ¿Lo repites?',
]
const MODELS = ['gpt-4o-mini-tts', 'gpt-realtime-2.1-mini', 'gpt-realtime-2.1', 'gpt-realtime-mini']
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
function diff(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
const out = []
for (const model of MODELS) for (const text of TEXTS) {
  const t0 = Date.now()
  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, voice: 'nova', input: text, response_format: 'mp3' }) })
    if (!res.ok) { const j = await res.json().catch(() => ({})); out.push({ model, ok: false, status: res.status, code: j?.error?.code ?? null, message: String(j?.error?.message ?? '').slice(0, 200) }); continue }
    const reader = res.body.getReader(); const chunks = []; let first = -1
    for (;;) { const { done, value } = await reader.read(); if (done) break; if (first < 0) first = Date.now() - t0; chunks.push(value) }
    const total = Date.now() - t0, bytes = Buffer.concat(chunks)
    let heard = '', wordDiff = null
    try {
      const fd = new FormData(); fd.append('file', new Blob([bytes], { type: 'audio/mpeg' }), 'speech.mp3'); fd.append('model', 'gpt-4o-transcribe'); fd.append('language', 'es')
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd })
      const j = await r.json(); heard = (j.text ?? '').trim(); wordDiff = diff(norm(text), norm(heard))
    } catch (e) { heard = 'asr_check_failed' }
    out.push({ model, ok: true, firstByteMs: first, totalMs: total, bytes: bytes.length, words: norm(text).length, wordDiff, heard })
  } catch (e) { out.push({ model, ok: false, error: String(e).slice(0, 160) }) }
}
console.log('[r1-diag]BEGIN' + JSON.stringify({ at: new Date().toISOString(), sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null, results: out }) + 'END[r1-diag]')
process.exit(0)
