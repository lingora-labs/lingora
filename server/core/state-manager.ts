// ============================================================================
// server/core/state-manager.ts
// LINGORA SEEK 3.1 — State Manager
// ============================================================================
// FIX LOG:
//   SEEK 3.1 Fase 0-A — mergeStatePatch: normalize null-as-clear sentinel
//   for requestedOperation before returning SessionState.
//   StatePatch allows requestedOperation?: RequestedOperation | null
//   SessionState allows requestedOperation?: RequestedOperation (no null)
//   mergeStatePatch is the constitutional translation layer between the two.
// ============================================================================

import {
  SessionState,
  StatePatch,
  StateValidationResult,
  RequestedOperation,
  CONTINUITY_FIELDS,
  INVARIANT_FIELDS,
  DEFAULT_SESSION_STATE,
} from '../../lib/contracts';

// ─────────────────────────────────────────────────────────────────────────────
// STATE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

export function validateStateInvariants(state: SessionState): StateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of INVARIANT_FIELDS) {
    if (state[field] === undefined) {
      errors.push(`Invariant field '${field}' is undefined`);
    }
  }

  if (state.curriculumPlan && state.masteryByModule) {
    const moduleKeys = Object.keys(state.masteryByModule).map(Number);
    const expectedModules = state.curriculumPlan.modules.map(m => m.index);

    for (const key of moduleKeys) {
      if (!expectedModules.includes(key)) {
        warnings.push(`Module ${key} in masteryByModule not present in curriculumPlan`);
      }
    }

    for (const expected of expectedModules) {
      if (!moduleKeys.includes(expected)) {
        warnings.push(`Module ${expected} in curriculumPlan missing from masteryByModule`);
      }
    }
  }

  if (state.engagement && state.masteryByModule) {
    const completedFromMastery = Object.entries(state.masteryByModule)
      .filter(([_, m]) => m.score >= 70 && m.passed)
      .map(([idx]) => parseInt(idx, 10));

    const completedFromEngagement = state.engagement.completedModules || [];

    const missingInEngagement = completedFromMastery.filter(
      idx => !completedFromEngagement.includes(idx)
    );

    if (missingInEngagement.length > 0) {
      warnings.push(`Modules ${missingInEngagement.join(",")} passed mastery but not in engagement.completedModules`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE REPAIR
// ─────────────────────────────────────────────────────────────────────────────

export function repairState(state: SessionState, errors: string[]): SessionState {
  const repaired = { ...state };

  for (const error of errors) {
    const fieldMatch = error.match(/field '(\w+)' is undefined/);
    if (fieldMatch) {
      const field = fieldMatch[1] as keyof SessionState;
      if (field in DEFAULT_SESSION_STATE) {
        (repaired as any)[field] = DEFAULT_SESSION_STATE[field];
      }
    }
  }

  if (!repaired.masteryByModule || typeof repaired.masteryByModule !== 'object') {
    repaired.masteryByModule = {};
  }

  return repaired;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE MERGE — CONSTITUTIONAL TRANSLATION LAYER
// ─────────────────────────────────────────────────────────────────────────────
//
// StatePatch allows requestedOperation?: RequestedOperation | null
//   null = explicit clear sentinel (set by execution-engine after hard overrides)
//
// SessionState allows requestedOperation?: RequestedOperation
//   null is not valid here — only undefined or a RequestedOperation value
//
// mergeStatePatch is the only place where StatePatch becomes SessionState.
// It must translate null -> undefined before returning.

export function mergeStatePatch(current: SessionState, patch: StatePatch): SessionState {
  const merged = { ...current, ...patch } as SessionState & {
    requestedOperation?: RequestedOperation | null;
  };

  // Constitutional translation: null-as-clear -> undefined
  if (patch.requestedOperation === null) {
    merged.requestedOperation = undefined;
  }

  return merged as SessionState;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE ADVANCE
// ─────────────────────────────────────────────────────────────────────────────

export function advanceTutorPhase(
  currentPhase: SessionState['tutorPhase'],
  activeMode: SessionState['activeMode']
): SessionState['tutorPhase'] {
  const phaseOrder: SessionState['tutorPhase'][] = [
    'guide', 'lesson', 'schema', 'quiz', 'feedback', 'conversation',
  ];

  const currentIndex = phaseOrder.indexOf(currentPhase);
  if (currentIndex === -1 || currentIndex >= phaseOrder.length - 1) {
    return 'conversation';
  }

  if (activeMode === 'structured' || activeMode === 'pdf_course') {
    return phaseOrder[currentIndex + 1];
  }

  return currentPhase;
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUESTED OPERATION CLEAR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a patch that clears the requestedOperation field.
 * Uses null as the clear sentinel — mergeStatePatch translates it to undefined.
 */
export function clearRequestedOperation(): StatePatch {
  return { requestedOperation: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTINUITY PRESERVATION
// ─────────────────────────────────────────────────────────────────────────────

export function preserveContinuity(
  current: SessionState,
  patch: StatePatch
): StatePatch {
  const preservedPatch: StatePatch = { ...patch };

  for (const field of CONTINUITY_FIELDS) {
    if (patch[field as keyof StatePatch] === undefined && current[field] !== undefined) {
      (preservedPatch as any)[field] = current[field];
    }
  }

  return preservedPatch;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGAGEMENT UPDATE
// ─────────────────────────────────────────────────────────────────────────────

export function updateEngagement(
  state: SessionState,
  moduleCompleted?: number
): StatePatch {
  const now = Date.now();
  const currentStreak  = state.engagement?.streak ?? 0;
  const lastActive     = state.engagement?.lastActive ?? 0;
  const completedModules = [...(state.engagement?.completedModules ?? [])];

  let newStreak = currentStreak;

  if (lastActive > 0 && now - lastActive > 24 * 60 * 60 * 1000) {
    newStreak = 1;
  } else if (lastActive > 0) {
    newStreak = currentStreak + 1;
  } else {
    newStreak = 1;
  }

  if (moduleCompleted !== undefined && !completedModules.includes(moduleCompleted)) {
    completedModules.push(moduleCompleted);
  }

  return {
    engagement: {
      streak: newStreak,
      lastActive: now,
      completedModules,
      totalTokens: (state.engagement?.totalTokens ?? 0) + 1,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTERY UPDATE
// ─────────────────────────────────────────────────────────────────────────────

export function updateMastery(
  state: SessionState,
  moduleIndex: number,
  score: number
): StatePatch {
  const currentMastery = state.masteryByModule[moduleIndex] ?? {
    score: 0, attempts: 0, lastAttemptAt: 0, passed: false,
  };

  const newAttempts = currentMastery.attempts + 1;
  const newScore    = Math.min(100, Math.max(0, score));
  const passed      = newScore >= 70;

  return {
    masteryByModule: {
      ...state.masteryByModule,
      [moduleIndex]: {
        score:         newScore,
        attempts:      newAttempts,
        lastAttemptAt: Date.now(),
        passed,
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR MEMORY UPDATE
// ─────────────────────────────────────────────────────────────────────────────

export function updateErrorMemory(
  state: SessionState,
  errors: { grammar?: string[]; vocabulary?: string[]; pronunciation?: string[] }
): StatePatch {
  const currentMemory = state.errorMemory ?? {
    grammar: [], vocabulary: [], pronunciation: [],
  };

  return {
    errorMemory: {
      grammar:       [...(errors.grammar       ?? []), ...(currentMemory.grammar       ?? [])].slice(0, 10),
      vocabulary:    [...(errors.vocabulary    ?? []), ...(currentMemory.vocabulary    ?? [])].slice(0, 10),
      pronunciation: [...(errors.pronunciation ?? []), ...(currentMemory.pronunciation ?? [])].slice(0, 10),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTERY GATE CHECK
// ─────────────────────────────────────────────────────────────────────────────

export function isModuleBlocked(state: SessionState, moduleIndex: number): boolean {
  const mastery = state.masteryByModule[moduleIndex];
  if (!mastery) return false;
  return mastery.score < 70 && mastery.attempts >= 1;
}

export function getNextUnlockedModule(state: SessionState): number | undefined {
  if (!state.curriculumPlan) return undefined;

  for (const module of state.curriculumPlan.modules) {
    const mastery = state.masteryByModule[module.index];
    if (!mastery || mastery.score < 70) return module.index;
  }

  return undefined;
}

// ============================================================================
// COMMIT:
// fix(state-manager): normalize requestedOperation null->undefined in
// mergeStatePatch — constitutional translation layer between StatePatch
// (allows null-as-clear) and SessionState (requires undefined or value)
// ============================================================================

