// LINGORA 7.5 — immersion as context, not as a copywriter (Manifiesto arts. 34–37 bis;
// contract docs/MOTOR_INMERSION.md @202f6171).
//
// buildCommercialContext(state) returns FACTS the Tutor reads in the ContextPack. There is no
// template, no appended sentence and no decision about pertinence here: whether and when an
// invitation adds value is the Tutor's judgement (art. 36).
//
// offerAllowed concerns only invitations LINGORA initiates. It is true when ALL hold:
//   1. a goal the student stated or confirmed (a confirmed Space fact; lastUserGoal alone is not one);
//   2. at least one result the Tutor recognized in an earlier interaction (a Space fact declared on the
//      student's own words — lib/learning-facts.ts);
//   3. no standing decline (a Space fact; only the student reopens the subject);
//   4. frequency: at most ONE invitation per conversation and TWO within any rolling 7 days of the Space.
// offerAllowed=true is permission, never an obligation. A question the student asks about immersion
// is outside offerAllowed and is answered whatever these facts say: nothing here filters the reply.
// The facts come from the Space BEFORE the turn, so a result declared in this turn counts from the next one.
import type { SessionState } from './contracts'
import { sanitizeCommercialFacts, type CommercialFacts } from './space/commercial-projection'

export const OFFER_LIMITS = { perConversation: 1, perWindow: 2, windowMs: 7 * 24 * 60 * 60 * 1000 } as const
export const IMMERSION_PATH = '/immersion'

export interface CommercialContext {
  level: string | null
  goal: { confirmed: boolean; value: string | null }
  result: { count: number; lastValue: string | null; lastAt: string | null }
  declined: { standing: boolean; since: string | null }
  interest: { recorded: boolean; count: number; lastAt: string | null; lastNote: string | null }
  offerAllowed: boolean
  offersInWindow: number
  offersThisConversation: number
}

type CommercialState = Partial<Pick<SessionState, 'commercialOffers' | 'sessionId' | 'confirmedLevel' | 'userLevel'>>
  & { immersionInterest?: Array<{ at?: unknown; note?: unknown }>; commercialFacts?: unknown }

function offers(state: CommercialState, now: number) {
  return (state.commercialOffers ?? []).filter(o => o && Number.isFinite(o.timestamp) && o.timestamp <= now)
}

const EMPTY_FACTS: CommercialFacts = { goals: [], results: [], declinedAt: null }

export function buildCommercialContext(state: CommercialState, now: number = Date.now()): CommercialContext {
  const all = offers(state, now)
  const inWindow = all.filter(o => o.timestamp > now - OFFER_LIMITS.windowMs).length
  const sid = state.sessionId ?? null
  const thisConversation = sid ? all.filter(o => o.sessionId === sid).length : 0
  const facts = sanitizeCommercialFacts(state.commercialFacts) ?? EMPTY_FACTS
  // Only facts that existed before this turn: anything stamped after the request clock is ignored.
  const before = (at: string) => { const t = Date.parse(at); return Number.isFinite(t) && t <= now }
  const goals = facts.goals.filter(f => before(f.at))
  const results = facts.results.filter(f => before(f.at))
  const declinedStanding = facts.declinedAt !== null && before(facts.declinedAt)
  const interest = (Array.isArray(state.immersionInterest) ? state.immersionInterest : [])
    .filter(i => i && typeof i.at === 'string')
    .map(i => ({ at: String(i.at), note: typeof i.note === 'string' ? i.note : '' }))
    .sort((a, b) => a.at.localeCompare(b.at))
  const last = interest[interest.length - 1]
  const level = String(state.confirmedLevel ?? state.userLevel ?? '').trim()
  const frequencyOk = thisConversation < OFFER_LIMITS.perConversation && inWindow < OFFER_LIMITS.perWindow
  return {
    level: level || null,
    goal: { confirmed: goals.length > 0, value: goals.length ? goals[goals.length - 1].value.slice(0, 180) : null },
    result: { count: results.length, lastValue: results.length ? results[results.length - 1].value : null, lastAt: results.length ? results[results.length - 1].at : null },
    declined: { standing: declinedStanding, since: declinedStanding ? facts.declinedAt : null },
    interest: { recorded: interest.length > 0, count: interest.length, lastAt: last?.at ?? null, lastNote: last?.note ? last.note.slice(0, 280) : null },
    offerAllowed: goals.length > 0 && results.length > 0 && !declinedStanding && frequencyOk,
    offersInWindow: inWindow,
    offersThisConversation: thisConversation,
  }
}

const q = (s: string) => '"' + s.replace(/[\r\n"]+/g, ' ').trim() + '"'

/** ContextPack lines: statements of fact, no imperative. */
export function formatCommercialFacts(c: CommercialContext | null | undefined): string[] {
  if (!c) return []
  const interest = c.interest.recorded
    ? `recorded ${c.interest.count} time(s), last ${c.interest.lastAt}${c.interest.lastNote ? ` — student's note: ${q(c.interest.lastNote)}` : ''}`
    : 'none recorded'
  return [
    `immersion.level: ${c.level ?? 'not confirmed'}`,
    `immersion.goal: ${c.goal.confirmed ? 'confirmed ' + q(c.goal.value ?? '') : 'not confirmed by the student'}`,
    `immersion.result: ${c.result.count ? `${c.result.count} recognized in earlier interactions, last ${q(c.result.lastValue ?? '')} (${c.result.lastAt})` : 'none recognized yet'}`,
    `immersion.declined: ${c.declined.standing ? `yes, since ${c.declined.since}; only the student reopens the subject` : 'no'}`,
    `immersion.interest: ${interest}`,
    `immersion.offerAllowed: ${c.offerAllowed} (concerns invitations LINGORA initiates; true needs a confirmed goal, an earlier recognized result, no standing decline and frequency room: ${c.offersThisConversation}/${OFFER_LIMITS.perConversation} in this conversation, ${c.offersInWindow}/${OFFER_LIMITS.perWindow} in the last 7 days)`,
    'immersion.scope: a question the student asks about immersion is outside offerAllowed.',
    `immersion.channel: ${IMMERSION_PATH} lets the student record interest in their own space; it is not a booking, payment or reservation, and no date, place or price exists there.`,
  ]
}

/** An invitation the Tutor actually sent (a link to the channel), recorded only when the rule allowed it. */
export function mentionsImmersionChannel(text: string): boolean {
  return /(?:\]\(\s*\/immersion(?:[?#][^)]*)?\s*\)|(?:^|\s)\/immersion\b)/iu.test(text)
}
