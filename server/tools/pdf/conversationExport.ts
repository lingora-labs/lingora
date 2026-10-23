// LINGORA 7.5 — conversation export = the canonical document page, one section per turn.
// The learner's real messages plus validated real-time artifacts are the single source of
// truth. No second tutor, no second Markdown converter, no invented data, no clipped turns.
import { renderDocumentPage, explainDocumentRefusal } from '../../../lib/content/document-page'
import type { PrintableArtifact } from '../../../lib/content/artifact-print'

export type ExportArtifact = PrintableArtifact
export interface ExportTurn {
  sender: string
  text: string
  complete?: boolean
  artifacts?: ExportArtifact[]
}

/** Resource limits of one export request (payload size), not of the conversation's content. */
export const EXPORT_RESOURCE_LIMITS = { turns: 2000, charsPerTurn: 400000, artifactsPerTurn: 50 } as const

export function validateExportTurns(raw: unknown): ExportTurn[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > EXPORT_RESOURCE_LIMITS.turns) return null
  const result: ExportTurn[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return null
    const v = t as Record<string, unknown>
    if (typeof v.sender !== 'string' || v.sender.length > 30 || typeof v.text !== 'string' || v.text.length > EXPORT_RESOURCE_LIMITS.charsPerTurn) return null
    // An unfinished or interrupted turn is never exported as if it were whole.
    if (v.complete === false) return null
    if (v.artifacts !== undefined && (!Array.isArray(v.artifacts) || v.artifacts.length > EXPORT_RESOURCE_LIMITS.artifactsPerTurn)) return null
    const artifacts = (v.artifacts ?? []) as unknown[]
    if (artifacts.some((a) => !a || typeof a !== 'object' || typeof (a as Record<string, unknown>).type !== 'string')) return null
    result.push({ sender: v.sender, text: v.text, complete: true, artifacts: artifacts as ExportArtifact[] })
  }
  return result
}

export const explainExportRefusal = explainDocumentRefusal

export function renderConversationExportHtml(title: string, turns: ExportTurn[]): string {
  return renderDocumentPage({ title, sections: turns.map((t) => ({ heading: t.sender, text: t.text, artifacts: t.artifacts })) }, 'print')
}
