// 7.3.2: the Tutor remembers its own language decision. Optional, small, never
// required per turn; the runtime only validates the code's shape and stores it.
export const SET_EXPLANATORY_LANGUAGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'set_explanatory_language',
    description: 'Record the language you explain in for this student (ISO 639 / BCP-47 code, e.g. ar, zh, no, tr, nl, pt-BR). Any language is allowed, in the UI picker or not. Call it only when you first settle the language or when it changes; never on every turn. It has no effect on your reply: keep writing your normal answer.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { language: { type: 'string', description: 'Language code, e.g. ar, zh-Hans, no, fr.' } },
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
