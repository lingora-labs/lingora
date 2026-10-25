// 7.3.2: the Tutor remembers its own language decision. Optional, small, never required per turn.
// 7.5 P1-A: the language of the Tutor's explanations is a STATE CONTRACT with precedence, decided here
// and applied by the engine — not by persona prose:
//   1. a change the student asked for explicitly, proven by the student's own words in that turn;
//   2. the language the student selected in the picker (any picker language, Spanish included);
//   3. only when the student picked OTROS (no selection): the language the Tutor settled on.
// What the student writes or says (a Spanish exercise, an Italian expression, a mixed sentence, an ASR
// hypothesis) never changes the language by itself. Teaching examples in any language never change it.
export const SET_EXPLANATORY_LANGUAGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'set_explanatory_language',
    description: 'Record the language you explain in for this student (ISO 639 / BCP-47 code, e.g. ar, zh, no, tr, nl, pt-BR). If the student selected a language, it stays until the student explicitly asks you to explain in another one: then call this with that language AND evidence = the exact words of the student\'s message that ask for it. Without such words the change is not recorded. The language a student writes or speaks an exercise in, or a word in another language, is not a request. Never call it on every turn. It has no effect on your reply: keep writing your normal answer.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        language: { type: 'string', description: 'Language code, e.g. ar, zh-Hans, no, fr.' },
        evidence: { type: 'string', description: 'The student\'s own words in this message asking to change the language of your explanations (copy them exactly).' },
      },
      required: ['language'],
    },
  },
}
const LANGUAGE_CODE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/
export function parseExplanatoryLanguage(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const v = (raw as Record<string, unknown>).language
  if (typeof v !== 'string') return null
  const code = v.trim()
  return LANGUAGE_CODE.test(code) ? code : null
}
export function parseLanguageEvidence(raw: unknown): string | undefined {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).evidence : undefined
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : undefined
}

export type LanguageSource = 'student_request' | 'selection' | 'tutor_detected'
export interface LanguageAuthority { language: string | null; source: LanguageSource | null }
export interface LanguageStateFields {
  interfaceLanguage?: string
  uiLanguageChoice?: string
  explanatoryLanguage?: string
  explanatoryLanguageSource?: string
}

const primary = (code: string) => code.toLowerCase().split('-')[0]
export const sameLanguage = (a?: string | null, b?: string | null): boolean => Boolean(a && b && primary(a) === primary(b))

/** The binding explanatory language of a session. A stored value without the student's request (7.3/7.4
 *  sessions, or one the Tutor inferred from an ASR hypothesis) never overrides an explicit selection. */
export function resolveExplanatoryLanguage(s: LanguageStateFields): LanguageAuthority {
  const declared = typeof s.explanatoryLanguage === 'string' && LANGUAGE_CODE.test(s.explanatoryLanguage.trim()) ? s.explanatoryLanguage.trim() : null
  if (declared && s.explanatoryLanguageSource === 'student_request') return { language: declared, source: 'student_request' }
  const selected = s.uiLanguageChoice !== 'other' && typeof s.interfaceLanguage === 'string' && LANGUAGE_CODE.test(s.interfaceLanguage) ? s.interfaceLanguage : null
  if (selected) return { language: selected, source: 'selection' }
  if (declared) return { language: declared, source: 'tutor_detected' }
  return { language: null, source: null }
}

const fold = (t: string) => t.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim()
const contains = (haystack: string, needle: string) => {
  const h = ` ${fold(haystack)} `, n = fold(needle)
  return n.length > 0 && h.includes(` ${n} `)
}

export type LanguageDecision =
  | { outcome: 'unchanged'; language: string | null }
  | { outcome: 'accepted'; language: string; source: Exclude<LanguageSource, 'selection'> }
  | { outcome: 'rejected'; language: string | null; reason: 'language_change_not_requested' | 'evidence_not_in_student_words' | 'evidence_uncertain' }

/** Whether a set_explanatory_language declaration changes the session. Pure; the runtime reads no intent:
 *  it only checks that the Tutor's quoted evidence is in the student's own words of this turn. */
export function decideLanguageDeclaration(input: {
  declared: string
  evidence?: string
  state: LanguageStateFields
  studentWords: string
  /** Fragments the speech recognizer was not sure about: they can never prove a request. */
  uncertain?: string[]
}): LanguageDecision {
  const current = resolveExplanatoryLanguage(input.state)
  if (sameLanguage(current.language, input.declared)) return { outcome: 'unchanged', language: current.language }
  // OTROS: no selection exists, so the first language the Tutor settles on is recorded as detected.
  if (!current.language) return { outcome: 'accepted', language: input.declared, source: 'tutor_detected' }
  if (!input.evidence) return { outcome: 'rejected', language: current.language, reason: 'language_change_not_requested' }
  if (!contains(input.studentWords, input.evidence)) return { outcome: 'rejected', language: current.language, reason: 'evidence_not_in_student_words' }
  const ev = fold(input.evidence)
  if ((input.uncertain ?? []).some(u => { const f = fold(u); return f && (ev.includes(f) || f.includes(ev)) }))
    return { outcome: 'rejected', language: current.language, reason: 'evidence_uncertain' }
  return { outcome: 'accepted', language: input.declared, source: 'student_request' }
}
