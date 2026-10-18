// ARCH-9.11 — the Next.js route is an entry adapter only.
// Execution authority lives in server/core/tutor-first-orchestrator.ts.
// Transport, state validation and response compilation are delegated.
export { POST, OPTIONS } from '../../../server/api/chat-entry'
export const runtime = 'nodejs'
export const maxDuration = 300
