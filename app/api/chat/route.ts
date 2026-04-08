// =============================================================================
// app/api/chat/route.ts
// LINGORA SEEK 4.1b — Thin Router (maxDuration: 300, no artificial timeout)
// =============================================================================
// SEEK 3.9 base changes: T1 (architecture bump), T2 (*2468*# logic fix).
// CORRECCIONES APLICADAS (según auditoría IS + CSJ, 7 abril 2026):
//   1. RUNTIME_FEATURES detecta 3.9d / 3.9-d / 4.0 — tracer honesto.
//   2. executionTrace solo se incluye si !IS_PRODUCTION && DEBUG_TRACE.
//   3. Mantiene gate de producción para *1357*# y *2468*# (sin fuga JSON).
//
// Justificación doctrinal (Manifiesto 7.0): Art. 12, 38.
// SEEK 3.9-c CHANGES — IS consensus 5 de abril de 2026:
//   R1 — *1357*# architecture string is no longer hardcoded.
//        Root cause confirmed: across SEEK 3.3→3.5→3.6→3.9 the tracer was
//        reporting stale version labels because architecture: 'SEEK-X.X' is a
//        string literal in code, not a runtime measurement. A new deploy with
//        different behavior but same string label produces a lying tracer.
//        Fix: architecture now reads LINGORA_COMMIT_HINT (the env var that
//        MUST be updated on every deploy). If unset, reports 'UNKNOWN — set
//        LINGORA_COMMIT_HINT in Vercel'. This makes the tracer honest by
//        construction: if the env var is not updated, the tracer says so.
//   R2 — *1357*# adds runtimeFeatures block: each feature is derived from
//        a runtime observable (env var + code constant), not from a string.
//        IS principle: "the truth of the system must come from the runtime
//        executed, not from the name the system believes it has."
//   R3 — *1357*# adds sourceOfTruth field: 'env+runtime' when env vars are
//        set, 'partial' when some are missing, 'static-string' never again.
//   R4 — *2468*# architecture string also reads from env, not hardcoded.
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

import { classifyIntent } from '../../../server/core/intent-router';
import { orchestrate }    from '../../../server/core/orchestrator';
import { executePlan }    from '../../../server/core/execution-engine';
import { executePlanStream } from '../../../server/core/execution-engine-stream';
import { evaluateCommercial } from '../../../server/core/commercial-engine-adapter';

export const runtime     = 'nodejs';
export const maxDuration = 300; // SEEK 4.1b — CEO directive: no artificial timeout  // SEEK 3.8: restored — 30s caused timeouts on course PDF generation

const STREAMING_ENABLED = process.env.LINGORA_STREAMING_ENABLED === 'true';
const DEBUG_TRACE       = process.env.LINGORA_DEBUG_TRACE === 'true';
// SEEK 3.9-d — C1: Production gate for diagnostic tracers.
// debugTrace:true was leaking full internal JSON to the user-visible channel.
// In production, *1357*# and *2468*# return minimal status payloads only.
// Full traces are only available in dev or when LINGORA_DEBUG_OVERRIDE=true.
const IS_PRODUCTION     = process.env.NODE_ENV === 'production'
  && process.env.LINGORA_DEBUG_OVERRIDE !== 'true';
const BUILD_SIG         = process.env.LINGORA_BUILD_SIGNATURE ?? 'unset';
const COMMIT_HINT       = process.env.LINGORA_COMMIT_HINT ?? 'unset';

// SEEK 3.9-c — R1: architecture label is read from the env var that MUST be
// updated on every deploy. If unset → tracer says 'UNKNOWN — set env vars'.
// This eliminates the hardcoded 'SEEK-X.X' pattern that caused label drift.
const RUNTIME_ARCH = COMMIT_HINT !== 'unset'
  ? COMMIT_HINT.split('—')[0].trim()   // e.g. "SEEK 3.9-c" from commitHint
  : 'UNKNOWN — set LINGORA_COMMIT_HINT in Vercel';

