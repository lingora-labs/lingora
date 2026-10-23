// LINGORA 7.5 — single tutor-authored interactive artifact contract.
// Validation/materialization ONLY; no second cognitive generator. A component that cannot be
// shown completely is refused WITH ITS REASON (shown to the student), never trimmed or hidden.
// 7.5 removed the count caps (16 columns, 80 rows, 20 questions, 4 options); what remains is
// validity and the resource limits in lib/native-visual-schema.ts.
import type { ArtifactSignal } from '../../lib/artifact-signal'
import type { ArtifactPayload } from '../../lib/contracts'
import { validateQuizAnswerKey } from '../../lib/quiz-answer-key'
import { normalizeSchemaPro } from '../../lib/native-schema-contract'
import { validateChartContent, type ChartSources } from '../../lib/chart-contract'
import { validateFlowchartContent } from '../../lib/flowchart-contract'
import { validateInfographicContent } from '../../lib/infographic-contract'
import { displayText, resourceRefusal, VISUAL_MINIMUMS } from '../../lib/native-visual-schema'
import { extractTutorQuiz } from '../../lib/content/quiz'

type Obj = Record<string, unknown>
const obj = (v: unknown): v is Obj => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const str = displayText
const tone = (v: unknown): v is string => typeof v === 'string' &&
  ['ok','warn','danger','info','neutral','highlight'].includes(v)
const options = (v: unknown): v is string[] => Array.isArray(v) && v.length >= VISUAL_MINIMUMS.quiz.options && v.every(str)

export type Materialized = { payload: ArtifactPayload } | { reason: string }

const REASONS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^(?:flow|info|chart)_title$|^title$/, () => 'falta el título'],
  [/^flow_node_count$/, () => 'el diagrama necesita al menos dos nodos'],
  [/^flow_edge_count$/, () => 'el diagrama no tiene conexiones'],
  [/^flow_node_shape:(\d+)$/, m => `el nodo ${Number(m[1]) + 1} no tiene id, texto o tipo válidos`],
  [/^flow_duplicate_id:(.+)$/, m => `hay dos nodos con el id «${m[1]}»`],
  [/^flow_edge_ref:(\d+)$/, m => `la conexión ${Number(m[1]) + 1} apunta a un nodo que no existe`],
  [/^flow_self_loop:(\d+)$/, m => `la conexión ${Number(m[1]) + 1} sale y entra en el mismo nodo`],
  [/^flow_duplicate_edge:(.+)$/, m => `la conexión ${m[1]} está repetida`],
  [/^flow_edge_label:(\d+)$/, m => `la etiqueta de la conexión ${Number(m[1]) + 1} no es texto válido`],
  [/^info_section_count$/, () => 'la infografía no tiene secciones'],
  [/^info_section_shape:(\d+)$/, m => `la sección ${Number(m[1]) + 1} no tiene título y texto`],
  [/^info_untraceable_stat:(\d+):(.*)$/, m => `la cifra «${m[2]}» no aparece en la explicación`],
  [/^chart_untraceable_value:\d+:\d+:(.*)$/, m => `el valor ${m[1]} no aparece en la explicación`],
  [/^chart_value_category:\d+:(\d+):(.*)$/, m => `el valor ${m[2]} no corresponde a la categoría ${Number(m[1]) + 1}`],
  [/^chart_value_count:(\d+):(.*)$/, m => `la serie ${Number(m[1]) + 1} no tiene un valor por categoría (${m[2]})`],
  [/^chart_table_(?:categories|values)/, () => 'los datos no coinciden con la tabla de la misma respuesta'],
  [/^chart_duplicate_category$/, () => 'hay categorías repetidas'],
]
/** Student-facing sentence for a validator code. */
export function explainNativeRefusal(code: string): string {
  for (const [re, say] of REASONS) { const m = re.exec(code); if (m) return say(m) }
  return `estructura no válida (${code})`
}

