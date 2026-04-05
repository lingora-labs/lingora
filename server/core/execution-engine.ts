// =============================================================================
// server/core/execution-engine.ts
// LINGORA SEEK 3.9 — Execution Engine
// =============================================================================
// Purpose  : Execute the ExecutionPlan produced by orchestrator.ts.
//            Reads executionOrder. Executes steps in declared order.
//            Resolves dependsOn. Collects results. Returns compiled outputs.
//
// SEEK 3.9 CHANGES:
//   F1 — generateCoursePdf: LLM/parse failure → honest error artifact instead
//        of silent {} return. User sees a real message, not mentor fallback.
//   F2 — buildFallbackMessage: course PDF failure produces a specific, honest
//        error message, not the generic "try again" fallback.
//   F3 — Header and architecture string bumped to SEEK-3.9.
//
// =============================================================================

import {
  ExecutionPlan,
  ExecutionStep,
  ExecutionStepResult,
  ExecutorType,
  ArtifactPayload,
  SessionState,
  StatePatch,
  ChatRequest,
  SuggestedAction,
  SuggestedActionType,
} from '../../lib/contracts';

import { advanceTutorPhase } from './state-manager';
import { buildModelParams } from '../mentors/mentor-engine';

// Single model source of truth — change via OPENAI_MAIN_MODEL env var.
// Supports: gpt-4o-mini, gpt-5.4-nano, gpt-5.4-mini (no code changes needed).
const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';

// ─────────────────────────────────────────────────────────────────────────────
// SEEK 3.1 Fase 0-A — TOPIC RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

const NOISE_PATTERNS = /^(continúa|continua|siguiente|next|ok|sí|si|yes|no|vale|listo|bien|ready|go|start|más|mas|seguir|continue|adelante|siguiente módulo|next module|proceed|claro|entendido|understood)$/i;

function resolveSchemaTopicFromState(
  message: string,
  state: SessionState,
  priorText: string,
): string {
  if (state.currentLessonTopic?.trim()) return state.currentLessonTopic;
  const cleanMessage = message?.trim();
  if (cleanMessage && cleanMessage.length > 4 && !NOISE_PATTERNS.test(cleanMessage)) {
    return cleanMessage;
  }
  if (state.lastConcept?.trim())       return state.lastConcept;
  if (state.lastUserGoal?.trim())      return state.lastUserGoal;
  if (state.curriculumPlan?.topic)     return state.curriculumPlan.topic;
  const cleanPrior = priorText?.trim();
  if (cleanPrior && cleanPrior.length > 4 && !NOISE_PATTERNS.test(cleanPrior)) {
    return cleanPrior;
  }
  return 'Spanish grammar';
}

export interface ExecutionResult {
  message: string;
  artifact?: ArtifactPayload;
  suggestedActions: SuggestedAction[];
  statePatch: StatePatch;
  stepResults: ExecutionStepResult[];
  totalDurationMs: number;
}

interface StepContext {
  plan: ExecutionPlan;
  request: ChatRequest;
  state: SessionState;
  priorResults: Map<number, StepOutput>;
}

interface StepOutput {
  stepOrder: number;
  executor: ExecutorType;
  text?: string;
  artifact?: ArtifactPayload;
  patch?: StatePatch;
  durationMs: number;
  success: boolean;
  error?: string;
  // SEEK 3.9 — F3: explicit signal for user-visible error text.
  // Distinct from success:false (which means the step threw/failed internally).
  // isUserVisibleError means the step succeeded in running but intentionally
  // returned an honest error message instead of an artifact.
  isUserVisibleError?: boolean;
}

export async function executePlan(
  plan: ExecutionPlan,
  request: ChatRequest,
  state: SessionState,
): Promise<ExecutionResult> {
  const engineStart = Date.now();
  const orderedSteps = [...plan.executionOrder].sort((a, b) => a.order - b.order);
  const ctx: StepContext = { plan, request, state, priorResults: new Map() };
  const stepResults: ExecutionStepResult[] = [];

  for (const step of orderedSteps) {
    if (step.dependsOn !== undefined) {
      const dep = ctx.priorResults.get(step.dependsOn);
      if (!dep || !dep.success) {
        const fallback = buildDegradedStep(step, `dependency step ${step.dependsOn} failed or missing`);
        ctx.priorResults.set(step.order, fallback);
        stepResults.push(toStepResult(fallback, plan));
        continue;
      }
    }
    const stepOutput = await executeStep(step, ctx);
    ctx.priorResults.set(step.order, stepOutput);
    stepResults.push(toStepResult(stepOutput, plan));
  }

  const compiled = compileResult(plan, ctx, stepResults);
  return { ...compiled, stepResults, totalDurationMs: Date.now() - engineStart };
}

