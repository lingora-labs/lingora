// =============================================================================
// app/api/chat/route.ts
// LINGORA SEEK 3.0 — Thin Router (Entry Point) — FASE 6E FINAL
// =============================================================================
// Purpose  : Parse → Validate → Classify → Orchestrate → Execute →
//            CommercialPost → Stream/Respond.
//            Zero decision logic. Zero pedagogical conditions.
//
//            FASE 6E CHANGES vs 6D:
//            ─────────────────────────────────────────────────────────────────
//            COMMERCIAL PARITY FIX (R1):
//              SSE branch no longer pre-evaluates commercial in route.ts.
//              Commercial is evaluated INSIDE execution-engine-stream.ts
//              AFTER all steps complete + state merges, using updatedState.
//              JSON branch: execute → merge → evaluateCommercial(updatedState)
//              SSE branch:  stream executes → merge → evaluateCommercial(updatedState)
//              Both branches now call evaluateCommercial() with the same
//              post-execution state. No divergence.
//
//            ADAPTER SIGNATURE FIX (commercial-engine-adapter.ts, not here):
//              commercialEngine(message, state) — real engine signature.
//
//            MENTOR STEP GATE FIX (execution-engine-stream.ts, not here):
//              Mentor steps never silently degrade to no-op.
//
// Core logic lines : 126 ✅ (< 150 limit)
//
// Commit   : fix(route): 6E — remove SSE pre-commercial evaluation;
//            stream engine owns commercial timing parity
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';

import {
  ChatRequest,
  ChatResponse,
  SessionState,
  OrchestrationContext,
  DEFAULT_SESSION_STATE,
} from '../../../lib/contracts';

import {
  validateStateInvariants,
  repairState,
  mergeStatePatch,
} from '../../../server/core/state-manager';

import { classifyIntent }         from '../../../server/core/intent-router';
import { orchestrate }            from '../../../server/core/orchestrator';
import { executePlan }            from '../../../server/core/execution-engine';
import { executePlanStream }      from '../../../server/core/execution-engine-stream';
import { evaluateCommercial }     from '../../../server/core/commercial-engine-adapter';

// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export const runtime     = 'nodejs';
export const maxDuration = 30;

const STREAMING_ENABLED = process.env.LINGORA_STREAMING_ENABLED === 'true';
const DEBUG_TRACE       = process.env.LINGORA_DEBUG_TRACE        === 'true';
const BUILD_SIG         = process.env.LINGORA_BUILD_SIGNATURE    ?? 'unset';
const COMMIT_HINT       = process.env.LINGORA_COMMIT_HINT        ?? 'SEEK-3.0';