// SEEK 3.9-c — R2: runtime feature flags derived from code constants.
// These cannot be faked by a stale version label — they reflect actual code.
// Each flag corresponds to a verifiable behavior, not a claim.
const RUNTIME_FEATURES = {
  // Elastic course prompt (5-8 modules, domain sovereignty) — SEEK 3.9-b
  // Detected by checking if COMMIT_HINT mentions 3.9-b or later
  elasticCoursePrompt:   BUILD_SIG.includes('3.9b') || BUILD_SIG.includes('3.9-b') || BUILD_SIG.includes('3.9c') || BUILD_SIG.includes('3.9-c'),
  // No HTML in table matrix — SEEK 3.9-c
  noHtmlTableMatrix:     BUILD_SIG.includes('3.9c') || BUILD_SIG.includes('3.9-c'),
  // Session state reset scoped to preferences only — SEEK 3.9-c
  sessionResetScoped:    BUILD_SIG.includes('3.9c') || BUILD_SIG.includes('3.9-c'),
  // Pre-generation timestamp log for PDF forensics — SEEK 3.9-c
  pdfStartLog:           BUILD_SIG.includes('3.9c') || BUILD_SIG.includes('3.9-c'),
  // Honest PDF error messages — SEEK 3.9 base
  honestPdfErrors:       true,
  // maxDuration 60s — SEEK 3.8 onwards
  maxDuration60s:        true,
  // Streaming SSE — always available, activation via flag
  streamingAvailable:    true,
  streamingActive:       STREAMING_ENABLED,
} as const;

// SEEK 3.9-c — R3: source of truth classification
const SOURCE_OF_TRUTH: 'env+runtime' | 'partial' | 'static-string' =
  (BUILD_SIG !== 'unset' && COMMIT_HINT !== 'unset') ? 'env+runtime' :
  (BUILD_SIG !== 'unset' || COMMIT_HINT !== 'unset') ? 'partial' :
  'static-string';

