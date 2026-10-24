// LINGORA 7.5 — server half of the immersion context.
// The facts the Tutor reads come from lib/commercial-context.ts (ContextPack). This module only
// (a) records an invitation the Tutor actually sent, when the frequency rule allowed it, and
// (b) keeps the server lead-capture channel (email to LINGORA) behind the DAE privacy gate.
// Recording interest in the student's own Space (browser) does not need that gate.
import type { SessionState } from '../../lib/contracts'
import { buildCommercialContext, mentionsImmersionChannel } from '../../lib/commercial-context'

export const LEAD_CAPTURE_RELEASED = false // DAE privacy gate for SERVER-side lead storage; do not override without legal/storage review

export function recordedImmersionOfferPatch(
  state: SessionState, tutorReply: string, now = Date.now(),
): Pick<SessionState, 'commercialOffers'> | Record<string, never> {
  if (!mentionsImmersionChannel(tutorReply)) return {}
  if (!buildCommercialContext(state, now).offerAllowed) return {}
  return {
    commercialOffers: [...(state.commercialOffers ?? []), {
      type: 'immersion', timestamp: now, sessionId: state.sessionId ?? null, interest: true,
    }],
  }
}