// ─────────────────────────────────────────────────────────────────────────────
// POST HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse | Response> {
  let callerState: SessionState | undefined;

  try {

    // ── 1. PARSE ─────────────────────────────────────────────────────────────
    const body = await parseRequest(req);
    if (!body) return errorResponse(400, 'Invalid request body', callerState);
    const { message, state: rawState, files, audioDataUrl, audioMimeType } = body;

    // ── 2. VALIDATE + REPAIR STATE ────────────────────────────────────────────
    const baseState: SessionState = rawState ?? DEFAULT_SESSION_STATE;
    callerState                   = baseState;
    const validation              = validateStateInvariants(baseState);
    const state                   = validation.valid
      ? baseState
      : repairState(baseState, validation.errors);
    const stateValidationStatus   = validation.valid ? 'passed' : 'repaired';

    if (validation.warnings.length > 0) {
      console.warn('[route] state warnings:', validation.warnings);
    }

    // ── SEEK DIAGNOSTIC TRIGGER ───────────────────────────────────────────────
    if (message?.trim() === '*1357*#') {
      return NextResponse.json({
        buildSignature:     BUILD_SIG,
        commitHint:         COMMIT_HINT,
        architecture:       'SEEK-3.0',
        runtime:            'LINGORA-ARCH-9.11',
        timestamp:          new Date().toISOString(),
        orchestratorActive: true,
        stateValidation:    stateValidationStatus,
        streamingEnabled:   STREAMING_ENABLED,
        debugTrace:         DEBUG_TRACE,
        tokens:             state.tokens,
        activeMode:         state.activeMode,
        tutorPhase:         state.tutorPhase,
        mentorProfile:      state.mentorProfile ?? 'Alex',
      });
    }

    // ── 3. CLASSIFY INTENT ────────────────────────────────────────────────────
    const hasFiles = Array.isArray(files) && files.length > 0;
    const hasAudio = !!(audioDataUrl || (hasFiles && files?.some(
      f => f.type?.startsWith('audio/') || f.type === 'video/webm',
    )));
    const intent = classifyIntent(message ?? '', state, hasFiles, hasAudio);

    // ── 4. BUILD ORCHESTRATION CONTEXT ────────────────────────────────────────
    const ctx: OrchestrationContext = {
      message:           message ?? '',
      state,
      intent,
      files,
      hasAudio,
      isFirstTurn:       state.tokens === 0,
      interfaceLanguage: state.interfaceLanguage ?? 'en',
      timestamp:         Date.now(),
    };

    // ── 5. ORCHESTRATE ────────────────────────────────────────────────────────
    const plan = orchestrate(ctx);

    // ── 6. EXECUTE ────────────────────────────────────────────────────────────
    const chatRequest: ChatRequest = {
      message: message ?? '', state, files, audioDataUrl, audioMimeType,
    };

    // ── 7. STREAM BRANCH ──────────────────────────────────────────────────────
    // Hard overrides (plan.blocking=true) → always JSON.
    // SSE branch: execution-engine-stream handles everything internally,
    // including state merge and commercial evaluation (post-merge).
    // route.ts does NOT pre-evaluate commercial for SSE.
    if (STREAMING_ENABLED && !plan.blocking) {
      return buildSSEResponse(executePlanStream(plan, chatRequest, state));
    }

    // ── 8. JSON BRANCH ────────────────────────────────────────────────────────
    const result       = await executePlan(plan, chatRequest, state);
    const updatedState = mergeStatePatch(state, result.statePatch);

    // Commercial: evaluated with post-merge state (same as SSE branch)
    let commercialSuffix: string | undefined;
    if (!plan.blocking) {
      const commercial = await evaluateCommercial(updatedState, plan);
      if (commercial.triggered && commercial.message) {
        commercialSuffix = commercial.message;
      }
    }

    // ── 9. COMPILE + RETURN ───────────────────────────────────────────────────
    const response: ChatResponse = {
      message: commercialSuffix
        ? `${result.message}\n\n${commercialSuffix}`
        : result.message,
      artifact:         result.artifact,
      state:            updatedState,
      suggestedActions: result.suggestedActions,
      ...(DEBUG_TRACE && {
        executionTrace: {
          requestId:         `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          intentResult:      intent,
          executionPlan:     plan,
          stepResults:       result.stepResults,
          totalDurationMs:   result.totalDurationMs,
          statePatchApplied: result.statePatch,
        },
      }),
    };

    return NextResponse.json(response, { headers: NO_CACHE });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    console.error('[route] unhandled error:', msg, err);
    return errorResponse(500, msg, callerState);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE RESPONSE — forwards execution-engine-stream output unchanged
// ─────────────────────────────────────────────────────────────────────────────

function buildSSEResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-store, no-cache, must-revalidate',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function parseRequest(req: NextRequest): Promise<ChatRequest | null> {
  try {
    const b = await req.json();
    return (typeof b === 'object' && b !== null) ? (b as ChatRequest) : null;
  } catch { return null; }
}

function errorResponse(
  status: number,
  message: string,
  preservedState?: SessionState,
): NextResponse {
  const body: Record<string, unknown> = {
    message,
    suggestedActions: [],
    error: true,
  };
  if (preservedState && preservedState.tokens > 0) {
    body.state = preservedState;
  }
  return NextResponse.json(body, { status, headers: NO_CACHE });
}

const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Content-Type':  'application/json',
} as const;
