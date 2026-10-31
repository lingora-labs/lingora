// 7.6 R3 — the SPOKEN form of what is on screen. The screen keeps the Tutor's text untouched (tables, arrows, emoji);
// the voice gets a projection of that same text that a person could say: no symbols read aloud, "+" said as the
// grammar word, tables announced instead of read cell by cell. Pure and deterministic: it never adds teaching content.

const PLUS: Record<string, string> = { es: 'más', en: 'plus', fr: 'plus', de: 'plus', it: 'più', pt: 'mais', no: 'pluss' }
const EQUALS: Record<string, string> = { es: 'es', en: 'is', fr: 'égale', de: 'ist', it: 'è', pt: 'é', no: 'er' }
const TABLE_NOTICE: Record<string, string> = {
  es: 'Te dejo la tabla en la pantalla.', en: "I've put the table on your screen.", fr: 'Je te laisse le tableau à l’écran.',
  de: 'Die Tabelle siehst du auf dem Bildschirm.', it: 'Ti lascio la tabella sullo schermo.', pt: 'Deixo a tabela no ecrã.', no: 'Jeg har lagt tabellen på skjermen.',
}
const ES_HINT = /[¿¡ñáéíóú]|\b(?:el|la|los|las|de|que|un|una|con|por|para|ir|quiero|voy|se|me|te|lo|y)\b/gi

/** The language a fragment is written in: Spanish is recognised from the text itself (the Tutor teaches in it); otherwise the session's. */
export function textLang(text: string, fallback: string): string {
  const hits = text.match(ES_HINT)
  return hits && (hits.length >= 2 || /[¿¡ñáéíóú]/.test(text)) ? 'es' : (PLUS[fallback] ? fallback : 'es')
}
export function tableNotice(lang: string): string { return TABLE_NOTICE[lang] ?? TABLE_NOTICE.es }

/** Make already-visible text sayable. `lang` is the session language, used when the fragment itself is not recognisably Spanish. */
export function oralize(text: string, sessionLang = 'es'): string {
  const lang = textLang(text, sessionLang)
  let s = text
    .replace(/[\p{Extended_Pictographic}‍️⃣]/gu, ' ')       // emoji, ❌ ✅ and the like
    .replace(/\s*(?:->|=>|→|⇒|⟶|➜|➡)\s*/g, ', ')                           // arrows are a pause, not a word
    .replace(/\s*\+\s*/g, ` ${PLUS[lang] ?? ''} `)                          // "ir a + lugar" → "ir a más lugar"
    .replace(/\s*=\s*/g, ` ${EQUALS[lang] ?? ''} `)
    .replace(/[«»“”„"‘]/g, ' ')                                            // quotation marks are not spoken
    .replace(/[()[\]{}]/g, ',')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/[/\\|~^<>•·▪◦●■□★☆✓✔✗✘*_`#@&§©®™°]/g, ' ')                 // anything left that is a symbol, not a letter
    .replace(/[^\p{L}\p{N}\p{M}\s.,;:?!¿¡'’%€$…-]/gu, ' ')
  s = s.replace(/\s+,/g, ',').replace(/,(\s*,)+/g, ',').replace(/^[\s,]+/, '').replace(/([.!?…])\s*,\s*/g, '$1 ').replace(/[\s,]+$/, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
  return s
}
