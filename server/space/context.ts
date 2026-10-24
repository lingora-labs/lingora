// LINGORA 7.5 — the Space contribution to one Tutor turn, on the server side.
// The client selects (lib/space/retrieve.ts); the server only validates the shape and the
// resource bounds and renders it as context with provenance. It never decides relevance and
// never reads anything the client did not send for this turn.
import { RETRIEVAL_TOKEN_BUDGET, type SpaceBlock, type SpaceContextPayload } from '../../lib/space/retrieve'
import { estimateTokens } from '../../lib/tutor-memory'
import { SPACE_RESOURCE_LIMITS } from '../../lib/space/model'

const ID = /^(?:source:[A-Za-z0-9_-]{1,64}#\d{1,6}|memory:[A-Za-z0-9_-]{1,64})$/

/** Null when absent or malformed. Blocks beyond the budget are dropped and counted as omitted. */
export function sanitizeSpaceContext(raw: unknown): SpaceContextPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Partial<SpaceContextPayload>
  if (typeof v.spaceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v.spaceId)) return null
  const instructions = typeof v.instructions === 'string' && v.instructions.trim()
    ? v.instructions.slice(0, SPACE_RESOURCE_LIMITS.instructionsChars) : null
  const blocks: SpaceBlock[] = []
  let used = 0
  let omitted = typeof v.omitted === 'number' && Number.isFinite(v.omitted) && v.omitted >= 0 ? Math.floor(v.omitted) : 0
  const seen = new Set<string>()
  for (const b of Array.isArray(v.blocks) ? v.blocks : []) {
    if (!b || typeof b.id !== 'string' || !ID.test(b.id) || seen.has(b.id) || (b.kind !== 'source' && b.kind !== 'memory')
      || typeof b.text !== 'string' || !b.text.trim() || typeof b.label !== 'string') continue
    const cost = estimateTokens(b.text) + 12
    if (used + cost > RETRIEVAL_TOKEN_BUDGET) { omitted++; continue }
    used += cost
    seen.add(b.id)
    blocks.push({ id: b.id, kind: b.kind, label: b.label.slice(0, 200), text: b.text })
  }
  if (!instructions && !blocks.length) return null
  return { spaceId: v.spaceId, instructions, blocks, omitted, usedTokens: used }
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()

/** Rendered as information the student placed in their space, each block with its id. */
export function formatSpaceContext(ctx: SpaceContextPayload | null | undefined): string {
  if (!ctx) return ''
  const parts: string[] = ['\n\n[STUDENT SPACE — material the student placed in their own space; information for this turn, with provenance]']
  if (ctx.instructions) parts.push('Space instructions written by the student (their standing preferences for every conversation in this space; the current message prevails if it says otherwise):\n' + ctx.instructions)
  if (ctx.blocks.length) {
    parts.push('Passages from the space that share words with this message (cite the bracketed id when you rely on one):')
    for (const b of ctx.blocks) parts.push(`[${b.id} · ${oneLine(b.label)}]\n${b.text}`)
  }
  if (ctx.omitted > 0) parts.push(`(${ctx.omitted} further matching passage(s) did not fit this turn's ${RETRIEVAL_TOKEN_BUDGET}-token space budget; ask the student to point to a passage if you need more.)`)
  return parts.join('\n')
}
