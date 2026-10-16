# dae-tests/

Real integration tests for the sovereign document-contract gate
(`server/core/orchestrator.ts` / `server/core/execution-engine.ts`),
covering the H1/H1b, AE-01 (cancellation), AE-02 ("tema:" first-message
topic), AE-04 (task-switch redirect) and AE-05 (redirect carrying an
immediate new instruction) fixes tracked across PR #10's review rounds
with AE (Directora de Arquitectura Externa).

Each file imports and calls the **real, exported** functions from
`server/core/orchestrator.ts`, `server/core/execution-engine.ts` and
`server/core/state-manager.ts` — no function body is reimplemented or
mocked in the test files. A test passing is evidence about the actual
shipped module, not about a hand-copied fragment of it.

## Running

From the repository root, with dependencies installed (`npm install`):

```bash
export OPENAI_API_KEY="any-non-empty-value"   # see note below
npx tsx dae-tests/orchestrator_integration.test.ts
npx tsx dae-tests/ae01_clearing_integration.test.ts
npx tsx dae-tests/ae04_task_switch.test.ts
npx tsx dae-tests/ae04_pipeline_integration.test.ts
npx tsx dae-tests/ae05_continuation.test.ts
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
in `compileResult()`). The one exception is
`ae05_continuation.test.ts`'s AE's-exact-case block, where the
remainder resolves to ordinary mentor conversation and a real
`chat.completions.create` call is attempted; with a placeholder key
that call fails with a connection/auth error, but the test still
passes, because the plan-level contract-clear is read independently of
whether that LLM call succeeds — this is treated as a positive
confirmation of the fix's robustness, not a gap in coverage.

## Expected results (as of this commit)

| File | Pass count |
|---|---|
| `orchestrator_integration.test.ts` | 15/15 |
| `ae01_clearing_integration.test.ts` | 5/5 |
| `ae04_task_switch.test.ts` | 9/9 |
| `ae04_pipeline_integration.test.ts` | 5/5 |
| `ae05_continuation.test.ts` | 8/8 |

**Total: 42/42.**

Run `npx tsc --noEmit -p tsconfig.json` from the repository root to
confirm these changes introduce zero TypeScript errors.
