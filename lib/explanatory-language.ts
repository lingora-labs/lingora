// 7.3.2: the Tutor remembers its own language decision. Optional, small, never required per turn.
// 7.6: the Tutor decides whether the current turn is a genuine conversation-language shift,
// an explicit language request, or merely a practice phrase/quotation. The picker gives an
// initial default, never a lock. The runtime validates the Tutor's quoted user words and
// ASR uncertainty; it does NOT classify languages, exercises, or intent by regex.
export const SET_EXPLANATORY_LANGUAGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'set_explanatory_language',
    description: 'When your actual explanatory reply language changes, record the new BCP-47 language. A student can naturally shift from Russian to Portuguese by speaking Portuguese; an explicit request is NOT required. Decide from meaning and tutoring context: a Spanish exercise, quoted foreign phrase, translation target, code sample, or uncertain ASR fragment is not a conversational-language shift. For an explicit request use basis=explicit_request; for a natural switch of the conversation use basis=conversation_shift. In BOTH cases quote evidence exactly from the student current message. Do not call if the language is unchanged. This updates UI labels too; continue the teaching task without restarting it.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        language: { type: 'string', description: 'Language code, e.g. ar, zh-Hans, no, fr.' },
        evidence: { type: 'string', description: 'Exact words from THIS student turn supporting the requested or natural conversational language change. Never an example quoted from an older turn.' },
        basis: { type: 'string', enum: ['explicit_request', 'conversation_shift'], description: 'Your semantic determination: explicit instruction or natural conversation-language change, not an exercise.' },
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


export function parseLanguageBasis(raw: unknown): 'explicit_request' | 'conversation_shift' | undefined {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).basis : undefined
  return v === 'explicit_request' || v === 'conversation_shift' ? v : undefined
}

export type LanguageSource = 'student_request' | 'student_turn' | 'selection' | 'tutor_detected'
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
  if (declared && (s.explanatoryLanguageSource === 'student_request' || s.explanatoryLanguageSource === 'student_turn')) return { language: declared, source: s.explanatoryLanguageSource }
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
  basis?: 'explicit_request' | 'conversation_shift'
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
  return { outcome: 'accepted', language: input.declared, source: input.basis === 'conversation_shift' ? 'student_turn' : 'student_request' }
}
