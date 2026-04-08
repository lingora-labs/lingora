// =============================================================================
// server/core/execution-engine.ts
// LINGORA SEEK 4.1b — Execution Engine (ArtifactRegistryEntry from contracts, package_session, no placebo)
// =============================================================================
// SEEK 3.9 base  : F1 (honest PDF errors), F2 (fallback messages), F3 (header).
// SEEK 3.9-b     : LW1 (elastic prompt 5-8 modules), LW2 (topic sovereignty rule).
// SEEK 3.9-c     : Operación Liberen a Willy — completar soberanía temática real.
//
//   LW3 — DOMAIN TERMINOLOGY ENFORCEMENT
//         Requires ≥3 real domain terms per module with Spanish usage sentences.
//         LW2 declared sovereignty; LW3 makes it executable. Without mandatory
//         domain lexicon, GPT-5.x defaulted to safe generic A1 Spanish.
//         Doctrinal basis: Art. 8 Manifiesto 7.0 — valor útil, no simulación.
//
//   LW4 — POST-GENERATION DOMAIN VALIDATOR
//         After JSON generation, lightweight check: module titles must reference
//         the domain (not generic "Introduction / Vocabulary"). If all titles are
//         generic, surfaces honest error instead of delivering dressed-up generic.
//         Doctrinal basis: Art. 16 Manifiesto 7.0 — prohibición de ficción func.
//
//   LW5 — MANDATORY DOMAIN MODULE TITLES
//         JSON schema example shows domain-specific titles, not free-form strings.
//         Guides LLM to scaffold real domain content from the start.
//
//   C5  — Pre-generation timestamp log [PDF:START] / [PDF:DONE] (Vercel forensics).
//   C6  — PDF density: full-page per module instruction in prompt.
//
// Approved: IS + CSJ — 5 de abril de 2026
// Sprint: SEEK 3.9-c · Operación Liberen a Willy
// =============================================================================
// SEEK 3.9 base changes: F1 (honest PDF errors), F2 (fallback messages), F3 (header).
// SEEK 3.9-b changes: LW1 (elastic prompt), LW2 (topic sovereignty rule).
// SEEK 3.9-c CHANGES:
//   C5 — generateCoursePdf: pre-generation timestamp log. Vercel truncates log
//        streams when serverless functions run long (>10s). The existing
//        result.success log often doesn't reach Vercel because it fires after
//        the LLM call. Adding a [PDF:START] log with wall-clock timestamp
//        before the OpenAI call allows forensic reconstruction of what happened
//        even when the result log is missing.
//   C6 — coursePrompt layout instruction: LLM is instructed to generate
//        content that fills each module fully (no one-topic-per-page sparsity).
//        Modules should produce content dense enough to occupy a full PDF page.
//        The PDF template renders modules sequentially — richer content = better
//        page utilization. No template change required.
//
// Approved by: IS + CSJ — consensus 5 de abril de 2026
// Sprint: SEEK 3.9-c · Operación Liberen a Willy (continuation)
// Files changed: execution-engine.ts, execution-engine-stream.ts,
//                schema-generator.ts, page.tsx
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
  ArtifactRegistryEntry,
} from '../../lib/contracts';

import { advanceTutorPhase } from './state-manager';
import { buildModelParams } from '../mentors/mentor-engine';

// Single model source of truth — change via OPENAI_MAIN_MODEL env var.
// Supports: gpt-4o-mini, gpt-5.4-nano, gpt-5.4-mini (no code changes needed).
const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';

