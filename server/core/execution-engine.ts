// =============================================================================
// server/core/execution-engine.ts
// LINGORA 7.5 — blocking executor for the two explicit runtime operations that
// remain blocking: the student's conversation export and the diagnostics command.
//
// Every conversational turn runs through execution-engine-stream.ts (one Tutor,
// tool-capable). The executors that used to live here (a second mentor path,
// schema/quiz/table generators, the LLM course composer, knowledge, image and
// audio executors) had no route in the orchestrator since 7.1 and were removed in
// 7.5: unreachable code that a future change could re-enable as a second brain.
// =============================================================================
import type {
  ExecutionPlan, ExecutionStepResult, ArtifactPayload, SessionState, StatePatch,
  ChatRequest, SuggestedAction, ArtifactRegistryEntry,
} from '../../lib/contracts';
import { documentContractStatePatch } from './state-manager';
import { buildContextualActions } from './suggested-actions';

export interface ExecutionResult {
  message: string;
  artifact?: ArtifactPayload;
  suggestedActions: SuggestedAction[];
  statePatch: StatePatch;
  stepResults: ExecutionStepResult[];
  totalDurationMs: number;
}

interface StepOutput { text?: string; artifact?: ArtifactPayload; patch?: StatePatch; refusal?: boolean }

async function exportConversation(request: ChatRequest): Promise<StepOutput> {
  // The export is the student's actual conversation, never an AI-authored study guide.
  const { validateExportTurns, explainExportRefusal } = await import('../tools/pdf/conversationExport');
  const turns = request.exportTurns === undefined ? null : validateExportTurns(request.exportTurns);
  // A structured export can only be produced from complete turns: never claim that a
  // partially streamed message was exported in full.
  if (request.exportTurns !== undefined && !turns)
    return { text: 'No se puede exportar un turno incompleto. Finaliza la respuesta antes de exportar.', refusal: true };
  if (!turns) return { text: 'No hay conversación que exportar.', refusal: true };
  const date = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
  const { generatePDF } = await import('../tools/pdf-generator');
  const result = await generatePDF({
    title: `LINGORA — Historial íntegro de conversación — ${date}`,
    conversationTurns: turns,
    filename: `lingora-full-transcript-${Date.now()}`,
  });
  if (!result.success || !result.url) {
    console.error('[export] conversation export failed', result.error, result.message);
    // Name the cause of a deterministic refusal; never a generic "try again" for content that cannot be printed.
    return { text: explainExportRefusal(result.message) ?? 'No se pudo generar el historial íntegro en PDF.', refusal: true };
  }
  return { artifact: { type: 'pdf_chat', url: result.url, messageCount: turns.length } as ArtifactPayload };
}

async function diagnose(request: ChatRequest, state: SessionState): Promise<StepOutput> {
  const { evaluateLevel } = await import('./diagnostics');
  const samples = [
    request.message,
    ...(state.lastConcept ? [state.lastConcept] : []),
    ...(state.lastUserGoal ? [state.lastUserGoal] : []),
    ...(state.lastMistake ? [state.lastMistake] : []),
  ];
  const result = await evaluateLevel(samples);
  return {
    patch: {
      diagnosticSamples: (state.diagnosticSamples ?? 0) + 1,
      ...(result.confidence !== 'insufficient' && result.confidence !== 'low'
        ? { confirmedLevel: result.level as import('../../lib/contracts').CEFRLevel } : {}),
    },
  };
}

const SUCCESS: Record<string, Record<string, string>> = {
  pdf_chat: {
    en: 'Conversation exported to PDF. You can download it below.',
    es: 'Conversación exportada a PDF. Puedes descargarla a continuación.',
    no: 'Samtalen er eksportert til PDF. Du kan laste den ned nedenfor.',
    it: 'Conversazione esportata in PDF. Puoi scaricarla qui sotto.',
    fr: 'Conversation exportée en PDF. Tu peux la télécharger ci-dessous.',
    de: 'Gespräch als PDF exportiert. Du kannst es unten herunterladen.',
  },
};

export async function executePlan(plan: ExecutionPlan, request: ChatRequest, state: SessionState): Promise<ExecutionResult> {
  const start = Date.now();
  const step = plan.executionOrder[0];
  let out: StepOutput = {};
  let error: string | undefined;
  try {
    if (step?.executor === 'tool_pdf' && step.action === 'exportChatPdf') out = await exportConversation(request);
    else if (step?.executor === 'diagnostic') out = await diagnose(request, state);
    else throw new Error(`no blocking executor for ${step?.executor}:${step?.action}`);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error('[execution-engine]', error);
  }
  const artifact = out.artifact;
  const lang = state.interfaceLanguage ?? 'en';
  const message = out.text?.trim()
    ? out.text
    : artifact ? (SUCCESS[artifact.type]?.[lang] ?? SUCCESS[artifact.type]?.en ?? 'Listo.') : '';
  const statePatch: StatePatch = { ...(out.patch ?? {}) };
  Object.assign(statePatch, documentContractStatePatch(plan, artifact ? [artifact] : []));
  statePatch.tokens = (state.tokens ?? 0) + 1;
  if (artifact && artifact.type !== 'pdf_chat') {
    const existing = (state as unknown as { artifactRegistry?: ArtifactRegistryEntry[] }).artifactRegistry ?? [];
    (statePatch as unknown as { artifactRegistry: ArtifactRegistryEntry[] }).artifactRegistry = [...existing, {
      id: `${artifact.type}-${Date.now()}`, type: artifact.type,
      title: (artifact as unknown as { title?: string }).title ?? artifact.type, generatedAt: Date.now(), payload: artifact,
    }].slice(-20);
  }
  if (plan.priority >= 100) statePatch.requestedOperation = null;
  const suggestedActions = buildContextualActions({
    pedagogicalAction: plan.pedagogicalAction,
    artifactType: artifact?.type,
    mentorProfile: state.mentorProfile,
    interfaceLanguage: state.interfaceLanguage,
    hasErrorText: Boolean(out.refusal),
    activeMode: state.activeMode,
  });
  const durationMs = Date.now() - start;
  return {
    message, artifact, suggestedActions, statePatch, totalDurationMs: durationMs,
    stepResults: step ? [{
      stepOrder: step.order, executor: step.executor, action: step.action, durationMs,
      success: !error, error, producedArtifacts: artifact ? [artifact.type] : [],
    }] : [],
  };
}
