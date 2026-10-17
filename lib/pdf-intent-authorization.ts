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