// SEEK 4.1b — ArtifactRegistryEntry imported from contracts.ts (canonical location)

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
      // Shared level for schema/table/quiz tools — standard session-based resolution
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

      // SEEK 4.1b — package_session: honest response (exportSessionStudyPdf arrives in SEEK 4.2)
      if (step.action === 'packageSession') {
        const lang = ctx.state.interfaceLanguage ?? 'en';
        const artifactCount = ctx.state.artifactRegistry?.length ?? 0;
        const msgs: Record<string, string> = {
          en: artifactCount > 0
            ? `Your session has ${artifactCount} saved material${artifactCount > 1 ? 's' : ''} (${ctx.state.artifactRegistry!.map(a => a.title).join(', ')}). Full session study PDF — including all tables, schemas and exercises — will be available in the next version.`
            : 'No materials have been generated in this session yet. Generate a schema, table or exercise first, then you can package the session.',
          es: artifactCount > 0
            ? `Tu sesión tiene ${artifactCount} material${artifactCount > 1 ? 'es' : ''} guardado${artifactCount > 1 ? 's' : ''} (${ctx.state.artifactRegistry!.map(a => a.title).join(', ')}). El PDF de estudio completo de sesión — incluyendo tablas, esquemas y ejercicios — estará disponible en la próxima versión.`
            : 'No se han generado materiales en esta sesión todavía. Genera un esquema, tabla o ejercicio primero.',
          no: artifactCount > 0
            ? `Økten din har ${artifactCount} lagret materiale. Fullstendig studié-PDF for økten kommer i neste versjon.`
            : 'Ingen materialer er generert i denne økten ennå.',
        };
        return { text: msgs[lang] ?? msgs['en'] };
      }

      if (step.action === 'exportArtifact') {
        const lang = ctx.state.interfaceLanguage ?? 'en';
        const msgs: Record<string, string> = {
          en: 'Individual artifact export buttons are coming in the next version. For now, you can export the full conversation PDF.',
          es: 'Los botones de exportación individual por artifact llegarán en la próxima versión. Por ahora, puedes exportar el PDF completo de la conversación.',
          no: 'Individuelle eksportknapper for artifacts kommer i neste versjon.',
        };
        return { text: msgs[lang] ?? msgs['en'] };
      }

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

        // SEEK 4.1a — include artifacts from session registry in export
        const sessionArtifacts = (ctx.state as unknown as { artifactRegistry?: ArtifactRegistryEntry[] }).artifactRegistry ?? [];
        const artifactSection = sessionArtifacts.length > 0
          ? [
              '',
              '══════════════════════════════════════════',
              '   MATERIALES GENERADOS EN SESION',
              '══════════════════════════════════════════',
              ...sessionArtifacts.map((a, i) =>
                `${i + 1}. [${a.type.toUpperCase()}] ${a.title}`
              ),
              '',
            ].join('\n')
          : '';

        const content = header + formattedLines + artifactSection + footer;
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
        // SEEK 3.9-d — C2: parse explicit level from request before session default
        // Bug: PDF cover showed A1 even when user requested B1-B2 or universitario
        const parseLevelFromRequest = (msg: string): string | undefined => {
          const up = (msg ?? '').toUpperCase();
          const cm = up.match(/\b(A0|A1|A2|B1|B2|C1|C2)\b/);
          if (cm) return cm[1];
          const rm = up.match(/\b([A-C][0-2])[-\u2013]([A-C][0-2])\b/);
          if (rm) return `${rm[1]}-${rm[2]}`;
          if (/UNIVERSITARIO/.test(up)) return 'Universitario';
          if (/PROFESIONAL/.test(up))  return 'Profesional';
          if (/EXPERTO/.test(up))      return 'C2';
          if (/AVANZADO/.test(up))     return 'C1-C2';
          if (/INTERMEDIO/.test(up))   return 'B1-B2';
          if (/BÁSICO|BASICO|ELEMENTAL/.test(up)) return 'A1-A2';
          return undefined;
        };
        const reqLevel = parseLevelFromRequest(ctx.request.message ?? '');
        const sessLevel = ctx.state.confirmedLevel ?? ctx.state.userLevel;
        // Never silently default to A1 — use General when nothing explicit is known
        const level = reqLevel ?? (sessLevel !== 'A1' ? sessLevel ?? 'General' : 'General');
        const lang     = ctx.state.interfaceLanguage ?? 'en';
        const mentor   = ctx.state.mentorProfile ?? 'Sarah';
        const now      = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

        // SEEK 3.9 — FIX-DENSITY: topic thematic isolation.
        // If topic is a non-Spanish domain (acupuncture, medicine, law, business, etc.)
        // The model reads the prompt and decides what type of course to produce.
        // The course title and modules must reflect: "Spanish for [domain]", not "[domain] theory".

        // SEEK 3.9-c — LIBEREN A WILLY: Free-reasoning course prompt.
        // CEO decision: the LLM already knows what acupuncture practitioners,
        // lawyers, chefs, architects, etc. use in Spanish. Adding minimum term
        // counts and WRONG/RIGHT examples is changing the cage, not removing it.
        // DeepSeek produced a sovereign TCM course with 16 seconds of free
        // reasoning and NO hardcoded rules. LINGORA must do the same.
        // The post-generation validator (LW4) stays in CODE — it only rejects
        // structurally empty output; it does not constrain the reasoning path.
        // Doctrinal basis: Art. 3 Manifiesto 7.0 — identidad no reduccionista.
        // "Ninguna implementación podrá reducir su identidad a un sistema de
        //  respuestas mecánicas." Mechanical rules = mechanical responses.
        // SEEK 3.9-c — CLEAN TOPIC: strip user directives from the topic string.
        // When topic = resolvedTopic from orchestrator, it often contains the full
        // user message: "acupuntura china... No acepto resumenes. Quiero nivel
        // universitario". Those user directives (no acepto, quiero, nivel) are not
        // the subject — they're format requests that confuse the JSON contract.
        // Clean: extract up to first sentence-ending directive marker.
        const cleanTopic = topic
          .replace(/\.\s*(no acepto|quiero|debe|sin resumen|nivel universitario|carrera|no puede ser|nivel profesional|con indice|con guia|con desarrollo).*/i, '')
          .replace(/,\s*(no acepto|quiero|debe|sin resumen|nivel universitario|carrera).*/i, '')
          .trim()
          || topic; // fallback to original if nothing matched

        // SEEK 3.9-c — SYSTEM/USER SPLIT for JSON generation.
        // GPT-5.4-mini does NOT have a thinking phase like DeepSeek. DeepSeek
        // reasoned for 16s before generating; GPT-5.4-mini responds directly.
        // To replicate DeepSeek's behavior (plan then generate), we give GPT the
        // structural contract via system message and the creative task via user.
        // This produces more reliable JSON than a single mixed-role message.
        // SEEK 4.0 — DocumentBlock[] contract
        // CEO + IS + CSJ consensus 6 de abril de 2026:
        // "Un contrato abstracto. Un renderer neutro. Un solo camino. El LLM decide la estructura."
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
  "documentType": "string (e.g. curriculo, guia clinica, curso de idioma, dossier academico)",
  "level": "${level}",
  "mentorName": "${mentor}",
  "nativeLanguage": "${lang}",
  "studentName": "Estudiante",
  "blocks": [
    {"type":"heading","level":1,"content":"Section title"},
    {"type":"paragraph","content":"Prose text..."},
    {"type":"key_value","label":"Terminology","items":["term: definition and usage sentence"]},
    {"type":"table","headers":["Col A","Col B","Col C"],"rows":[["a1","b1","c1"]]},
    {"type":"callout","label":"Nota clinica","style":"tip","content":"Important note..."},
    {"type":"bullets","items":["item one","item two"]},
    {"type":"exercise","label":"Practica","content":"Exercise instructions..."},
    {"type":"divider"}
  ],
  "nextStep": "string",
  "generatedAt": "${now}"
}`;

        // SEEK 3.9-c — C5: Pre-generation timestamp log.
        // Vercel truncates log streams when functions run >10s. The result.success
        // log fires after the OpenAI call and often never reaches Vercel.
        // This START log fires before the call — if it appears in Vercel logs
        // but result.success does not, the bottleneck is confirmed as LLM latency.
        const pdfGenStart = Date.now();
        console.log(`[PDF:START] generateCoursePdf — topic: "${topic}", level: ${level}, model: ${RUNTIME_MODEL}, t=${pdfGenStart}`);

        // SEEK 3.9-c — C5: wrap the full LLM call to log duration regardless of outcome
        let courseContent: import('../tools/pdf/generateCoursePdf').CourseContent | null = null;
        let courseGenError: string | null = null;

        try {
          // SEEK 3.9-c: system+user split for reliable JSON generation.
          // max_tokens raised from 4500 to 6000 for complex professional domains.
          // temperature 0.7 gives the model freedom to reason about structure
          // while response_format: json_object enforces the JSON contract.
          const completion = await openai.chat.completions.create({
            ...buildModelParams(RUNTIME_MODEL, 6000, 0.7),
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: courseSystemPrompt },
              { role: 'user',   content: courseUserPrompt   },
            ],
          });
          const raw = completion.choices?.[0]?.message?.content ?? '';
          if (!raw.trim()) {
            courseGenError = 'Model returned empty content for course generation.';
          } else {
            // SEEK 4.0 — TYPE-SAFE: deserialize DocumentContent with DocumentBlock[].
            // The LLM now returns blocks[] instead of modules[]. The normalizer
            // validates block structure and falls back gracefully on malformed entries.
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const rawBlocks = Array.isArray(parsed.blocks)
              ? parsed.blocks as Array<Record<string, unknown>>
              : [];

            const VALID_BLOCK_TYPES = new Set([
              'heading', 'paragraph', 'bullets', 'numbered', 'table',
              'callout', 'quote', 'divider', 'key_value', 'exercise', 'summary',
              'answer_key', 'case', 'timeline', 'comparison', 'framework', 'glossary', 'index',
            ]);

            if (rawBlocks.length > 0) {
              const normalizedBlocks = rawBlocks.map((b) => {
                const type = typeof b.type === 'string' && VALID_BLOCK_TYPES.has(b.type)
                  ? b.type as import('../tools/pdf/generateCoursePdf').DocumentBlockType
                  : 'paragraph' as const;
                return {
                  type,
                  level:   typeof b.level === 'number'    ? b.level as 1|2|3    : undefined,
                  content: typeof b.content === 'string'  ? b.content           : undefined,
                  label:   typeof b.label === 'string'    ? b.label             : undefined,
                  style:   typeof b.style === 'string'    ? b.style as 'info'|'warning'|'exercise'|'quote'|'tip' : undefined,
                  items:   Array.isArray(b.items)         ? (b.items as string[]).map(String) : undefined,
                  headers: Array.isArray(b.headers)       ? (b.headers as string[]).map(String) : undefined,
                  rows:    Array.isArray(b.rows)          ? (b.rows    as string[][])               : undefined,
                  events:  Array.isArray(b.events)        ? (b.events  as Array<Record<string, string>>) : undefined,
                  steps:   Array.isArray(b.steps)         ? (b.steps   as Array<Record<string, string>>) : undefined,
                  terms:   Array.isArray(b.terms)         ? (b.terms   as Array<Record<string, string>>) : undefined,
                  answers: Array.isArray(b.answers)       ? (b.answers as unknown[]).map(String)          : undefined,
                };
              });
              courseContent = {
                title:         typeof parsed.title        === 'string' ? parsed.title        : `Documento — ${cleanTopic}`,
                subtitle:      typeof parsed.subtitle     === 'string' ? parsed.subtitle     : undefined,
                documentType:  typeof parsed.documentType === 'string' ? parsed.documentType : 'documento',
                epistemicNature: typeof parsed.epistemicNature === 'string'
                  ? parsed.epistemicNature as import('../tools/pdf/generateCoursePdf').EpistemicNature
                  : undefined,
                level:         typeof parsed.level        === 'string' ? parsed.level        : level,
                mentorName:    typeof parsed.mentorName   === 'string' ? parsed.mentorName   : mentor,
                nativeLanguage:typeof parsed.nativeLanguage === 'string' ? parsed.nativeLanguage : lang,
                studentName:   typeof parsed.studentName  === 'string' ? parsed.studentName  : 'Estudiante',
                blocks:        normalizedBlocks,
                nextStep:      typeof parsed.nextStep     === 'string' ? parsed.nextStep     : '',
                generatedAt:   typeof parsed.generatedAt  === 'string' ? parsed.generatedAt  : now,
              } as import('../tools/pdf/generateCoursePdf').DocumentContent;
            } else {
              courseGenError = 'Model returned JSON with no blocks.';
            }
          }
        } catch (e) {
          courseGenError = e instanceof Error ? e.message : String(e);
          console.error('[execution-engine] generateCoursePdf: LLM/parse failed:', courseGenError);
        }

        // SEEK 3.9-c — C5: log duration for Vercel forensics regardless of outcome
        console.log(`[PDF:DONE] generateCoursePdf — success: ${!!courseContent}, blocks: ${(courseContent as import('../tools/pdf/generateCoursePdf').DocumentContent)?.blocks?.length ?? 0}, durationMs: ${Date.now() - pdfGenStart}`);

        // SEEK 4.0 — LW4: POST-GENERATION VALIDATOR (adapted for DocumentBlock[])
        // Validates that the document has meaningful content (not empty or trivial).
        // No longer checks for "domain vocabulary" — the LLM now decides block types.
        // Minimal check: at least 2 blocks, at least one heading or paragraph with content.
        if (courseContent) {
          const docBlocks = (courseContent as import('../tools/pdf/generateCoursePdf').DocumentContent).blocks ?? [];
          const hasContent = docBlocks.length >= 2 &&
            docBlocks.some(b => (b.type === 'heading' || b.type === 'paragraph') && b.content);

          if (!hasContent) {
            console.error(`[PDF] LW4 FAILED — document has ${docBlocks.length} blocks — topic: "${cleanTopic}"`);
            const lang2 = ctx.state.interfaceLanguage ?? 'en';
            const validationErrorMsgs: Record<string, string> = {
              en: `The document for "${cleanTopic}" did not generate sufficient content.`,
              es: `El documento sobre "${cleanTopic}" no generó contenido suficiente.`,
              no: `Dokumentet om "${cleanTopic}" genererte ikke nok innhold. Prøv en annen formulering.`,
              it: `Il documento su "${cleanTopic}" non ha generato contenuto sufficiente. Riprova.`,
              fr: `Le document sur "${cleanTopic}" n'a pas généré suffisamment de contenu. Réessaie.`,
              de: `Das Dokument zu "${cleanTopic}" hat nicht genug Inhalt generiert. Bitte erneut versuchen.`,
            };
            return { text: validationErrorMsgs[lang2] ?? validationErrorMsgs['en'], isUserVisibleError: true };
          }
          const docType = (courseContent as import('../tools/pdf/generateCoursePdf').DocumentContent).documentType ?? 'unknown';
          console.log(`[PDF] LW4 PASSED — ${docBlocks.length} blocks, documentType: ${docType}`);
        }
        // SEEK 3.9 — F1: if content generation failed, return honest error text.
        // This surfaces in compileResult() as the response message instead of
        // triggering the generic mentor fallback "No pude generar una respuesta".
        if (!courseContent) {
          const lang2 = ctx.state.interfaceLanguage ?? 'en';
          const errorMsgs: Record<string, string> = {
            en: `Could not generate the course for "${topic}" right now. The content engine returned an error. Check the topic formulation or try a shorter request.`,
            es: `No se pudo generar el curso sobre "${topic}" en este momento. El motor de contenido devolvió un error. Revisa la formulación del tema o intenta una solicitud más corta.`,
            no: `Kunne ikke generere kurset om "${topic}" akkurat nå. Innholdsmotoren returnerte en feil. Prøv en annen formulering av emnet.`,
            it: `Non è stato possibile generare il corso su "${topic}" in questo momento. Riprova tra un istante.`,
            fr: `Impossible de générer le cours sur "${topic}" pour l'instant. Réessaie dans un moment.`,
            de: `Der Kurs zu "${topic}" konnte gerade nicht generiert werden. Bitte versuche es erneut.`,
          };
          console.error(`[execution-engine] generateCoursePdf: aborting — ${courseGenError}`);
          return { text: errorMsgs[lang2] ?? errorMsgs['en'], isUserVisibleError: true };
        }

        const docC = courseContent as import('../tools/pdf/generateCoursePdf').DocumentContent;
        const courseTitle = docC.title || `Documento — ${cleanTopic}`;
        console.log(`[PDF] generateCoursePdf — courseTitle: ${courseTitle}, blocks: ${(courseContent as import('../tools/pdf/generateCoursePdf').DocumentContent).blocks?.length ?? 0}`);
        const result = await generatePDF({ title: courseTitle, content: '', courseContent });
        console.log(`[PDF] generateCoursePdf result.success: ${result.success}, method: ${result.method}, url_exists: ${!!result.url}`);
        if (!result.success) {
          console.error(`[PDF] generateCoursePdf error: ${result.error} — ${result.message}`);
          // SEEK 3.9 — F1: PDF render failure also surfaces honestly.
          const lang2 = ctx.state.interfaceLanguage ?? 'en';
          const pdfErrorMsgs: Record<string, string> = {
            en: `The course content was generated but the PDF could not be rendered. Error: ${result.error ?? 'unknown'}.`,
            es: `El contenido del curso se generó pero el PDF no pudo renderizarse. Error: ${result.error ?? 'desconocido'}.`,
            no: `Kursinnholdet ble generert, men PDF-en kunne ikke gjengis. Feil: ${result.error ?? 'ukjent'}. Prøv en annen formulering.`,
          };
          return { text: pdfErrorMsgs[lang2] ?? pdfErrorMsgs['en'], isUserVisibleError: true };
        }
        // SEEK 4.0: artifact uses block headings as navigation index
          const docContent = courseContent as import('../tools/pdf/generateCoursePdf').DocumentContent;
          const headings = (docContent.blocks ?? [])
            .filter(b => b.type === 'heading' && b.level === 1 && b.content)
            .map(b => b.content as string);
          const artifact = { type: 'course_pdf' as const, title: courseTitle, url: result.url, modules: headings };
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

