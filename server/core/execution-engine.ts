// =============================================================================
// server/core/execution-engine.ts
// LINGORA SEEK 3.8 — Execution Engine
// =============================================================================
// Purpose  : Execute the ExecutionPlan produced by orchestrator.ts.
//            Reads executionOrder. Executes steps in declared order.
//            Resolves dependsOn. Collects results. Returns compiled outputs.
//
//            THIS MODULE:
//            ✅ Reads ExecutionPlan.executionOrder
//            ✅ Executes steps in order (1 → 2 → 3...)
//            ✅ Resolves dependsOn — step N waits for step M
//            ✅ Collects results from execution layers
//            ✅ Returns ExecutionResult (message + artifact + patch)
//            ❌ Does NOT decide what to execute
//            ❌ Does NOT choose executor types
//            ❌ Does NOT modify priority or blocking
//            ❌ Does NOT reinterpret intent
//            ❌ Does NOT generate ad-hoc routing logic
//
//            ARCHITECTURAL RULE:
//            If this engine needs to "decide", the architecture has failed.
//            Any decision logic found here is a bug and must be moved to
//            orchestrator.ts.
//
// Riesgo principal : Step result contamination — a step producing output that
//                    implicitly influences subsequent steps outside the declared
//                    dependsOn chain. All inter-step data must flow through
//                    StepContext.priorResults explicitly.
//
// Dependencias     : lib/contracts.ts
//                    server/mentors/mentor-engine.ts
//                    server/tools/schema-generator.ts
//                    server/tools/pdf-generator.ts
//                    server/tools/image-generator.ts
//                    server/tools/audio-toolkit.ts
//                    server/knowledge/rag.ts
//                    server/core/diagnostics.ts
//
// Commit   : feat(execution-engine): SEEK 3.5 — ordered step execution with
//            dependsOn resolution, no decision logic.
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

