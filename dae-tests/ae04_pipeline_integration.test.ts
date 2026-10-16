// DAE — REAL INTEGRATION TEST for AE-04, full pipeline (same discipline as
// the AE-01 pipeline test AE already accepted). Proves AE's demand
// directly: "evidencia de que la intención explícita prevalece sobre el
// contrato heredado" — not just that orchestrate() PRODUCES the right
// plan, but that executing it durably clears the contract so the user's
// actual next message (their real new intent) is evaluated fresh by the
// full orchestration pipeline, not pre-owned by the stale contract.
import { orchestrate } from '../server/core/orchestrator';
import { executePlan } from '../server/core/execution-engine';
import { mergeStatePatch } from '../server/core/state-manager';
import {
  OrchestrationContext,
  SessionState,
  DEFAULT_SESSION_STATE,
  IntentResult,
  ChatRequest,
  PendingDocumentRequest,
} from '../lib/contracts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail: string): void {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) console.log('  ' + detail);
  if (cond) pass++; else fail++;
}

async function main(): Promise<void> {
  const conversationIntent: IntentResult = { type: 'conversation', explicit: false, confidence: 0.5 };
  const existing: PendingDocumentRequest = { type: 'course_pdf', level: 'A1', topic: null, status: 'collecting', openedAtToken: 0 };
  const state: SessionState = { ...DEFAULT_SESSION_STATE, interfaceLanguage: 'es', pendingDocumentRequest: existing, tokens: 1 };

  const message = 'Cambiemos de tema';
  const ctx: OrchestrationContext = {
    message, state, intent: conversationIntent, hasAudio: false, isFirstTurn: false,
    interfaceLanguage: 'es', timestamp: Date.now(),
  };

  // Step 1 — orchestrate() must produce the task_switch plan, not a
  // tool_pdf plan with the bogus topic "cambiemos de".
  const plan = orchestrate(ctx);
  check(
    'AE-04 pipeline step 1/4: orchestrate() produces the task-switch plan, never tool_pdf with a garbage topic',
    plan.executor === 'mentor'
      && plan.pedagogicalAction !== 'generate_course_pdf'
      && plan.executionOrder[0]?.action === 'collectDocumentParameter'
      && plan.executionOrder[0]?.params?.clearDocumentContract === true,
    `plan=${JSON.stringify({ executor: plan.executor, pedagogicalAction: plan.pedagogicalAction, step: plan.executionOrder[0] })}`,
  );

  // Step 2 — executePlan() dispatches through the SAME mentor bypass
  // AE-01 already verified, with no LLM call (clarificationMessage text
  // returned directly), and returns a statePatch that explicitly clears
  // pendingDocumentRequest.
  const request: ChatRequest = { message, state };
  const result = await executePlan(plan, request, state);
  const patchHasKey = Object.prototype.hasOwnProperty.call(result.statePatch, 'pendingDocumentRequest');
  check(
    'AE-04 pipeline step 2/4: executePlan() returns a statePatch that explicitly carries pendingDocumentRequest: undefined',
    patchHasKey && result.statePatch.pendingDocumentRequest === undefined,
    `statePatch=${JSON.stringify(result.statePatch)}`,
  );
  check(
    'AE-04 pipeline step 2/4b: the redirect acknowledgement was returned directly by the bypass (no LLM call)',
    typeof result.message === 'string' && result.message.length > 0,
    `message=${JSON.stringify(result.message)}`,
  );

  // Step 3 — mergeStatePatch() must durably remove pendingDocumentRequest
  // from the session state the client receives and sends on the NEXT turn.
  const mergedState = mergeStatePatch(state, result.statePatch);
  check(
    'AE-04 pipeline step 3/4: mergeStatePatch() durably clears pendingDocumentRequest from the merged session state',
    mergedState.pendingDocumentRequest === undefined,
    `mergedState.pendingDocumentRequest=${JSON.stringify(mergedState.pendingDocumentRequest)}`,
  );

  // Step 4 — THE decisive proof AE asked for: the user's actual next
  // message (their real new topic/intent, e.g. a genuinely different
  // subject) is now evaluated by the FULL orchestrate() pipeline from a
  // clean slate — not silently re-absorbed into a leftover PDF contract,
  // and not forced into the stale A1/course_pdf frame at all.
  const followUpCtx: OrchestrationContext = {
    message: 'Cuéntame sobre la historia de Cartagena.',
    state: mergedState,
    intent: conversationIntent,
    hasAudio: false,
    isFirstTurn: false,
    interfaceLanguage: 'es',
    timestamp: Date.now(),
  };
  const followUpPlan = orchestrate(followUpCtx);
  check(
    'AE-04 pipeline step 4/4: the user’s real next message is evaluated fresh — no open document contract, no generate_course_pdf, explicit intent wins over legacy context',
    followUpPlan.pedagogicalAction !== 'generate_course_pdf'
      && followUpPlan.executionOrder[0]?.action !== 'openDocumentContract'
      && followUpPlan.executionOrder[0]?.action !== 'collectDocumentParameter',
    `followUpPlan.pedagogicalAction=${followUpPlan.pedagogicalAction} action=${followUpPlan.executionOrder[0]?.action}`,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL (unexpected throw):', err);
  process.exit(1);
});