function compileResult(plan: ExecutionPlan, ctx: StepContext, _stepResults: ExecutionStepResult[]): CompiledResult {
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

  // SEEK 4.1a — register artifact in session artifact memory
  // PERSISTENCE NOTE: artifactRegistry survives between turns because
  // mergeStatePatch (state-manager.ts) performs {...state, ...patch} spread,
  // which preserves all patch fields including non-declared ones.
  // artifactRegistry is written as a patch field and returned to the client
  // in updatedState — the client sends it back in the next request.
  if (artifact && artifact.type !== 'pdf_chat') {
    const existing = ((ctx.state as unknown as { artifactRegistry?: ArtifactRegistryEntry[] }).artifactRegistry ?? []);
    const entry: ArtifactRegistryEntry = {
      id:          `${artifact.type}-${Date.now()}`,
      type:        artifact.type,
      title:       (artifact as unknown as { title?: string }).title ?? artifact.type,
      generatedAt: Date.now(),
      payload:     artifact,
    };
    (statePatch as unknown as { artifactRegistry: ArtifactRegistryEntry[] }).artifactRegistry =
      [...existing, entry].slice(-20); // keep last 20 artifacts max
  }

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
function buildFallbackMessage(_plan: ExecutionPlan, _lang: string): string {
  // SEEK 4.1b — no placebo. Return empty string; UI handles empty gracefully.
  return '';
}
