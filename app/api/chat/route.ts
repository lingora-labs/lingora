// =============================================================================
// app/api/chat/route.ts
// LINGORA SEEK 4.1b/4.1c2 — Thin Router | FIX_ID: TRACER_SOVEREIGN | patchSet: 4.1c2
// S0: CORS headers added for diagnostic access
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
export const maxDuration = 300;

const STREAMING_ENABLED = process.env.LINGORA_STREAMING_ENABLED === 'true';
const DEBUG_TRACE       = process.env.LINGORA_DEBUG_TRACE === 'true';
const IS_PRODUCTION     = process.env.NODE_ENV === 'production'
  && process.env.LINGORA_DEBUG_OVERRIDE !== 'true';

const SEEK_BASE    = '4.1b';
const PATCH_SET    = '4.1c2';
const ACTIVE_FIXES = [
  'DOC_CONTRACT_GATE',
  'ENGINE_CONTRACT_PERSIST',
  'ENGINE_CLARIFY_BYPASS',
  'ENGINE_CLEARCONTRACT',
  'WILLY_FREE_ENGINE',
] as const;

const VERCEL_DEPLOY_ID  = process.env.VERCEL_DEPLOYMENT_ID  ?? 'local';
const VERCEL_COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA ?? 'local';
const VERCEL_COMMIT_MSG = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? '';

const BUILD_SIG  = `seek-${PATCH_SET}-${VERCEL_COMMIT_SHA.slice(0, 8)}`;
const COMMIT_HINT = `SEEK ${PATCH_SET} — patchSet active`;
const RUNTIME_ARCH = `SEEK ${PATCH_SET}`;

const RUNTIME_BASELINE = '4.1c2';
const RUNTIME_EXPERIMENT = 'none';

const RUNTIME_FEATURES = {
  elasticCoursePrompt:   ACTIVE_FIXES.includes('WILLY_FREE_ENGINE'),
  noHtmlTableMatrix:     true,
  sessionResetScoped:    false,
  pdfStartLog:           false,
  honestPdfErrors:       true,
  maxDuration60s:        false,
  maxDuration300s:       true,
  streamingAvailable:    true,
  streamingActive:       STREAMING_ENABLED,
} as const;

const SOURCE_OF_TRUTH: 'code+vercel-auto' = 'code+vercel-auto';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
} as const;

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: { ...CORS_HEADERS } });
}

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

    if (message?.trim() === '*1357*#') {
      const diagPayload = {
        seekBase:          SEEK_BASE,
        patchSet:          PATCH_SET,
        runtimeBaseline:   RUNTIME_BASELINE,
        experiment:        RUNTIME_EXPERIMENT,
        activeFixes:       [...ACTIVE_FIXES],
        deploymentId:      VERCEL_DEPLOY_ID,
        gitCommit:         VERCEL_COMMIT_SHA,
        gitMessage:        VERCEL_COMMIT_MSG || undefined,
        architecture:      RUNTIME_ARCH,
        runtime:           'LINGORA-ARCH-9.11',
        buildSignature:    BUILD_SIG,
        commitHint:        COMMIT_HINT,
        sourceOfTruth:     'code+vercel-auto',
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
        _note: `SEEK ${PATCH_SET} — seekBase:${SEEK_BASE} patchSet:${PATCH_SET} deploymentId:${VERCEL_DEPLOY_ID} gitCommit:${VERCEL_COMMIT_SHA.slice(0,8)}. Source: code+vercel-auto.`,
      };
      const diagResponse = IS_PRODUCTION
        ? {
            buildSignature: BUILD_SIG,
            commitHint:     COMMIT_HINT,
            seekBase:       SEEK_BASE,
            patchSet:       PATCH_SET,
            runtimeBaseline: RUNTIME_BASELINE,
            experiment:     RUNTIME_EXPERIMENT,
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
      }, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
    }

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
        runtimeBaseline:       RUNTIME_BASELINE,
        experiment:            RUNTIME_EXPERIMENT,
        timestamp:             new Date().toISOString(),
      };

      return NextResponse.json(
        IS_PRODUCTION
          ? {
              message: JSON.stringify({
                summary: {
                  allPdfPipelinesActive,
                  streamingEnabled:      STREAMING_ENABLED,
                  architecture:          RUNTIME_ARCH,
                  runtimeBaseline:       RUNTIME_BASELINE,
                  experiment:            RUNTIME_EXPERIMENT,
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
            },
        { headers: { ...NO_CACHE, ...CORS_HEADERS } },
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

    return NextResponse.json(response, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
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
      ...CORS_HEADERS,
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
  return NextResponse.json(body, { status, headers: { ...NO_CACHE, ...CORS_HEADERS } });
}

const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Content-Type':  'application/json',
} as const;