// SEEK 3.8 — Single model source of truth.
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

      // SEEK 3.8 — FIX: tool_schema persists lastConcept immediately.
      // compileResult() also writes lastConcept, but that runs AFTER all steps.
      // If the mentor step changes context, the artifact topic would be lost.
      // Writing it here guarantees topic sovereignty for the artifact branch.
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
          console.error('[execution-engine] generateQuiz: no quiz in schema output — returning empty, not wrong artifact');
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
          console.error('[execution-engine] generateTable: no tableRows in output — returning empty, not wrong artifact');
          return {};
        }

        case 'generateTableMatrix': {
          // SEEK 3.4: generateTableMatrixRich produces tone-aware RCell rows for color rendering
          const { generateTableMatrixRich } = await import('../tools/schema-generator');
          const richArtifact = await generateTableMatrixRich({ topic, level, uiLanguage });
          if (richArtifact) return { artifact: richArtifact, patch: topicPatch };
          // Fallback to basic schema if rich fails
          const data = await generateSchemaContent({ topic, level, uiLanguage });
          if (data.tableRows?.length) {
            const artifact: import('../../lib/contracts').TableMatrixArtifact = {
              type: 'table_matrix', title: data.title,
              columns: ['Concepto', 'Valor'],
              rows: data.tableRows.map(row => [{ value: row.left, tone: 'neutral' as const }, { value: row.right }]),
            };
            return { artifact };
          }
          console.error('[execution-engine] generateTableMatrix: no tableRows in output — returning empty, not wrong artifact');
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
          console.error(`[execution-engine] tool_schema: unsupported action "${step.action}" — no artifact produced`);
          return {};
        }
      }
    }

    // ── PDF generator ────────────────────────────────────────────────────────
    case 'tool_pdf': {
      const { generatePDF } = await import('../tools/pdf-generator');
      const title = ctx.state.lastConcept ?? 'LINGORA Study Guide';
      // SEEK 3.5 — observable logging for Vercel diagnosis
      console.log(`[PDF] step.action: ${step.action}`);
      console.log(`[PDF] title: ${title}`);

      if (step.action === 'exportChatPdf') {
        // G6a — SEEK 3.3: structured PDF with UNED-style format
        const rawTranscript = ctx.request.exportTranscript || ctx.request.message || '';
        const now = new Date();
        const dateStr = now.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
        const mentorName = (ctx.state.mentorProfile ?? 'Alex').charAt(0).toUpperCase() +
                           (ctx.state.mentorProfile ?? 'Alex').slice(1);
        // IS fix H2: use userLevel, not level
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

        // IS fix H1: clean template literals (no backslash escaping)
        const header = [
          '══════════════════════════════════════════',
          '   LINGORA — HISTORIAL DE SESIÓN',
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
          'LINGORA · AI Cultural Immersion Platform for Spanish',
          'Learn → Connect → Experience',
          `Exportado el ${dateStr}`,
        ].join('\n');

        const content = header + formattedLines + footer;
        const result = await generatePDF({ title: `LINGORA · Sesión · ${dateStr}`, content });
        console.log(`[PDF] exportChatPdf result.success: ${result.success}, method: ${result.method}, url_exists: ${!!result.url}`);
        if (!result.success) console.error(`[PDF] exportChatPdf error: ${result.error} — ${result.message}`);

        // IS fix H3: include messageCount in pdf_chat artifact
        const messageCount = rawTranscript
          ? rawTranscript.split('\n').filter(Boolean).length
          : 0;

        const artifact = result.success
          ? { type: 'pdf_chat' as const, url: result.url, messageCount }
          : undefined;

        return { artifact };
      }

      if (step.action === 'generateCoursePdf') {
        // P2 — SEEK 3.4 FINAL: LLM produces CourseContent JSON directly.
        // No intermediate text → parser step. One LLM call → typed object → professional template.
        // Matches the exact CourseContent / CourseModule interfaces in generateCoursePdf.ts.
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const topic    = ctx.plan.resolvedTopic
          || resolveSchemaTopicFromState(ctx.request.message, ctx.state, '');
        const level    = ctx.state.confirmedLevel ?? ctx.state.userLevel ?? 'A1';
        const lang     = ctx.state.interfaceLanguage ?? 'en';
        const mentor   = ctx.state.mentorProfile ?? 'Sarah';
        const now      = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

        const coursePrompt = `You are LINGORA's course generator. Produce a complete Spanish course as valid JSON.
Topic: "${topic}". Level: ${level}. Interface language: ${lang}. Mentor: ${mentor}.

Return ONLY valid JSON matching this exact structure (no markdown, no extra text):
{
  "mentorName": "${mentor}",
  "level": "${level}",
  "studentName": "Estudiante",
  "courseTitle": "string — course title in the student's language",
  "objective": "string — 2-3 sentence learning objective",
  "nativeLanguage": "${lang}",
  "totalModules": 5,
  "modules": [
    {
      "index": 1,
      "title": "string",
      "vocabulary": [["spanish word", "translation/definition"], ...],
      "grammar": "string — the 80/20 core grammar rule in one sentence",
      "exercise": "string — one production exercise the student completes",
      "communicativeFunction": "string — what the student CAN DO after this module",
      "tip": "string — one practical tip, cultural note, or DELE strategy"
    }
  ],
  "nextStep": "string — recommended next step after completing this course",
  "generatedAt": "${now}"
}

Requirements:
- Exactly 5 modules, each addressing a distinct sub-topic of "${topic}"
- vocabulary: 4-6 pairs per module, level-appropriate
- grammar: one actionable rule, not an abstract definition
- exercise: a concrete sentence or task the student produces
- All content pedagogically appropriate for CEFR ${level}`;

        let courseContent: import('../tools/pdf/generateCoursePdf').CourseContent | null = null;
        try {
          const completion = await openai.chat.completions.create({
            ...buildModelParams(RUNTIME_MODEL, 3000, 0.3),
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: coursePrompt }],
          });
          const raw = completion.choices?.[0]?.message?.content ?? '';
          const parsed = JSON.parse(raw) as import('../tools/pdf/generateCoursePdf').CourseContent;
          if (parsed.modules?.length > 0) courseContent = parsed;
        } catch (e) {
          console.error('[execution-engine] generateCoursePdf: JSON parse failed:', e);
        }

        if (!courseContent) {
          console.error('[execution-engine] generateCoursePdf: no courseContent — aborting');
          return {};
        }

        const courseTitle = courseContent.courseTitle || `Curso — ${topic}`;
        console.log(`[PDF] generateCoursePdf — courseTitle: ${courseTitle}, modules: ${courseContent.modules.length}`);
        const result = await generatePDF({ title: courseTitle, content: '', courseContent });
        console.log(`[PDF] generateCoursePdf result.success: ${result.success}, method: ${result.method}, url_exists: ${!!result.url}`);
        if (!result.success) console.error(`[PDF] generateCoursePdf error: ${result.error} — ${result.message}`);
        const artifact = result.success
          ? { type: 'course_pdf' as const, title: courseTitle, url: result.url, modules: courseContent.modules.map(m => m.title) }
          : undefined;
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
        // G2 — SEEK 3.3: map mentor identity to correct OpenAI voice
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

      // Default: transcribe audio input
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
      // G5 — SEEK 3.3: persist transcript so subsequent turns don't lose it
      const transcriptText = result.success ? result.text : undefined;
      // IS fix H4: use patch (not statePatch) — DispatchOutput contract
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

    // ── Storage ───────────────────────────────────────────────────────────────
    case 'tool_storage': {
      return {};
    }

    // ── Knowledge / RAG ───────────────────────────────────────────────────────
    case 'knowledge': {
      const { getRagContext } = await import('../knowledge/rag');
      const result = await getRagContext(ctx.request.message);
      return { text: result?.text ?? undefined };
    }

    // ── Diagnostics ───────────────────────────────────────────────────────────
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

    // ── Commercial ────────────────────────────────────────────────────────────
    case 'commercial': {
      return {};
    }

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

  const message = textParts.join('\n\n') || buildFallbackMessage(plan, ctx.state.interfaceLanguage);

  const toolArtifact   = outputs.find(o => o.artifact && o.executor !== 'mentor')?.artifact;
  const mentorArtifact = outputs.find(o => o.artifact && o.executor === 'mentor')?.artifact;
  const artifact       = toolArtifact ?? mentorArtifact;

  const statePatch: StatePatch = outputs.reduce(
    (acc, o) => (o.patch ? { ...acc, ...o.patch } : acc),
    {} as StatePatch,
  );

  statePatch.tokens = (ctx.state.tokens ?? 0) + 1;

  // SEEK 3.7 — FIX: Persist the resolved topic back to state every turn.
  // This is the missing link: resolveCurrentTopic reads lastConcept but nothing
  // was ever WRITING it. Without this, topic continuity is impossible across turns.
  // Only persist if resolvedTopic is a real topic (not the fallback default).
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

  const suggestedActions = buildSuggestedActions(plan, artifact, ctx.state);
  return { message, artifact, suggestedActions, statePatch };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTED ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

