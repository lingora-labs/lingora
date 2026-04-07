   // =============================================================================
// server/core/execution-engine-stream.ts
// LINGORA SEEK 4.1a — Streaming Execution Engine (artifact memory registry parity)
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

import { advanceTutorPhase, mergeStatePatch } from './state-manager';
import { evaluateCommercial } from './commercial-engine-adapter';
import { buildModelParams } from '../mentors/mentor-engine';

const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';

// SEEK 4.1a — Artifact Memory Registry (stream parity)
interface ArtifactRegistryEntry {
  type:        string;
  title:       string;
  generatedAt: number;
  summary?:    string;
}

interface SSEDelta { delta: string; }
interface SSEDone {
  done: true;
  state: SessionState;
  artifact?: ArtifactPayload;
  suggestedActions?: SuggestedAction[];
}
type SSEPayload = SSEDelta | SSEDone;

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

interface SyncOut {
  text?: string;
  artifact?: ArtifactPayload;
  patch?: StatePatch;
  isUserVisibleError?: boolean;
}

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
        const orderedSteps = [...plan.executionOrder].sort((a, b) => a.order - b.order);

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

          if (step.executor === 'mentor') {
            const start = Date.now();
            try {
              const { getMentorResponseStream, getMentorResponse } = await import('../mentors/mentor-engine');

              if (typeof getMentorResponseStream === 'function') {
                const stream = await getMentorResponseStream({
                  request,
                  state,
                  plan,
                  priorContext: priorText,
                  action: step.action,
                });
                let fullText = '';
                for await (const delta of stream) {
                  fullText += delta;
                  emit({ delta });
                }
                priorResults.set(step.order, {
                  stepOrder: step.order,
                  executor: 'mentor',
                  text: fullText,
                  durationMs: Date.now() - start,
                  success: true,
                });
              } else {
                const fullText = await getMentorResponse({
                  request,
                  state,
                  plan,
                  priorContext: priorText,
                  action: step.action,
                });
                emit({ delta: fullText });
                priorResults.set(step.order, {
                  stepOrder: step.order,
                  executor: 'mentor',
                  text: fullText,
                  durationMs: Date.now() - start,
                  success: true,
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
                stepOrder: step.order,
                executor: 'mentor',
                text: degradedMsg,
                durationMs: Date.now() - start,
                success: false,
              });
            }
          } else {
            const output = await executeSyncStep(plan, step, request, state, priorText);
            priorResults.set(step.order, output);
            if (output.isUserVisibleError && output.text) emit({ delta: output.text });
          }
        }

        const statePatch = buildStatePatch(plan, state, priorResults);
        const updatedState = mergeStatePatch(state, statePatch);

        const outputs = Array.from(priorResults.values());
        const artifact =
          outputs.find(o => o.artifact && o.executor !== 'mentor')?.artifact
          ?? outputs.find(o => o.artifact && o.executor === 'mentor')?.artifact;

        const hasErrorText = outputs.some(o => o.isUserVisibleError === true && o.text);
        const suggestedActions = buildSuggestedActions(plan, artifact, updatedState, hasErrorText);

        const noTextEmitted = Array.from(priorResults.values()).every(o => !o.text || o.isUserVisibleError);
        if (artifact && plan.blocking && (plan.priority ?? 0) >= 100 && noTextEmitted) {
          const lang = state.interfaceLanguage ?? 'en';
          emit({ delta: buildStreamArtifactSuccessMessage(artifact.type, lang) });
        }

        if (!plan.blocking) {
          const commercial = await evaluateCommercial(updatedState, plan);
          if (commercial.triggered && commercial.message) {
            emit({ delta: `\n\n${commercial.message}` });
          }
        }

        const donePayload: SSEDone = {
          done: true,
          state: updatedState,
          ...(artifact && { artifact }),
          ...(suggestedActions.length > 0 && { suggestedActions }),
        };
        emit(donePayload);
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Stream error';
        console.error('[stream] fatal:', msg);
        emit({
          done: true,
          state: mergeStatePatch(state, { tokens: (state.tokens ?? 0) + 1 }),
        });
        controller.close();
      }
    },
  });
}

