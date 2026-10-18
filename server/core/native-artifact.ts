// LINGORA 7.1.1 — single tutor-authored interactive artifact contract.
// This is validation/materialization ONLY; no second cognitive generator.
// Reject ungrounded/empty/HTML-shaped artifacts rather than showing placebo.
import type { ArtifactSignal } from '../../lib/artifact-signal'
import type { ArtifactPayload } from '../../lib/contracts'
import { validateQuizAnswerKey } from '../../lib/quiz-answer-key'
import { normalizeSchemaPro } from '../../lib/native-schema-contract'

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
    const ok = (c.questions as unknown[]).every(q => obj(q) && str(q.question) &&
      strings(q.options, 2, 4) && typeof q.correct === 'number' &&
      Number.isInteger(q.correct) && q.correct >= 0 &&
      q.correct < (q.options as string[]).length &&
      str(q.explanation))
    if (!ok) return null
    // DAE P1-02: use ONLY the unique answer already proven by the existing
    // semantic verifier. Never alter its person/tense/semantic heuristics,
    // questions, options or explanations; never let an unproven key auto-grade.
    // Repair each independently verified wrong index on a local copy, bounded
    // by the number of questions. An unverified/absent unique answer is always
    // returned as a touch quiz with tutor_review, never as an automatic score.
    type QuizQuestion = {question:string;options:string[];correct:number;explanation?:string}
    const verifiedQuestions = (c.questions as QuizQuestion[]).map(q => ({...q}))
    for (let attempt = 0; attempt <= verifiedQuestions.length; attempt++) {
      const quality = validateQuizAnswerKey(verifiedQuestions)
      if (quality.ok) {
        return { type:'quiz', content:{...c,questions:verifiedQuestions} } as unknown as ArtifactPayload
      }
      console.warn('[quiz-quality] validation finding:', quality.reason)
      if (quality.reason?.startsWith('incorrect_model_answer_key:')) {
        const i = quality.questionIndex
        const correct = quality.correctedIndex
        if (i === undefined || correct === undefined ||
            !Number.isInteger(i) || i < 0 || i >= verifiedQuestions.length ||
            !Number.isInteger(correct) || correct < 0 ||
            correct >= verifiedQuestions[i].options.length ||
            verifiedQuestions[i].correct === correct) return null
        verifiedQuestions[i].correct = correct
        continue
      }
      if (quality.reason?.startsWith('unverified_copula_cloze:') ||
          quality.reason?.startsWith('missing_or_ambiguous_correct_option:')) {
        return { type:'quiz', content:{...c,questions:verifiedQuestions,gradingMode:'tutor_review'} } as unknown as ArtifactPayload
      }
      // compound_copula_cloze / invalid_answer_key / duplicate_options /
      // empty_quiz and unknown validation errors retain fail-closed behavior.
      return null
    }
    return null
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
