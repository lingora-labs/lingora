// 7.5 P1-A — what a speech recognizer heard, turned into facts. Pure: no I/O, no model, no intent.
// The recognizer's confidence becomes `uncertain` fragments (shown to the student, given to the Tutor as the
// platform's doubt, never as the student's error). Silence or a known recognizer artefact is "nothing heard",
// never an invented utterance.

/** Container of a recording, from the browser's MediaRecorder mime type (Safari records mp4, Chrome webm). */
export function audioFileName(mime: string | undefined): { name: string; type: string } {
  const m = (mime ?? '').toLowerCase().split(';')[0].trim()
  const ext = m === 'audio/mp4' || m === 'audio/x-m4a' || m === 'audio/m4a' || m === 'video/mp4' ? 'mp4'
    : m === 'audio/ogg' ? 'ogg' : m === 'audio/wav' || m === 'audio/x-wav' || m === 'audio/wave' ? 'wav'
    : m === 'audio/mpeg' || m === 'audio/mp3' ? 'mp3' : m === 'audio/aac' ? 'aac' : m === 'audio/flac' ? 'flac' : 'webm'
  return { name: `recording.${ext}`, type: m || 'audio/webm' }
}

export interface TokenLogprob { token: string; logprob: number }

/** Words the recognizer gave a low probability, merged into consecutive fragments, in order. */
export function uncertainFromLogprobs(logprobs: TokenLogprob[] | undefined, minProb = 0.45): string[] {
  if (!Array.isArray(logprobs) || !logprobs.length) return []
  const words: Array<{ text: string; p: number }> = []
  for (const t of logprobs) {
    if (typeof t?.token !== 'string' || typeof t.logprob !== 'number') continue
    const p = Math.exp(t.logprob)
    if (!words.length || /^\s/.test(t.token)) words.push({ text: t.token.trim(), p })
    else { const w = words[words.length - 1]; w.text += t.token; w.p = Math.min(w.p, p) }
  }
  const out: string[] = []
  let run: string[] = []
  const flush = () => { const f = run.join(' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''); if (f) out.push(f); run = [] }
  for (const w of words) { if (!w.text) continue; if (w.p < minProb) run.push(w.text); else flush() }
  flush()
  return out
}

export interface AsrSegment { text?: string; avg_logprob?: number; no_speech_prob?: number }
/** Whisper verbose segments: a segment it was unsure of is uncertain; all-silence is nothing heard. */
export function factsFromSegments(segments: AsrSegment[] | undefined): { uncertain: string[]; noSpeech: boolean } {
  const segs = Array.isArray(segments) ? segments : []
  if (!segs.length) return { uncertain: [], noSpeech: false }
  const noSpeech = segs.every(s => (s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.6)
  const uncertain = segs.filter(s => typeof s.avg_logprob === 'number' && s.avg_logprob < -0.9 && s.text?.trim()).map(s => s.text!.trim())
  return { uncertain, noSpeech }
}

/** Phrases recognizers emit on silence or noise (subtitle credits, sign-offs). Never a student turn. */
const ARTEFACTS = [
  /subt[ií]tulos? (realizados|por) /i, /amara\.org/i, /^¡?gracias por ver(nos| el v[ií]deo)?!?\.?$/i, /^thanks? (you )?for watching!?\.?$/i,
  /^suscr[ií]bete/i, /^\[?(m[uú]sica|music|silencio|silence)\]?\.?$/i, /^(\.|…|\s)+$/,
]
export function looksLikeAsrArtefact(text: string): boolean {
  const t = text.trim()
  return !t || ARTEFACTS.some(re => re.test(t))
}
