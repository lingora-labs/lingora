// DAE — REAL INTEGRATION TEST for AE-04 (second round on PR #10).
// Imports the ACTUAL orchestrate() from the real, patched
// server/core/orchestrator.ts. Proves AE's concrete case ("Cambiemos de
// tema" against an open A1 contract) no longer degrades into the bogus
// topic "cambiemos de" and queue PDF generation on it, while a genuine
// bare-topic continuation ("Ser y estar") still resolves correctly.
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

function ctxFor(message: string, state: SessionState, intent: IntentResult = conversationIntent): OrchestrationContext {
  return { message, state, intent, hasAudio: false, isFirstTurn: false, interfaceLanguage: 'es', timestamp: Date.now() };
}

function existingContract(level: string | null, topic: string | null): PendingDocumentRequest {
  return { type: 'course_pdf', level, topic, status: 'collecting', openedAtToken: 0 };
}

// AE's exact reported case.
{
  const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
  const plan = orchestrate(ctxFor('Cambiemos de tema', state));
  const step = plan.executionOrder[0];
  check(
    "AE-04 (AE's exact case): 'Cambiemos de tema' against an open A1 contract never becomes topic 'cambiemos de', never generates a PDF",
    plan.executor === 'mentor' && plan.pedagogicalAction !== 'generate_course_pdf'
      && step?.action === 'collectDocumentParameter'
      && step?.params?.clearDocumentContract === true
      && step?.params?.pendingDocumentRequest === undefined,
    `executor=${plan.executor} pedagogicalAction=${plan.pedagogicalAction} action=${step?.action} params=${JSON.stringify(step?.params)}`,
  );
}

// Additional redirect phrasings — bounded grammatical category, not an
// open-ended cancellation idiom list.
const taskSwitchMessages = [
  'Mejor hablemos de otra cosa.',
  'Pasemos a otro tema.',
  "Let's change the subject.",
  'Switch topics please.',
];
for (const msg of taskSwitchMessages) {
  const state = baseState({ pendingDocumentRequest: existingContract('B1', null), tokens: 2 });
  const plan = orchestrate(ctxFor(msg, state));
  const step = plan.executionOrder[0];
  check(
    `AE-04: redirect "${msg}" against open B1 contract clears the contract, never generates a PDF`,
    plan.pedagogicalAction !== 'generate_course_pdf'
      && step?.action === 'collectDocumentParameter'
      && step?.params?.clearDocumentContract === true,
    `pedagogicalAction=${plan.pedagogicalAction} action=${step?.action} params=${JSON.stringify(step?.params)}`,
  );
}

// Regression guard — cancellation (AE-01) must remain its OWN category,
// never reclassified as task_switch (both clear the contract the same
// way at the plan level, but they must stay independently triggerable;
// this checks the cancellation example from AE-01 still clears exactly as
// before and was not accidentally routed through task_switch logic that
// could change its wording/behavior).
{
  const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
  const plan = orchestrate(ctxFor('Olvídalo.', state));
  const step = plan.executionOrder[0];
  check(
    'AE-04 regression guard: AE-01 cancellation ("Olvídalo.") still resolves independently and still clears the contract',
    step?.params?.clearDocumentContract === true && plan.reason.includes('cancelled'),
    `reason=${plan.reason}`,
  );
}

// Regression guard — a genuine bare-topic continuation (H1b's original
// purpose) must still work: AE-04's dangling-preposition guard and the
// new task_switch class must not swallow legitimate topics.
{
  const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
  const plan = orchestrate(ctxFor('Ser y estar', state));
  check(
    'AE-04 regression guard: bare topic continuation "Ser y estar" (H1b) still resolves to tool_pdf',
    plan.executor === 'tool_pdf' && plan.resolvedTopic === 'ser y estar',
    `executor=${plan.executor} resolvedTopic=${plan.resolvedTopic}`,
  );
}

// Regression guard — AE's own H1-2 combined level+topic example must
// still resolve on the first message (AE-02), unaffected by the new
// task_switch check (no redirect verbs present).
{
  const state = baseState({ pendingDocumentRequest: existingContract(null, null), tokens: 1 });
  const plan = orchestrate(ctxFor('Nivel A1. Tema: SER y ESTAR', state));
  check(
    'AE-04 regression guard: AE’s own H1-2 example ("Nivel A1. Tema: SER y ESTAR") still resolves immediately',
    plan.executor === 'tool_pdf' && plan.resolvedTopic === 'ser y estar',
    `executor=${plan.executor} resolvedTopic=${plan.resolvedTopic}`,
  );
}

// Structural guard check in isolation — a redirect phrasing NOT in
// TASK_SWITCH_PATTERNS but that strips to a dangling preposition must
// still be rejected as a topic (defense in depth, not a content-loss risk
// since it simply re-asks instead of guessing).
{
  const state = baseState({ pendingDocumentRequest: existingContract('A1', null), tokens: 1 });
  // "tema" strips out, leaving "mejor otro" + trailing "de" after level words removed —
  // construct a message whose stripped remainder ends in a bare connector
  // without matching any TASK_SWITCH_PATTERNS verb, to isolate the
  // structural (non-pattern) guard.
  const plan = orchestrate(ctxFor('Nivel otro tema de', state));
  const pending = plan.executionOrder[0]?.params?.pendingDocumentRequest as PendingDocumentRequest | undefined;
  check(
    'AE-04 structural guard: a stripped remainder ending in a dangling connector ("...de") is never accepted as a topic',
    plan.executor === 'mentor' && (pending?.topic ?? null) === null,
    `executor=${plan.executor} pending=${JSON.stringify(pending)}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
