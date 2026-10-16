// DAE — REAL INTEGRATION TEST for AE-01's actual persistence mechanism.
// Exercises the full real pipeline: orchestrate() -> executePlan() (which
// internally calls the real dispatchToExecutor(), including the mentor
// "contract clarification bypass" — exercised transitively, not mocked)
// -> mergeStatePatch(). No function body is re-implemented here; every
// call below hits the actual module on disk.
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

  const message = 'Olvídalo.';
  const ctx: OrchestrationContext = {
    message, state, intent: conversationIntent, hasAudio: false, isFirstTurn: false,
    interfaceLanguage: 'es', timestamp: Date.now(),
  };

  // Step 1 — the real orchestrate() must produce a cancellation plan.
  const plan = orchestrate(ctx);
  check(
    'AE-01 pipeline step 1/3: orchestrate() produces the cancel-contract plan',
    plan.executor === 'mentor' && plan.executionOrder[0]?.action === 'collectDocumentParameter'
      && plan.executionOrder[0]?.params?.clearDocumentContract === true,
    `plan=${JSON.stringify(plan.executionOrder[0])}`,
  );

  // Step 2 — the real executePlan() must dispatch through the mentor
  // "contract clarification bypass" in execution-engine.ts (no LLM call:
  // if this test hangs or throws on a network/API-key error, the bypass
  // did NOT fire before getMentorResponse(), which would itself be a
  // regression) and return a statePatch that clears the contract.
  const request: ChatRequest = { message, state };
  const result = await executePlan(plan, request, state);
  const patchHasKey = Object.prototype.hasOwnProperty.call(result.statePatch, 'pendingDocumentRequest');
  check(
    // DAE fix (AE-EXECUTE round, defect C) — the clear sentinel is now the
    // transport-safe `null`, not `undefined` (undefined is dropped by
    // JSON.stringify at the API boundary — see lib/contracts.ts's
    // CLEARABLE_FIELDS doc comment). mergeStatePatch() still translates it
    // to `undefined` on the in-memory SessionState (checked in step 3/3).
    'AE-01 pipeline step 2/3: executePlan() returns a statePatch that explicitly carries pendingDocumentRequest: null (transport-safe clear sentinel)',
    patchHasKey && result.statePatch.pendingDocumentRequest === null,
    `statePatch=${JSON.stringify(result.statePatch)}`,
  );
  check(
    'AE-01 pipeline step 2/3b: the acknowledgement text was returned directly by the bypass (no LLM call needed)',
    typeof result.message === 'string' && result.message.length > 0,
    `message=${JSON.stringify(result.message)}`,
  );

  // Step 3 — the real mergeStatePatch() must durably remove
  // pendingDocumentRequest from the SESSION STATE the client receives
  // back and sends on the NEXT turn, so the gate does not re-trigger.
  const mergedState = mergeStatePatch(state, result.statePatch);
  check(
    'AE-01 pipeline step 3/3: mergeStatePatch() durably clears pendingDocumentRequest from the merged session state',
    mergedState.pendingDocumentRequest === undefined,
    `mergedState.pendingDocumentRequest=${JSON.stringify(mergedState.pendingDocumentRequest)}`,
  );

  // Step 4 — the contract is durably gone: a FOLLOW-UP turn against the
  // merged state must NOT re-enter buildDocumentContractGate at all
  // (since pendingDocumentRequest?.status is no longer 'collecting').
  const followUpCtx: OrchestrationContext = {
    message: 'Cuéntame algo sobre Colombia.',
    state: mergedState,
    intent: conversationIntent,
    hasAudio: false,
    isFirstTurn: false,
    interfaceLanguage: 'es',
    timestamp: Date.now(),
  };
  const followUpPlan = orchestrate(followUpCtx);
  check(
    'AE-01 pipeline step 4/4: the NEXT turn after cancellation no longer sees an open document contract',
    followUpPlan.pedagogicalAction !== 'generate_course_pdf'
      && followUpPlan.executionOrder[0]?.action !== 'openDocumentContract'
      && followUpPlan.executionOrder[0]?.action !== 'collectDocumentParameter',
    `followUpPlan.pedagogicalAction=${followUpPlan.pedagogicalAction} action=${followUpPlan.executionOrder[0]?.action}`,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL (unexpected throw — e.g. the mentor LLM bypass did not fire):', err);
  process.exit(1);
});