function buildStatePatch(
  plan: ExecutionPlan,
  state: SessionState,
  priorResults: Map<number, StepOutput>,
): StatePatch {
  const outputs = Array.from(priorResults.values());
  const patch: StatePatch = outputs.reduce((acc, o) => (o.patch ? { ...acc, ...o.patch } : acc), {} as StatePatch);

  patch.tokens = (state.tokens ?? 0) + 1;

  // SEEK 4.1a — register artifact in session artifact memory (stream parity)
  const streamArtifact = Array.from(priorResults.values())
    .find(o => o.artifact && o.artifact.type !== 'pdf_chat')?.artifact;
  if (streamArtifact) {
    const existingS = ((state as unknown as { artifactRegistry?: ArtifactRegistryEntry[] }).artifactRegistry ?? []);
    const entryS: ArtifactRegistryEntry = {
      type:        streamArtifact.type,
      title:       (streamArtifact as unknown as { title?: string }).title ?? streamArtifact.type,
      generatedAt: Date.now(),
    };
    (patch as unknown as { artifactRegistry: ArtifactRegistryEntry[] }).artifactRegistry =
      [...existingS, entryS].slice(-20);
  }

  const resolvedTopic = plan.resolvedTopic?.trim();
  if (resolvedTopic && resolvedTopic !== 'Spanish grammar') {
    patch.lastConcept = resolvedTopic;
  }

  if (plan.priority >= 100) {
    (patch as StatePatch).requestedOperation = null;
  }

  if (!plan.skipPhaseAdvance && state.activeMode === 'structured') {
    patch.tutorPhase = advanceTutorPhase(state.tutorPhase, state.activeMode);
  }

  return patch;
}

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
      stepOrder: step.order,
      executor: step.executor,
      text: out.text,
      artifact: out.artifact,
      patch: out.patch,
      durationMs: Date.now() - start,
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
      const { adaptSchemaToArtifact } = await import('../tools/schema-adapter');

      const topic = plan.resolvedTopic?.trim()
        || (priorContext?.trim() && priorContext.length > 4 ? priorContext : null)
        || request.message;

      const data = await generateSchemaContent({
        topic,
        level: state.confirmedLevel ?? state.userLevel ?? 'B1',
        uiLanguage: state.interfaceLanguage ?? 'en',
      });

      const artifact = adaptSchemaToArtifact(data, state.confirmedLevel ?? state.userLevel);
      const topicPatch = topic && topic !== 'Spanish grammar' ? { lastConcept: topic } : undefined;
      return { artifact, patch: topicPatch };
    }

    case 'tool_pdf': {
      const { generatePDF } = await import('../tools/pdf-generator');
      const title = state.lastConcept ?? 'LINGORA Study Guide';

      if (step.action === 'exportChatPdf') {
        // SEEK 4.1a — identical to sync path for behavioral equivalence (IS parity requirement)
        const rawTranscript = request.exportTranscript || request.message || '';
        const now = new Date();
        const dateStr = now.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
        const mentorName = (state.mentorProfile ?? 'Alex').charAt(0).toUpperCase() +
                           (state.mentorProfile ?? 'Alex').slice(1);
        const levelStr  = state.confirmedLevel ?? state.userLevel ?? 'N/A';
        const tokensStr = String(state.tokens ?? 0);

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

        const sessionArtifacts = (state as unknown as { artifactRegistry?: ArtifactRegistryEntry[] }).artifactRegistry ?? [];
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
        if (!result.success) console.error(`[stream] exportChatPdf error: ${result.error}`);

        const messageCount = rawTranscript ? rawTranscript.split('\n').filter(Boolean).length : 0;

        return {
          artifact: result.success ? { type: 'pdf_chat' as const, url: result.url, messageCount } : undefined,
        };
      }

      if (step.action === 'generateCoursePdf') {
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const topic = plan.resolvedTopic?.trim()
          || state.currentLessonTopic?.trim()
          || (state.lastConcept?.trim() && state.lastConcept !== 'Spanish grammar' ? state.lastConcept : null)
          || priorContext?.trim()
          || request.message?.trim()
          || state.curriculumPlan?.topic
          || 'Espanol general';

        const parseLevelFromRequest = (msg: string): string | undefined => {
          const up = (msg ?? '').toUpperCase();
          const m = up.match(/\b(A0|A1|A2|B1|B2|C1|C2)\b/);
          if (m) return m[1];
          const r = up.match(/\b([A-C][0-2])[-\u2013]([A-C][0-2])\b/);
          if (r) return `${r[1]}-${r[2]}`;
          if (/UNIVERSITARIO/.test(up)) return 'Universitario';
          if (/PROFESIONAL/.test(up)) return 'Profesional';
          if (/EXPERTO/.test(up)) return 'C2';
          if (/AVANZADO/.test(up)) return 'C1-C2';
          if (/INTERMEDIO/.test(up)) return 'B1-B2';
          if (/BÁSICO|BASICO|ELEMENTAL/.test(up)) return 'A1-A2';
          return undefined;
        };

        const reqLvl = parseLevelFromRequest(request.message ?? '');
        const sessLvl = state.confirmedLevel ?? state.userLevel;
        const level = reqLvl ?? (sessLvl !== 'A1' ? sessLvl ?? 'General' : 'General');
        const lang = state.interfaceLanguage ?? 'en';
        const mentor = state.mentorProfile ?? 'Sarah';
        const now = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

        const courseSystemPrompt = `You are a world-class document composer. Respond with valid JSON only. No markdown, no preamble. Think about the nature of the request before deciding document structure.`;

        const coursePrompt = `Compose a complete document about "${topic}".
Language: ${lang}. Mentor: ${mentor}. Level: ${level}.

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
    {"type":"paragraph","content":"Prose"},
    {"type":"timeline","events":[{"date":"...","event":"..."}]},
    {"type":"framework","steps":[{"name":"...","description":"..."}]},
    {"type":"glossary","terms":[{"term":"...","definition":"..."}]},
    {"type":"answer_key","answers":["..."]}
  ],
  "nextStep": "string",
  "generatedAt": "${now}"
}`;

        let courseContent: import('../tools/pdf/generateCoursePdf').DocumentContent | null = null;
        let courseGenError: string | null = null;

        try {
          const completion = await openai.chat.completions.create({
            ...buildModelParams(RUNTIME_MODEL, 6000, 0.7),
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: courseSystemPrompt },
              { role: 'user', content: coursePrompt },
            ],
          });

          const raw = completion.choices?.[0]?.message?.content ?? '';
          if (!raw.trim()) {
            courseGenError = 'Model returned empty content.';
          } else {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const rawBlocks = Array.isArray(parsed.blocks) ? parsed.blocks as Array<Record<string, unknown>> : [];

            const VALID_BT = new Set([
              'heading', 'paragraph', 'bullets', 'numbered', 'table',
              'callout', 'quote', 'divider', 'key_value', 'exercise', 'summary',
              'answer_key', 'case', 'timeline', 'comparison', 'framework', 'glossary', 'index',
            ]);

            if (rawBlocks.length > 0) {
              const normBlocks = rawBlocks.map((b) => ({
                type: typeof b.type === 'string' && VALID_BT.has(b.type)
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
                title: typeof parsed.title === 'string' ? parsed.title : 'Documento',
                subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : undefined,
                documentType: typeof parsed.documentType === 'string' ? parsed.documentType : 'documento',
                epistemicNature: typeof parsed.epistemicNature === 'string'
                  ? parsed.epistemicNature as import('../tools/pdf/generateCoursePdf').EpistemicNature
                  : undefined,
                level: typeof parsed.level === 'string' ? parsed.level : level,
                mentorName: typeof parsed.mentorName === 'string' ? parsed.mentorName : mentor,
                nativeLanguage: typeof parsed.nativeLanguage === 'string' ? parsed.nativeLanguage : lang,
                studentName: typeof parsed.studentName === 'string' ? parsed.studentName : 'Estudiante',
                blocks: normBlocks,
                nextStep: typeof parsed.nextStep === 'string' ? parsed.nextStep : '',
                generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : now,
              };
            } else {
              courseGenError = 'Model returned JSON with no blocks.';
            }
          }
        } catch (e) {
          courseGenError = e instanceof Error ? e.message : String(e);
          console.error('[stream] generateCoursePdf: LLM/parse failed:', courseGenError);
        }

        if (courseContent) {
          const sBlocks = courseContent.blocks ?? [];
          const sOK = sBlocks.length >= 2 && sBlocks.some(b => (b.type === 'heading' || b.type === 'paragraph') && b.content);
          if (!sOK) {
            courseContent = null;
          }
        }

        if (!courseContent) {
          const errorMsgs: Record<string, string> = {
            en: `Could not generate the course for "${topic}" right now. The content engine returned an error. Please try again in a moment.`,
            es: `No se pudo generar el curso sobre "${topic}" en este momento. El motor de contenido devolvio un error. Intentalo de nuevo en un instante.`,
            no: `Kunne ikke generere kurset om "${topic}" akkurat na. Innholdsmotoren returnerte en feil. Proev igjen om et oyeblikk.`,
          };
          return { text: errorMsgs[lang] ?? errorMsgs['en'], isUserVisibleError: true };
        }

        const courseTitle = courseContent.title || `Documento — ${topic}`;
        const result = await generatePDF({ title: courseTitle, content: '', courseContent });

        if (!result.success) {
          const pdfErrorMsgs: Record<string, string> = {
            en: `The course content was generated but the PDF could not be rendered. Error: ${result.error ?? 'unknown'}. Please try again.`,
            es: `El contenido del curso se genero pero el PDF no pudo renderizarse. Error: ${result.error ?? 'desconocido'}. Intentalo de nuevo.`,
            no: `Kursinnholdet ble generert, men PDF-en kunne ikke gjengis. Proev igjen.`,
          };
          return { text: pdfErrorMsgs[lang] ?? pdfErrorMsgs['en'], isUserVisibleError: true };
        }

        return {
          artifact: {
            type: 'course_pdf' as const,
            title: courseTitle,
            url: result.url,
            modules: (courseContent.blocks ?? [])
              .filter(b => b.type === 'heading' && b.level === 1)
              .map(b => b.content ?? ''),
          },
        };
      }

      const result = await generatePDF({ title, content: request.message });
      return { artifact: result.success ? { type: 'pdf' as const, title, url: result.url, dataUrl: result.url } : undefined };
    }

    case 'tool_image': {
      const { generateImage } = await import('../tools/image-generator');
      const prompt = priorContext || request.message;
      const result = await generateImage(prompt);
      if (result?.success && result.url) {
        return { artifact: { type: 'illustration' as const, prompt, url: result.url, caption: result.message ?? undefined } };
      }
      return {};
    }

    case 'tool_audio': {
      if (step.action === 'generateTTS') {
        const { generateSpeech } = await import('../tools/audio-toolkit');
        const textToSpeak = priorContext?.trim() || request.message?.trim();
        if (!textToSpeak) return {};
        const STREAM_MENTOR_VOICES: Record<string, string> = { sarah: 'shimmer', alex: 'fable', nick: 'onyx' };
        const streamMentorKey = (state.mentorProfile ?? 'alex').toLowerCase();
        const streamVoice = STREAM_MENTOR_VOICES[streamMentorKey] ?? 'fable';
        const result = await generateSpeech(textToSpeak, { voice: streamVoice });
        if (result?.success && result.url) return { artifact: { type: 'audio' as const, dataUrl: result.url } };
        return {};
      }

      const { transcribeAudio } = await import('../tools/audio-toolkit');
      let audioData: { data: string; format: string } | null = null;

      if (request.audioDataUrl) {
        audioData = {
          data: request.audioDataUrl.split(',')[1] || request.audioDataUrl,
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
      return { text: transcriptText, patch: transcriptText ? { lastUserAudioTranscript: transcriptText } : undefined };
    }

    case 'tool_attachment': {
      const { processAttachment } = await import('../tools/attachment-processor');
      const filesToProcess = (request.files ?? []).map(f => ({
        name: f.name,
        type: f.type,
        size: f.size,
        data: f.base64 ?? (f.dataUrl ? f.dataUrl.split(',')[1] ?? f.dataUrl : ''),
      }));
      const r = await processAttachment(filesToProcess, state as unknown as Record<string, unknown>);
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
        ...(state.lastConcept ? [state.lastConcept] : []),
        ...(state.lastUserGoal ? [state.lastUserGoal] : []),
        ...(state.lastMistake ? [state.lastMistake] : []),
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

function buildStreamArtifactSuccessMessage(artifactType: string, lang: string): string {
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

function buildSuggestedActions(
  plan: ExecutionPlan,
  artifact: ArtifactPayload | undefined,
  state: SessionState,
  hasErrorText = false,
): SuggestedAction[] {
  const lang = state.interfaceLanguage ?? 'en';
  if (hasErrorText && !artifact) return [];

  const a: SuggestedAction[] = [];
  if (artifact?.type === 'quiz') a.push({ type: 'start_quiz', label: loc('start_quiz', lang) });
  if (artifact?.type === 'schema' || artifact?.type === 'schema_pro') a.push({ type: 'export_chat_pdf', label: loc('export_chat_pdf', lang) });
  if (artifact?.type === 'roadmap') a.push({ type: 'start_course', label: loc('start_course', lang) });
  if (plan.pedagogicalAction === 'feedback' && state.activeMode === 'structured') a.push({ type: 'next_module', label: loc('next_module', lang) });
  if (plan.pedagogicalAction === 'lesson') a.push({ type: 'show_schema', label: loc('show_schema', lang) });
  a.push({ type: 'export_chat_pdf', label: loc('export_chat_pdf', lang) });

  return a.filter((x, i, arr) => arr.findIndex(b => b.type === x.type) === i);
}

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
  };
  const genericMsgs: Record<string, string> = {
    en: 'The tutor could not generate a response right now. Please try again.',
    es: 'El tutor no pudo generar una respuesta en este momento. Por favor, intentalo de nuevo.',
    no: 'Laereren kunne ikke generere et svar akkurat na. Proev igjen.',
  };
  return is429 ? (quotaMsgs[lang] ?? quotaMsgs['en']) : (genericMsgs[lang] ?? genericMsgs['en']);
}

function degradedStep(step: ExecutionStep, reason: string, durationMs = 0): StepOutput {
  return { stepOrder: step.order, executor: step.executor, durationMs, success: false, error: reason };
}

const LABELS: Record<string, Record<string, string>> = {
  start_quiz: { en: 'Start quiz', es: 'Empezar quiz', no: 'Start quiz' },
  export_chat_pdf: { en: 'Export as PDF', es: 'Exportar a PDF', no: 'Eksporter som PDF' },
  next_module: { en: 'Next module', es: 'Siguiente modulo', no: 'Neste modul' },
  start_course: { en: 'Start course', es: 'Empezar curso', no: 'Start kurs' },
  show_schema: { en: 'Show schema', es: 'Ver esquema', no: 'Vis skjema' },
};

function loc(k: string, l: string): string {
  return LABELS[k]?.[l] ?? LABELS[k]?.['en'] ?? k;
}
 
