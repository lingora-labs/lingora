// DAE — REAL INTEGRATION TEST for AE-05 (third round on PR #10). Imports the
// ACTUAL orchestrate() and executePlan() from the real, patched files.
// Proves AE's concrete case: "Cambiemos de tema. Cuéntame sobre la historia
// de Cartagena." against an open A1 contract must clear the contract AND
// act on the new instruction in the SAME turn — not just acknowledge the
// redirect and ask again what the user wants.
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

function baseState(overrides: Partial<SessionState> = {}): SessionState {
  return { ...DEFAULT_SESSION_STATE, interfaceLanguage: 'es', ...overrides };
}

const conversationIntent: IntentResult = { type: 'conversation', explicit: false, confidence: 0.5 };

function ctxFor(message: string, state: SessionState): OrchestrationContext {
  return { message, state, intent: conversationIntent, hasAudio: false, isFirstTurn: false, interfaceLanguage: 'es', timestamp: Date.now() };
}

function existingContract(level: string | null, topic: string | null): PendingDocumentRequest {
  return { type: 'course_pdf', level, topic, status: 'collecting', openedAtToken: 0 };
}

async function main(): Promise<void> {
  // AE's exact AE-05 case.
  {
    const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
    const message = 'Cambiemos de tema. Cuéntame sobre la historia de Cartagena.';
    const plan = orchestrate(ctxFor(message, state));

    check(
      "AE-05 (AE's exact case) 1/3: orchestrate() does NOT return the canned task_switch acknowledgement — it resolves the remainder",
      plan.reason.includes('task_switch_continuation') && plan.pedagogicalAction !== 'generate_course_pdf',
      `reason=${plan.reason} pedagogicalAction=${plan.pedagogicalAction}`,
    );
    check(
      'AE-05 (AE\'s exact case) 2/3: the plan carries clearDocumentContract:true at the plan level',
      plan.clearDocumentContract === true,
      `clearDocumentContract=${plan.clearDocumentContract}`,
    );

    // Full pipeline: executePlan() must honor the plan-level flag
    // regardless of which executor/action the remainder resolved to
    // (here: ordinary mentor conversation about Cartagena, not
    // collectDocumentParameter or generateCoursePdf).
    const request: ChatRequest = { message, state };
    const result = await executePlan(plan, request, state);
    const patchHasKey = Object.prototype.hasOwnProperty.call(result.statePatch, 'pendingDocumentRequest');
    check(
      // DAE fix (AE-EXECUTE round, defect C+H) — transport-safe `null`
      // sentinel, applied here via the shared clearDocumentContractIfRequested()
      // helper (state-manager.ts) that both execution-engine.ts and
      // execution-engine-stream.ts now call identically.
      'AE-05 (AE\'s exact case) 3/3: executePlan() clears pendingDocumentRequest via the plan-level flag (null sentinel) even though the resolved action is NOT collectDocumentParameter/generateCoursePdf',
      patchHasKey && result.statePatch.pendingDocumentRequest === null,
      `statePatch=${JSON.stringify(result.statePatch)}`,
    );

    const mergedState = mergeStatePatch(state, result.statePatch);
    check(
      'AE-05 pipeline: mergeStatePatch() durably clears pendingDocumentRequest',
      mergedState.pendingDocumentRequest === undefined,
      `mergedState.pendingDocumentRequest=${JSON.stringify(mergedState.pendingDocumentRequest)}`,
    );
  }

  // Regression — a plain redirect with NO immediate instruction must still
  // get the AE-04 clarification plan, not a continuation plan with a junk
  // remainder.
  {
    const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
    const plan = orchestrate(ctxFor('Cambiemos de tema.', state));
    const step = plan.executionOrder[0];
    check(
      'AE-05 regression: bare "Cambiemos de tema." (no remainder) still gets the AE-04 clarification plan, not a continuation',
      !plan.reason.includes('task_switch_continuation')
        && plan.reason.includes('task_switch')
        && step?.action === 'collectDocumentParameter'
        && step?.params?.clearDocumentContract === true,
      `reason=${plan.reason} action=${step?.action}`,
    );
  }

  // Regression — AE-01 cancellation must remain untouched by AE-05 logic.
  {
    const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
    const plan = orchestrate(ctxFor('Olvídalo.', state));
    check(
      'AE-05 regression: AE-01 cancellation ("Olvídalo.") unaffected by the new continuation logic',
      plan.reason.includes('cancelled') && !plan.reason.includes('task_switch'),
      `reason=${plan.reason}`,
    );
  }

  // Regression — H1b bare-topic continuation ("Ser y estar") must still
  // resolve straight to tool_pdf, untouched by task_switch detection.
  {
    const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
    const plan = orchestrate(ctxFor('Ser y estar', state));
    check(
      'AE-05 regression: bare topic continuation "Ser y estar" (H1b) still resolves to tool_pdf',
      plan.executor === 'tool_pdf' && plan.resolvedTopic === 'ser y estar' && plan.clearDocumentContract === undefined,
      `executor=${plan.executor} resolvedTopic=${plan.resolvedTopic} clearDocumentContract=${plan.clearDocumentContract}`,
    );
  }

  // Additional redirect-with-instruction phrasing, different verb/object
  // from AE's own example, to confirm the fix is structural (remainder
  // extraction) and not keyed to that one sentence.
  {
    const state = baseState({ pendingDocumentRequest: existingContract('B1', null), tokens: 2 });
    const plan = orchestrate(ctxFor('Mejor hablemos de otra cosa. Explícame el subjuntivo.', state));
    check(
      'AE-05: a second redirect+instruction phrasing also triggers the continuation plan, never generate_course_pdf',
      plan.reason.includes('task_switch_continuation') && plan.pedagogicalAction !== 'generate_course_pdf' && plan.clearDocumentContract === true,
      `reason=${plan.reason} pedagogicalAction=${plan.pedagogicalAction}`,
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL (unexpected throw):', err);
  process.exit(1);
});
