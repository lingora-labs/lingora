// 7.6 R1 — TEMPORARY. Preview build only. Fixed texts, closed model list, no user input. Prints results to the build log.
// A) does the realtime model read a given text VERBATIM (TTS-only use)?  B) latency of gpt-live-transcribe streaming.
if (process.env.VERCEL_ENV !== 'preview' || !process.env.OPENAI_API_KEY) { console.log('[r1-rt] skipped'); process.exit(0) }
const KEY = process.env.OPENAI_API_KEY
const TEXT = 'Muy bien, Ana. Ahora dime con tus propias palabras qué hiciste ayer por la tarde.'
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
function diff(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length] }
const wav = pcm => { const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]) }
const open = url => new WebSocket(url, ['realtime', 'openai-insecure-api-key.' + KEY])
async function asr(buf, type, name) { try { const fd = new FormData(); fd.append('file', new Blob([buf], { type }), name); fd.append('model', 'gpt-4o-transcribe'); fd.append('language', 'es'); const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd }); return ((await r.json()).text ?? '').trim() } catch { return 'asr_check_failed' } }

function ttsRealtime(model) {
  return new Promise(resolve => {
    const r = { model, events: [], errors: [] }; const chunks = []; let first = -1, tResp = 0, finished = false, transcript = ''
    const ws = open(`wss://api.openai.com/v1/realtime?model=${model}`)
    const fin = extra => { if (finished) return; finished = true; try { ws.close() } catch {} ; resolve({ ...r, ...extra, firstAudioMs: first, totalMs: tResp ? Date.now() - tResp : null, transcript, pcm: Buffer.concat(chunks) }) }
    const to = setTimeout(() => fin({ timeout: true }), 30000)
    ws.onerror = () => r.errors.push('ws_error')
    ws.onclose = ev => { r.closeCode = ev.code; clearTimeout(to); fin({}) }
    ws.onmessage = m => {
      let e; try { e = JSON.parse(m.data) } catch { return }
      if (r.events.length < 14 && !/delta$/.test(e.type)) r.events.push(e.type)
      if (e.type === 'session.created') ws.send(JSON.stringify({ type: 'session.update', session: { type: 'realtime', output_modalities: ['audio'], instructions: 'Eres un altavoz. Lee en voz alta exactamente el texto del usuario, palabra por palabra, sin añadir, quitar ni comentar nada.', audio: { output: { voice: 'marin' } } } }))
      else if (e.type === 'session.updated') { ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: TEXT }] } })); tResp = Date.now(); ws.send(JSON.stringify({ type: 'response.create' })) }
      else if (e.type === 'error') r.errors.push(String(e.error?.code ?? '') + ':' + String(e.error?.message ?? '').slice(0, 160))
      else if (/^response\.(output_)?audio\.delta$/.test(e.type)) { if (first < 0) first = Date.now() - tResp; chunks.push(Buffer.from(e.delta, 'base64')) }
      else if (/audio_transcript\.done$/.test(e.type)) transcript = e.transcript ?? ''
      else if (e.type === 'response.done') { r.status = e.response?.status; clearTimeout(to); fin({}) }
    }
  })
}

function sttLive(pcm) {
  return new Promise(resolve => {
    const r = { model: 'gpt-live-transcribe', errors: [], events: [] }; let tCommit = 0, firstDelta = -1, finished = false, text = ''
    const ws = open('wss://api.openai.com/v1/realtime?intent=transcription')
    const fin = extra => { if (finished) return; finished = true; try { ws.close() } catch {} ; resolve({ ...r, ...extra, firstDeltaMs: firstDelta, text }) }
    const to = setTimeout(() => fin({ timeout: true }), 30000)
    ws.onerror = () => r.errors.push('ws_error')
    ws.onclose = () => { clearTimeout(to); fin({}) }
    ws.onmessage = m => {
      let e; try { e = JSON.parse(m.data) } catch { return }
      if (r.events.length < 10 && !/delta$/.test(e.type)) r.events.push(e.type)
      if (e.type === 'session.created') ws.send(JSON.stringify({ type: 'session.update', session: { type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'gpt-live-transcribe', languages: ['es'] }, turn_detection: null } } } }))
      else if (e.type === 'session.updated') { for (let i = 0; i < pcm.length; i += 4800) ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcm.subarray(i, i + 4800).toString('base64') })); tCommit = Date.now(); ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' })) }
      else if (e.type === 'error') r.errors.push(String(e.error?.code ?? '') + ':' + String(e.error?.message ?? '').slice(0, 160))
      else if (e.type === 'conversation.item.input_audio_transcription.delta') { if (firstDelta < 0) firstDelta = Date.now() - tCommit }
      else if (e.type === 'conversation.item.input_audio_transcription.completed') { text = e.transcript ?? ''; r.completedMs = Date.now() - tCommit; clearTimeout(to); fin({}) }
    }
  })
}

const out = { at: new Date().toISOString(), sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null, tts: [], stt: null }
for (const model of ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1']) {
  const x = await ttsRealtime(model)
  const heardAsr = x.pcm.length > 2000 ? await asr(wav(x.pcm), 'audio/wav', 'rt.wav') : ''
  out.tts.push({ model, status: x.status ?? null, events: x.events, errors: x.errors, closeCode: x.closeCode ?? null, timeout: x.timeout ?? false, firstAudioMs: x.firstAudioMs, totalMs: x.totalMs, audioBytes: x.pcm.length, wordDiffAsr: heardAsr ? diff(norm(TEXT), norm(heardAsr)) : null, heardAsr, ownTranscript: x.transcript, wordDiffOwn: x.transcript ? diff(norm(TEXT), norm(x.transcript)) : null })
}
try {
  const res = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'nova', input: TEXT, response_format: 'pcm' }) })
  const pcm = Buffer.from(await res.arrayBuffer())
  const s = await sttLive(pcm)
  out.stt = { ...s, audioSeconds: +(pcm.length / 48000).toFixed(2), wordDiff: s.text ? diff(norm(TEXT), norm(s.text)) : null }
} catch (e) { out.stt = { error: String(e).slice(0, 160) } }
console.log('[r1-rt]BEGIN' + JSON.stringify(out) + 'END[r1-rt]')
process.exit(0)
