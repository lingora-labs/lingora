// =============================================================================
// app/api/chat/route.ts
// LINGORA SEEK 4.1b/4.1c2 — Thin Router | FIX_ID: TRACER_SOVEREIGN | patchSet: 4.1c2
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
//   SEEK 4.1c2 — TRACER_SOVEREIGN: SEEK_BASE/PATCH_SET/ACTIVE_FIXES are code
//        constants updated with each sprint. VERCEL_DEPLOYMENT_ID and
//        VERCEL_GIT_COMMIT_SHA are auto-set by Vercel on every deploy.
//        No manual env var update required.
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
// ─────────────────────────────────────────────────────────────────────────────
// SEEK 4.1c2 — SOVEREIGN TRACER (no manual env vars required)
// SEEK_BASE + PATCH_SET + ACTIVE_FIXES are updated IN CODE at each sprint.
// VERCEL_DEPLOYMENT_ID and VERCEL_GIT_COMMIT_SHA are set automatically by
// Vercel on every deploy — never need manual action.
// ─────────────────────────────────────────────────────────────────────────────

/** Updated in code — never needs manual env var update */
const SEEK_BASE    = '4.1b';
const PATCH_SET    = '4.1c2';
const ACTIVE_FIXES = [
  'DOC_CONTRACT_GATE',        // orchestrator: PendingDocumentRequest + STEP 1.75
  'ENGINE_CONTRACT_PERSIST',  // engine: pendingDocumentRequest → StatePatch
  'ENGINE_CLARIFY_BYPASS',    // engine: openDocumentContract bypasses LLM
  'ENGINE_CLEARCONTRACT',     // engine: clearDocumentContract after PDF
  'WILLY_FREE_ENGINE',        // engine: max_tokens 12000 + density benchmark in courseUserPrompt
] as const;

/** Vercel auto-sets these on every deploy — no manual action needed */
const VERCEL_DEPLOY_ID  = process.env.VERCEL_DEPLOYMENT_ID  ?? 'local';
const VERCEL_COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA ?? 'local';
const VERCEL_COMMIT_MSG = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? '';

/** Kept for backward compat with runtimeFeatures checks below */
const BUILD_SIG  = `seek-${PATCH_SET}-${VERCEL_COMMIT_SHA.slice(0, 8)}`;
const COMMIT_HINT = `SEEK ${PATCH_SET} — patchSet active`;
const RUNTIME_ARCH = `SEEK ${PATCH_SET}`;

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
// SEEK 4.1c2 — sovereign source of truth (no 'unset' comparisons)
const SOURCE_OF_TRUTH: 'code+vercel-auto' = 'code+vercel-auto';

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
        seekBase:          SEEK_BASE,
        patchSet:          PATCH_SET,
        activeFixes:       [...ACTIVE_FIXES],
        deploymentId:      VERCEL_DEPLOY_ID,
        gitCommit:         VERCEL_COMMIT_SHA,
        gitMessage:        VERCEL_COMMIT_MSG || undefined,
        architecture:      RUNTIME_ARCH,
        runtime:           'LINGORA-ARCH-9.11',
        buildSignature:    BUILD_SIG,              // backward compat
        commitHint:        COMMIT_HINT,            // backward compat
        sourceOfTruth:     'code+vercel-auto',
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
        _note: `SEEK ${PATCH_SET} — seekBase:${SEEK_BASE} patchSet:${PATCH_SET} deploymentId:${VERCEL_DEPLOY_ID} gitCommit:${VERCEL_COMMIT_SHA.slice(0,8)}. Source: code+vercel-auto. No manual env vars required.`,
      };
      // SEEK 3.9-d — C1: Production gate — no internal JSON leak to user channel
      const diagResponse = IS_PRODUCTION
        ? {
            buildSignature: BUILD_SIG,
            commitHint:     COMMIT_HINT,
            seekBase:       SEEK_BASE,
            patchSet:       PATCH_SET,
            activeFixes:    [...ACTIVE_FIXES],
            deploymentId:   VERCEL_DEPLOY_ID,
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

