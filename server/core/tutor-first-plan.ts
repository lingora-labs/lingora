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

export function buildTutorFirstPlan(
  message: string,
  state: SessionState,
  interfaceLanguage: string,
): ExecutionPlan {
  const contextPack = buildContextPack({
    interfaceLanguage,
    languageProficiency: state.confirmedLevel ?? state.userLevel,
    message,
    lastConcept: state.lastConcept,
    lastUserGoal: state.lastUserGoal,
    turnCount: state.tokens ?? 0,
    activeMode: state.activeMode,
  });

  return {
    executor: 'mentor',
    priority: 10,
    blocking: false,
    pedagogicalAction: 'conversation',
    artifacts: [],
    mentor: {
      profile: state.mentorProfile ?? 'Alex',
      directive: 'RICH_CONTENT_DIRECTIVE',
      injectContinuity: true,
      injectErrorMemory: Boolean(state.errorMemory),
      cognitiveStructure: true,
      activeTopic: state.lastConcept?.trim() || state.currentLessonTopic?.trim() || undefined,
    },
    commercial: undefined,
    skipPhaseAdvance: true,
    reason: '7.1 tutor-first — cognitive authority is the mentor. Runtime instruments only tool requests the mentor emits or an explicit UI action supplies. No intent classification. No orchestrator decision.',
    resolvedTopic: state.lastConcept?.trim() || state.currentLessonTopic?.trim() || undefined,
    executionOrder: [
      {
        order: 1,
        executor: 'mentor',
        action: 'conversation',
        timeout: 180000,
        params: { pedagogicalGoal: 'teach', artifactGoal: null, contextPack },
      },
    ],
  };
}
