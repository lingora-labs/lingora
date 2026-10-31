// 7.6 R4-M — the measurement of a call, per turn, from the REAL end of the student's voice to the estimated first audible sound.
// Pure and observational: it reads marks, it changes nothing. Every column is a segment of the same timeline, so they add up to TOTAL.
import type { SpeakMarks } from './call-speaker'

export interface CallTurnTrace {
  n: number
  speechEndAt: number     // end of the last frame with voice
  commitAt: number        // the VAD closed the turn
  transcriptAt: number    // the final transcript arrived
  sendAt: number | null   // the turn left for the Tutor (later than transcriptAt when the previous turn was still open)
  speak: SpeakMarks | null
}
export interface TurnTimes { n: number; close: number; asr: number; hold: number; tutorHeaders: number; firstSegment: number; voiceWait: number; voice: number; output: number; total: number; gaps: number; gapMs: number; segments: number; outputKnown: boolean }

const r = (x: number) => Math.round(x)
/** The timeline of one answered turn, or null when the turn never produced audible sound (interrupted, aborted). */
export function turnTimes(t: CallTurnTrace): TurnTimes | null {
  const s = t.speak
  if (!s || t.sendAt === null || s.firstSegmentAt === null || s.firstSendAt === null || s.firstAudioAt === null || s.audibleAt === null) return null
  return {
    n: t.n, close: r(t.commitAt - t.speechEndAt), asr: r(t.transcriptAt - t.commitAt), hold: r(t.sendAt - t.transcriptAt),
    tutorHeaders: r(s.beginAt - t.sendAt), firstSegment: r(s.firstSegmentAt - s.beginAt), voiceWait: r(s.firstSendAt - s.firstSegmentAt),
    voice: r(s.firstAudioAt - s.firstSendAt), output: r(s.audibleAt - s.firstAudioAt), total: r(s.audibleAt - t.speechEndAt),
    gaps: s.gaps, gapMs: r(s.gapMs), segments: s.segments, outputKnown: s.outputLatencyMs !== null,
  }
}
const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : r((a[m - 1] + a[m]) / 2)) : 0 }
const COLS: Array<[keyof TurnTimes, string]> = [['close', 'cierre'], ['asr', 'reconoc.'], ['hold', 'espera'], ['tutorHeaders', 'Tutor→inicio'], ['firstSegment', '1.ª frase'], ['voiceWait', 'espera voz'], ['voice', 'voz'], ['output', 'salida'], ['total', 'TOTAL']]
export function buildReport(turns: CallTurnTrace[], at = new Date()): string {
  const done = turns.map(turnTimes).filter((x): x is TurnTimes => x !== null)
  const head = `LINGORA · medición de llamada R4-M · ${at.toISOString()} · ${turns.length} turnos hablados, ${done.length} con respuesta audible`
  if (!done.length) return head + '\nNingún turno llegó a sonar: no hay tiempos que medir.'
  const pad = (v: string | number, w: number) => String(v).padStart(w)
  const lines = [head, 'ms desde el fin real de tu voz (última trama con voz) hasta el primer sonido estimado; las columnas suman TOTAL.',
    ['#', ...COLS.map(c => c[1]), 'huecos', 'frases'].map((h, i) => pad(h, i === 0 ? 3 : 12)).join('')]
  for (const t of done) lines.push([t.n, ...COLS.map(([k]) => t[k]), `${t.gaps}/${t.gapMs}`, t.segments].map((v, i) => pad(v as string | number, i === 0 ? 3 : 12)).join(''))
  lines.push(['med', ...COLS.map(([k]) => median(done.map(t => t[k] as number))), `${median(done.map(t => t.gaps))}/${median(done.map(t => t.gapMs))}`, median(done.map(t => t.segments))].map((v, i) => pad(v as string | number, i === 0 ? 3 : 12)).join(''))
  lines.push(`mín–máx TOTAL: ${Math.min(...done.map(t => t.total))}–${Math.max(...done.map(t => t.total))} ms · latencia de salida del dispositivo ${done.every(t => t.outputKnown) ? 'informada por el navegador (estimación, no medida física)' : 'NO informada por este navegador: «salida» es 0'}`)
  lines.push('huecos = silencios audibles entre trozos de voz (cantidad/ms). Con pocos turnos la mediana es descriptiva, no una conclusión.')
  lines.push('JSON: ' + JSON.stringify(done))
  return lines.join('\n')
}
