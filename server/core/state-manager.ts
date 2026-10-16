// =============================================================================
// server/core/state-manager.ts
// LINGORA SEEK 4.1a — State Manager
// =============================================================================
// FIX LOG:
//   SEEK 3.1 Fase 0-A — mergeStatePatch: normalize null-as-clear sentinel
//   for requestedOperation before returning SessionState.
//   StatePatch allows requestedOperation?: RequestedOperation | null
//   SessionState allows requestedOperation?: RequestedOperation (no null)
//   mergeStatePatch is the constitutional translation layer between the two.
//
//   SEEK 4.1a — PERSISTENCE VERIFICATION (no code change):
//   mergeStatePatch confirmed to use { ...current, ...patch } spread.
//   artifactRegistry (introduced in 4.1a) is an undeclared field in StatePatch
//   but IS preserved by spread merge — no pick(), no whitelist, no filter.
//   Persistence chain: compileResult writes artifactRegistry to statePatch →
//   mergeStatePatch spreads it into updatedState → route.ts returns updatedState
//   to client → client sends state back in next request → registry survives.
// =============================================================================

import {
  SessionState,
  StatePatch,
  StateValidationResult,
  ExecutionPlan,
  CONTINUITY_FIELDS,
  INVARIANT_FIELDS,
  CLEARABLE_FIELDS,
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
    // SEEK 3.8: filter out modules with undefined index before comparison
    // (LLM-generated curricula may omit explicit index; repairState handles this,
    // but validation runs before repair on the first turn)
    const expectedModules = state.curriculumPlan.modules
      .map(m => m.index)
      .filter((idx): idx is number => typeof idx === 'number' && !isNaN(idx));

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

  // SEEK 3.7 — FIX: Ensure curriculumPlan modules always have numeric index.
  // The LLM sometimes returns modules without explicit index, causing the warning
  // "Module undefined in curriculumPlan missing from masteryByModule".
  // Auto-assign 0-based index if missing.
  if (repaired.curriculumPlan?.modules?.length) {
    repaired.curriculumPlan = {
      ...repaired.curriculumPlan,
      modules: repaired.curriculumPlan.modules.map((m, i) => ({
        ...m,
        index: typeof m.index === 'number' && !isNaN(m.index) ? m.index : i,
      })),
    };

    // SEEK 3.8 — FIX: Initialize masteryByModule for any module that is in
    // curriculumPlan but missing from masteryByModule. This eliminates the
    // repetitive warning "Module N in curriculumPlan missing from masteryByModule"
    // that fires on every request in structured mode.
    if (!repaired.masteryByModule || typeof repaired.masteryByModule !== 'object') {
      repaired.masteryByModule = {};
    }
    for (const mod of repaired.curriculumPlan.modules) {
      const idx = mod.index;
      if (typeof idx === 'number' && !(idx in repaired.masteryByModule)) {
        repaired.masteryByModule[idx] = { score: 0, attempts: 0, lastAttemptAt: 0, passed: false };
      }
    }
  }

  return repaired;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE MERGE — CONSTITUTIONAL TRANSLATION LAYER
// ─────────────────────────────────────────────────────────────────────────────
//
// StatePatch allows null on every field listed in CLEARABLE_FIELDS
// (lib/contracts.ts) — null = explicit, transport-safe clear sentinel.
//
// SessionState never allows null on those fields — only undefined or a
// real value.
//
// mergeStatePatch is the only place where StatePatch becomes SessionState.
// It must translate null -> undefined before returning, for EVERY field in
// CLEARABLE_FIELDS, not just requestedOperation.
//
// SEEK 4.1a — PERSISTENCE CONTRACT:
// { ...current, ...patch } spread preserves ALL patch fields, including
// artifactRegistry (undeclared in StatePatch type but valid at runtime).
// No pick(), no whitelist, no filter beyond the CLEARABLE_FIELDS sentinel.
//
// DAE fix (AE-EXECUTE round, defect C) — generalized from a single
// hand-written `if (patch.requestedOperation === null)` branch to a loop
// over CLEARABLE_FIELDS. This is the shared mechanism AE required instead
// of per-field duplicated rules: pendingDocumentRequest now gets the exact
// same treatment requestedOperation already had, with no new branch to
// maintain, and any future clearable field needs only a CLEARABLE_FIELDS
// entry — never a new line here.

export function mergeStatePatch(current: SessionState, patch: StatePatch): SessionState {
  const merged = { ...current, ...patch } as SessionState & Record<string, unknown>;

  for (const field of CLEARABLE_FIELDS) {
    if ((patch as Record<string, unknown>)[field] === null) {
      (merged as Record<string, unknown>)[field] = undefined;
    }
  }

  return merged as SessionState;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED DOCUMENT-CONTRACT CLEAR MECHANISM
// ─────────────────────────────────────────────────────────────────────────────
//
// DAE fix (AE-EXECUTE round, defect H) — AE-05 introduced plan-level
// clearDocumentContract handling ONLY inside execution-engine.ts's
// compileResult(). Work's real-UI QA proved server/core/execution-engine-
// stream.ts (the path nearly all free-text mentor-first turns actually run
// through) builds its state patch through a completely separate code path
// that never looked at this flag at all — so a redirect-with-instruction
// turn could answer correctly (E/AE-05 passes) while the stale contract
// stayed alive into the next turn ONLY when that turn happened to stream
// (H fails). AE's mandate is explicit: "preferiblemente con un mecanismo de
// actualización compartido en vez de duplicar reglas" — not a second,
// independently-maintained copy of the same `if` check in the stream file.
// This function is that one shared mechanism: both execution-engine.ts's
// compileResult() and execution-engine-stream.ts's executePlanStream() call
// it identically when assembling their respective state patches.
export function clearDocumentContractIfRequested(
  plan: Pick<ExecutionPlan, 'clearDocumentContract'>,
): Pick<StatePatch, 'pendingDocumentRequest'> {
  return plan.clearDocumentContract === true
    ? { pendingDocumentRequest: null }
    : {};
}

// ─────────────────────────────────────────────────────────────────────────────
// WIRE STATE — THE OTHER HALF OF THE TRANSPORT FIX
// ─────────────────────────────────────────────────────────────────────────────
//
// DAE fix (AE-EXECUTE round, defect C, completing the fix) — mergeStatePatch()
// is correct and necessary for the SERVER's own in-memory SessionState: that
// type forbids null, so null must become undefined before any other
// server-side logic (evaluateCommercial, a later step in this same request,
// etc.) touches the object. But that translation happens BEFORE the API
// route/stream ever calls JSON.stringify — so if the route simply sent
// `updatedState` (the already-merged, null-free object) back to the
// browser, the cleared field would ALREADY be bare `undefined` by the time
// JSON.stringify runs on it, and undefined keys are dropped exactly as
// before this fix. Serializing the merged state directly would silently
// reintroduce defect C underneath the new null-sentinel mechanism.
//
// toWireState() is the one place that re-applies the explicit `null` for
// any CLEARABLE_FIELDS entry the ORIGINAL patch cleared this turn, onto a
// COPY of the already-merged state, strictly for what gets sent over the
// wire (NextResponse.json in the blocking route, or the SSE `done` event's
// `state` field in execution-engine-stream.ts). The server's own
// `updatedState`/in-memory SessionState is never mutated or given a null —
// only the wire copy is. Both transports call this SAME function.
export function toWireState(
  state: SessionState,
  patch: StatePatch,
): SessionState & Record<string, unknown> {
  const wire = { ...state } as SessionState & Record<string, unknown>;
  for (const field of CLEARABLE_FIELDS) {
    if ((patch as Record<string, unknown>)[field] === null) {
      (wire as Record<string, unknown>)[field] = null;
    }
  }
  return wire;
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

// =============================================================================
// COMMIT:
// fix(state-manager): normalize requestedOperation null->undefined in
// mergeStatePatch — constitutional translation layer between StatePatch
// (allows null-as-clear) and SessionState (requires undefined or value)
// =============================================================================
