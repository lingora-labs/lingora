// LINGORA 7.5 — the bounded projection of the Space that immersion eligibility reads.
// It does not depend on lexical retrieval (which may or may not surface a fact within 1,500 tokens):
// every confirmed goal, every result the Tutor declared on the student's words, and a standing decline.
import type { Space } from './model'

export interface CommercialFact { id: string; value: string; at: string }
export interface CommercialFacts { goals: CommercialFact[]; results: CommercialFact[]; declinedAt: string | null }

export const COMMERCIAL_PROJECTION_LIMITS = { perKind: 5, value: 280 } as const
/** Keys under which the student (panel) or the Tutor (record_learning_fact) stores an objective. */
const GOAL_KEYS = new Set(['goal', 'objetivo', 'objective'])

export function projectCommercialFacts(space: Space): CommercialFacts {
  const confirmed = space.memory.filter(f => f.kind === 'confirmed')
  const pick = (list: typeof confirmed): CommercialFact[] => list
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-COMMERCIAL_PROJECTION_LIMITS.perKind)
    .map(f => ({ id: f.id, value: f.value.slice(0, COMMERCIAL_PROJECTION_LIMITS.value), at: f.at }))
  const declined = confirmed.filter(f => f.key === 'immersion_declined').sort((a, b) => a.at.localeCompare(b.at))[0]
  return {
    goals: pick(confirmed.filter(f => GOAL_KEYS.has(f.key.trim().toLowerCase()))),
    // A result counts only when the Tutor declared it on the student's own words (never typed in by hand, never inferred).
    results: pick(confirmed.filter(f => f.key === 'result' && f.provenance?.origin === 'tutor_declared')),
    declinedAt: declined ? declined.at : null,
  }
}

/** Server-side shape check of the projection carried in the turn state. */
export function sanitizeCommercialFacts(raw: unknown): CommercialFacts | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Partial<CommercialFacts>
  const list = (x: unknown): CommercialFact[] => (Array.isArray(x) ? x : [])
    .filter((f): f is CommercialFact => !!f && typeof f.id === 'string' && typeof f.value === 'string' && f.value.trim().length > 0 && typeof f.at === 'string')
    .slice(-COMMERCIAL_PROJECTION_LIMITS.perKind)
    .map(f => ({ id: f.id.slice(0, 80), value: f.value.slice(0, COMMERCIAL_PROJECTION_LIMITS.value), at: f.at.slice(0, 40) }))
  return { goals: list(v.goals), results: list(v.results), declinedAt: typeof v.declinedAt === 'string' ? v.declinedAt.slice(0, 40) : null }
}
