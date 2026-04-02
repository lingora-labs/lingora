// =============================================================================
// app/api/chat/route.ts
// LINGORA SEEK 3.7 — Thin Router (Entry Point)
// =============================================================================
// SEEK-3.7: topic persistence (lastConcept), universal TTS, neutral first turn.
// *1357*# diagnostic + *2468*# pipeline tracer active.
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
import { orchestrate } from '../../../server/core/orchestrator';
import { executePlan } from '../../../server/core/execution-engine';
import { executePlanStream } from '../../../server/core/execution-engine-stream';
import { evaluateCommercial } from '../../../server/core/commercial-engine-adapter';

export const runtime = 'nodejs';
export const maxDuration = 30;

const STREAMING_ENABLED = process.env.LINGORA_STREAMING_ENABLED === 'true';
const DEBUG_TRACE       = process.env.LINGORA_DEBUG_TRACE === 'true';
const BUILD_SIG         = process.env.LINGORA_BUILD_SIGNATURE ?? 'unset';
const COMMIT_HINT       = process.env.LINGORA_COMMIT_HINT ?? 'SEEK-3.1';

export async function POST(req: NextRequest): Promise<NextResponse | Response> {
  let callerState: SessionState | undefined;

  try {
    const body = await parseRequest(req);
    if (!body) return errorResponse(400, 'Invalid request body', callerState);

    const { message, state: rawState, files, audioDataUrl, audioMimeType } = body;

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
    // SEEK 3.7: always run repairState to normalize structural issues (e.g. module indexes)
    // even when there are no hard errors — warnings can indicate silent state corruption.
    const state = repairState(
      validation.valid ? baseState : baseState,
      validation.errors,
    );
    const stateValidationStatus = validation.valid ? 'passed' : 'repaired';

    if (validation.warnings.length > 0) {
      console.warn('[route] state warnings:', validation.warnings);
    }

    // ── SEEK DIAGNOSTIC TRIGGER ───────────────────────────────────────────────
    if (message?.trim() === '*1357*#') {
      const diagPayload = {
        buildSignature:    BUILD_SIG,
        commitHint:        COMMIT_HINT,
        architecture:      'SEEK-3.7',  // SEEK 3.7 — topic persistence + universal TTS + neutral first turn
        runtime:           'LINGORA-ARCH-9.11',
        timestamp:         new Date().toISOString(),
        orchestratorActive: true,
        stateValidation:   stateValidationStatus,
        streamingEnabled:  STREAMING_ENABLED,
        debugTrace:        DEBUG_TRACE,
        tokens:            state.tokens,
        activeMode:        state.activeMode,
        tutorPhase:        state.tutorPhase,
        mentorProfile:     state.mentorProfile ?? 'Alex',
      };
      return NextResponse.json({
        ...diagPayload,
        message: JSON.stringify(diagPayload, null, 2),
        state,
        suggestedActions: [],
      });
    }

    // ── SEEK 3.5 PIPELINE TRACER — *2468*# ───────────────────────────────────
    // Live diagnosis: runs the full intent→orchestrate pipeline against two
    // known PDF test inputs and returns the exact decisions the system makes.
    // Does NOT call OpenAI. Does NOT produce artifacts. Pure routing trace.
    if (message?.trim() === '*2468*#') {
      const testCases = [
        { label: 'export_chat_pdf',    msg: 'Exporta esta conversación a PDF' },
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
          pdfWillFire: testPlan.executionOrder.some(s => s.executor === 'tool_pdf'),
          mentorIntercepts: testPlan.executionOrder.every(s => s.executor === 'mentor'),
        };
      });

      const summary = {
        allPdfPipelinesActive: traces.every(t => t.pdfWillFire || !t.testCase.includes('pdf')),
        noMentorInterception: traces
          .filter(t => t.testCase.includes('pdf'))
          .every(t => !t.mentorIntercepts),
        streamingEnabled: STREAMING_ENABLED,
        architecture: 'SEEK-3.7',
        timestamp: new Date().toISOString(),
      };

      const payload = { summary, traces };
      return NextResponse.json({
        ...summary,
        traces,
        message: JSON.stringify(payload, null, 2),
        state,
        suggestedActions: [],
      });
    }

    const hasFiles = Array.isArray(files) && files.length > 0;
    const hasAudio = !!(
      audioDataUrl ||
      (hasFiles && files?.some(f => f.type?.startsWith('audio/') || f.type === 'video/webm'))
    );

    // G4 — SEEK 3.3: when gallery audio is attached, the composer text disappears
    // and the backend receives the filename (e.g. "6c83090c-84a4.webm") as the message.
    // Normalize: if message looks like an audio filename, treat as empty string so
    // the intent-router can classify it correctly as a transcription request.
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
      message: normalizedMessage,  // G4: use normalized message (filename → empty)
      state,
      files,
      audioDataUrl,
      audioMimeType,
      // F-B3: propagate exportTranscript so execution-engine can use real chat history for PDF
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

