// =============================================================================
// server/api/chat-entry.ts
// LINGORA SEEK 4.1b/4.1c2 — Thin Router | FIX_ID: TRACER_SOVEREIGN | patchSet: 4.1c2
// S0: CORS headers added for diagnostic access
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import type { VoiceTurn } from '../../lib/contracts';

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
import { sanitizeMemory, sanitizeMemorySeq } from '../../lib/tutor-memory';
import { sanitizeSpaceContext } from '../space/context';

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
    // One clock per request: the plan (and its immersion facts) is a pure function of this input.
    const requestNow = Date.now();

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
      // 7.4: the Tutor's memory is typed at the boundary like any other state field.
      ...(incomingState.tutorMemory !== undefined ? { tutorMemory: sanitizeMemory(incomingState.tutorMemory) } : {}),
      ...(incomingState.tutorMemorySeq !== undefined ? { tutorMemorySeq: sanitizeMemorySeq(incomingState.tutorMemorySeq) } : {}),
    };

    callerState = baseState;
    const validation = validateStateInvariants(baseState);
    const state = repairState(baseState, validation.errors);
    const stateValidationStatus = validation.valid ? 'passed' : 'repaired';
    // 7.1: the Tutor Maestro is the only cognitive authority. The runtime plan
    // is instrumental (UI operations, diagnostics, structural invariants); the
    // mentor alone interprets intent and supplies pedagogical content.
    const preflightPlan=orchestrateTutorFirst({
      message:message ?? '',state,interfaceLanguage:state.interfaceLanguage ?? 'en',now:requestNow,
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
        instrumentalPlanActive: true,
        cognitiveAuthority: 'tutor-maestro',
        stateValidation:   stateValidationStatus,
        streamingEnabled:  STREAMING_ENABLED,
        debugTrace:        DEBUG_TRACE,
        tokens:            state.tokens,
        activeMode:        state.activeMode,
        tutorPhase:        state.tutorPhase,
        mentorProfile:     state.mentorProfile ?? 'Alex',
        runtimeFeatures:   RUNTIME_FEATURES,
        _note: `SEEK ${PATCH_SET} — seekBase:${SEEK_BASE} patchSet:${PATCH_SET} deploymentId:${VERCEL_DEPLOY_ID} gitCommit:${VERCEL_COMMIT_SHA.slice(0,8)}. Source: code+vercel-auto. Constitution 7.1: Tutor Maestro owns intent and content; runtime is a deterministic instrumental layer.`,
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
          interfaceLanguage:state.interfaceLanguage ?? 'en',now:requestNow,
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
    // 7.5 P1-A: spoken turns. The recognizer hears (language hint from the selection, conversational context,
    // confidence kept); it never invents a turn from silence. What it was unsure of travels as facts.
    let voiceTurn: VoiceTurn | undefined;
    if (hasAudio && audioDataUrl) {
      const { recognizeSpeech } = await import('../tools/voice');
      const { resolveExplanatoryLanguage } = await import('../../lib/explanatory-language');
      const base64 = audioDataUrl.includes(',') ? audioDataUrl.split(',')[1] : audioDataUrl;
      const selectedSpanish = state.interfaceLanguage === 'es' && state.uiLanguageChoice !== 'other';
      const rec = await recognizeSpeech({ base64, mime: audioMimeType }, {
        languageHint: selectedSpanish ? 'es' : undefined,
        context: 'Conversación de un estudiante de español con su tutora. El estudiante puede tener nivel inicial, cometer errores y mezclar el español con otro idioma.',
      });
      if (!rec.ok) {
        console.warn('[voice]', JSON.stringify({ understood: false, reason: rec.reason, asrModel: rec.model, asrMs: rec.ms }));
        const lang = (resolveExplanatoryLanguage(state).language ?? 'es').split('-')[0];
        return NextResponse.json({
          message: voiceRetryMessage(lang, rec.reason), state, suggestedActions: [],
          voice: { understood: false, reason: rec.reason, asrModel: rec.model, asrMs: rec.ms },
        }, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
      }
      const heard = body.voiceInterruption && typeof body.voiceInterruption === 'object' && typeof (body.voiceInterruption as { heard?: unknown }).heard === 'string'
        ? String((body.voiceInterruption as { heard: string }).heard).slice(-600) : null;
      voiceTurn = { transcript: rec.text, uncertain: rec.uncertain, asrModel: rec.model, asrMs: rec.ms, interruptedTutor: heard ? { heard } : null, clientSpeech: body.clientSpeech === true };
      audioTranscript = rec.text;
    }

    const rawMessageForNormalization =
      hasAudio && (message ?? '').trim() !== '' && AUDIO_FILENAME_RE.test((message ?? '').trim())
        ? ''
        : (message ?? '');

    const normalizedMessage = audioTranscript || rawMessageForNormalization;

    // 7.4.1 — "Reintentar entrega" re-materialises what the Tutor ALREADY wrote. It is not a student turn and
    // not a Tutor turn: no new message, no second authoring, no change to the conversation or the memory.
    if (body.uiAction === 'retry_delivery') {
      const text = body.materialText?.trim() ?? '';
      const { parseClosedTutorTurn } = await import('../../lib/artifact-signal');
      const declared = Array.isArray(body.retrySignals) ? body.retrySignals.slice(0, 3) : [];
      const signals = (parseClosedTutorTurn({ reply: 'retry', artifacts: declared })?.artifacts ?? [])
        .filter(sig => sig.type === 'emit_pdf');
      if (!text || text.length > 400000 || !signals.length) {
        return NextResponse.json({
          message: 'No hay material disponible para repetir esta entrega.',
          retryOf: true, state, suggestedActions: [], artifactFailures: [{ subject: 'Reintento de entrega' }],
        }, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
      }
      const { fulfillArtifactSignals } = await import('../core/artifact-side-effect');
      const done = await fulfillArtifactSignals(signals, text, state);
      return NextResponse.json({
        message: done.failures.length ? 'No se pudo completar la entrega.' : 'Entrega completada.',
        retryOf: true, state,
        artifacts: done.artifacts,
        ...(done.failures.length ? { artifactFailures: done.failures } : {}),
        suggestedActions: done.failures.length
          ? [{ type: 'retry_delivery', action: 'retry_delivery', label: 'Reintentar entrega', payload: { signals } }]
          : [],
      }, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
    }
    if (body.uiAction && !(['export_chat_pdf', 'download_pdf', 'hear_audio', 'create_visual_review'] as string[]).includes(body.uiAction)) {
      return errorResponse(400, 'Unsupported UI operation', state);
    }
    const plan=orchestrateTutorFirst({
      message:normalizedMessage,state,
      interfaceLanguage:state.interfaceLanguage ?? 'en',now:requestNow,
      uiAction:body.uiAction,
    });

    // 7.1 — direct touch actions need no cognitive routing or extra model.
    // Their source is the actual visible tutor message, not a generated promise.
    if (plan.pedagogicalAction === 'export_artifact') {
      // 7.5: "download" and "listen" act on the Tutor message the student is looking at, through the
      // same canonical document and the same complete speech as every other route. No length cut.
      const sourceText = body.materialText?.trim() ?? '';
      const subject = body.uiAction === 'download_pdf' ? 'PDF del material' : 'Respuesta hablada';
      const { EXPORT_RESOURCE_LIMITS, validateExportTurns } = await import('../tools/pdf/conversationExport');
      const refuse = (why: string) => NextResponse.json({
        message: why, state, suggestedActions: [], artifactFailures: [{ subject: `${subject}: ${why}` }],
      }, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
      if (!sourceText) return refuse('no hay material del Tutor en pantalla para esta acción');
      if (sourceText.length > EXPORT_RESOURCE_LIMITS.charsPerTurn) return refuse(`el mensaje tiene ${sourceText.length} caracteres; el máximo técnico por documento es ${EXPORT_RESOURCE_LIMITS.charsPerTurn}`);
      try {
        if (body.uiAction === 'download_pdf') {
          const turn = body.materialTurn === undefined ? null : validateExportTurns([body.materialTurn])?.[0] ?? null;
          if (body.materialTurn !== undefined && !turn) return refuse('el mensaje está incompleto o en curso; espera a que termine');
          const { tutorHeadings } = await import('../../lib/content/markdown');
          const title = tutorHeadings(sourceText)[0]?.text || 'Material de estudio';
          const { deliverDocument } = await import('../core/artifact-side-effect');
          const doc = await deliverDocument({ title, sections: [{ text: turn?.text ?? sourceText, artifacts: turn?.artifacts ?? [] }] },
            { withHtml: true, filename: `lingora-material-${Date.now()}` });
          if ('failure' in doc) return refuse(doc.failure);
          return NextResponse.json({ message: 'Material generado en PDF.', state, suggestedActions: [], artifact: doc.artifact },
            { headers: { ...NO_CACHE, ...CORS_HEADERS } });
        }
        const { speakTutorText } = await import('../tools/audio-toolkit');
        const { voiceFor } = await import('../core/artifact-side-effect');
        const result = await speakTutorText(sourceText, { voice: voiceFor(state.mentorProfile ?? 'alex') });
        if (result.success && result.url) {
          return NextResponse.json({ message: 'Audio preparado.', state, suggestedActions: [], artifact: { type: 'audio', dataUrl: result.url } },
            { headers: { ...NO_CACHE, ...CORS_HEADERS } });
        }
        return refuse(result.message ?? 'no se pudo generar el audio');
      } catch (error) {
        console.error('[7.5] explicit UI action failed', error instanceof Error ? error.message : error);
        return refuse(error instanceof Error ? error.message.slice(0, 200) : 'error interno');
      }
    }
    if (plan.pedagogicalAction === 'export_chat_pdf' && !body.exportTranscript?.trim() && !body.exportTurns) {
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
      exportTurns: body.exportTurns,
      uiAction: body.uiAction,
      conversationHistory: body.conversationHistory,
      spaceContext: sanitizeSpaceContext(body.spaceContext),
      conversationId: typeof body.conversationId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(body.conversationId) ? body.conversationId : undefined,
      ...(voiceTurn ? { voice: voiceTurn } : {}),
    };

    // 7.4: ONE Tutor engine, two transports. Tutor turns always run through the tool-capable engine
    // (memory, language, artifacts); `stream:false` only changes how the finished turn is delivered.
    if (!plan.blocking) {
      const turnStream = executePlanStream(plan, chatRequest, state);
      if (STREAMING_ENABLED && body.stream !== false) return buildSSEResponse(turnStream);
      return await buildJsonFromStream(turnStream);
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
      // 7.4.6: an explicit refusal (named artifact, interrupted turn) must reach the student; the generic text is the fallback only.
      message: exportFailed
        ? (result.message?.trim() || 'No se pudo generar el PDF de esta conversación. Inténtalo de nuevo.')
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

/** Same engine, JSON transport: drain the turn and return it as one ChatResponse-shaped document. */
const VOICE_RETRY: Record<string, Record<'nothing_heard' | 'unreadable_audio' | 'asr_unavailable', string>> = {
  es: { nothing_heard: 'No he oído nada claro. ¿Puedes repetirlo un poco más cerca del micrófono?', unreadable_audio: 'No he podido procesar esa grabación. ¿Lo intentas otra vez?', asr_unavailable: 'Ahora mismo no puedo escuchar audio. Puedes escribirme tu mensaje y seguimos.' },
  en: { nothing_heard: 'I could not hear anything clear. Could you say it again, a bit closer to the microphone?', unreadable_audio: 'I could not process that recording. Could you try again?', asr_unavailable: 'I cannot listen to audio right now. You can type your message and we carry on.' },
  no: { nothing_heard: 'Jeg hørte ikke noe tydelig. Kan du si det igjen, litt nærmere mikrofonen?', unreadable_audio: 'Jeg klarte ikke å behandle opptaket. Prøver du igjen?', asr_unavailable: 'Jeg kan ikke lytte til lyd akkurat nå. Du kan skrive meldingen din.' },
};
function voiceRetryMessage(lang: string, reason: 'nothing_heard' | 'unreadable_audio' | 'asr_unavailable'): string {
  return (VOICE_RETRY[lang] ?? VOICE_RETRY.es)[reason];
}

async function buildJsonFromStream(stream: ReadableStream<Uint8Array>): Promise<NextResponse> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '';
  let done: Record<string, unknown> | null = null;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    const events = buf.split('\n\n');
    buf = events.pop() ?? '';
    for (const ev of events) {
      const line = ev.split('\n').find(l => l.startsWith('data: '));
      if (!line) continue;
      try {
        const p = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (typeof p.delta === 'string') text += p.delta;
        if (p.done) done = p;
      } catch { /* ignore malformed event */ }
    }
  }
  const { done: _d, ...rest } = done ?? {};
  void _d;
  return NextResponse.json({ message: text, ...rest }, { headers: { ...NO_CACHE, ...CORS_HEADERS } });
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
