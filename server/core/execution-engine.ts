// =============================================================================
// server/core/execution-engine.ts
// LINGORA SEEK 4.0 — Execution Engine (DocumentBlock[] full transport)
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

const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';

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
  if (state.lastConcept?.trim()) return state.lastConcept;
  if (state.lastUserGoal?.trim()) return state.lastUserGoal;
  if (state.curriculumPlan?.topic) return state.curriculumPlan.topic;
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
  isUserVisibleError?: boolean;
}

interface DispatchOutput {
  text?: string;
  artifact?: ArtifactPayload;
  patch?: StatePatch;
  isUserVisibleError?: boolean;
}

interface CompiledResult {
  message: string;
  artifact?: ArtifactPayload;
  suggestedActions: SuggestedAction[];
  statePatch: StatePatch;
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
      isUserVisibleError: output.isUserVisibleError,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[execution-engine] step ${step.order} (${step.executor}:${step.action}) failed: ${errorMessage}`);
    return buildDegradedStep(step, errorMessage, Date.now() - start);
  }
}

async function dispatchToExecutor(step: ExecutionStep, ctx: StepContext): Promise<DispatchOutput> {
  const priorText = collectPriorText(ctx.priorResults, step.order);

  switch (step.executor) {
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
              type: 'pronunciation_report',
              score: typeof parsed.score === 'number' ? parsed.score : 70,
              feedback: parsed.feedback ?? parsed.tip ?? text.replace(/\{[\s\S]*?\}/, '').trim(),
              tip: parsed.tip ?? parsed.suggestion ?? '',
              errors: Array.isArray(parsed.errors) ? parsed.errors : [],
            };
            return { text: artifact.feedback, artifact };
          }
        } catch {}
      }

      return { text };
    }

    case 'tool_schema': {
      const { generateSchemaContent } = await import('../tools/schema-generator');
      const { adaptSchemaToArtifact } = await import('../tools/schema-adapter');

      const topic = ctx.plan.resolvedTopic || resolveSchemaTopicFromState(ctx.request.message, ctx.state, priorText);
      const level = ctx.state.confirmedLevel ?? ctx.state.userLevel ?? 'B1';
      const uiLanguage = ctx.state.interfaceLanguage ?? 'en';
      const topicPatch = topic && topic !== 'Spanish grammar' ? { lastConcept: topic } : undefined;

      switch (step.action) {
        case 'generateSchema': {
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          return { artifact: adaptSchemaToArtifact(data, ctx.state.confirmedLevel ?? ctx.state.userLevel), patch: topicPatch };
        }

        case 'generateSchemaPro': {
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          const blocks: import('../../lib/contracts').SchemaProBlockItem[] = [];
          if (data.keyConcepts?.length) blocks.push({ type: 'bullets', title: 'Conceptos clave', items: data.keyConcepts });
          for (const sub of (data.subtopics ?? [])) {
            blocks.push({ type: 'concept', title: sub.title, body: sub.keyTakeaway ? `${sub.content}\n→ ${sub.keyTakeaway}` : sub.content });
          }
          if (data.tableRows?.length) blocks.push({ type: 'table', columns: ['Forma', 'Valor'], rows: data.tableRows.map(r => [r.left, r.right]) });
          if (data.summary) blocks.push({ type: 'highlight', tone: 'ok', label: 'Regla 80/20', text: data.summary });
          const artifact: import('../../lib/contracts').SchemaProArtifact = {
            type: 'schema_pro',
            title: data.title,
            subtitle: data.objective,
            level: ctx.state.confirmedLevel ?? ctx.state.userLevel,
            blocks,
          };
          return { artifact };
        }

        case 'generateQuiz': {
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          if (data.quiz?.length) {
            const artifact: import('../../lib/contracts').QuizArtifact = {
              type: 'quiz',
              title: data.title,
              questions: data.quiz.map(q => ({
                question: q.question,
                options: q.options.map((opt, i) => ({ text: opt, correct: i === q.correct })),
              })),
            };
            return { artifact };
          }
          return {};
        }

        case 'generateTable': {
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          if (data.tableRows?.length) {
            const artifact: import('../../lib/contracts').TableArtifact = {
              type: 'table',
              title: data.title,
              columns: ['', ''],
              rows: data.tableRows.map(row => [row.left, row.right]),
            };
            return { artifact };
          }
          return {};
        }

        case 'generateTableMatrix': {
          const { generateTableMatrixRich } = await import('../tools/schema-generator');
          const richArtifact = await generateTableMatrixRich({ topic, level, uiLanguage });
          if (richArtifact) return { artifact: richArtifact, patch: topicPatch };
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          if (data.tableRows?.length) {
            const artifact: import('../../lib/contracts').TableMatrixArtifact = {
              type: 'table_matrix',
              title: data.title,
              columns: ['Concepto', 'Valor'],
              rows: data.tableRows.map(row => [{ value: row.left, tone: 'neutral' as const }, { value: row.right }]),
            };
            return { artifact };
          }
          return {};
        }

        case 'buildRoadmapArtifact': {
          if (!ctx.state.curriculumPlan) {
            const topicFallback = resolveSchemaTopicFromState(ctx.request.message, ctx.state, '') || topic;
            const fallbackModules = [
              { index: 0, title: 'Diagnóstico de nivel', focus: 'Evaluación inicial', completed: false, current: true },
              { index: 1, title: `Fundamentos: ${topicFallback}`, focus: 'Conceptos clave', completed: false, current: false },
              { index: 2, title: 'Práctica guiada', focus: 'Ejercicios aplicados', completed: false, current: false },
              { index: 3, title: 'Errores frecuentes', focus: 'Corrección', completed: false, current: false },
              { index: 4, title: 'Simulacro final', focus: 'Evaluación de dominio', completed: false, current: false },
            ];
            const artifact: import('../../lib/contracts').RoadmapBlock = {
              type: 'roadmap',
              title: topicFallback,
              modules: fallbackModules,
            };
            return { artifact };
          }

          const artifact: import('../../lib/contracts').RoadmapBlock = {
            type: 'roadmap',
            title: ctx.state.curriculumPlan.topic,
            modules: ctx.state.curriculumPlan.modules.map(m => ({
              index: m.index,
              title: m.title,
              focus: m.focus,
              completed: !!(ctx.state.masteryByModule[m.index]?.passed),
              current: m.index === (ctx.state.currentModuleIndex ?? 0),
            })),
          };
          return { artifact };
        }

        default:
          console.error(`[execution-engine] tool_schema: unsupported action "${step.action}"`);
          return {};
      }
    }

    case 'tool_pdf': {
      const { generatePDF } = await import('../tools/pdf-generator');
      const title = ctx.state.lastConcept ?? 'LINGORA Study Guide';
      console.log(`[PDF] step.action: ${step.action}`);

      if (step.action === 'exportChatPdf') {
        const rawTranscript = ctx.request.exportTranscript || ctx.request.message || '';
        const now = new Date();
        const dateStr = now.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
        const mentorName = (ctx.state.mentorProfile ?? 'Alex').charAt(0).toUpperCase() + (ctx.state.mentorProfile ?? 'Alex').slice(1);
        const levelStr = ctx.state.confirmedLevel ?? ctx.state.userLevel ?? 'N/A';
        const tokensStr = String(ctx.state.tokens ?? 0);

        const lines = rawTranscript.split('\n').filter(Boolean);
        const formattedLines = lines.map((line: string) => {
          if (line.startsWith('[Student]:') || line.startsWith('[USER]:')) return line.replace(/^\[(?:Student|USER)\]:/, '▶ Estudiante:');
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
        if (!result.success) console.error(`[PDF] exportChatPdf error: ${result.error} — ${result.message}`);
        const messageCount = rawTranscript ? rawTranscript.split('\n').filter(Boolean).length : 0;
        const artifact = result.success ? { type: 'pdf_chat' as const, url: result.url, messageCount } : undefined;
        return { artifact };
      }

      if (step.action === 'generateCoursePdf') {
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const topic = ctx.plan.resolvedTopic
          || ctx.state.currentLessonTopic?.trim()
          || (ctx.state.lastConcept?.trim() && ctx.state.lastConcept !== 'Spanish grammar' ? ctx.state.lastConcept : null)
          || resolveSchemaTopicFromState(ctx.request.message, ctx.state, '');

        const parseLevelFromRequest = (msg: string): string | undefined => {
          const up = (msg ?? '').toUpperCase();
          const cm = up.match(/\b(A0|A1|A2|B1|B2|C1|C2)\b/);
          if (cm) return cm[1];
          const rm = up.match(/\b([A-C][0-2])[-\u2013]([A-C][0-2])\b/);
          if (rm) return `${rm[1]}-${rm[2]}`;
          if (/UNIVERSITARIO/.test(up)) return 'Universitario';
          if (/PROFESIONAL/.test(up)) return 'Profesional';
          if (/EXPERTO/.test(up)) return 'C2';
          if (/AVANZADO/.test(up)) return 'C1-C2';
          if (/INTERMEDIO/.test(up)) return 'B1-B2';
          if (/BÁSICO|BASICO|ELEMENTAL/.test(up)) return 'A1-A2';
          return undefined;
        };

        const reqLevel = parseLevelFromRequest(ctx.request.message ?? '');
        const sessLevel = ctx.state.confirmedLevel ?? ctx.state.userLevel;
        const level = reqLevel ?? (sessLevel !== 'A1' ? sessLevel ?? 'General' : 'General');
        const lang = ctx.state.interfaceLanguage ?? 'en';
        const mentor = ctx.state.mentorProfile ?? 'Sarah';
        const now = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

        const cleanTopic = topic
          .replace(/\.\s*(no acepto|quiero|debe|sin resumen|nivel universitario|carrera|no puede ser|nivel profesional|con indice|con guia|con desarrollo).*/i, '')
          .replace(/,\s*(no acepto|quiero|debe|sin resumen|nivel universitario|carrera).*/i, '')
          .trim() || topic;

        const courseSystemPrompt = `You are a world-class document composer. You always respond with valid JSON only — no markdown, no preamble, no explanation. Think carefully about the nature of the request before deciding the document structure.`;

        const courseUserPrompt = `Compose a complete, high-quality document about "${cleanTopic}".
Audience language: ${lang}. Mentor voice: ${mentor}. Reference level: ${level}.

STEP 1 — THINK (internally, before writing):
What type of intellectual object does this request require?
(curriculum, clinical guide, language course, dossier, academic overview, grammar reference, etc.)
What is the appropriate depth? Who is the likely reader?
What sections are NECESSARY for this topic to be useful?

STEP 2 — COMPOSE:
Build the document using the block types that best serve the topic.
Use headings, paragraphs, tables, key_value pairs, callouts, exercises, bullets — whatever the content needs.
If it is a language course: teach the language with appropriate linguistic blocks.
If it is a professional or academic domain: teach that domain with appropriate conceptual blocks.
Do NOT force vocabulary/grammar/exercise onto non-linguistic content.
Do NOT force clinical/academic structure onto simple language exercises.

Return ONLY this JSON:
{
  "title": "string",
  "subtitle": "string or null",
  "documentType": "string",
  "epistemicNature": "language_course | domain_theoretical | domain_practical | reference_guide | exam_preparation | professional_training | cultural_guide | mixed",
  "level": "${level}",
  "mentorName": "${mentor}",
  "nativeLanguage": "${lang}",
  "studentName": "Estudiante",
  "blocks": [
    {"type":"heading","level":1,"content":"Section title"},
    {"type":"paragraph","content":"Prose text"},
    {"type":"timeline","label":"Timeline","events":[{"date":"...","event":"..."}]},
    {"type":"framework","label":"Framework","steps":[{"name":"...","description":"..."}]},
    {"type":"glossary","terms":[{"term":"...","definition":"..."}]},
    {"type":"answer_key","answers":["..."]},
    {"type":"table","headers":["A","B"],"rows":[["a","b"]]}
  ],
  "nextStep": "string",
  "generatedAt": "${now}"
}`;

        const pdfGenStart = Date.now();
        console.log(`[PDF:START] generateCoursePdf — topic: "${topic}", level: ${level}, model: ${RUNTIME_MODEL}, t=${pdfGenStart}`);

        let courseContent: import('../tools/pdf/generateCoursePdf').DocumentContent | null = null;
        let courseGenError: string | null = null;

        try {
          const completion = await openai.chat.completions.create({
            ...buildModelParams(RUNTIME_MODEL, 6000, 0.7),
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: courseSystemPrompt },
              { role: 'user', content: courseUserPrompt },
            ],
          });

          const raw = completion.choices?.[0]?.message?.content ?? '';
          if (!raw.trim()) {
            courseGenError = 'Model returned empty content for course generation.';
          } else {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const rawBlocks = Array.isArray(parsed.blocks) ? parsed.blocks as Array<Record<string, unknown>> : [];

            const VALID_BLOCK_TYPES = new Set([
              'heading', 'paragraph', 'bullets', 'numbered', 'table',
              'callout', 'quote', 'divider', 'key_value', 'exercise', 'summary',
              'answer_key', 'case', 'timeline', 'comparison', 'framework', 'glossary', 'index',
            ]);

            if (rawBlocks.length > 0) {
              const normalizedBlocks = rawBlocks.map((b) => ({
                type: typeof b.type === 'string' && VALID_BLOCK_TYPES.has(b.type)
                  ? b.type as import('../tools/pdf/generateCoursePdf').DocumentBlockType
                  : 'paragraph' as const,
                level: typeof b.level === 'number' ? b.level as 1 | 2 | 3 : undefined,
                content: typeof b.content === 'string' ? b.content : undefined,
                label: typeof b.label === 'string' ? b.label : undefined,
                style: typeof b.style === 'string'
                  ? b.style as 'info' | 'warning' | 'exercise' | 'quote' | 'tip'
                  : undefined,
                items: Array.isArray(b.items) ? (b.items as unknown[]).map(String) : undefined,
                headers: Array.isArray(b.headers) ? (b.headers as unknown[]).map(String) : undefined,
                rows: Array.isArray(b.rows) ? (b.rows as string[][]) : undefined,
                events: Array.isArray(b.events) ? (b.events as Array<Record<string, string>>) : undefined,
                steps: Array.isArray(b.steps) ? (b.steps as Array<Record<string, string>>) : undefined,
                terms: Array.isArray(b.terms) ? (b.terms as Array<Record<string, string>>) : undefined,
                answers: Array.isArray(b.answers) ? (b.answers as unknown[]).map(String) : undefined,
              }));

              courseContent = {
                title: typeof parsed.title === 'string' ? parsed.title : `Documento — ${cleanTopic}`,
                subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : undefined,
                documentType: typeof parsed.documentType === 'string' ? parsed.documentType : 'documento',
                epistemicNature: typeof parsed.epistemicNature === 'string'
                  ? parsed.epistemicNature as import('../tools/pdf/generateCoursePdf').EpistemicNature
                  : undefined,
                level: typeof parsed.level === 'string' ? parsed.level : level,
                mentorName: typeof parsed.mentorName === 'string' ? parsed.mentorName : mentor,
                nativeLanguage: typeof parsed.nativeLanguage === 'string' ? parsed.nativeLanguage : lang,
                studentName: typeof parsed.studentName === 'string' ? parsed.studentName : 'Estudiante',
                blocks: normalizedBlocks,
                nextStep: typeof parsed.nextStep === 'string' ? parsed.nextStep : '',
                generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : now,
              };
            } else {
              courseGenError = 'Model returned JSON with no blocks.';
            }
          }
        } catch (e) {
          courseGenError = e instanceof Error ? e.message : String(e);
          console.error('[execution-engine] generateCoursePdf: LLM/parse failed:', courseGenError);
        }

        console.log(`[PDF:DONE] generateCoursePdf — success: ${!!courseContent}, blocks: ${courseContent?.blocks?.length ?? 0}, durationMs: ${Date.now() - pdfGenStart}`);

        if (courseContent) {
          const docBlocks = courseContent.blocks ?? [];
          const hasContent = docBlocks.length >= 2 && docBlocks.some(b => (b.type === 'heading' || b.type === 'paragraph') && b.content);
          if (!hasContent) {
            const validationErrorMsgs: Record<string, string> = {
              en: `The document for "${cleanTopic}" did not generate sufficient content. Please try again.`,
              es: `El documento sobre "${cleanTopic}" no generó contenido suficiente. Inténtalo de nuevo.`,
              no: `Dokumentet om "${cleanTopic}" genererte ikke nok innhold. Prøv igjen.`,
            };
            return { text: validationErrorMsgs[lang] ?? validationErrorMsgs['en'], isUserVisibleError: true };
          }
        }

        if (!courseContent) {
          const errorMsgs: Record<string, string> = {
            en: `Could not generate the course for "${topic}" right now. The content engine returned an error. Please try again in a moment.`,
            es: `No se pudo generar el curso sobre "${topic}" en este momento. El motor de contenido devolvió un error. Inténtalo de nuevo en un instante.`,
            no: `Kunne ikke generere kurset om "${topic}" akkurat nå. Innholdsmotoren returnerte en feil. Prøv igjen om et øyeblikk.`,
          };
          console.error(`[execution-engine] generateCoursePdf: aborting — ${courseGenError}`);
          return { text: errorMsgs[lang] ?? errorMsgs['en'], isUserVisibleError: true };
        }

        const courseTitle = courseContent.title || `Documento — ${cleanTopic}`;
        const result = await generatePDF({ title: courseTitle, content: '', courseContent });

        if (!result.success) {
          const pdfErrorMsgs: Record<string, string> = {
            en: `The course content was generated but the PDF could not be rendered. Error: ${result.error ?? 'unknown'}. Please try again.`,
            es: `El contenido del curso se generó pero el PDF no pudo renderizarse. Error: ${result.error ?? 'desconocido'}. Inténtalo de nuevo.`,
            no: `Kursinnholdet ble generert, men PDF-en kunne ikke gjengis. Feil: ${result.error ?? 'ukjent'}. Prøv igjen.`,
          };
          return { text: pdfErrorMsgs[lang] ?? pdfErrorMsgs['en'], isUserVisibleError: true };
        }

        const headings = (courseContent.blocks ?? [])
          .filter(b => b.type === 'heading' && b.level === 1 && b.content)
          .map(b => b.content as string);

        const artifact = {
          type: 'course_pdf' as const,
          title: courseTitle,
          url: result.url,
          modules: headings,
        };

        return { artifact };
      }

      const result = await generatePDF({ title, content: ctx.request.message });
      const artifact = result.success ? { type: 'pdf' as const, title, url: result.url, dataUrl: result.url } : undefined;
      return { artifact };
    }

    case 'tool_image': {
      const { generateImage } = await import('../tools/image-generator');
      const prompt = priorText || ctx.request.message;
      const result = await generateImage(prompt);
      if (result?.success && result.url) {
        return { artifact: { type: 'illustration' as const, prompt, url: result.url, caption: result.message ?? undefined } };
      }
      return {};
    }

    case 'tool_audio': {
      if (step.action === 'generateTTS') {
        const { generateSpeech } = await import('../tools/audio-toolkit');
        const mentorPriorText = Array.from(ctx.priorResults.values())
          .filter(r => r.executor === 'mentor' && r.text)
          .sort((a, b) => b.stepOrder - a.stepOrder)[0]?.text;
        const textToSpeak = (mentorPriorText ?? priorText)?.trim() || ctx.request.message?.trim();
        if (!textToSpeak) return {};
        const MENTOR_VOICES: Record<string, string> = { sarah: 'shimmer', alex: 'fable', nick: 'onyx' };
        const mentorKey = (ctx.state.mentorProfile ?? 'alex').toLowerCase();
        const ttsVoice = MENTOR_VOICES[mentorKey] ?? 'fable';
        const result = await generateSpeech(textToSpeak, { voice: ttsVoice });
        if (result?.success && result.url) {
          return { artifact: { type: 'audio' as const, dataUrl: result.url } };
        }
        return {};
      }

      const { transcribeAudio } = await import('../tools/audio-toolkit');
      let audioData: { data: string; format: string } | null = null;

      if (ctx.request.audioDataUrl) {
        audioData = {
          data: ctx.request.audioDataUrl.split(',')[1] || ctx.request.audioDataUrl,
          format: ctx.request.audioMimeType?.split('/')[1] || 'webm',
        };
      } else if (ctx.request.files?.length) {
        const audioFile = ctx.request.files.find(f => f.type?.startsWith('audio/') || f.type === 'video/webm');
        if (audioFile) {
          const raw = audioFile.base64 ?? (audioFile.dataUrl ? audioFile.dataUrl.split(',')[1] ?? audioFile.dataUrl : '');
          audioData = { data: raw, format: audioFile.type?.split('/')[1] || 'webm' };
        }
      }

      if (!audioData) return {};
      const result = await transcribeAudio(audioData);
      const transcriptText = result.success ? result.text : undefined;
      return { text: transcriptText, patch: transcriptText ? { lastUserAudioTranscript: transcriptText } : undefined };
    }

    case 'tool_attachment': {
      const { processAttachment } = await import('../tools/attachment-processor');
      const filesToProcess = (ctx.request.files ?? []).map(f => ({
        name: f.name,
        type: f.type,
        size: f.size,
        data: f.base64 ?? (f.dataUrl ? f.dataUrl.split(',')[1] ?? f.dataUrl : ''),
      }));
      const result = await processAttachment(filesToProcess, ctx.state as unknown as Record<string, unknown>);
      const text = result?.extractedTexts?.[0] ?? undefined;
      return { text };
    }

    case 'tool_storage':
      return {};

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
        ...(ctx.state.lastConcept ? [ctx.state.lastConcept] : []),
        ...(ctx.state.lastUserGoal ? [ctx.state.lastUserGoal] : []),
        ...(ctx.state.lastMistake ? [ctx.state.lastMistake] : []),
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

    case 'commercial':
      return {};

    default:
      console.warn(`[execution-engine] unknown executor: "${step.executor}" in step ${step.order}. Skipping.`);
      return {};
  }
}

function compileResult(plan: ExecutionPlan, ctx: StepContext, _stepResults: ExecutionStepResult[]): CompiledResult {
  const outputs = Array.from(ctx.priorResults.values());
  const textParts = outputs.sort((a, b) => a.stepOrder - b.stepOrder).map(o => o.text).filter((t): t is string => !!t && t.trim() !== '');

  const toolArtifact = outputs.find(o => o.artifact && o.executor !== 'mentor')?.artifact;
  const mentorArtifact = outputs.find(o => o.artifact && o.executor === 'mentor')?.artifact;
  const artifact = toolArtifact ?? mentorArtifact;

  const lang = ctx.state.interfaceLanguage ?? 'en';
  let message: string;
  if (textParts.length > 0) {
    message = textParts.join('\n\n');
  } else if (artifact && plan.blocking && plan.priority >= 100) {
    message = buildArtifactSuccessMessage(artifact.type, lang);
  } else {
    message = buildFallbackMessage(plan, lang);
  }

  const statePatch: StatePatch = outputs.reduce((acc, o) => (o.patch ? { ...acc, ...o.patch } : acc), {} as StatePatch);
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

  const hasErrorText = outputs.some(o => o.isUserVisibleError === true && o.text);
  const suggestedActions = buildSuggestedActions(plan, artifact, ctx.state, hasErrorText);
  return { message, artifact, suggestedActions, statePatch };
}

function buildSuggestedActions(
  plan: ExecutionPlan,
  artifact: ArtifactPayload | undefined,
  state: SessionState,
  hasErrorText = false,
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  if (hasErrorText && !artifact) return [];

  if (artifact) {
    if (artifact.type === 'quiz') actions.push({ type: 'start_quiz', label: getLabel('start_quiz', state.interfaceLanguage) });
    if (artifact.type === 'schema' || artifact.type === 'schema_pro') actions.push({ type: 'export_chat_pdf', label: getLabel('export_chat_pdf', state.interfaceLanguage) });
    if (artifact.type === 'roadmap') actions.push({ type: 'start_course', label: getLabel('start_course', state.interfaceLanguage) });
  }

  if (plan.pedagogicalAction === 'feedback' && state.activeMode === 'structured') {
    actions.push({ type: 'next_module', label: getLabel('next_module', state.interfaceLanguage) });
  }
  if (plan.pedagogicalAction === 'lesson') {
    actions.push({ type: 'show_schema', label: getLabel('show_schema', state.interfaceLanguage) });
  }
  actions.push({ type: 'export_chat_pdf', label: getLabel('export_chat_pdf', state.interfaceLanguage) });

  return actions.filter((a, i, arr) => arr.findIndex(b => b.type === a.type) === i);
}

const LABELS: Record<string, Record<string, string>> = {
  start_quiz: { en: 'Start quiz', es: 'Empezar quiz', no: 'Start quiz' },
  export_chat_pdf: { en: 'Export as PDF', es: 'Exportar a PDF', no: 'Eksporter som PDF' },
  next_module: { en: 'Next module', es: 'Siguiente modulo', no: 'Neste modul' },
  start_course: { en: 'Start course', es: 'Empezar curso', no: 'Start kurs' },
  show_schema: { en: 'Show schema', es: 'Ver esquema', no: 'Vis skjema' },
  retry_quiz: { en: 'Try again', es: 'Intentar de nuevo', no: 'Proev igjen' },
};

function getLabel(type: SuggestedActionType, lang: string): string {
  return LABELS[type]?.[lang] ?? LABELS[type]?.['en'] ?? type;
}

function collectPriorText(results: Map<number, StepOutput>, currentOrder: number): string {
  return Array.from(results.values())
    .filter(r => r.stepOrder < currentOrder && r.text)
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map(r => r.text!)
    .join('\n\n');
}

function buildDegradedStep(step: ExecutionStep, reason: string, durationMs = 0): StepOutput {
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

function buildArtifactSuccessMessage(artifactType: string, lang: string): string {
  const msgs: Record<string, Record<string, string>> = {
    course_pdf: {
      en: 'Your course PDF is ready. You can download it below.',
      es: 'Tu curso en PDF está listo. Puedes descargarlo a continuación.',
      no: 'Kurset ditt i PDF er klart. Du kan laste det ned nedenfor.',
    },
    pdf_chat: {
      en: 'Conversation exported to PDF. You can download it below.',
      es: 'Conversación exportada a PDF. Puedes descargarla a continuación.',
      no: 'Samtalen er eksportert til PDF. Du kan laste den ned nedenfor.',
    },
    pdf: {
      en: 'Your PDF is ready.',
      es: 'Tu PDF está listo.',
      no: 'PDF-en din er klar.',
    },
  };
  return msgs[artifactType]?.[lang] ?? msgs[artifactType]?.['en'] ?? 'PDF ready.';
}

function buildFallbackMessage(_plan: ExecutionPlan, lang: string): string {
  const fallbacks: Record<string, string> = {
    en: "I wasn't able to generate a response right now — please try again in a moment.",
    es: 'No pude generar una respuesta en este momento. Por favor, intentalo de nuevo en un instante.',
    no: 'Jeg kunne ikke generere et svar akkurat na. Proev igjen om et oyeblikk.',
  };
  return fallbacks[lang] ?? fallbacks['en'];
          }
