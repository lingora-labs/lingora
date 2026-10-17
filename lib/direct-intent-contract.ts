// SEEK 2.7 — explicit-intent output contract. Does not classify ambiguous
// student goals and does not introduce a second cognitive authority.
// It only recognises literal "translate/correct this:" requests for which the
// constitution requires *solely* the requested transformation.
export type DirectFormat = 'translation' | 'correction'
export function directFormatFor(message:string):DirectFormat|null {
  const v=message.trim()
  if (/^(?:traduce(?:me)?\s+(?:al?|a\s+la)\s+[\p{L}\s-]{2,35}|translate\s+(?:to|into)\s+[\p{L}\s-]{2,35})\s*:\s*\S/iu.test(v)) return 'translation'
  if (/^(?:corrige\s+(?:esto|esta\s+frase|este\s+texto)|correct\s+(?:this|the\s+following))\s*:\s*\S/iu.test(v)) return 'correction'
  return null
}
const tidy=(s:string)=>s.replace(/^\s+|\s+$/g,'').replace(/^["“”«]([\s\S]*)["“”»]$/,'$1').trim()
/**
 * Short explicit transformations must not retain model-authored wrappers,
 * lesson notes or unsolicited content. Only this bounded format is trimmed;
 * all substantive tutor/long-form responses preserve their streaming path.
 */
export function formatDirectAnswer(kind:DirectFormat,value:string):string {
  let out=value.trim()
  if(kind==='translation'){
    out=out.replace(/^(?:in\s+(?:english|spanish|norwegian|french|german|italian)|en\s+(?:ingl[eé]s|espa[nñ]ol|noruego|franc[eé]s|alem[aá]n|italiano)|translation|traducci[oó]n)\s*:\s*/iu,'')
    out=out.split(/\n\s*\n/)[0].trim()
    return tidy(out)
  }
  out=out.replace(/^(?:la\s+(?:forma|frase|versi[oó]n)\s+correcta\s+es|la\s+correcci[oó]n\s+es|correcci[oó]n|corrected(?:\s+sentence)?|correction)\s*:\s*/iu,'')
  out=out.split(/\n/).filter(Boolean)[0]?.trim()||out.trim()
  const extra=/(?:\s*Peque[nñ]a\s+correcci[oó]n\s*:|\s*Nota\s*:|\s*Explicaci[oó]n\s*:)/iu
  out=out.split(extra)[0].trim()
  return tidy(out)
}
