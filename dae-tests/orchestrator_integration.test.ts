// DAE — REAL INTEGRATION TEST, not a copied-fragment harness.
// Imports and calls the ACTUAL orchestrate() exported by the real,
// patched server/core/orchestrator.ts inside the build copy — the same
// module that ships. No function body is re-implemented here.
import { orchestrate } from '../server/core/orchestrator';
import {
  OrchestrationContext,
  SessionState,
  DEFAULT_SESSION_STATE,
  IntentResult,
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
const hardOverridePdfIntent: IntentResult = { type: 'hard_override', subtype: 'generate_course_pdf', explicit: true, confidence: 1 };

function ctxFor(message: string, state: SessionState, intent: IntentResult = conversationIntent): OrchestrationContext {
  return {
    message,
    state,
    intent,
    hasAudio: false,
    isFirstTurn: false,
    interfaceLanguage: 'es',
    timestamp: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// H1 — continuation turn with an EXISTING pendingDocumentRequest, routed
// through the real pendingDocumentRequest?.status === 'collecting' branch
// of orchestrate() -> buildDocumentContractGate().
// ─────────────────────────────────────────────────────────────────────────

function existingContract(level: string | null, topic: string | null): PendingDocumentRequest {
  return { type: 'course_pdf', level, topic, status: 'collecting', openedAtToken: 0 };
}

{
  const state = baseState({ pendingDocumentRequest: existingContract(null, null), tokens: 1 });
  const plan = orchestrate(ctxFor('A1, sobre ser y estar', state));
  check(
    'H1-1: combined level+topic, one continuation message, "sobre" connector',
    plan.executor === 'tool_pdf' && plan.resolvedTopic === 'ser y estar' && plan.executionOrder[0]?.params?.level === 'A1',
    `executor=${plan.executor} resolvedTopic=${plan.resolvedTopic} params=${JSON.stringify(plan.executionOrder[0]?.params)}`,
  );
}

{
  const state = baseState({ pendingDocumentRequest: existingContract(null, null), tokens: 1 });
  const plan = orchestrate(ctxFor('Nivel A1. Tema: SER y ESTAR', state));
  check(
    'H1-2: AE exact example "Nivel A1. Tema: SER y ESTAR" (continuation, no sobre/de connector)',
    plan.executor === 'tool_pdf' && plan.resolvedTopic === 'ser y estar' && plan.executionOrder[0]?.params?.level === 'A1',
    `executor=${plan.executor} resolvedTopic=${plan.resolvedTopic} params=${JSON.stringify(plan.executionOrder[0]?.params)}`,
  );
}

{
  const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
  const plan = orchestrate(ctxFor('Ser y estar', state));
  check(
    'H1-3: level already known, bare topic turn (no connector) — H1b fallback',
    plan.executor === 'tool_pdf' && plan.resolvedTopic === 'ser y estar',
    `executor=${plan.executor} resolvedTopic=${plan.resolvedTopic}`,
  );
}

{
  const state = baseState({ pendingDocumentRequest: existingContract(null, null), tokens: 1 });
  const plan = orchestrate(ctxFor('Nivel A1', state));
  const pending = plan.executionOrder[0]?.params?.pendingDocumentRequest as PendingDocumentRequest | undefined;
  check(
    'H1-4: regression guard — bare "Nivel A1" produces NO false topic',
    plan.executor === 'mentor' && pending?.level === 'A1' && pending?.topic === null,
    `executor=${plan.executor} pending=${JSON.stringify(pending)}`,
  );
}

{
  const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
  const plan = orchestrate(ctxFor('sí', state));
  const pending = plan.executionOrder[0]?.params?.pendingDocumentRequest as PendingDocumentRequest | undefined;
  check(
    'H1-5: regression guard — confirmation turn ("sí") sets no topic',
    plan.executor === 'mentor' && pending?.topic === null,
    `executor=${plan.executor} pending=${JSON.stringify(pending)}`,
  );
}

{
  const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
  const plan = orchestrate(ctxFor('continuar', state));
  const pending = plan.executionOrder[0]?.params?.pendingDocumentRequest as PendingDocumentRequest | undefined;
  check(
    'H1-6: regression guard — noise turn ("continuar") sets no topic',
    plan.executor === 'mentor' && pending?.topic === null,
    `executor=${plan.executor} pending=${JSON.stringify(pending)}`,
  );
}

{
  const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
  const plan = orchestrate(ctxFor('quiero el pdf del curso', state));
  const pending = plan.executionOrder[0]?.params?.pendingDocumentRequest as PendingDocumentRequest | undefined;
  check(
    'H1-7: regression guard — self-referential message sets no topic',
    plan.executor === 'mentor' && pending?.topic === null,
    `executor=${plan.executor} pending=${JSON.stringify(pending)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// AE-02 — FIRST message, no existing pendingDocumentRequest at all, routed
// through the real hard_override -> buildHardOverridePlan -> (subtype ===
// 'generate_course_pdf') -> buildDocumentContractGate() -> !existing
// branch. This is the exact path AE said the original H1 fix never
// touched.
// ─────────────────────────────────────────────────────────────────────────

{
  const state = baseState({ tokens: 0 });
  const plan = orchestrate(ctxFor('Hazme un curso PDF. Nivel A1. Tema: SER y ESTAR.', state, hardOverridePdfIntent));
  check(
    'AE-02: first message, AE exact example, resolves immediately — no re-asking for level already given',
    plan.executor === 'tool_pdf'
      && plan.pedagogicalAction === 'generate_course_pdf'
      && plan.resolvedTopic === 'ser y estar'
      && plan.executionOrder[0]?.params?.level === 'A1'
      && plan.executionOrder[0]?.params?.topic === 'ser y estar',
    `executor=${plan.executor} pedagogicalAction=${plan.pedagogicalAction} resolvedTopic=${plan.resolvedTopic} params=${JSON.stringify(plan.executionOrder[0]?.params)}`,
  );
}

{
  // Regression guard on AE-02's new "tema: X" pattern itself, isolated on
  // the FIRST-message path (!existing branch), which calls
  // extractCourseTopic() exactly once with no H1b fallback to interfere:
  // the colon must be load-bearing, not optional — "tema" shows up in
  // plenty of ordinary sentences that are NOT a topic declaration ("no
  // tengo tema todavía" = "I don't have a topic yet"). Without the colon
  // required, extractCourseTopic would misread "todavía" as the topic.
  const state = baseState({ tokens: 0 });
  const plan = orchestrate(ctxFor('No tengo tema todavía. Nivel A1.', state, hardOverridePdfIntent));
  const pending = plan.executionOrder[0]?.params?.pendingDocumentRequest as PendingDocumentRequest | undefined;
  check(
    'AE-02 regression guard: "tema" without a colon is not read as a topic declaration (first message)',
    plan.executor === 'mentor' && pending?.topic === null,
    `executor=${plan.executor} pending=${JSON.stringify(pending)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// AE-01 — cancellation turns against an OPEN contract (continuation path).
// Must clear the contract (plan carries clearDocumentContract:true, NOT a
// pendingDocumentRequest with "olvídalo"/"no, gracias" as topic), and must
// NEVER route to tool_pdf/generateCoursePdf.
// ─────────────────────────────────────────────────────────────────────────

const cancellationMessages = ['Olvídalo.', 'No, gracias.', 'Cancela.', 'Mejor no.', 'Forget it.'];
for (const msg of cancellationMessages) {
  const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
  const plan = orchestrate(ctxFor(msg, state));
  const step = plan.executionOrder[0];
  check(
    `AE-01: cancellation "${msg}" against open A1 contract — never becomes a topic, never generates a PDF`,
    plan.executor === 'mentor'
      && step?.action === 'collectDocumentParameter'
      && step?.params?.clearDocumentContract === true
      && step?.params?.pendingDocumentRequest === undefined,
    `executor=${plan.executor} action=${step?.action} params=${JSON.stringify(step?.params)}`,
  );
}

{
  // Control: the SAME withdrawal phrase must not be globally banned from
  // ever being real content elsewhere — only against an OPEN contract.
  // With no pendingDocumentRequest at all, "olvídalo" is ordinary free
  // conversation, not a document-contract concern.
  const state = baseState({ tokens: 3 });
  const plan = orchestrate(ctxFor('Olvídalo.', state));
  check(
    'AE-01 control: "Olvídalo." with NO open contract is ordinary conversation, not document-contract logic',
    plan.pedagogicalAction !== 'generate_course_pdf',
    `pedagogicalAction=${plan.pedagogicalAction} executor=${plan.executor}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