export function materializeNativeArtifactOrReason(signal: ArtifactSignal, sources: ChartSources = {}): Materialized {
  const c = signal.content
  if (!c || !obj(c)) return { reason: 'el Tutor no envió el contenido del componente' }
  if (!str(c.title)) return { reason: explainNativeRefusal('title') }
  const tooBig = resourceRefusal(c)
  if (tooBig) return { reason: tooBig }
  if (signal.type === 'chart') {
    const checked = validateChartContent(c, sources)
    return checked.ok ? { payload: { type: 'chart', content: checked.chart } as unknown as ArtifactPayload } : { reason: explainNativeRefusal(checked.reason) }
  }
  if (signal.type === 'flowchart') {
    const checked = validateFlowchartContent(c)
    return checked.ok ? { payload: { type: 'flowchart', content: checked.flow } as unknown as ArtifactPayload } : { reason: explainNativeRefusal(checked.reason) }
  }
  if (signal.type === 'infographic') {
    const checked = validateInfographicContent(c, sources)
    return checked.ok ? { payload: { type: 'infographic', content: checked.info } as unknown as ArtifactPayload } : { reason: explainNativeRefusal(checked.reason) }
  }
  if (signal.type === 'table_matrix') {
    // Preserve every Tutor-authored column and row. Normalize syntax only:
    // column labels may be strings, and cell values may be strings or {text,tone}.
    const cols = Array.isArray(c.columns) ? c.columns : []
    const rows = Array.isArray(c.rows) ? c.rows : []
    if (cols.length < VISUAL_MINIMUMS.table.columns) return { reason: 'la tabla no tiene columnas' }
    if (rows.length < VISUAL_MINIMUMS.table.rows) return { reason: 'la tabla no tiene filas' }
    const columns: Array<{ key: string; label: string; width?: string }> = []
    for (const [i, col] of cols.entries()) {
      if (typeof col === 'string' && str(col)) { columns.push({ key: 'c' + i, label: col }); continue }
      if (!obj(col) || !str(col.label)) return { reason: `la columna ${i + 1} no tiene encabezado` }
      columns.push({ key: typeof col.key === 'string' && col.key.trim() ? col.key : 'c' + i, label: col.label, ...(typeof col.width === 'string' ? { width: col.width } : {}) })
    }
    const matrix: Array<Array<{ text: string; tone?: string; icon?: string }>> = []
    for (const [ri, row] of rows.entries()) {
      if (!Array.isArray(row) || row.length !== columns.length) return { reason: `la fila ${ri + 1} tiene ${Array.isArray(row) ? row.length : 0} celdas y la tabla ${columns.length} columnas` }
      const converted: Array<{ text: string; tone?: string; icon?: string }> = []
      for (const [ci, cell] of row.entries()) {
        if (typeof cell === 'string' && str(cell)) { converted.push({ text: cell }); continue }
        if (typeof cell === 'number' && Number.isFinite(cell)) { converted.push({ text: String(cell) }); continue }
        if (!obj(cell) || !str(cell.text) || (cell.tone !== undefined && !tone(cell.tone)) || (cell.icon !== undefined && !str(cell.icon)))
          return { reason: `la celda ${ri + 1}·${ci + 1} no tiene texto válido` }
        converted.push({ text: cell.text as string, ...(typeof cell.tone === 'string' ? { tone: cell.tone } : {}), ...(typeof cell.icon === 'string' ? { icon: cell.icon } : {}) })
      }
      matrix.push(converted)
    }
    return { payload: { type: 'table_matrix', content: { title: c.title, subtitle: c.subtitle, columns, rows: matrix } } as unknown as ArtifactPayload }
  }
  if (signal.type === 'schema_pro') {
    // Shared typed materialization boundary: re-map only equivalent author-supplied fields.
    const canonical = normalizeSchemaPro(c)
    return canonical ? { payload: { type: 'schema_pro', content: canonical } as unknown as ArtifactPayload } : { reason: 'algún bloque del esquema no tiene un tipo o contenido reconocible' }
  }
  if (signal.type === 'quiz') {
    if (!Array.isArray(c.questions) || c.questions.length < VISUAL_MINIMUMS.quiz.questions) return { reason: 'el cuestionario no tiene preguntas' }
    const qs = c.questions as unknown[]
    const bad = qs.findIndex(q => !obj(q) || !str(q.question) || !options(q.options))
    if (bad >= 0) return { reason: `la pregunta ${bad + 1} no tiene enunciado o al menos dos opciones` }
    // QA13: one option cannot fill two different blanks; such an item is malformed, not reviewable.
    const multi = qs.findIndex(q => (String((q as Obj).question).match(/_{2,}/g) ?? []).length > 1 || (String((q as Obj).question).match(/\.{3,}/g) ?? []).length > 1)
    if (multi >= 0 && (qs[multi] as Obj).options && ((qs[multi] as Obj).options as string[]).every(o => !/[,;/]|\s\S+\s/.test(o.trim())))
      return { reason: `la pregunta ${multi + 1} tiene varios huecos y cada opción es una sola palabra` }
    const isUnscoredReview = c.gradingMode === 'tutor_review' && qs.every(q => obj(q) && q.correct === -1)
    // -1 is an internal NO-KEY sentinel: the same Tutor reviews the student's actual clicks.
    if (isUnscoredReview) return { payload: { type: 'quiz', content: c } as unknown as ArtifactPayload }
    const keyed = qs.every(q => obj(q) && typeof q.correct === 'number' && Number.isInteger(q.correct) &&
      q.correct >= 0 && q.correct < (q.options as string[]).length && str(q.explanation))
    const review = { type: 'quiz', content: { ...c, gradingMode: 'tutor_review', questions: qs.map(q => ({ ...(q as Obj), correct: -1, explanation: '' })) } } as unknown as ArtifactPayload
    if (!keyed) return { payload: review }
    // A multi-gap item with combined options ("es / está") cannot be scored by one key; the Tutor reviews it.
    if (multi >= 0) return { payload: review }
    const audit = validateQuizAnswerKey(qs as Array<{ question: string; options: string[]; correct: number; explanation?: string }>)
    if (audit.reason?.startsWith('duplicate_options:')) return { reason: 'una pregunta repite la misma opción' }
    // The verifier can PROVE keys only inside its limited domain. Outside that proof the Tutor reviews.
    if (audit.ok && (qs as Array<{ question: string; options: string[] }>).every(q =>
      /_{2,}|\.{3,}|…/u.test(q.question) &&
      q.options.every(option => /\b(?:soy|eres|es|somos|sois|son|estoy|estás|está|estamos|estáis|están|ser|estar)\b/iu.test(option))
    )) return { payload: { type: 'quiz', content: c } as unknown as ArtifactPayload }
    console.info('[quiz-quality] auto grading withheld:', audit.reason ?? 'outside_proven_domain')
    return { payload: { type: 'quiz', content: { ...c, gradingMode: 'tutor_review' } } as unknown as ArtifactPayload }
  }
  return { reason: `tipo de componente desconocido (${signal.type})` }
}

