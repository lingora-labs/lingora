// LINGORA Tutor First: context, not an independent commercial copywriter.
// The model chooses whether immersion adds value. This module enforces the
// Manifiesto's frequency ceiling and records only invitations actually sent.
import type { SessionState, CommercialOffer } from '../../lib/contracts'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const INVITATION_PATH = '/immersion'

function recentOffers(state: SessionState, now: number): CommercialOffer[] {
  return (state.commercialOffers ?? []).filter(
    o => Number.isFinite(o.timestamp) && o.timestamp > now - WEEK_MS && o.timestamp <= now,
  )
}

function canInvite(state: SessionState, now: number): boolean {
  const recent = recentOffers(state, now)
  const sessionId = state.sessionId
  if (recent.length >= 2) return false
  if (recent.some(o => now - o.timestamp < WEEK_MS)) return false
  if (sessionId && recent.some(o => o.sessionId === sessionId)) return false
  return true
}

export function commercialContextForTurn(_message: string, state: SessionState): string {
  const permitted = canInvite(state, Date.now())
  const goal = state.lastUserGoal ?? state.userObjective ?? 'not yet established'
  const level = state.confirmedLevel ?? state.userLevel ?? 'not confirmed'
  return '\n\n[IMMERSION CONTEXT — MANIFIESTO ARTS. 34–37 bis]\n' +
    'The student learns Spanish as a living cultural practice, and may eventually value real-world immersion. ' +
    'Do the requested work first. A suggestion is appropriate ONLY after real value, when the learner’s own context shows interest or preparation. Never sell from a template or infer a reservation. ' +
    'Current learner goal: ' + String(goal).slice(0,180) + '; level: ' + level + '.\n' +
    (permitted
      ? 'If truly pertinent, you MAY naturally mention exploring immersion via ' + INVITATION_PATH + '. Do not mention the link unless an invitation has genuine contextual value. '
      : 'Do not initiate a new immersion invitation this turn: frequency limit reached. Answer direct questions about immersion factually if asked, without promotional pressure. ') +
    'This is a real contact-interest page, NOT an automatic booking or payment checkout. Never claim any date, availability, price, agreement, payment, or reserved place.'
}

export function recordedImmersionOfferPatch(
  state: SessionState, tutorReply: string, now = Date.now(),
): Pick<SessionState, 'commercialOffers'> | Record<string, never> {
  const mentioned = /(?:\]\(\s*\/immersion(?:[?#][^)]*)?\s*\)|(?:^|\s)\/immersion\b)/iu.test(tutorReply)
  if (!mentioned || !canInvite(state, now)) return {}
  const history = recentOffers(state, now)
  return {
    commercialOffers: [...history, {
      type: 'immersion', timestamp: now,
      sessionId: state.sessionId ?? null, interest: true,
    }],
  }
}
