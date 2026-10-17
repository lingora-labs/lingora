// LINGORA — independently verifiable answer-key contract for the closed
// present-tense SER / ESTAR cloze domain.
//
// A model's "correct" index is evidence of intent, NEVER proof of correctness.
// For this defined domain, infer the unique expected grammatical form from
// explicit subject, syntax and lesson semantics; decline to score unproven
// items. No question, choice or answer is silently rewritten.
//
// Other subject domains retain their existing structural contract. This is
// deliberately not advertised as universal linguistic verification.
type Question = { question:string; options:string[]; correct:number; explanation?:string }
export type AnswerKeyAudit = { ok:boolean; reason?:string }

const serForms = ['soy','eres','es','somos','sois','son'] as const
const estarForms = ['estoy','estás','está','estamos','estáis','están'] as const
const copulas = new Set<string>(['ser','estar',...serForms,...estarForms])
const finiteSer = new Set<string>(serForms)
const finiteEstar = new Set<string>(estarForms)
type Person = 0|1|2|3|4|5

const normalize = (value:string):string => value.trim()
  .toLocaleLowerCase('es').normalize('NFC')
  .replace(/^[«"'¿¡(\s]+|[»"'.?!);\s]+$/gu,'').trim()
const normalizeOption = (value:string):string =>
  normalize(value.replace(/^\s*(?:[A-D]|[1-4])\s*[).:\-]\s*/iu,''))

function personOf(subject:string):Person|null {
  const s=normalize(subject)
  // This recognises explicit subjects only. Avoid assigning a person where
  // syntax is unknown; absence of proof must not grant a mark.
  const explicit:Record<string,Person>={
    yo:0, tú:1, tu:1, él:2, ella:2, usted:2,
    nosotros:3, nosotras:3, vosotros:4, vosotras:4,
    ellos:5, ellas:5, ustedes:5,
  }
  if (Object.prototype.hasOwnProperty.call(explicit,s)) return explicit[s]
  if (/^(?:mis|tus|sus|nuestros|nuestras|los|las|unos|unas)\s+\p{L}+(?:\s+\p{L}+)?$/u.test(s)) return 5
  // A single named entity or a simple singular noun phrase.
  if (/^\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?$/u.test(subject.trim())) return 2
  if (/^(?:el|la|un|una|mi|tu|su|nuestro|nuestra)\s+\p{L}+(?:\s+\p{L}+)?$/u.test(s)) return 2
  return null
}

const eventHead = /^(?:(?:el|la|un|una|mi|tu|su|nuestra|nuestro)\s+)?(?:boda|fiesta|reunión|concierto|clase|conferencia|examen|partido|evento|ceremonia|festival|acto|presentación)(?:\s+\p{L}+)?$/u
const location = /^(?:en\s+\S+|aquí\b|allí\b|ahí\b|cerca de\b|lejos de\b|dentro de\b)/u
const origin = /^de\s+\S+/u
const eventTime = /^(?:mañana\b|hoy\b|el\s+(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b|a\s+las\s+\d)/u
const transient = /^(?:cansad[oa]s?|nervios[oa]s?|enferm[oa]s?|preocupad[oa]s?|agotad[oa]s?|content[oa]s?|abiert[oa]s?|cerrad[oa]s?|trist[ei]s?|felic(?:es)?|list[oa]s?|ocupad[oa]s?)\b/u
const identity = /^(?:médic[oa]s?|doctor(?:a|es|as)?|profesor(?:a|es|as)?|ingenier[oa]s?|estudiant(?:e|es)|simpátic[oa]s?|inteligent(?:e|es)|alt[oa]s?|grand(?:e|es)|pequeñ[oa]s?|español(?:a|es|as)?|azul(?:es)?|importante(?:s)?|abogad[oa]s?)\b/u
const infinitiveGovernor = /(?:^|\s)(?:quiero|quieres|quiere|queremos|quieren|puedo|puedes|puede|podemos|pueden|necesito|necesita|necesitamos|prefiero|prefiere|debo|debes|debe|debemos|deben|para|sin|al|antes de|después de|voy a|vas a|va a|vamos a|van a)\s*$/u

/**
 * If a copular cloze is in the explicitly supported grammar domain, return
 * the UNIQUE grammatically expected answer. If not, return null: never
 * confuse the model-provided index with a checked answer.
 */
function expectedSerEstarForm(question:string):string|null {
  const gaps=[...question.matchAll(/_{2,}|\.{3,}|…/gu)]
  if (gaps.length !== 1) return null
  const pos=gaps[0].index??0
  const before=question.slice(0,pos).trim()
  const after=normalize(question.slice(pos+gaps[0][0].length))
  const subject=normalize(before)
  const semantic: 'ser'|'estar'|null =
    location.test(after) ? (eventHead.test(subject)?'ser':'estar')
    : origin.test(after) ? 'ser'
    : eventTime.test(after) && eventHead.test(subject) ? 'ser'
    : transient.test(after) ? 'estar'
    : identity.test(after.replace(/^(?:muy|bastante)\s+/u,'')) ? 'ser'
    : null
  if (!semantic) return null
  if (infinitiveGovernor.test(subject)) return semantic
  const person=personOf(before)
  if (person === null) return null
  return semantic === 'ser'?serForms[person]:estarForms[person]
}

/**
 * Reject the whole quiz if even one SER/ESTAR cloze lacks an independently
 * established and uniquely offered correct answer.
 *
 * Non-copular questions are kept backward compatible, but their accuracy is
 * NOT independently verified by this Spanish-specific contract.
 */
export function validateQuizAnswerKey(questions:Question[]):AnswerKeyAudit {
  if (!Array.isArray(questions) || questions.length===0) return {ok:false,reason:'empty_quiz'}
  for (const [i,q] of questions.entries()) {
    if (!q || typeof q.question!=='string' || !Array.isArray(q.options) ||
        !Number.isInteger(q.correct) || q.correct<0 || q.correct>=q.options.length ||
        q.options.some(x=>typeof x!=='string' || !x.trim())) {
      return {ok:false,reason:'invalid_answer_key:'+i}
    }
    const choices=q.options.map(normalizeOption)
    if(new Set(choices).size!==choices.length) return {ok:false,reason:'duplicate_options:'+i}
    const gaps=[...q.question.matchAll(/_{2,}|\.{3,}|…/gu)]
    if (!gaps.length) continue // Outside present-tense cloze scope.
    // Never let model-authored option labels ("A) es") bypass validation.
    // The grammatical construction itself can establish the supported scope,
    // regardless of how choices are decorated.
    const expected=expectedSerEstarForm(q.question)
    if (expected===null && !choices.some(x=>copulas.has(x))) continue
    if (gaps.length!==1) return {ok:false,reason:'compound_copula_cloze:'+i}
    if (!expected) return {ok:false,reason:'unverified_copula_cloze:'+i}
    const match=choices.map((v,k)=>v===expected?k:-1).filter(k=>k!==-1)
    if (match.length!==1) return {ok:false,reason:'missing_or_ambiguous_correct_option:'+i}
    if (q.correct!==match[0]) return {ok:false,reason:'incorrect_model_answer_key:'+i}
    // An unsupported alternative option such as an odd verb inflection cannot
    // itself count as correct: all scoring references the verified single form.
  }
  return {ok:true}
}