function buildSuggestedActions(plan: ExecutionPlan, artifact: ArtifactPayload | undefined, state: SessionState): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
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
  next_module:     { en: 'Next module',     es: 'Siguiente módulo',   no: 'Neste modul' },
  start_course:    { en: 'Start course',    es: 'Empezar curso',      no: 'Start kurs' },
  show_schema:     { en: 'Show schema',     es: 'Ver esquema',        no: 'Vis skjema' },
  retry_quiz:      { en: 'Try again',       es: 'Intentar de nuevo',  no: 'Prøv igjen' },
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

function buildFallbackMessage(plan: ExecutionPlan, lang: string): string {
  // SEEK 3.8 — Dignified fallback: never leave user with a generic placeholder.
  // If the system couldn't respond, say something honest and useful.
  const fallbacks: Record<string, string> = {
    en: "I wasn't able to generate a response right now — please try again in a moment.",
    es: "No pude generar una respuesta en este momento. Por favor, inténtalo de nuevo en un instante.",
    no: "Jeg kunne ikke generere et svar akkurat nå. Prøv igjen om et øyeblikk.",
    it: "Non ho potuto generare una risposta in questo momento. Riprova tra un attimo.",
    fr: "Je n'ai pas pu générer une réponse pour l'instant. Réessaie dans un moment.",
  };
  return fallbacks[lang] ?? fallbacks['en'];
}