/** Compatibility wrapper: payload or null. Callers that show failures use materializeNativeArtifactOrReason. */
export function materializeNativeArtifact(signal: ArtifactSignal, sources: ChartSources = {}): ArtifactPayload | null {
  const out = materializeNativeArtifactOrReason(signal, sources)
  if ('reason' in out) { console.error(`[${signal.type}] rejected`, out.reason); return null }
  return out.payload
}

/** Tactile quiz from the questions the Tutor WROTE in this reply, read by the canonical reader.
 * Never infers correct answers: a review quiz has no machine key; the Tutor reviews the clicks. */
export function quizFromTutorText(text: string, title: string): Materialized {
  const extracted = extractTutorQuiz(text)
  if (!extracted.ok) return { reason: extracted.reason }
  return materializeNativeArtifactOrReason({
    type: 'quiz', trigger: 'explicit_user_request', subject: title, format: 'native',
    content: { title: title.trim() || 'Quiz', gradingMode: 'tutor_review',
      questions: extracted.questions.map(q => ({ question: q.question, options: q.options, correct: -1, explanation: '' })) },
  })
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
    return {type:'concept', title:heading, body:passage}
  })
  const signal: ArtifactSignal = {
    type:'schema_pro',trigger:'pedagogical_completion',subject:topic,format:'native',
    content:{title:'Refuerzo visual · ' + topic.slice(0,90),blocks},
  }
  return materializeNativeArtifact(signal)
}
