// Suppress unsolicited scheduled visuals during an explicitly requested quiz.
// This does NOT classify the tutor's conversational intention or select an answer.
export function isExplicitQuizRequest(message:string):boolean {
 return /\b(?:quiz|simulacro|cuestionario|test\s+interactivo|interactive\s+test)\b/iu.test(message)
}
