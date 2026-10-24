// 7.5 — one action, one component (order "TRES CORRECCIONES", point 1).
// «Empezar quiz» opens the quiz ALREADY on screen: it writes no student message and asks the model for nothing.
// «Revisar mis respuestas» carries the stable identity of the quiz answered (instance id, fingerprint, title)
// together with its questions, options and selections, so a review can only be about that quiz.
// A new quiz is generated only when the student asks for one in their own words.
import { resolveMsgArtifacts, type Artifact, type Msg } from './beta-model'

export const QUIZ_ACTIVATE_EVENT = 'lingora-quiz-activate'

/** The quiz component an action refers to: the first quiz of the message that offered the action,
 *  otherwise the most recent quiz in the thread. Same id scheme as the chat renderer (`${msg.id}#${i}`). */
export function findQuizInstance(msgs: ReadonlyArray<Pick<Msg, 'id' | 'artifact' | 'artifacts'>>, sourceMsgId?: string): string | null {
  const firstQuiz = (m: Pick<Msg, 'id' | 'artifact' | 'artifacts'>): string | null => {
    const i = resolveMsgArtifacts(m).findIndex((a: Artifact) => a.type === 'quiz')
    return i < 0 ? null : `${m.id}#${i}`
  }
  if (sourceMsgId) {
    const source = msgs.find(m => m.id === sourceMsgId)
    const own = source ? firstQuiz(source) : null
    if (own) return own
  }
  for (let k = msgs.length - 1; k >= 0; k--) {
    const id = firstQuiz(msgs[k])
    if (id) return id
  }
  return null
}

export interface QuizIdentity { instanceId: string; key: string; title: string }
export interface QuizReviewResponse { question: string; options: string[]; chosen: string; verified?: 'correct' | 'incorrect' }

export function normalizeQuizIdentity(raw: unknown): QuizIdentity | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.instanceId !== 'string' || !/^[^\s#]{1,80}#\d{1,3}$/.test(r.instanceId)) return null
  if (typeof r.key !== 'string' || r.key.length < 1 || r.key.length > 128) return null
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 160) : 'Simulacro'
  return { instanceId: r.instanceId, key: r.key, title }
}

export function quizIdentityLine(q: QuizIdentity): string {
  return `quiz «${q.title}» (componente ${q.instanceId}, clave ${q.key})`
}

/** The review request for ONE identified quiz. It never asks for a new quiz and never claims a score
 *  the system did not verify itself. */
export function buildQuizReviewMessage(q: QuizIdentity, responses: QuizReviewResponse[]): string {
  return `He respondido al ${quizIdentityLine(q)}. Mis respuestas, sin calificación automática:\n` +
    responses.map((r, i) => String(i + 1) + '. ' + r.question + '\nOpciones: ' + r.options.join(' | ') + '\nElegí: ' + r.chosen +
      (r.verified ? '\nComprobación automática con clave independiente: ' + (r.verified === 'correct' ? 'acierto' : 'error') : '')).join('\n') +
    '\nRevisa pedagógicamente solo este quiz: cada elección e indica las soluciones justificadas. No generes otro quiz, no inventes una puntuación verificada ni generes PDF.'
}
