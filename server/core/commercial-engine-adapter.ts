// =============================================================================
// server/core/commercial-engine-adapter.ts
// LINGORA SEEK 3.0 — Commercial Engine Adapter
// =============================================================================
// Purpose  : Bridge between route.ts / execution-engine-stream.ts and the
//            PROTECTED commercial-engine.ts.
//
//            REAL ENGINE CONTRACT (SEEK 2.6 [PROTECTED], verified):
//
//              Input:
//                commercialEngine(message: string, state: Partial<SessionState>)
//
//              Output (CommercialResult):
//                trigger: CommercialTrigger | null
//                         where CommercialTrigger contains trigger.message —
//                         the canonical, already-localized commercial message
//                         computed by the engine.
//
//            ADAPTER RULE:
//            If trigger.message exists, it is the canonical message.
//            The adapter does NOT derive new copy. It does NOT rewrite.
//            It normalizes the engine output to CommercialEvaluationResult.
//            The commercial intelligence belongs to the engine, not the adapter.
//
// Commit   : fix(commercial-adapter): read trigger.message as canonical —
//            no derived copy, adapter normalizes only
// =============================================================================

import {
  SessionState,
  ExecutionPlan,
  CommercialTrigger,
  CommercialEngineTrigger,
  COMMERCIAL_COOLDOWN_TOKENS,
} from '../../lib/contracts';

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER OUTPUT
// ─────────────────────────────────────────────────────────────────────────────

export interface CommercialEvaluationResult {
  triggered: boolean;
  message?:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// REAL ENGINE OUTPUT — matches commercial-engine.ts (SEEK 2.6 [PROTECTED])
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CommercialResult — the typed output of commercialEngine().
 * trigger is CommercialEngineTrigger | null (declared in contracts.ts).
 * Native type — no cast required at the call site.
 */
interface CommercialResult {
  trigger: CommercialEngineTrigger | null;
  state?:  Partial<SessionState>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — single function for both JSON and SSE branches
// ─────────────────────────────────────────────────────────────────────────────

const NOT_TRIGGERED: CommercialEvaluationResult = { triggered: false };

/**
 * evaluateCommercial
 * ──────────────────────────────────────────────────────────────────────────
 * @param updatedState  Post-execution, post-mergeStatePatch() state.
 *                      Both JSON and SSE pass the same post-merge state.
 * @param plan          Used for guard checks only.
 */
export async function evaluateCommercial(
  updatedState: SessionState,
  plan: ExecutionPlan,
): Promise<CommercialEvaluationResult> {

  // ── Guards ────────────────────────────────────────────────────────────────
  if (plan.blocking)                                    return NOT_TRIGGERED;
  if (!plan.commercial)                                 return NOT_TRIGGERED;
  if (updatedState.tokens < COMMERCIAL_COOLDOWN_TOKENS) return NOT_TRIGGERED;
  if (!plan.commercial.cooldownRespected)               return NOT_TRIGGERED;
  if (plan.commercial.sessionScore < 60)                return NOT_TRIGGERED;

  try {
    const { commercialEngine } = await import('./commercial-engine');

    const contextMessage = updatedState.lastConcept ?? updatedState.lastUserGoal ?? '';
    const result: CommercialResult = await commercialEngine(contextMessage, updatedState);

    // Engine returns trigger: CommercialTrigger | null
    if (!result.trigger) return NOT_TRIGGERED;

    // RULE: trigger.message is the canonical commercial copy.
    // CommercialResult.trigger is CommercialEngineTrigger | null — no cast required.
    const trigger = result.trigger;
    const message = trigger.message;
    if (!message) return NOT_TRIGGERED;

    return { triggered: true, message };

  } catch (err) {
    console.warn(
      '[commercial-adapter] engine failed — skipping:',
      err instanceof Error ? err.message : String(err),
    );
    return NOT_TRIGGERED;
  }
}

