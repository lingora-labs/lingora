// Per-turn runtime fact for the one Tutor Maestro (Manifiesto arts. 48 and 51):
// the runtime validates and executes, and tells the Tutor what is TRUE this turn.
//
// Why this exists: for an explicit PDF/HTML request the runtime fixes
// tool_choice to 'none' and renders the Tutor's own text deterministically.
// The only description of that route used to be a static paragraph far inside
// a long system prompt, next to a description of a tool that is disabled for
// the turn. Mid-lesson the Tutor could conclude that it cannot attach files.
// The declaration below is derived from the SAME authorization that fixes
// tool_choice, so what the Tutor is told and what the runtime does cannot
// diverge. It is a statement of capability, not a script for the answer.
import { isExplicitPdfRequest, isConversationPdfExportRequest } from '@/lib/pdf-intent-authorization'
import type { ExecutionPlan } from '@/lib/contracts'

export function deliveryContextForTurn(
  message: string,
  activeMode: string | undefined,
  plan?: ExecutionPlan,
): string {
  // While the student's document parameters are still being collected the
  // Tutor must ask, not write the document.
  const awaitingParameters = Boolean(plan?.documentContractUpdate && !plan.documentContractReady)
  if (awaitingParameters) return ''
  // Exporting the existing chat is a runtime operation, not authored content.
  if (isConversationPdfExportRequest(message)) return ''
  if (!isExplicitPdfRequest(message, activeMode)) return ''
  return '\n\n[DELIVERY CONTEXT - THIS TURN] ' +
    'The student explicitly requested downloadable material (PDF and/or web HTML). ' +
    'This capability is available right now and is performed by the platform, not by you: it takes the text of your answer, renders it as a real PDF and web HTML, and attaches both files with download buttons. ' +
    'Therefore your answer IS the document: begin directly with its title and write the complete requested material in every language the student asked for, including exercises and solutions. ' +
    'Do not write any preface or closing about files, formats, conversion, access or what you can or cannot do, and do not offer an outline or a promise. No tool call is needed.'
}
