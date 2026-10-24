// LINGORA 7.5 — immersion as context, not as a copywriter (Manifiesto arts. 34–37 bis).
//
// buildCommercialContext(state) returns FACTS the Tutor reads in the ContextPack:
// the learner's level and goal, whether they recorded interest in immersion, and whether the
// frequency rule leaves room for an invitation this turn. There is no template, no appended
// sentence and no decision about pertinence here: whether an invitation adds value is the
// Tutor's judgement (art. 36). The runtime only enforces frequency (art. 37 bis).
//
// Frequency rule (one reading of "1/sesión, 2/semana, 7 días"): at most ONE invitation per
// conversation and at most TWO within any rolling 7-day window of the student's Space.
// The offer history travels with the Space, so a new conversation does not reset the window.
import type { SessionState } from './contracts'

export const OFFER_LIMITS = { perConversation: 1, perWindow: 2, windowMs: 7 * 24 * 60 * 60 * 1000 } as const
export const IMMERSION_PATH = '/immersion'

export interface CommercialContext {
  level: string | null
  goal: string | null
  interest: { recorded: boolean; count: number; lastAt: string | null; lastNote: string | null }
  offerAllowed: boolean
  offersInWindow: number
  offersThisConversation: number
}

type CommercialState = Partial<Pick<SessionState, 'commercialOffers' | 'sessionId' | 'lastUserGoal' | 'userObjective' | 'confirmedLevel' | 'userLevel'>>
  & { immersionInterest?: Array<{ at?: unknown; note?: unknown }> }

function offers(state: CommercialState, now: number) {
  return (state.commercialOffers ?? []).filter(o => o && Number.isFinite(o.timestamp) && o.timestamp <= now)
}

export function buildCommercialContext(state: CommercialState, now: number = Date.now()): CommercialContext {
  const all = offers(state, now)
  const inWindow = all.filter(o => o.timestamp > now - OFFER_LIMITS.windowMs).length
  const sid = state.sessionId ?? null
  const thisConversation = sid ? all.filter(o => o.sessionId === sid).length : 0
  const interest = (Array.isArray(state.immersionInterest) ? state.immersionInterest : [])
    .filter(i => i && typeof i.at === 'string')
    .map(i => ({ at: String(i.at), note: typeof i.note === 'string' ? i.note : '' }))
    .sort((a, b) => a.at.localeCompare(b.at))
  const last = interest[interest.length - 1]
  const goal = String(state.lastUserGoal ?? state.userObjective ?? '').trim()
  const level = String(state.confirmedLevel ?? state.userLevel ?? '').trim()
  return {
    level: level || null,
    goal: goal ? goal.slice(0, 180) : null,
    interest: { recorded: interest.length > 0, count: interest.length, lastAt: last?.at ?? null, lastNote: last?.note ? last.note.slice(0, 280) : null },
    offerAllowed: thisConversation < OFFER_LIMITS.perConversation && inWindow < OFFER_LIMITS.perWindow,
    offersInWindow: inWindow,
    offersThisConversation: thisConversation,
  }
}

/** ContextPack lines: statements of fact, no imperative. */
export function formatCommercialFacts(c: CommercialContext | null | undefined): string[] {
  if (!c) return []
  const interest = c.interest.recorded
    ? `recorded ${c.interest.count} time(s), last ${c.interest.lastAt}${c.interest.lastNote ? ` — student's note: "${c.interest.lastNote.replace(/[\r\n"]+/g, ' ')}"` : ''}`
    : 'none recorded'
  return [
    `immersion.level: ${c.level ?? 'not confirmed'}`,
    `immersion.goal: ${c.goal ?? 'not yet established'}`,
    `immersion.interest: ${interest}`,
    `immersion.offerAllowed: ${c.offerAllowed} (frequency: ${c.offersThisConversation}/${OFFER_LIMITS.perConversation} in this conversation, ${c.offersInWindow}/${OFFER_LIMITS.perWindow} in the last 7 days)`,
    `immersion.channel: ${IMMERSION_PATH} lets the student record interest in their own space; it is not a booking, payment or reservation, and no date, place or price exists there.`,
  ]
}

/** An invitation the Tutor actually sent (a link to the channel), recorded only when the rule allowed it. */
export function mentionsImmersionChannel(text: string): boolean {
  return /(?:\]\(\s*\/immersion(?:[?#][^)]*)?\s*\)|(?:^|\s)\/immersion\b)/iu.test(text)
}