async function executeStep(step: ExecutionStep, ctx: StepContext): Promise<StepOutput> {
  const start = Date.now();
  try {
    const output = await dispatchToExecutor(step, ctx);
    return {
      stepOrder: step.order,
      executor: step.executor,
      text: output.text,
      artifact: output.artifact,
      patch: output.patch,
      durationMs: Date.now() - start,
      success: true,
      // SEEK 3.9 — F3: preserve explicit error signal from dispatcher.
      // success stays true (step ran without throwing) but isUserVisibleError
      // tells compileResult() that the text is an honest error message.
      isUserVisibleError: output.isUserVisibleError,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[execution-engine] step ${step.order} (${step.executor}:${step.action}) failed: ${errorMessage}`);
    return buildDegradedStep(step, errorMessage, Date.now() - start);
  }
}

interface DispatchOutput {
  text?: string;
  artifact?: ArtifactPayload;
  patch?: StatePatch;
  isUserVisibleError?: boolean; // SEEK 3.9 — F3: propagated from dispatchToExecutor to StepOutput
}

async function dispatchToExecutor(step: ExecutionStep, ctx: StepContext): Promise<DispatchOutput> {
  const priorText = collectPriorText(ctx.priorResults, step.order);

  switch (step.executor) {

    // ── Mentor ───────────────────────────────────────────────────────────────
    case 'mentor': {
      const { getMentorResponse } = await import('../mentors/mentor-engine');
      const text = await getMentorResponse({
        request: ctx.request,
        state: ctx.state,
        plan: ctx.plan,
        priorContext: priorText,
        action: step.action,
      });

      if (step.action === 'evaluatePronunciation') {
        try {
          const jsonMatch = text.match(/\{[\s\S]*?\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const artifact: import('../../lib/contracts').PronunciationReport = {
              type:     'pronunciation_report',
              score:    typeof parsed.score === 'number' ? parsed.score : 70,
              feedback: parsed.feedback ?? parsed.tip ?? text.replace(/\{[\s\S]*?\}/, '').trim(),
              tip:      parsed.tip ?? parsed.suggestion ?? '',
              errors:   Array.isArray(parsed.errors) ? parsed.errors : [],
            };
            return { text: artifact.feedback, artifact };
          }
        } catch { /* fall through to plain text */ }
      }

      return { text };
    }

    // ── Schema generator ─────────────────────────────────────────────────────
    case 'tool_schema': {
      const { generateSchemaContent } = await import('../tools/schema-generator');
      const { adaptSchemaToArtifact }  = await import('../tools/schema-adapter');

      const topic      = ctx.plan.resolvedTopic
        || resolveSchemaTopicFromState(ctx.request.message, ctx.state, priorText);
      const level      = ctx.state.confirmedLevel ?? ctx.state.userLevel ?? 'B1';
      const uiLanguage = ctx.state.interfaceLanguage ?? 'en';

      const topicPatch = (topic && topic !== 'Spanish grammar')
        ? { lastConcept: topic }
        : undefined;

      switch (step.action) {

        case 'generateSchema': {
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          return { artifact: adaptSchemaToArtifact(data, ctx.state.confirmedLevel ?? ctx.state.userLevel), patch: topicPatch };
        }

        case 'generateSchemaPro': {
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          const blocks: import('../../lib/contracts').SchemaProBlockItem[] = [];
          if (data.keyConcepts?.length) {
            blocks.push({ type: 'bullets', title: 'Conceptos clave', items: data.keyConcepts });
          }
          for (const sub of (data.subtopics ?? [])) {
            blocks.push({ type: 'concept', title: sub.title, body: sub.keyTakeaway ? `${sub.content}\n→ ${sub.keyTakeaway}` : sub.content });
          }
          if (data.tableRows?.length) {
            blocks.push({ type: 'table', columns: ['Forma', 'Valor'], rows: data.tableRows.map(r => [r.left, r.right]) });
          }
          if (data.summary) {
            blocks.push({ type: 'highlight', tone: 'ok', label: 'Regla 80/20', text: data.summary });
          }
          const artifact: import('../../lib/contracts').SchemaProArtifact = {
            type: 'schema_pro', title: data.title, subtitle: data.objective,
            level: ctx.state.confirmedLevel ?? ctx.state.userLevel, blocks,
          };
          return { artifact };
        }

        case 'generateQuiz': {
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          if (data.quiz?.length) {
            const artifact: import('../../lib/contracts').QuizArtifact = {
              type: 'quiz', title: data.title,
              questions: data.quiz.map(q => ({
                question: q.question,
                options: q.options.map((opt, i) => ({ text: opt, correct: i === q.correct })),
              })),
            };
            return { artifact };
          }
          console.error('[execution-engine] generateQuiz: no quiz in schema output — returning empty');
          return {};
        }

        case 'generateTable': {
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          if (data.tableRows?.length) {
            const artifact: import('../../lib/contracts').TableArtifact = {
              type: 'table', title: data.title, columns: ['', ''],
              rows: data.tableRows.map(row => [row.left, row.right]),
            };
            return { artifact };
          }
          console.error('[execution-engine] generateTable: no tableRows — returning empty');
          return {};
        }

        case 'generateTableMatrix': {
          const { generateTableMatrixRich } = await import('../tools/schema-generator');
          const richArtifact = await generateTableMatrixRich({ topic, level, uiLanguage });
          if (richArtifact) return { artifact: richArtifact, patch: topicPatch };
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          if (data.tableRows?.length) {
            const artifact: import('../../lib/contracts').TableMatrixArtifact = {
              type: 'table_matrix', title: data.title,
              columns: ['Concepto', 'Valor'],
              rows: data.tableRows.map(row => [{ value: row.left, tone: 'neutral' as const }, { value: row.right }]),
            };
            return { artifact };
          }
          console.error('[execution-engine] generateTableMatrix: no tableRows — returning empty');
          return {};
        }

        case 'buildRoadmapArtifact': {
          if (!ctx.state.curriculumPlan) {
            const topicFallback = resolveSchemaTopicFromState(ctx.request.message, ctx.state, '') || topic;
            const fallbackModules = [
              { index: 0, title: 'Diagnóstico de nivel',          focus: 'Evaluación inicial',    completed: false, current: true },
              { index: 1, title: `Fundamentos: ${topicFallback}`, focus: 'Conceptos clave',       completed: false, current: false },
              { index: 2, title: 'Práctica guiada',               focus: 'Ejercicios aplicados',  completed: false, current: false },
              { index: 3, title: 'Errores frecuentes',            focus: 'Corrección',            completed: false, current: false },
              { index: 4, title: 'Simulacro final',               focus: 'Evaluación de dominio', completed: false, current: false },
            ];
            const artifact: import('../../lib/contracts').RoadmapBlock = {
              type: 'roadmap', title: topicFallback, modules: fallbackModules,
            };
            return { artifact };
          }
          const artifact: import('../../lib/contracts').RoadmapBlock = {
            type: 'roadmap', title: ctx.state.curriculumPlan.topic,
            modules: ctx.state.curriculumPlan.modules.map(m => ({
              index: m.index, title: m.title, focus: m.focus,
              completed: !!(ctx.state.masteryByModule[m.index]?.passed),
              current: m.index === (ctx.state.currentModuleIndex ?? 0),
            })),
          };
          return { artifact };
        }

        default: {
          console.error(`[execution-engine] tool_schema: unsupported action "${step.action}"`);
          return {};
        }
      }
    }

    // ── PDF generator ────────────────────────────────────────────────────────
    case 'tool_pdf': {
      const { generatePDF } = await import('../tools/pdf-generator');
      const title = ctx.state.lastConcept ?? 'LINGORA Study Guide';
      console.log(`[PDF] step.action: ${step.action}`);
      console.log(`[PDF] title: ${title}`);

      if (step.action === 'exportChatPdf') {
        const rawTranscript = ctx.request.exportTranscript || ctx.request.message || '';
        const now = new Date();
        const dateStr = now.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
        const mentorName = (ctx.state.mentorProfile ?? 'Alex').charAt(0).toUpperCase() +
                           (ctx.state.mentorProfile ?? 'Alex').slice(1);
        const levelStr  = ctx.state.confirmedLevel ?? ctx.state.userLevel ?? 'N/A';
        const tokensStr = String(ctx.state.tokens ?? 0);

        const lines = rawTranscript.split('\n').filter(Boolean);
        const formattedLines = lines.map((line: string) => {
          if (line.startsWith('[Student]:') || line.startsWith('[USER]:')) {
            return line.replace(/^\[(?:Student|USER)\]:/, '▶ Estudiante:');
          }
          const mentorMatch = line.match(/^\[([A-Z]+)\]:/);
          if (mentorMatch) return line.replace(/^\[[A-Z]+\]:/, `◆ ${mentorName}:`);
          return line;
        }).join('\n');

        const header = [
          '══════════════════════════════════════════',
          '   LINGORA - HISTORIAL DE SESION',
          '══════════════════════════════════════════',
          `Mentor:   ${mentorName}`,
          `Nivel:    ${levelStr}`,
          `Turnos:   ${tokensStr}`,
          `Fecha:    ${dateStr}`,
          '──────────────────────────────────────────',
          '',
        ].join('\n');

        const footer = [
          '',
          '──────────────────────────────────────────',
          'LINGORA - AI Cultural Immersion Platform for Spanish',
          'Learn -> Connect -> Experience',
          `Exportado el ${dateStr}`,
        ].join('\n');

        const content = header + formattedLines + footer;
        const result = await generatePDF({ title: `LINGORA - Sesion - ${dateStr}`, content });
        console.log(`[PDF] exportChatPdf result.success: ${result.success}, method: ${result.method}, url_exists: ${!!result.url}`);
        if (!result.success) console.error(`[PDF] exportChatPdf error: ${result.error} — ${result.message}`);

        const messageCount = rawTranscript
          ? rawTranscript.split('\n').filter(Boolean).length
          : 0;

        const artifact = result.success
          ? { type: 'pdf_chat' as const, url: result.url, messageCount }
          : undefined;

        return { artifact };
      }

      if (step.action === 'generateCoursePdf') {
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        // SEEK 3.9 — FIX-TOPIC: resolvedTopic must use the pedagogically active
        // topic, not the literal request message ("hazme un curso en PDF").
        // Priority: plan.resolvedTopic → lastConcept → currentLessonTopic → message.
        // This prevents the meta-topic ("pedir un curso en PDF") from becoming
        // the course subject when the conversation already has an active theme.
        const topic    = ctx.plan.resolvedTopic
          || ctx.state.currentLessonTopic?.trim()
          || (ctx.state.lastConcept?.trim() && ctx.state.lastConcept !== 'Spanish grammar'
              ? ctx.state.lastConcept
              : null)
          || resolveSchemaTopicFromState(ctx.request.message, ctx.state, '');
        const level    = ctx.state.confirmedLevel ?? ctx.state.userLevel ?? 'A1';
        const lang     = ctx.state.interfaceLanguage ?? 'en';
        const mentor   = ctx.state.mentorProfile ?? 'Sarah';
        const now      = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

        // SEEK 3.9 — FIX-DENSITY: topic thematic isolation.
        // If topic is a non-Spanish domain (acupuncture, medicine, law, business, etc.)
        // the course teaches SPANISH LANGUAGE SKILLS for that domain — NOT the domain itself.
        // The course title and modules must reflect: "Spanish for [domain]", not "[domain] theory".
        const isSpanishDomain = /gramatica|grammar|vocabulario|vocabulary|subjuntivo|tiempos|verbos|pronunciacion|conjugacion|dele|ccse|siele|presentacion|saludos|restaurante|viaje|travel|negocios|business|conversacion/i.test(topic);
        const domainFrame = isSpanishDomain
          ? `The course is about the Spanish language topic: "${topic}".`
          : `The course teaches SPANISH LANGUAGE SKILLS needed to speak, read, and write about "${topic}" in Spanish. Each module covers vocabulary, grammar, and communicative functions related to "${topic}" — NOT theory about the domain itself. The course title should be "Spanish for [domain]" style.`;

        const coursePrompt = `You are LINGORA's course generator. Produce a complete, dense, pedagogically rich Spanish course as valid JSON.

${domainFrame}
Level: ${level}. Interface language: ${lang}. Mentor: ${mentor}.

DENSITY REQUIREMENTS — MANDATORY (this is the most important instruction):
- vocabulary: MINIMUM 8 pairs per module, MAXIMUM 12. Include full-sentence usage examples.
- grammar: 3-5 sentences explaining the rule, its exceptions, and a memory anchor.
- exercise: 3-part exercise: (1) fill-in-the-blank, (2) production sentence, (3) real-world micro-simulation.
- development: a 60-100 word paragraph developing the module theme with examples, context, and cultural notes.
- communicativeFunction: what the student CAN DO after this module (start with "Puedes...").
- tip: DELE/UNED-style strategy tip, memory hook, or cultural insight (2-3 sentences).

Return ONLY valid JSON matching this exact structure (no markdown, no extra text):
{
  "mentorName": "${mentor}",
  "level": "${level}",
  "studentName": "Estudiante",
  "courseTitle": "string — specific, engaging course title in the interface language",
  "objective": "string — 3-4 sentence learning objective explaining practical outcomes",
  "nativeLanguage": "${lang}",
  "totalModules": 5,
  "modules": [
    {
      "index": 1,
      "title": "string — specific module title",
      "vocabulary": [["spanish word or phrase", "translation + usage note"], ...],
      "grammar": "string — 3-5 sentences: rule, exception, memory anchor",
      "exercise": "string — 3-part exercise with instructions for each part",
      "development": "string — 60-100 word paragraph developing the theme with examples",
      "communicativeFunction": "string — starts with Puedes...",
      "tip": "string — 2-3 sentence DELE/UNED tip or cultural insight"
    }
  ],
  "nextStep": "string — specific recommended next step with action",
  "generatedAt": "${now}"
}

CONTENT RULES:
- Exactly 5 modules covering distinct sub-topics of the theme
- Each module must be COMPLETE and SELF-CONTAINED — no placeholders, no "etc."
- vocabulary minimum 8 pairs — no exceptions
- All content CEFR ${level} appropriate
- If the topic is a non-Spanish domain, every module must frame content around SPANISH USE, not domain theory`;

        // SEEK 3.9 — F1: capture LLM/parse errors explicitly and return honest text
        // instead of silently returning {} which causes mentor fallback "No pude generar".
        let courseContent: import('../tools/pdf/generateCoursePdf').CourseContent | null = null;
        let courseGenError: string | null = null;

        try {
          const completion = await openai.chat.completions.create({
            ...buildModelParams(RUNTIME_MODEL, 4500, 0.3),
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: coursePrompt }],
          });
          const raw = completion.choices?.[0]?.message?.content ?? '';
          if (!raw.trim()) {
            courseGenError = 'Model returned empty content for course generation.';
          } else {
            const parsed = JSON.parse(raw) as import('../tools/pdf/generateCoursePdf').CourseContent & {
              modules: Array<import('../tools/pdf/generateCoursePdf').CourseModule & { development?: string }>;
            };
            if (parsed.modules?.length > 0) {
              // SEEK 3.9 — FIX-DENSITY adapter: merge 'development' into exercise
              // so the existing PDF template renders the full content without
              // requiring changes to generateCoursePdf.ts (not in our deploy set).
              parsed.modules = parsed.modules.map(m => ({
                ...m,
                exercise: m.development
                  ? `${m.exercise}\n\nDesarrollo: ${m.development}`
                  : m.exercise,
              }));
              courseContent = parsed;
            } else {
              courseGenError = 'Model returned JSON with no modules.';
            }
          }
        } catch (e) {
          courseGenError = e instanceof Error ? e.message : String(e);
          console.error('[execution-engine] generateCoursePdf: LLM/parse failed:', courseGenError);
        }

        // SEEK 3.9 — F1: if content generation failed, return honest error text.
        // This surfaces in compileResult() as the response message instead of
        // triggering the generic mentor fallback "No pude generar una respuesta".
        if (!courseContent) {
          const lang2 = ctx.state.interfaceLanguage ?? 'en';
          const errorMsgs: Record<string, string> = {
            en: `Could not generate the course for "${topic}" right now. The content engine returned an error. Please try again in a moment.`,
            es: `No se pudo generar el curso sobre "${topic}" en este momento. El motor de contenido devolvió un error. Inténtalo de nuevo en un instante.`,
            no: `Kunne ikke generere kurset om "${topic}" akkurat nå. Innholdsmotoren returnerte en feil. Prøv igjen om et øyeblikk.`,
            it: `Non è stato possibile generare il corso su "${topic}" in questo momento. Riprova tra un istante.`,
            fr: `Impossible de générer le cours sur "${topic}" pour l'instant. Réessaie dans un moment.`,
            de: `Der Kurs zu "${topic}" konnte gerade nicht generiert werden. Bitte versuche es erneut.`,
          };
          console.error(`[execution-engine] generateCoursePdf: aborting — ${courseGenError}`);
          return { text: errorMsgs[lang2] ?? errorMsgs['en'], isUserVisibleError: true };
        }

        const courseTitle = courseContent.courseTitle || `Curso — ${topic}`;
        console.log(`[PDF] generateCoursePdf — courseTitle: ${courseTitle}, modules: ${courseContent.modules.length}`);
        const result = await generatePDF({ title: courseTitle, content: '', courseContent });
        console.log(`[PDF] generateCoursePdf result.success: ${result.success}, method: ${result.method}, url_exists: ${!!result.url}`);
        if (!result.success) {
          console.error(`[PDF] generateCoursePdf error: ${result.error} — ${result.message}`);
          // SEEK 3.9 — F1: PDF render failure also surfaces honestly.
          const lang2 = ctx.state.interfaceLanguage ?? 'en';
          const pdfErrorMsgs: Record<string, string> = {
            en: `The course content was generated but the PDF could not be rendered. Error: ${result.error ?? 'unknown'}. Please try again.`,
            es: `El contenido del curso se generó pero el PDF no pudo renderizarse. Error: ${result.error ?? 'desconocido'}. Inténtalo de nuevo.`,
            no: `Kursinnholdet ble generert, men PDF-en kunne ikke gjengis. Feil: ${result.error ?? 'ukjent'}. Prøv igjen.`,
          };
          return { text: pdfErrorMsgs[lang2] ?? pdfErrorMsgs['en'], isUserVisibleError: true };
        }
        const artifact = { type: 'course_pdf' as const, title: courseTitle, url: result.url, modules: courseContent.modules.map(m => m.title) };
        return { artifact };
      }

      const result = await generatePDF({ title, content: ctx.request.message });
      const artifact = result.success
        ? { type: 'pdf' as const, title, url: result.url, dataUrl: result.url }
        : undefined;
      return { artifact };
    }

    // ── Image generator ──────────────────────────────────────────────────────
    case 'tool_image': {
      const { generateImage } = await import('../tools/image-generator');
      const prompt = priorText || ctx.request.message;
      const result = await generateImage(prompt);
      if (result?.success && result.url) {
        return { artifact: {
          type: 'illustration' as const, prompt, url: result.url,
          caption: result.message ?? undefined,
        }};
      }
      return {};
    }

    // ── Audio toolkit ────────────────────────────────────────────────────────
    case 'tool_audio': {

      if (step.action === 'generateTTS') {
        const { generateSpeech } = await import('../tools/audio-toolkit');
        const mentorPriorText = Array.from(ctx.priorResults.values())
          .filter(r => r.executor === 'mentor' && r.text)
          .sort((a, b) => b.stepOrder - a.stepOrder)[0]?.text;
        const textToSpeak = (mentorPriorText ?? priorText)?.trim() || ctx.request.message?.trim();
        if (!textToSpeak) return {};
        const MENTOR_VOICES: Record<string, string> = {
          sarah: 'shimmer',
          alex:  'fable',
          nick:  'onyx',
        };
        const mentorKey = (ctx.state.mentorProfile ?? 'alex').toLowerCase();
        const ttsVoice  = MENTOR_VOICES[mentorKey] ?? 'fable';
        const result = await generateSpeech(textToSpeak, { voice: ttsVoice });
        if (result?.success && result.url) {
          return { artifact: { type: 'audio' as const, dataUrl: result.url } };
        }
        return {};
      }

      const { transcribeAudio } = await import('../tools/audio-toolkit');
      const audioData = ctx.request.audioDataUrl
        ? { data: ctx.request.audioDataUrl.split(',')[1] || ctx.request.audioDataUrl, format: ctx.request.audioMimeType?.split('/')[1] || 'webm' }
        : null;

      if (!audioData && ctx.request.files?.length) {
        const audioFile = ctx.request.files.find(
          f => f.type?.startsWith('audio/') || f.type === 'video/webm',
        );
        if (audioFile) {
          const raw = audioFile.base64
            ?? (audioFile.dataUrl ? audioFile.dataUrl.split(',')[1] ?? audioFile.dataUrl : '');
          const result = await transcribeAudio({ data: raw, format: audioFile.type?.split('/')[1] || 'webm' });
          return { text: result.success ? result.text : undefined };
        }
      }

      if (!audioData) return {};
      const result = await transcribeAudio(audioData);
      const transcriptText = result.success ? result.text : undefined;
      return {
        text: transcriptText,
        patch: transcriptText
          ? { lastUserAudioTranscript: transcriptText }
          : undefined,
      };
    }

    // ── Attachment processor ─────────────────────────────────────────────────
    case 'tool_attachment': {
      const { processAttachment } = await import('../tools/attachment-processor');
      const filesToProcess = (ctx.request.files ?? []).map(f => ({
        name: f.name, type: f.type, size: f.size,
        data: f.base64 ?? (f.dataUrl ? f.dataUrl.split(',')[1] ?? f.dataUrl : ''),
      }));
      const result = await processAttachment(
        filesToProcess, ctx.state as unknown as Record<string, unknown>,
      );
      const text = result?.extractedTexts?.[0] ?? undefined;
      return { text };
    }

    case 'tool_storage': return {};

    case 'knowledge': {
      const { getRagContext } = await import('../knowledge/rag');
      const result = await getRagContext(ctx.request.message);
      return { text: result?.text ?? undefined };
    }

    case 'diagnostic': {
      const { evaluateLevel } = await import('./diagnostics');
      const sampleCount = (ctx.state.diagnosticSamples ?? 0) + 1;
      const samples = [
        ctx.request.message,
        ...(ctx.state.lastConcept  ? [ctx.state.lastConcept]  : []),
        ...(ctx.state.lastUserGoal ? [ctx.state.lastUserGoal] : []),
        ...(ctx.state.lastMistake  ? [ctx.state.lastMistake]  : []),
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

    case 'commercial': return {};

    default: {
      console.warn(`[execution-engine] unknown executor: "${step.executor}" in step ${step.order}. Skipping.`);
      return {};
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULT COMPILER
// ─────────────────────────────────────────────────────────────────────────────

interface CompiledResult {
  message: string;
  artifact?: ArtifactPayload;
  suggestedActions: SuggestedAction[];
  statePatch: StatePatch;
}

function compileResult(plan: ExecutionPlan, ctx: StepContext, stepResults: ExecutionStepResult[]): CompiledResult {
  const outputs = Array.from(ctx.priorResults.values());

  const textParts = outputs
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map(o => o.text)
    .filter((t): t is string => !!t && t.trim() !== '');

  // SEEK 3.9 — FIX-PDF-MSG: artifact must be resolved BEFORE message so the
  // success-message branch can reference artifact.type without forward-reference error.
  // IS-flagged build risk: original code used artifact before declaration — fixed here.
  const toolArtifact   = outputs.find(o => o.artifact && o.executor !== 'mentor')?.artifact;
  const mentorArtifact = outputs.find(o => o.artifact && o.executor === 'mentor')?.artifact;
  const artifact       = toolArtifact ?? mentorArtifact;

  // Now that artifact is resolved, compute message with full context.
  // When a blocking hard-override produced an artifact but no mentor text,
  // textParts is empty and the old code fell through to buildFallbackMessage —
  // the user saw an error even though the PDF was generated successfully.
  const lang = ctx.state.interfaceLanguage ?? 'en';
  let message: string;
  if (textParts.length > 0) {
    message = textParts.join('\n\n');
  } else if (artifact && plan.blocking && plan.priority >= 100) {
    // Blocking hard-override produced an artifact — communicate success, not error
    message = buildArtifactSuccessMessage(artifact.type, lang);
  } else {
    message = buildFallbackMessage(plan, lang);
  }

  const statePatch: StatePatch = outputs.reduce(
    (acc, o) => (o.patch ? { ...acc, ...o.patch } : acc),
    {} as StatePatch,
  );

  statePatch.tokens = (ctx.state.tokens ?? 0) + 1;

  const resolvedTopic = plan.resolvedTopic?.trim();
  if (resolvedTopic && resolvedTopic !== 'Spanish grammar') {
    statePatch.lastConcept = resolvedTopic;
  }

  if (plan.priority >= 100) {
    (statePatch as StatePatch).requestedOperation = null;
  }

  if (!plan.skipPhaseAdvance && ctx.state.activeMode === 'structured') {
    statePatch.tutorPhase = advanceTutorPhase(ctx.state.tutorPhase, ctx.state.activeMode);
  }

  // SEEK 3.9 — F3: detect error state. If all non-mentor steps failed to produce
  // an artifact and the message came from an error text path, suppress contextually
  // irrelevant suggested actions. An honest error message must not arrive with
  // buttons that imply the operation succeeded.
  // SEEK 3.9 — F3 FINAL: use explicit isUserVisibleError flag, not !o.success.
  // success:false means the step threw internally — different from an honest error message.
  const hasErrorText = outputs.some(o => o.isUserVisibleError === true && o.text);
  const suggestedActions = buildSuggestedActions(plan, artifact, ctx.state, hasErrorText);
  return { message, artifact, suggestedActions, statePatch };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTED ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

function buildSuggestedActions(
  plan: ExecutionPlan,
  artifact: ArtifactPayload | undefined,
  state: SessionState,
  hasErrorText = false,
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];

  // SEEK 3.9 — F3: when the response is an honest error (no artifact, error text present),
  // only offer a retry action. Do not suggest export, schema, or quiz — they are not
  // contextually valid when the requested operation failed.
  // SEEK 3.9 — F3 FINAL: honest error with no artifact → no suggested actions.
  // Offering export_chat_pdf after a course generation failure is semantically wrong.
  // The user received an error message, not content worth exporting or acting on.
  if (hasErrorText && !artifact) {
    return [];
  }

  if (artifact) {
    if (artifact.type === 'quiz')                                      actions.push({ type: 'start_quiz',      label: getLabel('start_quiz',      state.interfaceLanguage) });
    if (artifact.type === 'schema' || artifact.type === 'schema_pro') actions.push({ type: 'export_chat_pdf', label: getLabel('export_chat_pdf', state.interfaceLanguage) });
    if (artifact.type === 'roadmap')                                   actions.push({ type: 'start_course',    label: getLabel('start_course',    state.interfaceLanguage) });
  }
  if (plan.pedagogicalAction === 'feedback' && state.activeMode === 'structured') actions.push({ type: 'next_module', label: getLabel('next_module', state.interfaceLanguage) });
  if (plan.pedagogicalAction === 'lesson')                             actions.push({ type: 'show_schema',     label: getLabel('show_schema',     state.interfaceLanguage) });
  actions.push({ type: 'export_chat_pdf', label: getLabel('export_chat_pdf', state.interfaceLanguage) });
  return actions.filter((a, i, arr) => arr.findIndex(b => b.type === a.type) === i);
}

const LABELS: Record<string, Record<string, string>> = {
  start_quiz:      { en: 'Start quiz',      es: 'Empezar quiz',       no: 'Start quiz' },
  export_chat_pdf: { en: 'Export as PDF',   es: 'Exportar a PDF',     no: 'Eksporter som PDF' },
  next_module:     { en: 'Next module',     es: 'Siguiente modulo',   no: 'Neste modul' },
  start_course:    { en: 'Start course',    es: 'Empezar curso',      no: 'Start kurs' },
  show_schema:     { en: 'Show schema',     es: 'Ver esquema',        no: 'Vis skjema' },
  retry_quiz:      { en: 'Try again',       es: 'Intentar de nuevo',  no: 'Proev igjen' },
};

function getLabel(type: SuggestedActionType, lang: string): string {
  return LABELS[type]?.[lang] ?? LABELS[type]?.['en'] ?? type;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function collectPriorText(results: Map<number, StepOutput>, currentOrder: number): string {
  return Array.from(results.values())
    .filter(r => r.stepOrder < currentOrder && r.text)
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map(r => r.text!)
    .join('\n\n');
}

function buildDegradedStep(step: ExecutionStep, reason: string, durationMs: number = 0): StepOutput {
  return { stepOrder: step.order, executor: step.executor, durationMs, success: false, error: reason };
}

function toStepResult(output: StepOutput, plan: ExecutionPlan): ExecutionStepResult {
  return {
    stepOrder: output.stepOrder,
    executor: output.executor,
    action: plan.executionOrder.find(s => s.order === output.stepOrder)?.action ?? 'unknown',
    durationMs: output.durationMs,
    success: output.success,
    error: output.error,
    producedArtifacts: output.artifact ? [output.artifact.type] : [],
  };
}

// SEEK 3.9 — FIX-PDF-MSG: success message when blocking tool produced artifact.
// Called when textParts is empty but artifact exists — avoids false error feedback.
function buildArtifactSuccessMessage(artifactType: string, lang: string): string {
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
    pdf: {
      en: 'Your PDF is ready.',
      es: 'Tu PDF está listo.',
      no: 'PDF-en din er klar.',
    },
  };
  return msgs[artifactType]?.[lang]
    ?? msgs[artifactType]?.['en']
    ?? 'PDF ready.';
}

// SEEK 3.9 — buildFallbackMessage is only reached when ALL steps produced no text.
// Course PDF errors are now returned as text from the step itself (F1), so this
// generic fallback should rarely fire in practice.
function buildFallbackMessage(plan: ExecutionPlan, lang: string): string {
  const fallbacks: Record<string, string> = {
    en: "I wasn't able to generate a response right now — please try again in a moment.",
    es: "No pude generar una respuesta en este momento. Por favor, intentalo de nuevo en un instante.",
    no: "Jeg kunne ikke generere et svar akkurat na. Proev igjen om et oyeblikk.",
    it: "Non ho potuto generare una risposta in questo momento. Riprova tra un attimo.",
    fr: "Je n'ai pas pu generer une reponse pour l'instant. Reessaie dans un moment.",
  };
  return fallbacks[lang] ?? fallbacks['en'];
}

