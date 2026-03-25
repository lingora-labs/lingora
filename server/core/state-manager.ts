// ============================================================================
// server/core/state-manager.ts
// LINGORA SEEK 3.1 — State Manager
// FASE 0-A — Estado, Precedencia e Identidad Base
// BLOQUE 0-A.4 — Alineación de StatePatch con SessionState
// ============================================================================
// OBJETIVO: corregir incompatibilidad de tipos entre StatePatch y SessionState,
//           reemplazando `requestedOperation = null` por `undefined`.
// ALCANCE: modifica la función `clearRequestedOperation()` y cualquier otro
//          lugar donde se asigne `null` a `requestedOperation`.
// EXCLUSIONES: no modifica lógica de merge; solo cambia el valor centinela.
// COMPATIBILIDAD: sync y stream; mantiene comportamiento funcional idéntico
//                porque en el contexto de `mergeStatePatch`, `undefined` en
//                el patch significa "no modificar este campo". Como se usa
//                como clear explícito, `undefined` cumple la misma función.
// DOCTRINA: el estado debe ser consistente entre contratos y ejecución.
// RIESGO COMPILACIÓN: BAJO — solo cambia null por undefined.
// ============================================================================

import {
  SessionState,
  StatePatch,
  StateValidationResult,
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

  // Check invariant fields are present
  for (const field of INVARIANT_FIELDS) {
    if (state[field] === undefined) {
      errors.push(`Invariant field '${field}' is undefined`);
    }
  }

  // Check masteryByModule consistency with curriculumPlan
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

  // Check engagement.completedModules alignment
  if (state.engagement && state.masteryByModule) {
    const completedFromMastery = Object.entries(state.masteryByModule)
      .filter(([_, m]) => m.score >= 70 && m.passed)
      .map(([idx]) => parseInt(idx, 10));

    const completedFromEngagement = state.engagement.completedModules || [];

    const missingInEngagement = completedFromMastery.filter(
      idx => !completedFromEngagement.includes(idx)
    );

    if (missingInEngagement.length > 0) {
      warnings.push(`Modules ${missingInEngagement.join(',')} passed mastery but not in engagement.completedModules`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
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

  // Ensure masteryByModule is always an object
  if (!repaired.masteryByModule || typeof repaired.masteryByModule !== 'object') {
    repaired.masteryByModule = {};
  }

  return repaired;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE MERGE WITH PROTECTION (FASE 0-A: se mantiene igual, sin protección adicional)
// ─────────────────────────────────────────────────────────────────────────────

export function mergeStatePatch(current: SessionState, patch: StatePatch): SessionState {
  // FASE 0-A: merge simple. La protección de campos críticos se evaluará
  // después de analizar los resets legítimos en fases posteriores.
  return { ...current, ...patch };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE ADVANCE
// ─────────────────────────────────────────────────────────────────────────────

export function advanceTutorPhase(
  currentPhase: SessionState['tutorPhase'],
  activeMode: SessionState['activeMode']
): SessionState['tutorPhase'] {
  const phaseOrder: SessionState['tutorPhase'][] = [
    'guide',
    'lesson',
    'schema',
    'quiz',
    'feedback',
    'conversation',
  ];

  const currentIndex = phaseOrder.indexOf(currentPhase);
  if (currentIndex === -1 || currentIndex >= phaseOrder.length - 1) {
    return 'conversation';
  }

  // En structured mode, avanzar normalmente
  if (activeMode === 'structured' || activeMode === 'pdf_course') {
    return phaseOrder[currentIndex + 1];
  }

  // En otros modos, no avanzar
  return currentPhase;
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUESTED OPERATION CLEAR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a patch that clears the requestedOperation field.
 * FASE 0-A: ahora usa undefined en lugar de null para alinear con StatePatch.
 */
export function clearRequestedOperation(): StatePatch {
  // Returns undefined — clears by omission under the new StatePatch contract.
  // El campo se excluye del patch, lo que resulta en que el merge no lo modifica,
  // pero en el flujo de execution-engine se asigna explícitamente undefined.
  // Para la limpieza explícita, se usa undefined en lugar de null.
  return { requestedOperation: undefined };
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
  const currentStreak = state.engagement?.streak ?? 0;
  const lastActive = state.engagement?.lastActive ?? 0;
  const completedModules = [...(state.engagement?.completedModules ?? [])];

  let newStreak = currentStreak;

  // Update streak: if last active was more than 24h ago, reset streak
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
    score: 0,
    attempts: 0,
    lastAttemptAt: 0,
    passed: false,
  };

  const newAttempts = currentMastery.attempts + 1;
  const newScore = Math.min(100, Math.max(0, score));
  const passed = newScore >= 70;

  return {
    masteryByModule: {
      ...state.masteryByModule,
      [moduleIndex]: {
        score: newScore,
        attempts: newAttempts,
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
  errors: {
    grammar?: string[];
    vocabulary?: string[];
    pronunciation?: string[];
  }
): StatePatch {
  const currentMemory = state.errorMemory ?? {
    grammar: [],
    vocabulary: [],
    pronunciation: [],
  };

  // Limit to last 10 errors per category
  const newGrammar = [
    ...(errors.grammar ?? []),
    ...(currentMemory.grammar ?? []),
  ].slice(0, 10);

  const newVocabulary = [
    ...(errors.vocabulary ?? []),
    ...(currentMemory.vocabulary ?? []),
  ].slice(0, 10);

  const newPronunciation = [
    ...(errors.pronunciation ?? []),
    ...(currentMemory.pronunciation ?? []),
  ].slice(0, 10);

  return {
    errorMemory: {
      grammar: newGrammar,
      vocabulary: newVocabulary,
      pronunciation: newPronunciation,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTERY GATE CHECK
// ─────────────────────────────────────────────────────────────────────────────

export function isModuleBlocked(
  state: SessionState,
  moduleIndex: number
): boolean {
  const mastery = state.masteryByModule[moduleIndex];
  if (!mastery) return false;

  // Module is blocked if score < 70 and at least one attempt was made
  return mastery.score < 70 && mastery.attempts >= 1;
}

export function getNextUnlockedModule(
  state: SessionState
): number | undefined {
  if (!state.curriculumPlan) return undefined;

  for (let i = 0; i < state.curriculumPlan.modules.length; i++) {
    const module = state.curriculumPlan.modules[i];
    const mastery = state.masteryByModule[module.index];

    if (!mastery || mastery.score < 70) {
      return module.index;
    }
  }

  return undefined;
}

// ============================================================================
// COMMIT:
// fix(state-manager): replace requestedOperation null clear with undefined
// ============================================================================
