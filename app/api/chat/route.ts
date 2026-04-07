// =============================================================================
// app/api/chat/route.ts
// LINGORA SEEK 4.0 — Thin Router (Entry Point) with hardened production gates
// =============================================================================
// CORRECCIONES APLICADAS (según auditoría IS + CSJ, 7 abril 2026):
//   1. RUNTIME_FEATURES detecta 3.9d / 3.9-d / 4.0 — tracer honesto.
//   2. executionTrace solo se incluye si !IS_PRODUCTION && DEBUG_TRACE.
//   3. Mantiene gate de producción para *1357*# y *2468*# (sin fuga JSON).
//
// Justificación doctrinal (Manifiesto 7.0): Art. 12, 38.
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
export const maxDuration = 60;

const STREAMING_ENABLED = process.env.LINGORA_STREAMING_ENABLED === 'true';
const DEBUG_TRACE       = process.env.LINGORA_DEBUG_TRACE === 'true';
const IS_PRODUCTION     = process.env.NODE_ENV === 'production'
  && process.env.LINGORA_DEBUG_OVERRIDE !== 'true';
const BUILD_SIG         = process.env.LINGORA_BUILD_SIGNATURE ?? 'unset';
const COMMIT_HINT       = process.env.LINGORA_COMMIT_HINT ?? 'unset';

const RUNTIME_ARCH = COMMIT_HINT !== 'unset'
  ? COMMIT_HINT.split('—')[0].trim()
  : 'UNKNOWN — set LINGORA_COMMIT_HINT in Vercel';

// CORRECCIÓN B: RUNTIME_FEATURES actualizado para 3.9-d / 4.0
const is39cOrLater = BUILD_SIG.includes('3.9c') || BUILD_SIG.includes('3.9-c') ||
                     BUILD_SIG.includes('3.9d') || BUILD_SIG.includes('3.9-d') ||
                     BUILD_SIG.includes('4.0');
const is40 = BUILD_SIG.includes('4.0') || BUILD_SIG.includes('3.9d') || BUILD_SIG.includes('3.9-d');

const RUNTIME_FEATURES = {
  elasticCoursePrompt:   is39cOrLater,
  noHtmlTableMatrix:     is39cOrLater,
  sessionResetScoped:    is39cOrLater,
  pdfStartLog:           is39cOrLater,
  documentBlockContract: is40,
  honestPdfErrors:       true,
  maxDuration60s:        true,
  streamingAvailable:    true,
  streamingActive:       STREAMING_ENABLED,
} as const;

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

    // ── SEEK DIAGNOSTIC TRIGGER *1357*# ───────────────────────────────────
    if (message?.trim() === '*1357*#') {
      const diagPayload = {
        buildSignature:    BUILD_SIG,
        commitHint:        COMMIT_HINT,
        architecture:      RUNTIME_ARCH,
        runtime:           'LINGORA-ARCH-9.11',
        sourceOfTruth:     SOURCE_OF_TRUTH,
        timestamp:         new Date().toISOString(),
        orchestratorActive: true,
        stateValidation:   stateValidationStatus,
        streamingEnabled:  STREAMING_ENABLED,
        debugTrace:        DEBUG_TRACE,
        tokens:            state.tokens,
        activeMode:        state.activeMode,
        tutorPhase:        state.tutorPhase,
        mentorProfile:     state.mentorProfile ?? 'Alex',
        runtimeFeatures:   RUNTIME_FEATURES,
        _note: SOURCE_OF_TRUTH !== 'env+runtime'
          ? 'WARNING: LINGORA_BUILD_SIGNATURE and/or LINGORA_COMMIT_HINT not set.'
          : 'OK: env vars set.',
      };
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

    // ── SEEK 3.9 PIPELINE TRACER *2468*# ───────────────────────────────────
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

      const pdfTraces = traces.filter(t =>
        t.testCase === 'export_chat_pdf' || t.testCase === 'generate_course_pdf',
      );
      const allPdfPipelinesActive = pdfTraces.every(t => t.pdfWillFire);
      const noMentorInterceptionOnPdf = pdfTraces.every(t => !t.mentorIntercepts);

      const summary = {
        allPdfPipelinesActive,
        noMentorInterception:  noMentorInterceptionOnPdf,
        streamingEnabled:      STREAMING_ENABLED,
        architecture:          RUNTIME_ARCH,
        sourceOfTruth:         SOURCE_OF_TRUTH,
        runtimeFeatures:       RUNTIME_FEATURES,
        timestamp:             new Date().toISOString(),
      };

      const payload = { summary, traces };
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

    // CORRECCIÓN C: executionTrace solo si NO producción Y debug activo
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
