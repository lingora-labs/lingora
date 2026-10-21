// Side-effect authorization belongs to the execution contract, not to
// the mentor's self-reported trigger. Mode entry or a wish for export
// CONTROLS does not authorize creation of a PDF file.
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

// Request verbs are matched as accent-insensitive STEMS (with clitics such as
// "preparame", "entregame") in ES and EN, so that phrasing variants of the same
// explicit request ("Preparame un PDF", "I need a printable PDF") authorize alike.
const REQUEST_STEMS =
  '(?:prepar\\w*|gener\\w*|cre[ae]\\w*|haz\\w*|hac\\w*|convierte\\w*|convertir\\w*|quier\\w*|necesit\\w*|elabor\\w*|export\\w*|descarg\\w*|d[ae]me\\w*|dam\\w*|produc\\w*|redact\\w*|escrib\\w*|arma\\w*|entreg\\w*|envi\\w*|adjunt\\w*|facilit\\w*|pued\\w*|podr\\w*|me\\s+gustar\\w*|' +
  'need|want|create|generate|make|export|download|prepare|produce|write|build|provide|give|send|get|can\\s+you|could\\s+you|would\\s+like|i\'d\\s+like)'

// A prohibition is a negator attached to a request verb or to the document noun
// itself ("no generes PDF", "ni generes PDF", "sin PDF", "do not make a PDF").
// It outranks every request stem. A negator that belongs to ANOTHER clause
// ("no quiero un quiz, quiero un PDF") does not match: words only, no punctuation.
const DOC = '(?:pdf|archivo imprimible|documento descargable)'
const NEG_VERB = '(?:prepar|gener|cre[ae]|haz|hag|hac|convert|quier|necesit|elabor|export|descarg|d[ae]me|produc|redact|escrib|entreg|envi|adjunt|make|create|generate|produce|export|download|want|need|send|give|provide)'
const PROHIBITION = new RegExp(
  `\\b(?:no|ni|nunca|tampoco|never|nor|don't|dont|do not|evita|evites|avoid)\\s+(?:\\w+\\s+){0,2}?${NEG_VERB}\\w*\\s+(?:\\w+\\s+){0,3}?${DOC}\\b` +
  `|\\b(?:sin|without)\\s+(?:\\w+\\s+){0,3}?${DOC}\\b` +
  `|\\b(?:ni|nor)\\s+(?:un\\s+)?${DOC}\\b`,
  'iu',
)

export function isExplicitPdfRequest(message: string, activeMode?: string): boolean {
  const raw = message.trim()
  if (!raw) return false
  const text = strip(raw)
  if (PROHIBITION.test(text)) return false
  if (/\b(?:sin|no quiero|no generes|no hagas|without|don't generate)\b.{0,70}\bpdf\b/iu.test(text)) return false
  if (/\b(?:opcion(?:es)?|posibilidad|boton(?:es)?|capacidad)\s+(?:de\s+)?(?:exportar|exportacion|descarga|descargar)\b/iu.test(text)
      && !/\b(?:genera|prepara|crea|haz|exporta|descarga|descargame)\b.{0,70}\bpdf\b/iu.test(text)) return false
  // In PDF-course mode, an explicit request for an actual course DELIVERY
  // is sufficient; selecting that mode or greeting alone is not.
  if (activeMode === 'pdf_course' &&
      /\b(?:primera entrega|siguiente entrega|modulo|leccion|curso)\b/iu.test(text) &&
      /\b(?:prepara|genera|crea|entrega|haz|quiero|necesito)\b/iu.test(text)) return true
  const mentionsPdf = /\b(?:pdf|archivo imprimible|documento descargable)\b/iu.test(text)
  if (!mentionsPdf) return false
  // Pure informational questions about the format are not delivery requests.
  if (/^\s*[¿]?\s*(?:como\s+(?:se\s+)?(?:hace|crea|genera|exporta)|que\s+es|what\s+is|how\s+(?:do|does|can)\b)/iu.test(text)
      && !/\b(?:me|for me|para mi)\b/iu.test(text)) return false
  // Late-sentence explicit requests are authorizations, not cognitive routing.
  if (new RegExp(`\\b${REQUEST_STEMS}\\b[\\s\\S]{0,160}\\b${DOC}\\b`, 'iu').test(text)) return true
  if (new RegExp(`\\b${DOC}\\b.{0,60}\\b(?:ahora|por favor|please|de este|del curso|completo)\\b`, 'iu').test(text)) return true
  return false
}

/** Route an explicit student command to export the ACTUAL chat transcript,
 * not a new tutor-authored PDF about the last lesson. Shared by UI and API.
 */
export function isConversationPdfExportRequest(message:string):boolean {
  const text=message.trim()
  if (/^(?:no|sin|don't|do not)\b/iu.test(text)) return false
  if (/^¿?\s*(?:c[oó]mo|cu[aá]l es la forma|d[oó]nde|qu[eé] pasos)\b/iu.test(text)) return false
  if (!/\bpdf\b/iu.test(text)) return false
  // Exporting the EXISTING dialogue is an instrumental operation; asking
  // for a new document ABOUT a dialogue is an entirely different intention.
  // Never treat an incidental "incluye un diálogo" as a transcript export.
  const explicitExport=/\b(?:exporta(?:r)?|descarga(?:r)?|convierte|genera(?:r)?|prepara(?:r)?|crea(?:r)?|haz|quiero\s+exportar|necesito\s+exportar|p[aá]same)\b/iu
  if(!explicitExport.test(text))return false
  const direct=/\b(?:exporta(?:r)?|descarga(?:r)?|convierte|p[aá]same)\s+(?:(?:todo|toda|el|la|este|esta|mi|nuestro|nuestra)\s+){0,3}(?:conversaci[oó]n|chat|historial|di[aá]logo)\b/iu
  const owned=/\b(?:esta|mi|nuestra|nuestro)\s+conversaci[oó]n\b|\b(?:mi|este|el|nuestro|nuestra)\s+(?:historial|chat)\b|\b(?:este|nuestro)\s+di[aá]logo\b|\bhistorial\s+de\s+(?:la|esta)\s+conversaci[oó]n\b/iu
  return direct.test(text)||owned.test(text)
}

// Instrumental checks only — never route or author the tutor's cognitive answer.
export function isPdfProhibitedByUser(message:string):boolean {
 const t=message.trim()
 return /\b(?:sin|no\s+(?:quiero|generes?|hagas?|produzcas?|necesito)|without|do\s+not\s+(?:make|generate)|don't\s+(?:make|generate))\b[\s\S]{0,90}\bpdf\b/iu.test(t)
   || PROHIBITION.test(strip(t))
}
export function isPdfAndWebRequest(message:string):boolean {
 return !isPdfProhibitedByUser(message) && /\bpdf\b/iu.test(message)
  && /\b(?:versi[oó]n\s+(?:web|html)|p[aá]gina\s+web|html|web\s+version|website\s+version|web\s+page)\b/iu.test(message)
}
