// =============================================================================
// server/core/execution-engine-stream.ts
// LINGORA SEEK 3.9-c — Streaming Execution Engine
// =============================================================================
// SEEK 3.9 base  : F1 (honest PDF errors), F2 (PDF render errors), F3 (header).
// SEEK 3.9-b     : LW1 (elastic prompt), LW2 (topic sovereignty).
// SEEK 3.9-c     : Operación Liberen a Willy — stream parity with engine.ts.
//
//   LW3 — Domain terminology enforcement (identical prompt to execution-engine.ts).
//   LW4 — Post-generation validator (identical logic to execution-engine.ts).
//   LW5 — Domain-specific module title mandate (via prompt example).
//   C5  — Pre-generation timestamp log [PDF:START:stream] / [PDF:DONE:stream].
//
// Approved: IS + CSJ — 5 de abril de 2026
// Sprint: SEEK 3.9-c · Operación Liberen a Willy
// =============================================================================
//
// SEEK 3.9 base: F1 (honest PDF errors), F2 (PDF render errors), F3 (header).
// SEEK 3.9-b: LW1 (elastic prompt), LW2 (topic sovereignty).
// SEEK 3.9-c CHANGES:
//   C5 — Pre-generation timestamp log (parity with execution-engine.ts).
//        [PDF:START] fires before OpenAI call; [PDF:DONE] fires after.
//        Allows forensic reconstruction when Vercel truncates long-running logs.
//
// ── SSE CONTRACT (verified against app/beta/page.tsx — updated SEEK 3.4) ─────
//
//   Frontend accumulates text from: { delta: string }
//   Frontend applies state from:    { done: true, state, artifact?, suggestedActions? }
//
//   This engine emits:
//     data: {"delta":"...partial mentor text..."}\n\n    (0–N times)
//     data: {"delta":"...commercial suffix..."}\n\n      (0–1 times, if triggered)
//     data: {"done":true,"state":{...},...}\n\n          (exactly once)
//
// ── INVARIANTS ────────────────────────────────────────────────────────────────
//   1. ORDER: Steps walk executionOrder ascending. No grouping by executor.
//   2. DEPENDSON: Failure → visible degraded step, not silent skip.
//   3. MENTOR GATE: executor='mentor' always runs.
//   4. PATCH/STATE: buildStatePatch() → StatePatch (delta).
//                   mergeStatePatch() → updatedState (final).
//   5. COMMERCIAL: Emitted as final delta before done.
//
// =============================================================================

import {
  ExecutionPlan,
  ExecutionStep,
  ExecutorType,
  ArtifactPayload,
  SessionState,
  StatePatch,
  ChatRequest,
  SuggestedAction,
} from '../../lib/contracts';

// ExecutionResult imported from execution-engine — not used in stream path
import { advanceTutorPhase, mergeStatePatch } from './state-manager';
import { evaluateCommercial }                 from './commercial-engine-adapter';

import { buildModelParams } from '../mentors/mentor-engine';

// Single model source of truth — change via OPENAI_MAIN_MODEL env var.
const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';

// ─────────────────────────────────────────────────────────────────────────────
// SSE WIRE FORMAT
// ─────────────────────────────────────────────────────────────────────────────

interface SSEDelta { delta: string; }
interface SSEDone  {
  done:              true;
  state:             SessionState;
  artifact?:         ArtifactPayload;
  suggestedActions?: SuggestedAction[];
}
type SSEPayload = SSEDelta | SSEDone;

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL
// ─────────────────────────────────────────────────────────────────────────────

