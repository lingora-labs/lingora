// This is a side-effect authorization check, not a cognitive router.
// Mentioning a completed quiz during pedagogical review does NOT request a
// new quiz. The Tutor can discuss a quiz freely without materializing one.
export function isExplicitQuizRequest(message:string):boolean {
 const text=message.trim()
 const noun=/\b(?:quiz|simulacro|cuestionario|test(?:\s+interactivo)?|interactive\s+test)\b/iu
 if(!noun.test(text))return false
 // Explicit refusal has higher authority than any positive mention.
 if(/\b(?:no\s+(?:quiero|necesito|generes|hagas|prepares)|sin|without|do\s+not|don't)\b[\s\S]{0,80}\b(?:quiz|simulacro|cuestionario|test)\b/iu.test(text))return false
 const request=/\b(?:convierte|transforma|hazme|haz|crea(?:me)?|genera(?:me)?|prepara(?:me)?|dame|ponme|quiero|necesito|inicia|empezar|comienza|otro|otra|start|give\s+me|make|create|generate|prepare|i\s+want|i\s+need)\b[\s\S]{0,180}\b(?:quiz|simulacro|cuestionario|test(?:\s+interactivo)?|interactive\s+test)\b/iu
 return request.test(text) || /^\s*(?:quiz|simulacro|cuestionario)\s+(?:de|sobre|para)\b/iu.test(text)
}
