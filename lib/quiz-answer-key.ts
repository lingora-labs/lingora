// LINGORA — quiz answer-key validation at materialization boundary.
// A model-authored key is not automatically a grammatically valid answer.
// The deterministic checks below cover the finite SER/ESTAR cloze class
// exercised in QA14. Other linguistic domains require independent coverage;
// this module never claims to be a universal grammar checker.
type Question = {question:string;options:string[];correct:number;explanation?:string}
const normal = (value:string):string => value.trim().toLocaleLowerCase('es').replace(/[¡!?.]+$/g,'').trim()
const finiteSer = new Set(['soy','eres','es','somos','sois','son'])
const finiteEstar = new Set(['estoy','estás','está','estamos','estáis','están'])
const copulas = new Set([...finiteSer,...finiteEstar,'ser','estar'])
const infinitiveLicense = /(?:(?:^|\s)(?:quiero|quieres|quiere|queremos|queréis|quieren|puedo|puedes|puede|podemos|pueden|debo|debes|debe|debemos|deben|necesito|necesita|necesitamos|prefiero|prefiere|deseo|desea|voy a|vas a|va a|vamos a|van a|para|sin|antes de|después de|al|a|de)\s*)$/iu
const eventSubject = /\b(?:fiesta|boda|reunión|concierto|clase|conferencia|examen|partido|evento|ceremonia|festival|acto|presentación)\b/iu

export function validateQuizAnswerKey(questions:Question[]):{ok:boolean;reason?:string} {
  for (const [index,q] of questions.entries()) {
    if (!q || typeof q.question !== 'string' || !Array.isArray(q.options) ||
        !Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) {
      return {ok:false,reason:'invalid_answer_key:'+index}
    }
    const options = q.options.map(normal)
    if (new Set(options).size !== options.length) {
      return {ok:false,reason:'duplicate_options:'+index}
    }
    const chosen = options[q.correct]
    if (!copulas.has(chosen)) continue
    const gaps = [...q.question.matchAll(/_{2,}|\.{3,}|…/gu)]
    if (gaps.length !== 1) continue // Compound gaps rejected by the enclosing contract
    const before = q.question.slice(0,gaps[0].index).trim()
    const after = q.question.slice((gaps[0].index ?? 0)+gaps[0][0].length).trim()
    const licensedInfinitive = infinitiveLicense.test(before)
    // A free-standing finite predicate cannot be completed with a lemma.
    // Example: María ___ en casa -> "estar" is NOT "está".
    if ((chosen === 'ser' || chosen === 'estar') && !licensedInfinitive) {
      return {ok:false,reason:'infinitive_in_finite_slot:'+index}
    }
    if (licensedInfinitive) continue
    // For an explicit Spanish present-tense subject, the answer must agree
    // with the subject. Unknown/plural noun phrases are left to the tutor;
    // ambiguous cases are not silently rewritten.
    const subject = before.toLocaleLowerCase('es')
    const pronoun = /(?:^|\s)(yo|tú|tu|él|ella|usted|nosotros|nosotras|vosotros|vosotras|ellos|ellas|ustedes)\s*$/u.exec(subject)?.[1]
    const expectedForms:Record<string,Set<string>> = {
      yo:new Set(['soy','estoy']),
      tú:new Set(['eres','estás']), tu:new Set(['eres','estás']),
      él:new Set(['es','está']), ella:new Set(['es','está']),
      usted:new Set(['es','está']),
      nosotros:new Set(['somos','estamos']), nosotras:new Set(['somos','estamos']),
      vosotros:new Set(['sois','estáis']), vosotras:new Set(['sois','estáis']),
      ellos:new Set(['son','están']), ellas:new Set(['son','están']),
      ustedes:new Set(['son','están']),
    }
    if (pronoun && !expectedForms[pronoun]?.has(chosen)) {
      return {ok:false,reason:'person_agreement:'+index}
    }
    // Spatial location with SER is valid for events ("La boda es en Madrid"),
    // but not the location of a person, place or ordinary object.
    const temporaryState = /^(?:cansad[oa]s?|nervios[oa]s?|enferm[oa]s?|preocupad[oa]s?|agotad[oa]s?|content[oa]s?)\b/iu.test(after)
      && /\b(?:hoy|ahora|esta mañana|en este momento)\b/iu.test(after)
    if (temporaryState && finiteSer.has(chosen)) {
      return {ok:false,reason:'ser_temporary_state:'+index}
    }
    const location = /^(?:en\s+\S+|aquí\b|allí\b|ahí\b|cerca de\b|lejos de\b)/iu.test(after)
    if (location && finiteSer.has(chosen) && !eventSubject.test(before)) {
      return {ok:false,reason:'ser_location_predicate:'+index}
    }
  }
  return {ok:true}
}
