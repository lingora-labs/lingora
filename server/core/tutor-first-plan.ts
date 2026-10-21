// =============================================================================
// server/core/tutor-first-plan.ts
// Reforma Constitucional 7.1 — Tutor Maestro as sole cognitive authority.
//
// This builder produces an ExecutionPlan that always goes to the mentor.
// It does not classify intent, does not consult the orchestrator, and does
// not apply hard-override rules. ContextPack is information, not a decision.
//
// Explicit UI actions (export button, direct tool request with a contract)
// are handled by the route before this function is called. This file only
// covers conversational turns.
// =============================================================================

import type {
  ExecutionPlan,
  SessionState,
} from '../../lib/contracts';

import { buildContextPack } from '../../lib/context-pack';
import { directFormatFor } from '../../lib/direct-intent-contract';

export function buildTutorFirstPlan(
  message: string,
  state: SessionState,
  interfaceLanguage: string,
): ExecutionPlan {
  const directFormat = directFormatFor(message)
  // Onboarding's synthesized greeting is not the student's first REAL turn.
  // A short hello in Free mode is still the pedagogical opening: the tutor
  // must guide one actionable micro-step instead of drifting into small talk.
  const freeOpeningGreeting = state.activeMode === 'free'
    && (state.tokens ?? 0) <= 2
    && message.trim().split(/\s+/).filter(Boolean).length <= 2
  const contextPack = buildContextPack({
    interfaceLanguage,
    languageProficiency: state.confirmedLevel ?? state.userLevel,
    message,
    lastConcept: state.lastConcept,
    lastUserGoal: state.lastUserGoal,
    turnCount: state.tokens ?? 0,
    activeMode: state.activeMode,
    explanatoryLanguage: (state as SessionState & { explanatoryLanguage?: string }).explanatoryLanguage,
  });

  return {
    executor: 'mentor',
    priority: directFormat ? 100 : 10,
    blocking: false,
    pedagogicalAction: directFormat === 'translation' ? 'translation_only' : directFormat === 'correction' ? 'correction_only' : 'conversation',
    artifacts: [],
    mentor: {
      profile: state.mentorProfile ?? 'Alex',
      directive: directFormat === 'translation' ? 'TRANSLATION_ONLY_DIRECTIVE'
        : directFormat === 'correction' ? 'CORRECTION_ONLY_DIRECTIVE'
        : (!message.trim() || freeOpeningGreeting) ? 'FIRST_TURN_DIRECTIVE'
        : state.activeMode === 'structured' && state.tutorPhase === 'feedback' ? 'EXERCISE_FEEDBACK_DIRECTIVE'
        : state.activeMode === 'structured' ? 'STRUCTURED_COURSE_DIRECTIVE'
        : state.activeMode === 'pdf_course' ? 'PDF_COURSE_DIRECTIVE'
        : state.activeMode === 'free' ? 'FREE_CONVERSATION_DIRECTIVE'
        : 'RICH_CONTENT_DIRECTIVE',
      injectContinuity: true,
      injectErrorMemory: Boolean(state.errorMemory),
      cognitiveStructure: true,
      activeTopic: state.lastConcept?.trim() || state.currentLessonTopic?.trim() || undefined,
    },
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: directFormat
      ? `7.1 explicit student transformation: ${directFormat}; tutor writes the content, deterministic runtime enforces response-only output without artifacts.`
      : freeOpeningGreeting
        ? '7.1 first learner hello in Free mode — tutor owns first-turn microaction after synthesized onboarding greeting.'
        : '7.1 tutor-first — cognitive authority is the mentor. Runtime instruments only tool requests the mentor emits or an explicit UI action supplies. No intent classification. No orchestrator decision.',
    resolvedTopic: state.lastConcept?.trim() || state.currentLessonTopic?.trim() || undefined,
    executionOrder: [
      {
        order: 1,
        executor: 'mentor',
        action: 'conversation',
        timeout: 180000,
        params: { contextPack },
      },
    ],
  };
}
