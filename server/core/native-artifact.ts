// LINGORA 7.1.1 — single tutor-authored interactive artifact contract.
// This is validation/materialization ONLY; no second cognitive generator.
// Reject ungrounded/empty/HTML-shaped artifacts rather than showing placebo.
import type { ArtifactSignal } from '../../lib/artifact-signal'
import type { ArtifactPayload } from '../../lib/contracts'

type Obj = Record<string, unknown>
const obj = (v: unknown): v is Obj => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const str = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= 1800 && !/<\s*\/?\s*[a-z][^>]*>/i.test(v)
const tone = (v: unknown): v is string => typeof v === 'string' &&
  ['ok','warn','danger','info','neutral','highlight'].includes(v)
const strings = (v: unknown, min = 1, max = 12): v is string[] =>
  Array.isArray(v) && v.length >= min && v.length <= max && v.every(str)

export function materializeNativeArtifact(signal: ArtifactSignal): ArtifactPayload | null {
  const c = signal.content
  if (!c || !obj(c) || !str(c.title)) return null
  if (signal.type === 'table_matrix') {
    if (!Array.isArray(c.columns) || c.columns.length < 2 || c.columns.length > 6 ||
        !c.columns.every((x: unknown) => obj(x) && str(x.key) && str(x.label)) ||
        !Array.isArray(c.rows) || c.rows.length < 2 || c.rows.length > 18) return null
    const rows = c.rows as unknown[]
    if (!rows.every(r => Array.isArray(r) && r.length === (c.columns as unknown[]).length &&
      r.every((cell: unknown) => obj(cell) && str(cell.text) &&
        (cell.tone === undefined || tone(cell.tone)) &&
        (cell.icon === undefined || str(cell.icon))))) return null
    return { type:'table_matrix', content: c } as unknown as ArtifactPayload
  }
  if (signal.type === 'schema_pro') {
    if (!Array.isArray(c.blocks) || c.blocks.length < 2 || c.blocks.length > 12) return null
    const valid = (c.blocks as unknown[]).every(b => {
      if (!obj(b)) return false
      if (b.type === 'concept') return str(b.title) && str(b.body)
      if (b.type === 'bullets') return str(b.title) && strings(b.items)
      if (b.type === 'highlight') return str(b.text) && (b.tone === undefined || tone(b.tone))
      if (b.type === 'flow') return strings(b.steps, 2, 10)
      if (b.type === 'comparison') return str(b.left) && str(b.right)
      if (b.type === 'table') return strings(b.columns, 2, 6) &&
        Array.isArray(b.rows) && b.rows.length > 0 && b.rows.length <= 12 &&
        (b.rows as unknown[]).every(row => strings(row, (b.columns as string[]).length, (b.columns as string[]).length))
      return false
    })
    return valid ? ({ type:'schema_pro', content:c } as unknown as ArtifactPayload) : null
  }
  if (signal.type === 'quiz') {
    if (!Array.isArray(c.questions) || c.questions.length < 2 || c.questions.length > 8) return null
    const ok = (c.questions as unknown[]).every(q => obj(q) && str(q.question) &&
      strings(q.options, 2, 4) && typeof q.correct === 'number' &&
      Number.isInteger(q.correct) && q.correct >= 0 &&
      q.correct < (q.options as string[]).length &&
      str(q.explanation))
    return ok ? ({ type:'quiz', content:c } as unknown as ArtifactPayload) : null
  }
  return null
}


/**
 * Constitutional 5-token review fallback. The model remains the author.
 * When its typed review is absent, the runtime can DISPLAY already-taught
 * substantive passages as expandable native concept cards, never inventing
 * explanations, questions, answers, or a new pedagogical plan.
 * No meaningful taught content => null and a visible failure.
 */
export function groundedMilestoneReview(
  reply: string,
  history: Array<{ role: string; content: string }> = [],
  topic = 'Tema actual',
): ArtifactPayload | null {
  const candidates = [reply, ...history.slice(-10).reverse()
    .filter(turn => turn.role === 'assistant').map(turn => turn.content)]
  const selected = candidates.find(t => t && t.length >= 280)
  if (!selected) return null
  const clean = selected.replace(/<\/?[^>]+>/g,'').replace(/\r\n/g,'\n')
  let passages = clean.split(/\n\s*\n/).map(x=>x.trim()).filter(x=>x.length >= 85 && x.length <= 2400)
  if (passages.length < 2) {
    passages = clean.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/)
      .map(x=>x.trim()).filter(x=>x.length >= 60)
  }
  const unique = [...new Set(passages)].slice(0,4)
  if (unique.length < 2) return null
  const blocks = unique.map((passage) => {
    const first = passage.split('\n')[0].replace(/^#{1,5}\s*/, '').trim()
    const heading = first.length > 5 && first.length <= 70
      ? first : passage.replace(/\s+/g,' ').slice(0,58).trim() + '…'
    return {type:'concept', title:heading, body:passage.slice(0,550)}
  })
  const signal: ArtifactSignal = {
    type:'schema_pro',trigger:'pedagogical_completion',subject:topic,format:'native',
    content:{title:'Refuerzo visual · ' + topic.slice(0,90),blocks},
  }
  return materializeNativeArtifact(signal)
}