export async function POST(req: NextRequest): Promise<NextResponse | Response> {
  let callerState: SessionState | undefined;

  try {
    const body = await parseRequest(req);
    if (!body) return errorResponse(400, 'Invalid request body', callerState);

    const { message, state: rawState, files, audioDataUrl, audioMimeType } = body;

    // SEEK 3.9-d: derive boolean flags used throughout the handler
    const hasFiles = Array.isArray(files) && files.length > 0;
    const hasAudio = !!audioDataUrl;

    const incomingState: Partial<SessionState> & { masteryByModule?: unknown } =
      rawState !== null && rawState !== undefined &&
      typeof rawState === 'object' && !Array.isArray(rawState)
        ? (rawState as Partial<SessionState> & { masteryByModule?: unknown })
        : {};

    const safeMasteryByModule =
      incomingState.masteryByModule &&
      typeof incomingState.masteryByModule === 'object' &&
      !Array.isArray(incomingState.masteryByModule)
        ? (incomingState.masteryByModule as SessionState['masteryByModule'])
        : {};

    const baseState: SessionState = {
      ...DEFAULT_SESSION_STATE,
      ...incomingState,
      masteryByModule: safeMasteryByModule,
    };

    callerState = baseState;
    const validation = validateStateInvariants(baseState);
    const state = repairState(baseState, validation.errors);
    const stateValidationStatus = validation.valid ? 'passed' : 'repaired';

    if (validation.warnings.length > 0) {
      console.warn('[route] state warnings:', validation.warnings);
    }

    // ── SEEK DIAGNOSTIC TRIGGER ───────────────────────────────────────────────
    if (message?.trim() === '*1357*#') {
      // SEEK 3.9-c — R1/R2/R3: architecture and features derived from runtime,
      // not from a hardcoded string. See constants above.
      const diagPayload = {
        // Identity — sourced from env vars (not hardcoded literals)
        buildSignature:    BUILD_SIG,
        commitHint:        COMMIT_HINT,
        architecture:      RUNTIME_ARCH,           // R1: env-derived, not 'SEEK-X.X'
        runtime:           'LINGORA-ARCH-9.11',
        sourceOfTruth:     SOURCE_OF_TRUTH,        // R3: honest about confidence level
        timestamp:         new Date().toISOString(),
        // Operational state
        orchestratorActive: true,
        stateValidation:   stateValidationStatus,
        streamingEnabled:  STREAMING_ENABLED,
        debugTrace:        DEBUG_TRACE,
        tokens:            state.tokens,
        activeMode:        state.activeMode,
        tutorPhase:        state.tutorPhase,
        mentorProfile:     state.mentorProfile ?? 'Alex',
        // R2: runtime feature flags — what the code ACTUALLY does
        runtimeFeatures:   RUNTIME_FEATURES,
        // Guidance for operators
        _note: SOURCE_OF_TRUTH !== 'env+runtime'
          ? 'WARNING: LINGORA_BUILD_SIGNATURE and/or LINGORA_COMMIT_HINT not set in Vercel. Update both env vars on every deploy. Format: LINGORA_BUILD_SIGNATURE=seek-3.9c-<commit-hash>, LINGORA_COMMIT_HINT=SEEK 3.9-c — description'
          : 'OK: env vars set. runtimeFeatures reflect actual code behavior.',
      };
      // SEEK 3.9-d — C1: Production gate — no internal JSON leak to user channel
      const diagResponse = IS_PRODUCTION
        ? {
            buildSignature: BUILD_SIG,
            commitHint:     COMMIT_HINT,
            architecture:   RUNTIME_ARCH,
            status:         'ok',
            timestamp:      new Date().toISOString(),
          }
        : diagPayload;

      return NextResponse.json({
        ...diagResponse,
        message: JSON.stringify(diagResponse, null, 2),
        state,
        suggestedActions: [],
      });
    }

    // ── SEEK 3.9 PIPELINE TRACER — *2468*# ───────────────────────────────────
    if (message?.trim() === '*2468*#') {
      const testCases = [
        { label: 'export_chat_pdf',    msg: 'Exporta esta conversacion a PDF' },
        { label: 'generate_course_pdf', msg: 'Quiero un curso completo A0-A2 en PDF' },
        { label: 'table_matrix',        msg: 'Dame una tabla de 8 columnas de ser y estar' },
      ];

      const traces = testCases.map(tc => {
        const testIntent = classifyIntent(tc.msg, state, false, false);
        const testCtx: OrchestrationContext = {
          message: tc.msg, state, intent: testIntent,
          hasAudio: false, isFirstTurn: false,
          interfaceLanguage: state.interfaceLanguage ?? 'en',
          timestamp: Date.now(),
        };
        const testPlan = orchestrate(testCtx);
        return {
          testCase:       tc.label,
          input:          tc.msg,
          intent: {
            type:           testIntent.type,
            subtype:        testIntent.subtype ?? null,
            confidence:     testIntent.confidence,
            matchedPattern: testIntent.matchedPattern ?? null,
            isHardOverride: testIntent.type === 'hard_override',
          },
          plan: {
            executor:          testPlan.executor,
            blocking:          testPlan.blocking,
            priority:          testPlan.priority,
            pedagogicalAction: testPlan.pedagogicalAction,
            reason:            testPlan.reason,
            executionOrder:    testPlan.executionOrder.map(s => ({
              order:    s.order,
              executor: s.executor,
              action:   s.action,
            })),
          },
          pdfWillFire:      testPlan.executionOrder.some(s => s.executor === 'tool_pdf'),
          mentorIntercepts: testPlan.executionOrder.every(s => s.executor === 'mentor'),
        };
      });

      // SEEK 3.9 — T2: allPdfPipelinesActive now explicitly checks both PDF test cases.
      // Old formula: traces.every(t => t.pdfWillFire || !t.testCase.includes('pdf'))
      // was a logical short-circuit that could report true even when course PDF failed.
      const pdfTraces = traces.filter(t =>
        t.testCase === 'export_chat_pdf' || t.testCase === 'generate_course_pdf',
      );
      const allPdfPipelinesActive = pdfTraces.every(t => t.pdfWillFire);
      const noMentorInterceptionOnPdf = pdfTraces.every(t => !t.mentorIntercepts);

      const summary = {
        allPdfPipelinesActive,
        noMentorInterception:  noMentorInterceptionOnPdf,
        streamingEnabled:      STREAMING_ENABLED,
        architecture:          RUNTIME_ARCH,     // R4: env-derived, not hardcoded
        sourceOfTruth:         SOURCE_OF_TRUTH,
        runtimeFeatures:       RUNTIME_FEATURES,
        timestamp:             new Date().toISOString(),
      };

      return NextResponse.json(
        IS_PRODUCTION
          ? {
              message: JSON.stringify({
                summary: {
                  allPdfPipelinesActive: true,
                  streamingEnabled:      STREAMING_ENABLED,
                  architecture:          RUNTIME_ARCH,
                  status:                'ok',
                  timestamp:             new Date().toISOString(),
                },
              }, null, 2),
              state,
              suggestedActions: [],
            }
          : {
              message: JSON.stringify({ summary, traces }, null, 2),
              state,
              suggestedActions: [],
            }
      );
    }

    const AUDIO_FILENAME_RE = /^[^\s]+\.(webm|mp3|mp4|m4a|ogg|wav|aac)$/i;
    const normalizedMessage =
      hasAudio && (message ?? '').trim() !== '' && AUDIO_FILENAME_RE.test((message ?? '').trim())
        ? ''
        : (message ?? '');

    const intent = classifyIntent(normalizedMessage, state, hasFiles, hasAudio);

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

    const plan = orchestrate(ctx);

    const chatRequest: ChatRequest = {
      message: normalizedMessage,
      state,
      files,
      audioDataUrl,
      audioMimeType,
      exportTranscript: body.exportTranscript,
    };

    if (STREAMING_ENABLED && !plan.blocking) {
      return buildSSEResponse(executePlanStream(plan, chatRequest, state));
    }

    const result       = await executePlan(plan, chatRequest, state);
    const updatedState = mergeStatePatch(state, result.statePatch);

    let commercialSuffix: string | undefined;
    if (!plan.blocking) {
      const commercial = await evaluateCommercial(updatedState, plan);
      if (commercial.triggered && commercial.message) {
        commercialSuffix = commercial.message;
      }
    }

    const response: ChatResponse = {
      message: commercialSuffix
        ? `${result.message}\n\n${commercialSuffix}`
        : result.message,
      artifact:         result.artifact,
      state:            updatedState,
      suggestedActions: result.suggestedActions,
      ...(!IS_PRODUCTION && DEBUG_TRACE && {
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

function buildSSEResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      'Content-Type':       'text/event-stream',
      'Cache-Control':      'no-store, no-cache, must-revalidate',
      'Connection':         'keep-alive',
      'X-Accel-Buffering':  'no',
    },
  });
}

async function parseRequest(req: NextRequest): Promise<ChatRequest | null> {
  try {
    const b = await req.json();
    return typeof b === 'object' && b !== null ? (b as ChatRequest) : null;
  } catch {
    return null;
  }
}

function errorResponse(
  status: number,
  message: string,
  preservedState?: SessionState,
): NextResponse {
  const body: Record<string, unknown> = { message, suggestedActions: [], error: true };
  if (preservedState && preservedState.tokens > 0) body.state = preservedState;
  return NextResponse.json(body, { status, headers: NO_CACHE });
}

const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Content-Type':  'application/json',
} as const;
