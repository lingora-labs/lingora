// LINGORA 7.5 — facts about the student that their own words prove (immersion contract @202f6171).
//
// The Tutor DECLARES a fact with a typed call (record_learning_fact), exactly like it declares its
// explanation language or a memory note. The runtime never reads the conversation to decide what
// happened; it only checks PROVENANCE:
//   - every fact carries `evidence`: the student's exact words, and those words must appear, as whole
//     words, in what the student actually wrote (current message, or an earlier one for a result);
//   - immersion_declined is accepted only when this conversation holds an identifiable invitation
//     (an invitation the platform recorded, or the previous Tutor turn linking the channel);
//   - praise, promises and inferences carry no student words, so they cannot become a result.
// Accepted facts are returned with the turn; the browser stores them in the Space (lib/space/model.ts).
// A fact written in turn N is part of the Space only after turn N completes, so it can never make
// turn N itself eligible for an invitation.

export const LEARNING_FACT_KINDS = ['goal', 'result', 'immersion_declined', 'immersion_reopened'] as const
export type LearningFactKind = typeof LEARNING_FACT_KINDS[number]
export interface LearningFactDeclaration { fact: LearningFactKind; text: string; evidence: string }
export interface AcceptedLearningFact extends LearningFactDeclaration { id: string; conversationId: string; at: string }
export interface LearningFactContext {
  conversationId: string
  currentStudentMessage: string
  priorStudentMessages: string[]
  invitationInConversation: boolean
  at: string
}
export type LearningFactRejection = { fact: string; reason: 'evidence_not_in_student_words' | 'evidence_missing' | 'text_missing' | 'no_identified_invitation' | 'no_conversation' }

export const LEARNING_FACT_LIMITS = { facts: 8, text: 280, evidence: 600 } as const

export const RECORD_LEARNING_FACT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'record_learning_fact',
    description: 'Record facts about this student that their own words prove, so they stay true across the conversations of their space. ' +
      'goal: an objective the student states. ' +
      'result: a concrete achievement in the student\'s own work that you recognize in this reply (an exercise solved correctly, a correction applied, an objective met), not praise, encouragement or a prediction. ' +
      'immersion_declined: the student declines an immersion invitation you made earlier in this conversation. ' +
      'immersion_reopened: the student brings immersion back up after having declined it. ' +
      'evidence: the student\'s exact words that show the fact, copied verbatim. Small call; keep writing your reply as usual.',
    parameters: {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fact: { type: 'string', enum: [...LEARNING_FACT_KINDS] },
              text: { type: 'string', description: 'The fact in one short sentence (the goal, or the achievement you recognize).' },
              evidence: { type: 'string', description: 'The student\'s exact words, verbatim.' },
            },
            required: ['fact', 'text', 'evidence'],
          },
        },
      },
      required: ['facts'],
    },
  },
}

/** Shape check of the Tutor's call. Null when malformed (reported as invalid_learning_fact). */
export function parseLearningFacts(raw: unknown): LearningFactDeclaration[] | null {
  const list = raw && typeof raw === 'object' ? (raw as { facts?: unknown }).facts : undefined
  if (!Array.isArray(list) || !list.length || list.length > LEARNING_FACT_LIMITS.facts) return null
  const out: LearningFactDeclaration[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') return null
    const { fact, text, evidence } = item as Record<string, unknown>
    if (typeof fact !== 'string' || !(LEARNING_FACT_KINDS as readonly string[]).includes(fact)) return null
    if (typeof text !== 'string' || typeof evidence !== 'string') return null
    out.push({ fact: fact as LearningFactKind, text: text.trim().slice(0, LEARNING_FACT_LIMITS.text), evidence: evidence.trim().slice(0, LEARNING_FACT_LIMITS.evidence) })
  }
  return out
}

const words = (s: string): string[] =>
  s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/** True when `evidence` appears as a contiguous run of whole words in `source`. */
export function wordsAppearIn(evidence: string, source: string): boolean {
  const e = words(evidence), s = words(source)
  if (!e.length || e.length > s.length) return false
  outer: for (let i = 0; i + e.length <= s.length; i++) {
    for (let j = 0; j < e.length; j++) if (s[i + j] !== e[j]) continue outer
    return true
  }
  return false
}

/** Stable, dependency-free hash (FNV-1a 32) for idempotent fact ids. */
export function factHash(s: string): string {
  let h = 0x811c9dc5
  for (const ch of s) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}

/** Same student words in the same conversation → same id, whatever retries or reloads happen. */
export function learningFactId(fact: LearningFactKind, conversationId: string, evidence: string): string {
  if (fact === 'immersion_declined') return 'lf_immersion_declined'
  return `lf_${fact}_${factHash(conversationId + '|' + words(evidence).join(' '))}`
}

export function validateLearningFacts(decls: LearningFactDeclaration[], ctx: LearningFactContext): { accepted: AcceptedLearningFact[]; rejected: LearningFactRejection[] } {
  const accepted: AcceptedLearningFact[] = []
  const rejected: LearningFactRejection[] = []
  if (!ctx.conversationId) return { accepted, rejected: decls.map(d => ({ fact: d.fact, reason: 'no_conversation' as const })) }
  for (const d of decls) {
    if (!words(d.evidence).length) { rejected.push({ fact: d.fact, reason: 'evidence_missing' }); continue }
    if ((d.fact === 'goal' || d.fact === 'result') && !d.text) { rejected.push({ fact: d.fact, reason: 'text_missing' }); continue }
    // A result may point to work the student did earlier in this conversation; everything else is about this message.
    const sources = d.fact === 'result' ? [ctx.currentStudentMessage, ...ctx.priorStudentMessages] : [ctx.currentStudentMessage]
    if (!sources.some(s => wordsAppearIn(d.evidence, s))) { rejected.push({ fact: d.fact, reason: 'evidence_not_in_student_words' }); continue }
    if (d.fact === 'immersion_declined' && !ctx.invitationInConversation) { rejected.push({ fact: d.fact, reason: 'no_identified_invitation' }); continue }
    const id = learningFactId(d.fact, ctx.conversationId, d.evidence)
    if (accepted.some(a => a.id === id)) continue
    accepted.push({ ...d, id, conversationId: ctx.conversationId, at: ctx.at })
  }
  return { accepted, rejected }
}

/** Shape check of facts coming back from the wire (client side). */
export function sanitizeAcceptedFacts(raw: unknown): AcceptedLearningFact[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((f): f is AcceptedLearningFact => !!f && typeof f === 'object'
    && (LEARNING_FACT_KINDS as readonly string[]).includes((f as AcceptedLearningFact).fact)
    && typeof (f as AcceptedLearningFact).id === 'string' && typeof (f as AcceptedLearningFact).conversationId === 'string'
    && typeof (f as AcceptedLearningFact).at === 'string' && typeof (f as AcceptedLearningFact).text === 'string'
    && typeof (f as AcceptedLearningFact).evidence === 'string').slice(0, LEARNING_FACT_LIMITS.facts)
}
