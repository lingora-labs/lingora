# MIGRATION 7.1 — F0 INVENTORY

BASE HEAD: 2f6c44e315ec1c4a6ec0718b6391699e7902c9da
BRANCH: migrate/7.1-tutor-first
CREATED FROM: main @ 2f6c44e
PRODUCTION: https://lingora-labs.vercel.app
HEALTH: healthy | v10.1 | runtimeBaseline 4.1c2 | timestamp 2026-10-16T16:56:35.213Z
RECOVERY POINT: current production deployment (matches HEAD 2f6c44e, health at 16:56Z)

## RETAIN (cognitive identity, real tools, verified controls)

- server/mentors/profiles.ts — Alex / Sarah / Nick identities
- server/tools/audio-toolkit.ts — Whisper STT, generateSpeech TTS (real)
- app/beta/chrome-gate.ts — E-07 pre-LLM labels
- lib/context-pack.ts — E-11 languageProficiency ≠ domainProficiency
- lib/artifact-signal.ts — structured ArtifactSignal contract
- app/beta/* UI modules — onboarding, schema, quiz, artifacts, chat-ui, model
- Conversation history in client (use-beta-page.ts)
- Explicit UI actions (export button) — may enter runtime directly

## RETIRE FROM DECISION PATH (not delete files; remove governing role)

- server/core/intent-router.ts classifyIntent — regex classifier runs before tutor. Decides hard_override, learn, artifact, practice. This is the cognitive authority that 7.1 removes.
- server/core/orchestrator.ts orchestrate — chooses execution branch from IntentResult. Speaks before the model.
- lib/tutorProtocol.ts — pedagogical phase stack that constrains the turn.
- Document contract as pre-decider in route.ts / execution-engine (DOC_CONTRACT_GATE).
- Hard-override rules (translate, correct, export_chat_pdf, generate_course_pdf) that intercept before the mentor.
- Second call that decides artifacts by keyword on pedagogical content.

## REPLACE

- app/api/chat/route.ts flow:
  BEFORE: normalize → classifyIntent → orchestrate → executePlan
  AFTER:  normalize/safety → Tutor Maestro (one call) → runtime validates only tool requests emitted by tutor or explicit UI → execute or return explicit error → continuity

## DEPENDENCIES

- intent-router → lib/contracts.ts (IntentResult, IntentType, SessionState)
- route.ts → intent-router, orchestrator, execution-engine, execution-engine-stream, state-manager, commercial-engine-adapter
- orchestrator → IntentResult from router
- execution-engine → ExecutionPlan from orchestrator

## OUT OF SCOPE

- Merge PR #9 or #10
- Write to main
- Deploy production
- Rebuild state machine under new name

## F0 STATUS

BRANCH CREATED: YES
HEAD VERIFIED: 2f6c44e
RECOVERY POINT: production @ 16:56Z on 2f6c44e
INVENTORY: COMPLETE
