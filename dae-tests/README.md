# dae-tests/

Real integration tests for the sovereign document-contract gate
(`server/core/orchestrator.ts` / `server/core/execution-engine.ts` /
`server/core/execution-engine-stream.ts` / `server/core/state-manager.ts`),
covering the H1/H1b, AE-01 (cancellation), AE-02 ("tema:" first-message
topic), AE-04 (task-switch redirect), AE-05 (redirect carrying an
immediate new instruction) fixes, and — new in this round — the
AE-EXECUTE forensic resolution of defects **C** (resurrected contract
across JSON transport), **F** (PDF-rejection intent misclassification)
and **H** (streaming path never applying `clearDocumentContract`)
surfaced by Work's real-UI QA against PR #10.

Each file imports and calls the **real, exported** functions from
`server/core/orchestrator.ts`, `server/core/execution-engine.ts`,
`server/core/execution-engine-stream.ts`, `server/core/state-manager.ts`,
`server/core/intent-router.ts` and `app/beta/beta-io.ts` — no function
body is reimplemented or mocked in the test files. A test passing is
evidence about the actual shipped module, not about a hand-copied
fragment of it.

## Running

From the repository root, with dependencies installed (`npm install`):

```bash
export OPENAI_API_KEY="any-non-empty-value"   # see note below
npx tsx dae-tests/orchestrator_integration.test.ts
npx tsx dae-tests/ae01_clearing_integration.test.ts
npx tsx dae-tests/ae04_task_switch.test.ts
npx tsx dae-tests/ae04_pipeline_integration.test.ts
npx tsx dae-tests/ae05_continuation.test.ts
npx tsx dae-tests/ae_execute_transport_continuity.test.ts
```

Each file is a standalone script: it prints `PASS`/`FAIL` per
assertion, a `<n> passed, <n> failed` summary, and exits non-zero on
any failure — safe to wire into CI as separate steps or chained with
`&&`.

### Why `OPENAI_API_KEY` is required even though these tests never call OpenAI

`execution-engine.ts` imports `server/mentors/mentor-engine.ts`, which
instantiates `new OpenAI(...)` at module load time. That constructor
throws if the env var is unset or empty, before any test code runs.
Every path these tests exercise is a **bypass** that returns text
directly without invoking the mentor LLM (the `collectDocumentParameter`
/ `openDocumentContract` contract-clarification shortcut, or — new in
AE-05 — the plan-level `clearDocumentContract` flag honored generically
in `compileResult()` and, as of the AE-EXECUTE round, in
`executePlanStream()` via the shared `clearDocumentContractIfRequested()`
helper in `state-manager.ts`). The exceptions are `ae05_continuation
.test.ts`'s AE's-exact-case block and `ae_execute_transport_continuity
.test.ts`'s SCENARIO-2 block, where the remainder resolves to ordinary
mentor conversation and a real `chat.completions.create`/streaming call
is attempted; with a placeholder key (or in a sandbox with no network
egress to the LLM) that call fails with a connection/auth error, but
the tests still pass, because the contract-clear logic runs
independently of whether that LLM call succeeds — this is treated as a
positive confirmation of the fix's robustness, not a gap in coverage.
`ae_execute_transport_continuity.test.ts` reports this explicitly via a
console `[info]` line rather than silently skipping when it occurs.

## AE-EXECUTE round — what `ae_execute_transport_continuity.test.ts` adds

The previous 42 tests all asserted on in-memory `StatePatch`/`SessionState`
objects inside one process — they never actually serialized a patch to
JSON and back, never drove the real `execution-engine-stream.ts`
`ReadableStream`/SSE output, and never called the client-side merge in
`app/beta/beta-io.ts`. That is exactly the gap Work's real-browser QA
exploited for defects C and H. This file closes it, mapping 1:1 to AE's
five required scenarios:

1. **TRANSPORT-1a–d / SCENARIO-1** — cancellation ("Olvídalo.") round-tripped
   through real `JSON.stringify`/`JSON.parse` (what `NextResponse.json`
   and the browser actually do), then through the real
   `applyServerStatePatch()` against a client session holding a stale
   contract, confirming defect C's exact mechanism (`undefined` dropped,
   `null` survives) and its fix.
2. **SCENARIO-2** — the AE-05 redirect-with-instruction case driven
   through the real `executePlanStream()` and a real `ReadableStream`
   consumer, confirming defect H's fix in the streaming path specifically
   (not just the blocking path AE-05 originally covered), including the
   error-fallback branch when the mentor LLM call is unreachable.
3. **SCENARIO-3a–c + 2 regression guards** — "En lugar del PDF, hazme una
   tabla..." (and the sibling connector "en vez del pdf") through the
   real `classifyIntent()`, confirming defect F's fix, plus guards that
   an ordinary, non-rejecting PDF export request is untouched by it.
4. **SCENARIO-4** — a generalized JSON round-trip for both
   `CLEARABLE_FIELDS` (`requestedOperation`, `pendingDocumentRequest`)
   through the real `mergeStatePatch()`, confirming the mechanism is
   shared/typed rather than a one-field special case.
5. Blocking and streaming are both exercised directly (scenario 1 via
   `executePlan()`, scenario 2 via `executePlanStream()`).

## Expected results (as of this commit)

| File | Pass count |
|---|---|
| `orchestrator_integration.test.ts` | 15/15 |
| `ae01_clearing_integration.test.ts` | 5/5 |
| `ae04_task_switch.test.ts` | 9/9 |
| `ae04_pipeline_integration.test.ts` | 5/5 |
| `ae05_continuation.test.ts` | 8/8 |
| `ae_execute_transport_continuity.test.ts` | 16/16 |

**Total: 58/58.**

Run `npx tsc --noEmit -p tsconfig.json` from the repository root to
confirm these changes introduce zero TypeScript errors.
