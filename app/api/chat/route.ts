// ARCH-9.11 / Constitution 7.1 — the Next.js route is an entry adapter only.
// Cognitive authority is the Tutor Maestro; the instrumental plan lives in
// server/core/tutor-first-orchestrator.ts. Transport, state validation and
// response compilation are delegated.
export { POST, OPTIONS } from '../../../server/api/chat-entry'
export const runtime = 'nodejs'
export const maxDuration = 300
