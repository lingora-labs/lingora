// Side-effect authorization belongs to the execution contract, not to
// the mentor's self-reported trigger. Mode entry or a wish for export
// CONTROLS does not authorize creation of a PDF file.
export function isExplicitPdfRequest(message: string, activeMode?: string): boolean {
  const text = message.trim()
  if (!text) return false
  if (/\b(?:sin|no quiero|no generes|no hagas|without|don't generate)\b.{0,70}\bpdf\b/iu.test(text)) return false
  if (/\b(?:opci[oó]n(?:es)?|posibilidad|bot[oó]n(?:es)?|capacidad)\s+(?:de\s+)?(?:exportar|exportaci[oó]n|descarga|descargar)\b/iu.test(text)
      && !/\b(?:genera|prepara|crea|haz|exporta|descarga|desc[aá]rgame)\b.{0,70}\bpdf\b/iu.test(text)) return false
  // In PDF-course mode, an explicit request for an actual course DELIVERY
  // is sufficient; selecting that mode or greeting alone is not.
  if (activeMode === 'pdf_course' &&
      /\b(?:primera entrega|siguiente entrega|m[oó]dulo|lecci[oó]n|curso)\b/iu.test(text) &&
      /\b(?:prepara|genera|crea|entrega|haz|quiero|necesito)\b/iu.test(text)) return true
  const mentionsPdf = /\b(?:pdf|archivo imprimible|documento descargable)\b/iu.test(text)
  if (!mentionsPdf) return false
  if (/\b(?:genera|prepara|crea|haz|convierte|quiero|necesito|elabora|exporta|descarga|dame|produce|create|generate|make|export|download)\b[\s\S]{0,160}\b(?:pdf|archivo imprimible|documento descargable)\b/iu.test(text)) return true
  if (/\b(?:pdf|archivo imprimible|documento descargable)\b.{0,60}\b(?:ahora|por favor|please|de este|del curso|completo)\b/iu.test(text)) return true
  return false
}

/** Route an explicit student command to export the ACTUAL chat transcript,
 * not a new tutor-authored PDF about the last lesson. Shared by UI and API.
 */
export function isConversationPdfExportRequest(message:string):boolean {
  const text=message.trim()
  if (/^(?:no|sin|don't|do not)\b/iu.test(text)) return false
  // An informational question about HOW to export is not an authorization
  // to produce a file and must preserve the user's explicit intent.
  if (/^¿?\s*(?:c[oó]mo|cu[aá]l es la forma|d[oó]nde|qu[eé] pasos)\b/iu.test(text)) return false
  if (!/\bpdf\b/iu.test(text)) return false
  if (!/\b(?:conversaci[oó]n|chat|historial|dialogo|di[aá]logo)\b/iu.test(text)) return false
  return /\b(?:exporta(?:r)?|exportar|descarga(?:r)?|descargar|genera(?:r)?|crear?|prepara(?:r)?|convierte|quiero\s+exportar|necesito\s+exportar)\b/iu.test(text)
}

// Instrumental checks only — never route or author the tutor's cognitive answer.
export function isPdfProhibitedByUser(message:string):boolean {
 return /\b(?:sin|no\s+(?:quiero|generes?|hagas?|produzcas?|necesito)|without|do\s+not\s+(?:make|generate)|don't\s+(?:make|generate))\b[\s\S]{0,90}\bpdf\b/iu.test(message.trim())
}
export function isPdfAndWebRequest(message:string):boolean {
 return !isPdfProhibitedByUser(message) && /\bpdf\b/iu.test(message)
  && /\b(?:versi[oó]n\s+(?:web|html)|p[aá]gina\s+web|html|web\s+version|website\s+version|web\s+page)\b/iu.test(message)
}