interface StepOutput {
  stepOrder:  number;
  executor:   ExecutorType;
  text?:      string;
  artifact?:  ArtifactPayload;
  patch?:     StatePatch;
  durationMs: number;
  success:    boolean;
  error?:     string;
  isUserVisibleError?: boolean; // SEEK 3.9 — F3: explicit honest-error signal (stream parity)
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export function executePlanStream(
  plan: ExecutionPlan,
  request: ChatRequest,
  state: SessionState,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {

      function emit(payload: SSEPayload): void {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }

      const priorResults = new Map<number, StepOutput>();

      try {
        const orderedSteps = [...plan.executionOrder].sort(
          (a, b) => a.order - b.order,
        );

        for (const step of orderedSteps) {

          if (step.dependsOn !== undefined) {
            const dep = priorResults.get(step.dependsOn);
            if (!dep || !dep.success) {
              if (step.executor === 'mentor') {
                console.warn(`[stream] step ${step.order}: dep ${step.dependsOn} failed — running mentor with empty context`);
              } else {
                priorResults.set(step.order, degradedStep(step, `dep ${step.dependsOn} failed`));
                console.error(`[stream] step ${step.order} skipped: dep ${step.dependsOn} failed`);
                continue;
              }
            }
          }

          const priorText = collectPriorText(priorResults, step.order);

          // ── MENTOR STEP ───────────────────────────────────────────────────
          if (step.executor === 'mentor') {
            if (!plan.mentor) {
              console.warn(`[stream] step ${step.order}: plan.mentor missing — will use default directive`);
            }
            const start = Date.now();
            try {
              const { getMentorResponseStream, getMentorResponse } = await import('../mentors/mentor-engine');

              if (typeof getMentorResponseStream === 'function') {
                const stream = await getMentorResponseStream({
                  request, state, plan, priorContext: priorText, action: step.action,
                });
                let fullText = '';
                for await (const delta of stream) {
                  fullText += delta;
                  emit({ delta });
                }
                priorResults.set(step.order, {
                  stepOrder: step.order, executor: 'mentor',
                  text: fullText, durationMs: Date.now() - start, success: true,
                });

              } else {
                console.warn(`[stream] getMentorResponseStream not found — falling back to getMentorResponse`);
                const fullText = await getMentorResponse({
                  request, state, plan, priorContext: priorText, action: step.action,
                });
                emit({ delta: fullText });
                priorResults.set(step.order, {
                  stepOrder: step.order, executor: 'mentor',
                  text: fullText, durationMs: Date.now() - start, success: true,
                });
              }

            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[stream] mentor step ${step.order} failed:`, msg);
              const is429 = msg.includes('429') || msg.toLowerCase().includes('quota');
              const lang = state.interfaceLanguage ?? 'en';
              const degradedMsg = getDegradedMentorMessage(lang, is429);
              emit({ delta: degradedMsg });
              priorResults.set(step.order, {
                stepOrder: step.order, executor: 'mentor',
                text: degradedMsg, durationMs: Date.now() - start, success: false,
              });
            }

          // ── NON-MENTOR STEP ───────────────────────────────────────────────
          } else {
            const output = await executeSyncStep(plan, step, request, state, priorText);
            priorResults.set(step.order, output);

            // SEEK 3.9 — F3: emit honest error text as immediate delta only when
            // the step explicitly flagged it as a user-visible error.
            // Using !output.success was too broad — it could classify legitimate
            // text outputs (transcription, attachment, knowledge) as errors.
            if (output.isUserVisibleError && output.text) {
              emit({ delta: output.text });
            }
          }
        }

        const statePatch   = buildStatePatch(plan, state, priorResults);
        const updatedState = mergeStatePatch(state, statePatch);

        const outputs = Array.from(priorResults.values());
        const artifact =
          outputs.find(o => o.artifact && o.executor !== 'mentor')?.artifact
          ?? outputs.find(o => o.artifact && o.executor === 'mentor')?.artifact;

        // SEEK 3.9 — F3: detect honest error in stream outputs, same logic as JSON engine.
        const hasErrorText = outputs.some(o => o.isUserVisibleError === true && o.text);
        const suggestedActions = buildSuggestedActions(plan, artifact, updatedState, hasErrorText);

        // SEEK 3.9 — FIX-PDF-MSG (stream parity): when a blocking hard-override plan
        // produced an artifact but no mentor text, the user would see nothing before
        // the done event (which carries only state/artifact, not a visible message).
        // Fix: emit a success delta so the user sees a confirmation message.
        const noTextEmitted = Array.from(priorResults.values()).every(o => !o.text || o.isUserVisibleError);
        if (artifact && plan.blocking && (plan.priority ?? 0) >= 100 && noTextEmitted) {
          const lang = state.interfaceLanguage ?? 'en';
          const successMsg = buildStreamArtifactSuccessMessage(artifact.type, lang);
          emit({ delta: successMsg });
        }

        if (!plan.blocking) {
          const commercial = await evaluateCommercial(updatedState, plan);
          if (commercial.triggered && commercial.message) {
            emit({ delta: `\n\n${commercial.message}` });
          }
        }

        const donePayload: SSEDone = {
          done:  true,
          state: updatedState,
          ...(artifact               && { artifact }),
          ...(suggestedActions.length > 0 && { suggestedActions }),
        };
        emit(donePayload);
        controller.close();

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Stream error';
        console.error('[stream] fatal:', msg);
        emit({
          done:  true,
          state: mergeStatePatch(state, { tokens: (state.tokens ?? 0) + 1 }),
        });
        controller.close();
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE PATCH BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildStatePatch(
  plan: ExecutionPlan,
  state: SessionState,
  priorResults: Map<number, StepOutput>,
): StatePatch {
  const outputs = Array.from(priorResults.values());

  const patch: StatePatch = outputs.reduce(
    (acc, o) => (o.patch ? { ...acc, ...o.patch } : acc),
    {} as StatePatch,
  );

  patch.tokens = (state.tokens ?? 0) + 1;

  const resolvedTopic = plan.resolvedTopic?.trim();
  if (resolvedTopic && resolvedTopic !== 'Spanish grammar') {
    patch.lastConcept = resolvedTopic;
  }

  if (plan.priority >= 100) (patch as StatePatch).requestedOperation = null;

  if (!plan.skipPhaseAdvance && state.activeMode === 'structured') {
    patch.tutorPhase = advanceTutorPhase(state.tutorPhase, state.activeMode);
  }

  return patch;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC DISPATCHER
// ─────────────────────────────────────────────────────────────────────────────

interface SyncOut { text?: string; artifact?: ArtifactPayload; patch?: StatePatch; isUserVisibleError?: boolean; }

async function executeSyncStep(
  plan: ExecutionPlan,
  step: ExecutionStep,
  request: ChatRequest,
  state: SessionState,
  priorContext: string,
): Promise<StepOutput> {
  const start = Date.now();
  try {
    const out = await dispatchSync(plan, step, request, state, priorContext);
    return {
      stepOrder: step.order, executor: step.executor,
      text: out.text, artifact: out.artifact, patch: out.patch,
      durationMs: Date.now() - start,
      // SEEK 3.9 — F3: preserve explicit error signal from dispatcher.
      // success stays true (step ran without throwing).
      // isUserVisibleError is the only signal used to emit an immediate delta.
      success: true,
      isUserVisibleError: out.isUserVisibleError,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return degradedStep(step, msg, Date.now() - start);
  }
}

async function dispatchSync(
  plan: ExecutionPlan,
  step: ExecutionStep,
  request: ChatRequest,
  state: SessionState,
  priorContext: string,
): Promise<SyncOut> {
  switch (step.executor) {
    case 'tool_schema': {
      const { generateSchemaContent } = await import('../tools/schema-generator');
      const { adaptSchemaToArtifact }  = await import('../tools/schema-adapter');
      const topic = plan.resolvedTopic?.trim()
        || (priorContext?.trim() && priorContext.length > 4 ? priorContext : null)
        || request.message;
      const data  = await generateSchemaContent({
        topic,
        level:      state.confirmedLevel ?? state.userLevel ?? 'B1',
        uiLanguage: state.interfaceLanguage ?? 'en',
      });
      const artifact = adaptSchemaToArtifact(
        data,
        state.confirmedLevel ?? state.userLevel,
      );
      const topicPatch = (topic && topic !== 'Spanish grammar')
        ? { lastConcept: topic }
        : undefined;
      return { artifact, patch: topicPatch };
    }

    case 'tool_pdf': {
      const { generatePDF } = await import('../tools/pdf-generator');
      const title = state.lastConcept ?? 'LINGORA Study Guide';
      console.log(`[PDF:stream] step.action: ${step.action}`);

      if (step.action === 'exportChatPdf') {
        const content = request.exportTranscript || request.message;
        const result = await generatePDF({ title: 'Chat Export', content });

        const messageCount =
          (request.exportTranscript
            ? String(request.exportTranscript).split('\n').filter(Boolean).length
            : 0) || (request.message ? 1 : 0);

        return {
          artifact: result.success
            ? { type: 'pdf_chat' as const, url: result.url, messageCount }
            : undefined,
        };
      }

      if (step.action === 'generateCoursePdf') {
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        // SEEK 3.9 — FIX-TOPIC (stream parity): same priority as execution-engine.ts
        const topic  = plan.resolvedTopic?.trim()
          || state.currentLessonTopic?.trim()
          || (state.lastConcept?.trim() && state.lastConcept !== 'Spanish grammar'
              ? state.lastConcept : null)
          || priorContext?.trim()
          || request.message?.trim()
          || state.curriculumPlan?.topic
          || 'Espanol general';
        const level  = state.confirmedLevel ?? state.userLevel ?? 'A1';
        const lang   = state.interfaceLanguage ?? 'en';
        const mentor = state.mentorProfile ?? 'Sarah';
        const now    = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

        // SEEK 3.9 — FIX-DENSITY (stream parity): identical prompt to execution-engine.ts

        // SEEK 3.9-c — LIBEREN A WILLY (stream parity): free-reasoning course prompt.
        // Identical to execution-engine.ts — no rules, goal + structure only.
        // SEEK 3.9-c — STREAM PARITY: cleanTopic + system/user split.
        const cleanTopicS = topic
          .replace(/\.\s*(no acepto|quiero|debe|sin resumen|nivel universitario|carrera|no puede ser|nivel profesional|con indice|con guia|con desarrollo).*/i, '')
          .replace(/,\s*(no acepto|quiero|debe|sin resumen|nivel universitario|carrera).*/i, '')
          .trim()
          || topic;

        const courseSystemPromptS = `You are a world-class course designer. You always respond with valid JSON only — no markdown, no preamble, no explanation. Your JSON must match the exact structure provided.`;

        const courseUserPromptS = `Generate a complete, authentic course about "${cleanTopicS}" at level ${level}.
Interface language: ${lang}. Mentor: ${mentor}.

The course should reflect what someone who works in the field of "${cleanTopicS}" actually needs. If it is a language course, teach language. If it is a professional domain, teach that domain. Decide the right number of modules, depth, and terminology based on the subject matter.

Return ONLY this JSON structure:
{
  "mentorName": "${mentor}",
  "level": "${level}",
  "studentName": "Estudiante",
  "courseTitle": "string",
  "objective": "string",
  "nativeLanguage": "${lang}",
  "totalModules": <number>,
  "modules": [
    {
      "index": 1,
      "title": "string",
      "vocabulary": [["term", "translation + sentence"], ...],
      "grammar": "string",
      "exercise": "string",
      "development": "string",
      "communicativeFunction": "string",
      "tip": "string"
    }
  ],
  "nextStep": "string",
  "generatedAt": "${now}"
}`;

        // SEEK 3.9-c — C5 (stream parity): pre-generation timestamp log.
        // Vercel truncates logs when functions run >10s. [PDF:START] fires before
        // the OpenAI call — if it appears but result does not, latency is confirmed.
        const pdfGenStartS = Date.now();
        console.log(`[PDF:START:stream] generateCoursePdf — topic: "${topic}", level: ${level}, model: ${RUNTIME_MODEL}, t=${pdfGenStartS}`);

        // SEEK 3.9 — F1 (stream parity): capture errors explicitly.
        let courseContent: import('../tools/pdf/generateCoursePdf').CourseContent | null = null;
        let courseGenError: string | null = null;

        try {
          // SEEK 3.9-c stream: system+user split, 6000 tokens, 0.7 temp.
          const completion = await openai.chat.completions.create({
            ...buildModelParams(RUNTIME_MODEL, 6000, 0.7),
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: courseSystemPromptS },
              { role: 'user',   content: courseUserPromptS   },
            ],
          });
          const raw = completion.choices?.[0]?.message?.content ?? '';
          if (!raw.trim()) {
            courseGenError = 'Model returned empty content.';
          } else {
            // SEEK 3.9 — TYPE-SAFE (stream parity): same raw-reconstruction pattern
            // as execution-engine.ts — no direct m.development access on typed CourseModule.
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const rawModules = Array.isArray(parsed.modules)
              ? parsed.modules as Array<Record<string, unknown>>
              : [];

            if (rawModules.length > 0) {
              const normalizedModules = rawModules.map((m) => {
                const exercise     = typeof m.exercise     === 'string' ? m.exercise     : '';
                const development  = typeof m.development  === 'string' ? m.development  : '';
                return {
                  index: typeof m.index === 'number' ? m.index : 0,
                  title: typeof m.title === 'string' ? m.title : 'Module',
                  vocabulary: Array.isArray(m.vocabulary)
                    ? (m.vocabulary as Array<[string, string]>)
                    : [],
                  grammar: typeof m.grammar === 'string' ? m.grammar : '',
                  exercise: development
                    ? `${exercise}\n\nDesarrollo: ${development}`
                    : exercise,
                  communicativeFunction: typeof m.communicativeFunction === 'string'
                    ? m.communicativeFunction : '',
                  tip: typeof m.tip === 'string' ? m.tip : '',
                };
              });
              courseContent = {
                mentorName:    typeof parsed.mentorName   === 'string' ? parsed.mentorName   : mentor,
                level:         typeof parsed.level        === 'string' ? parsed.level        : level,
                studentName:   typeof parsed.studentName  === 'string' ? parsed.studentName  : 'Estudiante',
                courseTitle:   typeof parsed.courseTitle  === 'string' ? parsed.courseTitle  : `Curso — ${topic}`,
                objective:     typeof parsed.objective    === 'string' ? parsed.objective    : '',
                nativeLanguage:typeof parsed.nativeLanguage === 'string' ? parsed.nativeLanguage : lang,
                totalModules:  typeof parsed.totalModules === 'number'  ? parsed.totalModules : normalizedModules.length,
                modules:       normalizedModules,
                nextStep:      typeof parsed.nextStep     === 'string' ? parsed.nextStep     : '',
                generatedAt:   typeof parsed.generatedAt  === 'string' ? parsed.generatedAt  : now,
              } as import('../tools/pdf/generateCoursePdf').CourseContent;
            } else {
              courseGenError = 'Model returned JSON with no modules.';
            }
          }
        } catch (e) {
          courseGenError = e instanceof Error ? e.message : String(e);
          console.error('[stream] generateCoursePdf: LLM/parse failed:', courseGenError);
        }

        // SEEK 3.9-c — C5: duration log for Vercel forensics
        console.log(`[PDF:DONE:stream] generateCoursePdf — success: ${!!courseContent}, modules: ${courseContent?.modules?.length ?? 0}, durationMs: ${Date.now() - pdfGenStartS}`);

        // SEEK 3.9-c — LW4: POST-GENERATION DOMAIN VALIDATOR (stream — parity with engine.ts)
        // Two-layer check: titles (Layer A) + vocabulary content (Layer B).
        // IS recommendation: title-only check can be gamed by good titles + weak body.
        if (courseContent) {
          const GENERIC_TITLE_WORDS_S = /\b(introduction|introducción|vocabulary|vocabulario básico|grammar|gramática|basics|básico|overview|resumen|module overview|getting started|empezando)\b/i;
          const genericCountS = courseContent.modules.filter(m => {
            const t = m.title?.trim() ?? '';
            return GENERIC_TITLE_WORDS_S.test(t) && t.length < 45;
          }).length;
          const totalModsS = courseContent.modules.length;

          const FILLER_TERMS_S = /^(hola|adiós|gracias|por favor|sí|no|bien|mal|buenas|buenos días|buenas tardes|me llamo|¿cómo estás?|hasta luego)$/i;
          const vacuousVocabCountS = courseContent.modules.filter(m => {
            const vocab = m.vocabulary ?? [];
            if (vocab.length === 0) return false;
            const fillerCount = vocab.filter((pair: string[]) =>
              FILLER_TERMS_S.test((pair[0] ?? '').trim())
            ).length;
            return fillerCount > Math.floor(vocab.length * 0.6);
          }).length;

          const titlesFail_S = totalModsS > 0 && genericCountS > Math.floor(totalModsS / 2);
          const vocabFails_S  = totalModsS > 0 && vacuousVocabCountS > Math.floor(totalModsS / 2);

          if (titlesFail_S || vocabFails_S) {
            console.error(`[PDF:stream] LW4 FAILED — titles: ${genericCountS}/${totalModsS} generic, vocab: ${vacuousVocabCountS}/${totalModsS} vacuous — topic: "${topic}"`);
            const validationErrorMsgsS: Record<string, string> = {
              en: `The course for "${topic}" did not pass domain validation — content was too generic. Please try again.`,
              es: `El curso sobre "${topic}" no pasó la validación de dominio. Inténtalo de nuevo con más precisión.`,
              no: `Kurset om "${topic}" bestod ikke domenevalidering. Prøv igjen.`,
              it: `Il corso su "${topic}" non ha superato la validazione. Riprova.`,
              fr: `Le cours sur "${topic}" n'a pas passé la validation. Réessaie.`,
              de: `Validierung für "${topic}" fehlgeschlagen. Bitte erneut versuchen.`,
            };
            return { text: validationErrorMsgsS[lang] ?? validationErrorMsgsS['en'], isUserVisibleError: true };
          }
          console.log(`[PDF:stream] LW4 PASSED — ${totalModsS - genericCountS}/${totalModsS} domain titles, ${totalModsS - vacuousVocabCountS}/${totalModsS} domain vocab`);
        }

        // SEEK 3.9 — F1: honest error text, not silent {}.
        // executeSyncStep() detects text+no-artifact → marks success:false → emits delta.
        if (!courseContent) {
          const errorMsgs: Record<string, string> = {
            en: `Could not generate the course for "${topic}" right now. The content engine returned an error. Please try again in a moment.`,
            es: `No se pudo generar el curso sobre "${topic}" en este momento. El motor de contenido devolvio un error. Intentalo de nuevo en un instante.`,
            no: `Kunne ikke generere kurset om "${topic}" akkurat na. Innholdsmotoren returnerte en feil. Proev igjen om et oyeblikk.`,
          };
          console.error(`[stream] generateCoursePdf: aborting — ${courseGenError}`);
          return { text: errorMsgs[lang] ?? errorMsgs['en'], isUserVisibleError: true };
        }

        const courseTitle = courseContent.courseTitle || `Curso — ${topic}`;
        console.log(`[PDF:stream] generateCoursePdf — courseTitle: ${courseTitle}, modules: ${courseContent.modules.length}`);
        const result = await generatePDF({ title: courseTitle, content: '', courseContent });
        console.log(`[PDF:stream] generateCoursePdf result.success: ${result.success}, method: ${result.method}, url_exists: ${!!result.url}`);

        if (!result.success) {
          console.error(`[PDF:stream] error: ${result.error} — ${result.message}`);
          // SEEK 3.9 — F2: PDF render failure → honest delta, not silence.
          const pdfErrorMsgs: Record<string, string> = {
            en: `The course content was generated but the PDF could not be rendered. Error: ${result.error ?? 'unknown'}. Please try again.`,
            es: `El contenido del curso se genero pero el PDF no pudo renderizarse. Error: ${result.error ?? 'desconocido'}. Intentalo de nuevo.`,
            no: `Kursinnholdet ble generert, men PDF-en kunne ikke gjengis. Proev igjen.`,
          };
          return { text: pdfErrorMsgs[lang] ?? pdfErrorMsgs['en'], isUserVisibleError: true };
        }

        return { artifact: result.success
          ? { type: 'course_pdf' as const, title: courseTitle, url: result.url, modules: courseContent.modules.map(m => m.title) }
          : undefined };
      }

      const result = await generatePDF({ title, content: request.message });
      return { artifact: result.success ? { type: 'pdf' as const, title, url: result.url, dataUrl: result.url } : undefined };
    }

    case 'tool_image': {
      const { generateImage } = await import('../tools/image-generator');
      const prompt = priorContext || request.message;
      const result = await generateImage(prompt);
      if (result?.success && result.url) {
        return { artifact: {
          type: 'illustration' as const,
          prompt,
          url: result.url,
          caption: result.message ?? undefined,
        }};
      }
      return {};
    }

    case 'tool_audio': {
      if (step.action === 'generateTTS') {
        const { generateSpeech } = await import('../tools/audio-toolkit');
        const textToSpeak = priorContext?.trim() || request.message?.trim();
        if (!textToSpeak) return {};
        const STREAM_MENTOR_VOICES: Record<string, string> = {
          sarah: 'shimmer',
          alex:  'fable',
          nick:  'onyx',
        };
        const streamMentorKey = (state.mentorProfile ?? 'alex').toLowerCase();
        const streamVoice = STREAM_MENTOR_VOICES[streamMentorKey] ?? 'fable';
        const result = await generateSpeech(textToSpeak, { voice: streamVoice });
        if (result?.success && result.url) {
          return { artifact: { type: 'audio' as const, dataUrl: result.url } };
        }
        return {};
      }

      const { transcribeAudio } = await import('../tools/audio-toolkit');

      let audioData: { data: string; format: string } | null = null;
      if (request.audioDataUrl) {
        audioData = {
          data:   request.audioDataUrl.split(',')[1] || request.audioDataUrl,
          format: request.audioMimeType?.split('/')[1] || 'webm',
        };
      } else if (request.files?.length) {
        const audioFile = request.files.find(f => f.type?.startsWith('audio/') || f.type === 'video/webm');
        if (audioFile) {
          const raw = audioFile.base64 ?? (audioFile.dataUrl ? audioFile.dataUrl.split(',')[1] ?? audioFile.dataUrl : '');
          audioData = { data: raw, format: audioFile.type?.split('/')[1] || 'webm' };
        }
      }

      if (!audioData) return {};
      const result = await transcribeAudio(audioData);
      const transcriptText = result.success ? result.text : undefined;
      return {
        text: transcriptText,
        patch: transcriptText ? { lastUserAudioTranscript: transcriptText } : undefined,
      };
    }

    case 'tool_attachment': {
      const { processAttachment } = await import('../tools/attachment-processor');
      const filesToProcess = (request.files ?? []).map(f => ({
        name: f.name,
        type: f.type,
        size: f.size,
        data: f.base64 ?? (f.dataUrl ? f.dataUrl.split(',')[1] ?? f.dataUrl : ''),
      }));
      const r = await processAttachment(
        filesToProcess,
        state as unknown as Record<string, unknown>,
      );
      const text = r?.extractedTexts?.[0] ?? undefined;
      return { text };
    }

    case 'knowledge': {
      const { getRagContext } = await import('../knowledge/rag');
      const result = await getRagContext(request.message);
      return { text: result?.text ?? undefined };
    }

    case 'diagnostic': {
      const { evaluateLevel } = await import('./diagnostics');
      const sampleCount = (state.diagnosticSamples ?? 0) + 1;
      const samples = [
        request.message,
        ...(state.lastConcept  ? [state.lastConcept]  : []),
        ...(state.lastUserGoal ? [state.lastUserGoal] : []),
        ...(state.lastMistake  ? [state.lastMistake]  : []),
      ];
      const result = await evaluateLevel(samples);
      const patch = {
        diagnosticSamples: sampleCount,
        ...(result.confidence !== 'insufficient' && result.confidence !== 'low'
          ? { confirmedLevel: result.level as import('../../lib/contracts').CEFRLevel }
          : {}),
      };
      return { patch };
    }

    case 'tool_storage':
    case 'commercial':
      return {};

    default:
      console.warn(`[stream] unknown executor "${step.executor}" — skipping`);
      return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTED ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

// SEEK 3.9 — FIX-PDF-MSG: stream parity with execution-engine.ts
function buildStreamArtifactSuccessMessage(artifactType: string, lang: string): string {
  const msgs: Record<string, Record<string, string>> = {
    course_pdf: {
      en: 'Your course PDF is ready. You can download it below.',
      es: 'Tu curso en PDF está listo. Puedes descargarlo a continuación.',
      no: 'Kurset ditt i PDF er klart. Du kan laste det ned nedenfor.',
      it: 'Il tuo corso in PDF è pronto. Puoi scaricarlo qui sotto.',
      fr: 'Ton cours en PDF est prêt. Tu peux le télécharger ci-dessous.',
      de: 'Dein PDF-Kurs ist fertig. Du kannst ihn unten herunterladen.',
    },
    pdf_chat: {
      en: 'Conversation exported to PDF. You can download it below.',
      es: 'Conversación exportada a PDF. Puedes descargarla a continuación.',
      no: 'Samtalen er eksportert til PDF. Du kan laste den ned nedenfor.',
      it: 'Conversazione esportata in PDF. Puoi scaricarla qui sotto.',
      fr: 'Conversation exportée en PDF. Tu peux la télécharger ci-dessous.',
      de: 'Gespräch als PDF exportiert. Du kannst es unten herunterladen.',
    },
    pdf: { en: 'Your PDF is ready.', es: 'Tu PDF está listo.', no: 'PDF-en din er klar.' },
  };
  return msgs[artifactType]?.[lang] ?? msgs[artifactType]?.['en'] ?? 'PDF ready.';
}

function buildSuggestedActions(
  plan: ExecutionPlan,
  artifact: ArtifactPayload | undefined,
  state: SessionState,
  hasErrorText = false,
): SuggestedAction[] {
  const lang = state.interfaceLanguage ?? 'en';

  // SEEK 3.9 — stream parity with execution-engine.ts F3:
  // honest error with no artifact → no suggested actions.
  if (hasErrorText && !artifact) {
    return [];
  }

  const a: SuggestedAction[] = [];

  if (artifact?.type === 'quiz')                                         a.push({ type: 'start_quiz',      label: loc('start_quiz', lang) });
  if (artifact?.type === 'schema' || artifact?.type === 'schema_pro')    a.push({ type: 'export_chat_pdf', label: loc('export_chat_pdf', lang) });
  if (artifact?.type === 'roadmap')                                      a.push({ type: 'start_course',    label: loc('start_course', lang) });
  if (plan.pedagogicalAction === 'feedback' && state.activeMode === 'structured')
                                                                          a.push({ type: 'next_module',     label: loc('next_module', lang) });
  if (plan.pedagogicalAction === 'lesson')                               a.push({ type: 'show_schema',     label: loc('show_schema', lang) });
  a.push({ type: 'export_chat_pdf', label: loc('export_chat_pdf', lang) });
  return a.filter((x, i, arr) => arr.findIndex(b => b.type === x.type) === i);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function collectPriorText(r: Map<number, StepOutput>, order: number): string {
  return Array.from(r.values())
    .filter(s => s.stepOrder < order && s.text)
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map(s => s.text!)
    .join('\n\n');
}

function getDegradedMentorMessage(lang: string, is429: boolean): string {
  const quotaMsgs: Record<string, string> = {
    en: 'The tutor is momentarily unavailable. API quota reached. Please try again shortly.',
    es: 'El tutor no esta disponible en este momento. Cuota de API alcanzada. Por favor, intentalo de nuevo en breve.',
    no: 'Laereren er midlertidig utilgjengelig. API-kvote nadd. Proev igjen om litt.',
    de: 'Der Tutor ist momentan nicht verfuegbar. API-Kontingent erreicht. Bitte versuche es in Kuerze erneut.',
    fr: 'Le tuteur est momentanement indisponible. Quota API atteint. Reessaie dans quelques instants.',
    it: 'Il tutor non e al momento disponibile. Quota API raggiunta. Riprova tra breve.',
  };
  const genericMsgs: Record<string, string> = {
    en: 'The tutor could not generate a response right now. Please try again.',
    es: 'El tutor no pudo generar una respuesta en este momento. Por favor, intentalo de nuevo.',
    no: 'Laereren kunne ikke generere et svar akkurat na. Proev igjen.',
    de: 'Der Tutor konnte gerade keine Antwort generieren. Bitte versuche es erneut.',
    fr: "Le tuteur n'a pas pu generer de reponse pour l'instant. Reessaie.",
    it: 'Il tutor non ha potuto generare una risposta in questo momento. Riprova.',
  };
  return is429 ? (quotaMsgs[lang] ?? quotaMsgs['en']) : (genericMsgs[lang] ?? genericMsgs['en']);
}

function degradedStep(step: ExecutionStep, reason: string, durationMs = 0): StepOutput {
  return { stepOrder: step.order, executor: step.executor, durationMs, success: false, error: reason };
}

const LABELS: Record<string, Record<string, string>> = {
  start_quiz:      { en: 'Start quiz',    es: 'Empezar quiz',     no: 'Start quiz' },
  export_chat_pdf: { en: 'Export as PDF', es: 'Exportar a PDF',   no: 'Eksporter som PDF' },
  next_module:     { en: 'Next module',   es: 'Siguiente modulo', no: 'Neste modul' },
  start_course:    { en: 'Start course',  es: 'Empezar curso',    no: 'Start kurs' },
  show_schema:     { en: 'Show schema',   es: 'Ver esquema',      no: 'Vis skjema' },
};
function loc(k: string, l: string): string { return LABELS[k]?.[l] ?? LABELS[k]?.['en'] ?? k; }
