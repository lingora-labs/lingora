// LINGORA 7.5 — tactile quiz = the Tutor's own questions, read by the canonical reader.
//
// No second parser: the reply is tokenised once by lib/content/markdown.ts and this
// module walks those tokens (skipping code, tables, raw HTML and math) to find what
// the Tutor wrote as numbered questions with lettered options. It never invents a
// question, an option or a key. Whatever it cannot read completely it refuses with a
// sentence the student sees, instead of dropping or trimming anything.
import type { Token, Tokens } from 'marked'
import { lexTutorText } from './markdown'

/** Resource limits only (memory and layout), far above any lesson. Not pedagogical caps. */
export const QUIZ_RESOURCE_LIMITS = { questions: 200, options: 26, chars: 4000 } as const

export interface ExtractedQuestion { number: number; question: string; options: string[] }
export type QuizExtraction =
  | { ok: true; questions: ExtractedQuestion[] }
  | { ok: false; reason: string }

const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const ARABIC = ['أ', 'ب', 'ج', 'د', 'ه', 'و', 'ز', 'ح', 'ط', 'ي']
const QUESTION = /^(?:(?:pregunta|question|ejercicio|exercise|سؤال)\s*)?(\d{1,4})\s*[.)º:\-–]\s*(.*)$|^(?:pregunta|question|ejercicio|exercise|سؤال)\s*(\d{1,4})\s*$/iu
const OPTION_LATIN = /^[(\[]?([A-Za-z])\s?[)\].:]\s*(.+)$/u
const OPTION_ARABIC = /^[(\[]?([أبجدهوزحطي])\s?[)\].:\-]\s*(.+)$/u
const INLINE_OPTION = /(?:^|\s)\(?([A-Z])\)\s+/g

function inlinePlain(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  return tokens.map((t) => {
    const x = t as Token & { tokens?: Token[]; text?: string }
    if (x.type === 'br') return '\n'
    if (x.type === 'image') return ''
    if (x.tokens?.length) return inlinePlain(x.tokens)
    return typeof x.text === 'string' ? x.text : ''
  }).join('')
}

/** Reading-order lines of quiz-capable text. Code, tables, raw HTML and formulas are not quiz text. */
function linesOf(tokens: Token[], out: string[] = []): string[] {
  for (const t of tokens) {
    if (t.type === 'heading' || t.type === 'paragraph' || t.type === 'text') {
      const x = t as Tokens.Paragraph
      out.push(...inlinePlain(x.tokens?.length ? x.tokens : [t]).split('\n'))
    } else if (t.type === 'list') {
      const list = t as Tokens.List
      list.items.forEach((item, i) => {
        const inner = linesOf(item.tokens, [])
        const prefix = list.ordered ? `${Number(list.start || 1) + i}. ` : ''
        if (inner.length) inner[0] = prefix + inner[0]
        out.push(...inner)
      })
    } else if (t.type === 'blockquote') {
      linesOf((t as Tokens.Blockquote).tokens, out)
    } else if (t.type === 'space' || t.type === 'hr') {
      out.push('')
    }
  }
  return out
}

/** "1. Voy ___ Madrid. A) por B) para C) en" → stem + options, only when the letters run A, B, C… */
function splitInlineOptions(text: string): { stem: string; options: string[] } | null {
  const marks = [...text.matchAll(INLINE_OPTION)]
  if (marks.length < 2) return null
  for (let i = 0; i < marks.length; i++) if (marks[i][1] !== LATIN[i]) return null
  const at = (m: RegExpMatchArray) => (m.index ?? 0) + (m[0].length - m[0].trimStart().length)
  const stem = text.slice(0, at(marks[0])).trim()
  const options = marks.map((m, i) => text.slice((m.index ?? 0) + m[0].length, i + 1 < marks.length ? at(marks[i + 1]) : undefined).trim())
  return options.every(Boolean) ? { stem, options } : null
}

export function extractTutorQuiz(source: string): QuizExtraction {
  const lines = linesOf(lexTutorText(source)).map((l) => l.trim())
  interface Draft { number: number; stem: string[]; options: string[]; script?: 'latin' | 'arabic'; closed: boolean }
  const drafts: Draft[] = []
  let cur: Draft | null = null
  for (const line of lines) {
    if (!line) { if (cur && cur.options.length) cur.closed = true; continue }
    const q = QUESTION.exec(line)
    if (q && !(cur && !cur.closed && cur.options.length === 0 && !q[2] && !q[3])) {
      const number = Number(q[1] ?? q[3])
      const rest = (q[2] ?? '').trim()
      const inline = rest ? splitInlineOptions(rest) : null
      cur = { number, stem: inline ? [inline.stem] : rest ? [rest] : [], options: inline ? inline.options : [], script: inline ? 'latin' : undefined, closed: false }
      drafts.push(cur)
      continue
    }
    if (cur && !cur.closed) {
      const expectedLatin = LATIN[cur.options.length]
      const lo = cur.script !== 'arabic' ? OPTION_LATIN.exec(line) : null
      if (lo && lo[1].toUpperCase() === expectedLatin && (cur.script === 'latin' || lo[1].toUpperCase() === 'A')) {
        cur.script = 'latin'; cur.options.push(lo[2].trim()); continue
      }
      const ao = cur.script !== 'latin' ? OPTION_ARABIC.exec(line) : null
      if (ao && ao[1] === ARABIC[cur.options.length]) {
        cur.script = 'arabic'; cur.options.push(ao[2].trim()); continue
      }
      if (cur.options.length === 0) { cur.stem.push(line); continue }
      cur.closed = true
    }
  }
  const withOptions = drafts.map((d, i) => (d.options.length ? i : -1)).filter((i) => i >= 0)
  if (!withOptions.length) return { ok: false, reason: 'no encontré preguntas numeradas con opciones (A, B, C…) en el texto del Tutor' }
  // Numbered lines before the first real question or after the last one are instructions, not questions.
  const quiz = drafts.slice(withOptions[0], withOptions[withOptions.length - 1] + 1)
  const broken = quiz.filter((d) => d.options.length < 2)
  if (broken.length) return { ok: false, reason: `la pregunta ${broken.map((d) => d.number).join(', ')} no tiene al menos dos opciones legibles` }
  const empty = quiz.filter((d) => !d.stem.join(' ').trim())
  if (empty.length) return { ok: false, reason: `la pregunta ${empty.map((d) => d.number).join(', ')} no tiene enunciado` }
  if (quiz.length > QUIZ_RESOURCE_LIMITS.questions) return { ok: false, reason: `tiene ${quiz.length} preguntas; el máximo técnico por componente es ${QUIZ_RESOURCE_LIMITS.questions}` }
  const wide = quiz.find((d) => d.options.length > QUIZ_RESOURCE_LIMITS.options)
  if (wide) return { ok: false, reason: `la pregunta ${wide.number} tiene más de ${QUIZ_RESOURCE_LIMITS.options} opciones` }
  const long = quiz.find((d) => d.stem.join('\n').length > QUIZ_RESOURCE_LIMITS.chars || d.options.some((o) => o.length > QUIZ_RESOURCE_LIMITS.chars))
  if (long) return { ok: false, reason: `la pregunta ${long.number} supera ${QUIZ_RESOURCE_LIMITS.chars} caracteres` }
  return { ok: true, questions: quiz.map((d) => ({ number: d.number, question: d.stem.join('\n').trim(), options: d.options })) }
}
