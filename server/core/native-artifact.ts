// LINGORA 7.1.1 — single tutor-authored interactive artifact contract.
// This is validation/materialization ONLY; no second cognitive generator.
// Reject ungrounded/empty/HTML-shaped artifacts rather than showing placebo.
import type { ArtifactSignal } from '../../lib/artifact-signal'
import type { ArtifactPayload } from '../../lib/contracts'
import { validateQuizAnswerKey } from '../../lib/quiz-answer-key'
import { normalizeSchemaPro } from '../../lib/native-schema-contract'
import { validateChartContent, type ChartSources } from '../../lib/chart-contract'
import { validateFlowchartContent } from '../../lib/flowchart-contract'
import { validateInfographicContent } from '../../lib/infographic-contract'

type Obj = Record<string, unknown>
const obj = (v: unknown): v is Obj => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const str = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= 1800 && !/<\s*\/?\s*[a-z][^>]*>/i.test(v)
const tone = (v: unknown): v is string => typeof v === 'string' &&
  ['ok','warn','danger','info','neutral','highlight'].includes(v)
const strings = (v: unknown, min = 1, max = 12): v is string[] =>
  Array.isArray(v) && v.length >= min && v.length <= max && v.every(str)

export function materializeNativeArtifact(signal: ArtifactSignal, sources: ChartSources = {}): ArtifactPayload | null {
  const c = signal.content
  if (!c || !obj(c) || !str(c.title)) return null
  if (signal.type === 'chart') {
    const checked = validateChartContent(c, sources)
    if (!checked.ok) { console.error('[chart] rejected', checked.reason); return null }
    return { type: 'chart', content: checked.chart } as unknown as ArtifactPayload
  }
  if (signal.type === 'flowchart') {
    const checked = validateFlowchartContent(c)
    if (!checked.ok) {
      const nodes = Array.isArray(c.nodes) ? c.nodes : []
      const suspect = /flow_node_shape:(\d+)/.exec(checked.reason)
      const node = suspect ? nodes[Number(suspect[1])] : null
      const shape = node && typeof node === 'object' && !Array.isArray(node)
        ? { kindType: typeof (node as Obj).kind, typeType: typeof (node as Obj).type,
            labelType: typeof (node as Obj).label, textType: typeof (node as Obj).text,
            labelLength: typeof (node as Obj).label === 'string' ? String((node as Obj).label).length : null }
        : null
      console.error('[flowchart] rejected', checked.reason, JSON.stringify({ nodeCount: nodes.length, edgeCount: Array.isArray(c.edges) ? c.edges.length : null, shape }))
      return null
    }
    return { type: 'flowchart', content: checked.flow } as unknown as ArtifactPayload
  }
  if (signal.type === 'infographic') {
    const checked = validateInfographicContent(c, sources)
    if (!checked.ok) {
      console.error('[infographic] rejected', checked.reason, JSON.stringify({
        sections: Array.isArray(c.sections) ? c.sections.length : null,
        cards: Array.isArray(c.cards) ? c.cards.length : null,
        blocks: Array.isArray(c.blocks) ? c.blocks.length : null,
        stats: Array.isArray(c.stats) ? c.stats.length : null,
      }))
      return null
    }
    return { type: 'infographic', content: checked.info } as unknown as ArtifactPayload
  }
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
    // Shared typed materialization boundary: re-map only equivalent author-
    // supplied fields. Never invent missing lessons, nodes, or examples.
    const canonical=normalizeSchemaPro(c)
    return canonical ? ({type:'schema_pro',content:canonical} as unknown as ArtifactPayload) : null
  }
  if (signal.type === 'quiz') {
    if (!Array.isArray(c.questions) || c.questions.length < 2 || c.questions.length > 8) return null
    // QA13: a multi-gap compound item cannot be certified by one answer-key
    // index when none of the combined options is fully grammatical. Fail
    // closed before rendering or scoring; don't award false points.
    // One independent blank per item is the canonical testable contract.
    if ((c.questions as unknown[]).some(q =>
      obj(q) && ((String(q.question).match(/_{2,}/g) ?? []).length > 1 ||
      (String(q.question).match(/\.{3,}/g) ?? []).length > 1))) return null
    const isUnscoredReview = c.gradingMode === 'tutor_review' && (c.questions as unknown[]).every(q =>
      obj(q) && q.correct === -1 && str(q.question) && strings(q.options,2,4))
    if (isUnscoredReview) {
      // -1 is an internal NO-KEY sentinel. It is never a correct answer.
      // The UI must ask the same Tutor to review the student's actual clicks.
      return {type:'quiz',content:c} as unknown as ArtifactPayload
    }
    const ok = (c.questions as unknown[]).every(q => obj(q) && str(q.question) &&
      strings(q.options, 2, 4) && typeof q.correct === 'number' &&
      Number.isInteger(q.correct) && q.correct >= 0 &&
      q.correct < (q.options as string[]).length &&
      str(q.explanation))
    if (!ok) return null
    // A native quiz is always the Tutor's own work. Never silently rewrite
    // a correct index while leaving its explanation unchanged: that caused
    // the Gate C "Madrid es en España" contradiction.
    // The existing verifier can PROVE keys only inside its limited domain.
    // Outside that proof or on disagreement, deliver a tactile tutor_review
    // quiz; never fabricate an automatic score.
    const audit = validateQuizAnswerKey(c.questions as Array<{
      question: string; options: string[]; correct: number; explanation?: string
    }>)
    if (audit.reason?.startsWith('duplicate_options:')) return null
    if (audit.ok && (c.questions as Array<{question:string; options:string[]}>).every(q =>
      /_{2,}|\.{3,}|…/u.test(q.question) &&
      q.options.every(option => /\b(?:soy|eres|es|somos|sois|son|estoy|estás|está|estamos|estáis|están|ser|estar)\b/iu.test(option))
    )) return { type:'quiz', content:c } as unknown as ArtifactPayload
    console.info('[quiz-quality] auto grading withheld:', audit.reason ?? 'outside_proven_domain')
    return { type:'quiz', content:{...c,gradingMode:'tutor_review'} } as unknown as ArtifactPayload
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


/** Syntax-only adapter: extract ONLY the questions/options the sole Tutor wrote.
 * Never infer correct answers. A review quiz has no machine-verified key.
 */
export function tutorQuizFromText(text:string):ArtifactPayload|null {
  type Draft={question:string;options:string[]}
  const drafts:Draft[]=[]
  let current:Draft|null=null
  const question=/^\s*(?:#{1,4}\s*)?(?:\*{0,2})?(?:(?:pregunta|question)\s*)?([1-8])\s*[).:\-–]?\s*(.*)$/iu
  const option=/^\s*(?:[-*]\s*)?(?:\*{0,2})?([A-D])(?:\*{0,2})\s*[).:\-]\s*(.*)$/iu
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim().replace(/^\*{2}|\*{2}$/g,'').trim()
    const q=line.match(question)
    if(q){
      if(current)drafts.push(current)
      current={question:q[2]?.trim()??'',options:[]}
      continue
    }
    const opt=line.match(option)
    if(opt&&current){
      const value=opt[2].trim().replace(/^\*{2}|\*{2}$/g,'').trim()
      if(value)current.options.push(value)
      continue
    }
    if(current&&!current.options.length&&line&&!/^(?:respuestas?|solutions?|instrucciones?|quiz|simulacro)\b/iu.test(line)){
      current.question=(current.question+' '+line).trim()
    }
  }
  if(current)drafts.push(current)
  const complete=drafts.filter(q=>q.question.length>=6 && q.question.length<=1800 &&
    q.options.length>=2 && q.options.length<=4 && new Set(q.options.map(v=>v.toLocaleLowerCase())).size===q.options.length)
  if(complete.length<2 || complete.length>8 || complete.length!==drafts.length)return null
  const signal:ArtifactSignal={type:'quiz',trigger:'explicit_user_request',
    subject:'Quiz solicitado',format:'native',
    content:{title:'Quiz táctil — revisión con el Tutor',gradingMode:'tutor_review',
      questions:complete.map(q=>({...q,correct:-1,explanation:''}))}}
  return materializeNativeArtifact(signal)
}
