// =============================================================================
// FIX-1 — app/beta/page.tsx
// LINGORA SEEK 3.0 — Audio payload alignment
// =============================================================================
// PROBLEM:
//   sendComposer was sending audio as:
//     payload.audio = { data: b64, format: 'webm' }
//
//   But app/api/chat/route.ts (SEEK 3.0) expects:
//     body.audioDataUrl  — the full data URL ("data:audio/webm;base64,...")
//     body.audioMimeType — the MIME type string
//
//   Because of this mismatch, route.ts computed hasAudio = false,
//   the intent-router never saw audio, and the orchestrator never produced
//   a transcription plan. All audio was silently dropped.
//
// FIX:
//   In sendComposer, replace the audio block:
//
//   BEFORE (broken):
//     payload.audio = { data: b64, format: 'webm' }
//
//   AFTER (correct):
//     payload.audioDataUrl  = `data:audio/webm;base64,${b64}`
//     payload.audioMimeType = pendingAudioBlob.type || 'audio/webm'
//
// HOW TO APPLY:
//   Find this block in sendComposer (search for "payload.audio = {"):
//
//     const b64 = await new Promise<string>(res => {
//       const r = new FileReader()
//       r.onload = () => res((r.result as string).split(',')[1] || '')
//       r.readAsDataURL(pendingAudioBlob)
//     })
//     payload.audio = { data: b64, format: 'webm' }
//
//   Replace with:
//
//     const audioDataUrl = await new Promise<string>(res => {
//       const r = new FileReader()
//       r.onload = () => res(r.result as string)   // keep full data URL, do NOT split
//       r.readAsDataURL(pendingAudioBlob)
//     })
//     payload.audioDataUrl  = audioDataUrl
//     payload.audioMimeType = pendingAudioBlob.type || 'audio/webm'
//
// NOTE:
//   The key change is:
//   1. Keep the FULL data URL (do not split on ',')[1] — route.ts splits it internally)
//   2. Use payload.audioDataUrl instead of payload.audio.data
//   3. Add payload.audioMimeType
//
//   Do NOT change anything else in sendComposer or page.tsx.
//   This is a surgical 3-line change.
//
// =============================================================================
//
// VERCEL ENVIRONMENT VARIABLES — also add these in Vercel dashboard:
//
//   LINGORA_STREAMING_ENABLED=true
//   LINGORA_DEBUG_TRACE=true
//
// LINGORA_DEBUG_TRACE adds executionTrace to every API response so you can
// confirm what plan the orchestrator is running and whether suggestedActions
// are arriving. Turn it off after validation.
//
// =============================================================================

export const FIX_DESCRIPTION = 'Audio payload alignment — see comments above';

