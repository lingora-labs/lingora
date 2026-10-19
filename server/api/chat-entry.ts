// =============================================================================
// server/api/chat-entry.ts
// LINGORA SEEK 4.1b/4.1c2 — Thin Router | FIX_ID: TRACER_SOVEREIGN | patchSet: 4.1c2
// S0: CORS headers added for diagnostic access
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';

import {
  ChatRequest,
  ChatResponse,
  SessionState,
  ExecutionPlan,
  OrchestrationContext,
  DEFAULT_SESSION_STATE,
} from '../../lib/contracts';

import {
  validateStateInvariants,
  repairState,
  mergeStatePatch,
  toWireState,
} from '../core/state-manager';

import { executePlan }    from '../core/execution-engine';
import { executePlanStream } from '../core/execution-engine-stream';
import { orchestrateTutorFirst } from '../core/tutor-first-orchestrator';
import { isConversationPdfExportRequest } from '../../lib/pdf-intent-authorization';

// 7.1 — all conversational tutor turns share one tool-capable streaming path.
// Explicit runtime-only UI operations remain blocking and use executePlan.
const STREAMING_ENABLED = true;
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
    // One central authority produces ALL execution plans, including
    // diagnostics. The mentor alone supplies pedagogical content.
    const preflightPlan=orchestrateTutorFirst({
      message:message ?? '',state,interfaceLanguage:state.interfaceLanguage ?? 'en',
    });


    if (validation.warnings.length > 0) {
      console.warn('[route] state warnings:', validation.warnings);
    }

    if (preflightPlan.executor === 'diagnostic' && preflightPlan.executionOrder[0].action === 'runtimeStatus') {
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
        _note: `SEEK ${PATCH_SET} — seekBase:${SEEK_BASE} patchSet:${PATCH_SET} deploymentId:${VERCEL_DEPLOY_ID} gitCommit:${VERCEL_COMMIT_SHA.slice(0,8)}. Source: code+vercel-auto. Tutor First: centralized deterministic execution planner; tutor owns cognitive content.`,
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

    if (preflightPlan.executor === 'diagnostic' && preflightPlan.executionOrder[0].action === 'runtimePlanAudit') {
      const testCases = [
        { label: 'export_chat_pdf',    msg: 'Exporta esta conversacion a PDF' },
        { label: 'generate_course_pdf', msg: 'Quiero un curso completo A0-A2 en PDF' },
        { label: 'table_matrix',        msg: 'Dame una tabla de 8 columnas de ser y estar' },
      ];

      const traces = testCases.map(tc => {
        const uiAction=tc.label === 'export_chat_pdf' ? 'export_chat_pdf' as const : undefined
        const testPlan=orchestrateTutorFirst({
          message:tc.msg,state,uiAction,
          interfaceLanguage:state.interfaceLanguage ?? 'en',
        })
        return {
          testCase:tc.label,input:tc.msg,
          intent:{type:uiAction?'explicit_ui_action':'tutor_first',explicit:Boolean(uiAction)},
          plan:{
            executor:testPlan.executor,blocking:testPlan.blocking,priority:testPlan.priority,
            pedagogicalAction:testPlan.pedagogicalAction,reason:testPlan.reason,
            executionOrder:testPlan.executionOrder.map(step=>({
              order:step.order,executor:step.executor,action:step.action,
            })),
          },
          pdfWillFire:testPlan.executionOrder.some(step=>step.executor === 'tool_pdf'),
          mentorIntercepts:testPlan.executionOrder.every(step=>step.executor === 'mentor'),
        }
      })
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
        note: 'Diagnostic only — product path uses orchestrateTutorFirst, single typed deterministic execution authority.',
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

    let audioTranscript: string | null = null;
    if (hasAudio && audioDataUrl) {
      try {
        const { transcribeAudio } = await import('../tools/audio-toolkit');
        const base64 = audioDataUrl.includes(',') ? audioDataUrl.split(',')[1] : audioDataUrl;
        const format = audioMimeType?.split('/')[1] || 'webm';
        const transcription = await transcribeAudio({ data: base64, format });
        if (transcription.success && transcription.text?.trim()) {
          audioTranscript = transcription.text.trim();
        } else if (!transcription.success) {
          console.warn('[route] audio transcription failed:', transcription.message);
        }
      } catch (e) {
        console.error('[route] audio transcription exception:', e instanceof Error ? e.message : e);
      }
    }

    if (hasAudio && audioDataUrl && !audioTranscript) {
      const lang = state.interfaceLanguage ?? 'en';
      const retryMsgs: Record<string, string> = {
        es: 'No pude entender el audio. ¿Puedes intentarlo de nuevo?',
        en: 'I could not understand the audio. Could you try again?',
        no: 'Jeg fikk ikke med meg lyden. Kan du proeve igjen?',
      };
      return NextResponse.json({
        message: retryMsgs[lang] ?? retryMsgs.en,
        state,
        suggestedActions: [],
      }, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
    }

    const rawMessageForNormalization =
      hasAudio && (message ?? '').trim() !== '' && AUDIO_FILENAME_RE.test((message ?? '').trim())
        ? ''
        : (message ?? '');

    const normalizedMessage = audioTranscript || rawMessageForNormalization;

    // A typed UI command OR an explicit natural-language student export
    // instruction must converge on one existing pdf_chat execution path.
    // Never route this through the tutor document composer.
    if (!body.uiAction && isConversationPdfExportRequest(normalizedMessage)) {
      body.uiAction = 'export_chat_pdf'
      if (!body.exportTranscript?.trim() && body.conversationHistory?.length) {
        body.exportTranscript = body.conversationHistory
          .filter((turn) => typeof turn.content === 'string' && turn.content.trim())
          .map((turn) => `[${turn.role === 'user' ? 'Student' : 'Tutor'}]: ${turn.content.trim()}`)
          .join('\n\n')
      }
    }
    if (body.uiAction && !(['export_chat_pdf', 'download_pdf', 'hear_audio'] as string[]).includes(body.uiAction)) {
      return errorResponse(400, 'Unsupported UI operation', state);
    }
    const plan=orchestrateTutorFirst({
      message:normalizedMessage,state,
      interfaceLanguage:state.interfaceLanguage ?? 'en',
      uiAction:body.uiAction,
    });

    // 7.1 — direct touch actions need no cognitive routing or extra model.
    // Their source is the actual visible tutor message, not a generated promise.
    if (plan.pedagogicalAction === 'export_artifact') {
      const sourceText = body.materialText?.trim() ?? '';
      const subject = body.uiAction === 'download_pdf' ? 'PDF del material' : 'Respuesta hablada';
      const sourceLimit = body.uiAction === 'download_pdf' ? 50000 : 3000;
      if (!sourceText || sourceText.length > sourceLimit) {
        return NextResponse.json({
          message: !sourceText
            ? 'No hay material disponible para esta acción.'
            : 'El material supera el límite de esta operación. Selecciona un fragmento más corto.',
          state, suggestedActions: [], artifactFailures: [{ subject }],
        }, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
      }
      try {
        if (body.uiAction === 'download_pdf') {
          const { generatePDF } = await import('../tools/pdf-generator');
          const result = await generatePDF({
            title: 'LINGORA — Material de estudio', content: sourceText,
            filename: `lingora-material-${Date.now()}`,
          });
          if (result.success && result.url) {
            return NextResponse.json({
              message: 'Material generado en PDF.',
              state, suggestedActions: [],
              artifact: { type: 'pdf', title: 'LINGORA — Material de estudio', url: result.url },
            }, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
          }
        } else {
          const { generateSpeech } = await import('../tools/audio-toolkit');
          const voice = ({ sarah: 'shimmer', alex: 'fable', nick: 'onyx' } as Record<string, string>)[
            String(state.mentorProfile ?? 'alex').toLowerCase()
          ] ?? 'fable';
          const result = await generateSpeech(sourceText, { voice });
          if (result.success && result.url) {
            return NextResponse.json({
              message: 'Audio preparado.',
              state, suggestedActions: [],
              artifact: { type: 'audio', dataUrl: result.url },
            }, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
          }
        }
      } catch (error) {
        console.error('[7.1] explicit UI action failed', error instanceof Error ? error.message : error);
      }
      return NextResponse.json({
        message: 'No pude completar la operación solicitada.',
        state, suggestedActions: [], artifactFailures: [{ subject }],
      }, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
    }
    if (plan.pedagogicalAction === 'export_chat_pdf' && !body.exportTranscript?.trim()) {
      return NextResponse.json({
        message: 'No hay contenido de conversación para exportar.',
        state,
        artifactFailures: [{ subject: 'Exportación de conversación' }],
        suggestedActions: [],
      }, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
    }
    const chatRequest: ChatRequest = {
      message: normalizedMessage,
      state,
      files,
      audioDataUrl,
      audioMimeType,
      exportTranscript: body.exportTranscript,
      uiAction: body.uiAction,
      conversationHistory: body.conversationHistory,
    };

    if (STREAMING_ENABLED && !plan.blocking) {
      return buildSSEResponse(executePlanStream(plan, chatRequest, state));
    }

    const result       = await executePlan(plan, chatRequest, state);
    const updatedState = mergeStatePatch(state, result.statePatch);

    let resultArtifact = result.artifact;
    let blockingArtifactFailures: { subject: string }[] | undefined;
    if (hasAudio && audioDataUrl && result.message.trim().length > 0 && !resultArtifact) {
      try {
        const { generateSpeech } = await import('../tools/audio-toolkit');
        const MENTOR_VOICES: Record<string, string> = { sarah: 'shimmer', alex: 'fable', nick: 'onyx' };
        const mentorKey = String(state.mentorProfile ?? 'alex').toLowerCase();
        const voice = MENTOR_VOICES[mentorKey] ?? 'fable';
        const tts = await generateSpeech(result.message, { voice });
        if (tts.success && tts.url) {
          resultArtifact = { type: 'audio', dataUrl: tts.url } as typeof result.artifact;
        } else {
          console.error('[P16] blocking-path voice TTS failed', tts.message);
          blockingArtifactFailures = [{ subject: 'Respuesta hablada' }];
        }
      } catch (e) {
        console.error('[P16] blocking-path voice TTS exception', e instanceof Error ? e.message : e);
        blockingArtifactFailures = [{ subject: 'Respuesta hablada' }];
      }
    }

    const wireState = toWireState(updatedState, result.statePatch);

    const exportFailed = plan.pedagogicalAction === 'export_chat_pdf' && !resultArtifact;
    const response: ChatResponse = {
      message: exportFailed
        ? 'No se pudo generar el PDF de esta conversación. Inténtalo de nuevo.'
        : result.message,
      artifact:         resultArtifact,
      ...(exportFailed ? { artifactFailures: [{ subject: 'Exportación de conversación' }] } : blockingArtifactFailures ? { artifactFailures: blockingArtifactFailures } : {}),
      state:            wireState,
      suggestedActions: result.suggestedActions,
      ...(!IS_PRODUCTION && DEBUG_TRACE && {
        executionTrace: {
          requestId:         `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          intentResult:      null,
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
