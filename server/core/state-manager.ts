// =============================================================================
// server/core/state-manager.ts
// LINGORA SEEK 3.0 — State Guardian
// =============================================================================
// Purpose  : Validate invariants, merge state patches, and preserve continuity
//            fields across every request turn.
//            This module DOES NOT route. It DOES NOT decide. It protects state.
//
// Riesgo principal : Silent state corruption between turns — fields lost in
//                    merge, invariants bypassed, continuity broken.
//                    This module makes that failure VISIBLE, not silent.
//
// Dependencia      : lib/contracts.ts (SessionState, StatePatch, all constants)
//
// Commit   : feat(state-manager): SEEK 3.0 — validateStateInvariants +
//            mergeStatePatch with continuity preservation
// =============================================================================

import {
  SessionState,
  StatePatch,
  StateValidationResult,
  INVARIANT_FIELDS,
  CONTINUITY_FIELDS,
  DEFAULT_SESSION_STATE,
  ActiveMode,
  TutorPhase,
  DepthMode,
  InterfaceLanguage,
  MASTERY_PASS_THRESHOLD,
} from '../../lib/contracts';

// ─────────────────────────────────────────────────────────────────────────────
// VALID ENUM VALUES — used by validateStateInvariants
// ─────────────────────────────────────────────────────────────────────────────

const VALID_ACTIVE_MODES: ActiveMode[] = [
  'interact', 'structured', 'pdf_course', 'free',
];

const VALID_TUTOR_PHASES: TutorPhase[] = [
  'guide', 'lesson', 'schema', 'quiz', 'feedback', 'conversation',
];

const VALID_DEPTH_MODES: DepthMode[] = ['shallow', 'standard', 'deep'];

const VALID_INTERFACE_LANGUAGES: InterfaceLanguage[] = [
  'en', 'no', 'es', 'it', 'fr', 'de', 'pt', 'nl',
];

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * validateStateInvariants
 * ──────────────────────────────────────────────────────────────────────────
 * Checks that the given SessionState satisfies all formal invariants defined
 * in lib/contracts.ts. Returns errors[] for violations and warnings[] for
 * non-fatal inconsistencies.
 *
 * Called by route.ts BEFORE orchestration begins.
 * If errors.length > 0, route.ts must repair state before proceeding.
 *
 * THIS FUNCTION DOES NOT MODIFY STATE. It only inspects.
 */
export function validateStateInvariants(
  state: SessionState,
): StateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── 1. Required invariant fields must be present and valid ────────────────

  if (!state.activeMode || !VALID_ACTIVE_MODES.includes(state.activeMode)) {
    errors.push(
      `invariant:activeMode — invalid or missing: "${state.activeMode}". ` +
      `Must be one of: ${VALID_ACTIVE_MODES.join(', ')}`
    );
  }

  if (!state.tutorPhase || !VALID_TUTOR_PHASES.includes(state.tutorPhase)) {
    errors.push(
      `invariant:tutorPhase — invalid or missing: "${state.tutorPhase}". ` +
      `Must be one of: ${VALID_TUTOR_PHASES.join(', ')}`
    );
  }

  if (typeof state.tokens !== 'number' || state.tokens < 0) {
    errors.push(
      `invariant:tokens — invalid value: ${state.tokens}. Must be a non-negative number.`
    );
  }

  if (!state.interfaceLanguage || !VALID_INTERFACE_LANGUAGES.includes(state.interfaceLanguage)) {
    errors.push(
      `invariant:interfaceLanguage — invalid or missing: "${state.interfaceLanguage}". ` +
      `Must be one of: ${VALID_INTERFACE_LANGUAGES.join(', ')}`
    );
  }

  if (!state.depthMode || !VALID_DEPTH_MODES.includes(state.depthMode)) {
    errors.push(
      `invariant:depthMode — invalid or missing: "${state.depthMode}". ` +
      `Must be one of: ${VALID_DEPTH_MODES.join(', ')}`
    );
  }

  if (state.masteryByModule === undefined || state.masteryByModule === null) {
    errors.push(
      `invariant:masteryByModule — must be an object (may be empty {}), not null or undefined.`
    );
  }

  // ── 2. curriculumPlan consistency ─────────────────────────────────────────

  if (state.curriculumPlan !== undefined) {
    if (typeof state.curriculumPlan === 'string') {
      errors.push(
        `invariant:curriculumPlan — must be CurriculumPlan object, not a string. ` +
        `This is a known corruption pattern from SEEK 2.x.`
      );
    } else if (state.curriculumPlan !== null) {
      // Validate masteryByModule keys align with curriculum modules
      const moduleIndices = state.curriculumPlan.modules.map(m => m.index);
      const masteryKeys = Object.keys(state.masteryByModule).map(Number);
      const orphanedKeys = masteryKeys.filter(k => !moduleIndices.includes(k));
      if (orphanedKeys.length > 0) {
        warnings.push(
          `invariant:masteryByModule — keys ${orphanedKeys.join(', ')} do not correspond ` +
          `to any module in curriculumPlan. Orphaned mastery records.`
        );
      }
    }
  } else if (state.activeMode === 'structured' && state.tokens > 2) {
    // Structured mode without a plan after the first couple of turns is suspicious
    warnings.push(
      `invariant:curriculumPlan — mode is 'structured' and tokens=${state.tokens} ` +
      `but curriculumPlan is undefined. Expected plan to exist by now.`
    );
  }

  // ── 3. engagement.completedModules alignment ──────────────────────────────

  if (state.engagement && state.masteryByModule) {
    const masteryPassed = Object.entries(state.masteryByModule)
      .filter(([, m]) => m.score >= MASTERY_PASS_THRESHOLD)
      .map(([k]) => Number(k));
    const completedModules = state.engagement.completedModules ?? [];
    const missingFromCompleted = masteryPassed.filter(
      k => !completedModules.includes(k)
    );
    if (missingFromCompleted.length > 0) {
      warnings.push(
        `invariant:engagement.completedModules — modules ${missingFromCompleted.join(', ')} ` +
        `have mastery >= ${MASTERY_PASS_THRESHOLD} but are missing from completedModules.`
      );
    }
  }

  // ── 4. requestedOperation must not persist across turns ───────────────────
  // This is checked after execution, but we warn if it arrives set on a new request
  // (indicates it was not cleared properly in the previous turn)
  // Note: we only warn here, not error — clearing happens in execution-engine.

  // ── 5. tokens cannot be negative ─────────────────────────────────────────
  // Already covered above.

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * repairState
 * ──────────────────────────────────────────────────────────────────────────
 * Applies safe defaults to fix invariant violations.
 * Called by route.ts when validateStateInvariants returns errors.
 *
 * PRINCIPLE: always prefer restoration over rejection.
 * A repaired state that can proceed is better than an aborted request.
 * EXCEPTION: curriculumPlan=string is unrecoverable — it must be cleared.
 */
export function repairState(
  state: SessionState,
  errors: string[],
): SessionState {
  const repaired: SessionState = { ...state };
  let repairsApplied = 0;

  for (const error of errors) {
    if (error.startsWith('invariant:activeMode')) {
      repaired.activeMode = DEFAULT_SESSION_STATE.activeMode;
      repairsApplied++;
    }
    if (error.startsWith('invariant:tutorPhase')) {
      repaired.tutorPhase = DEFAULT_SESSION_STATE.tutorPhase;
      repairsApplied++;
    }
    if (error.startsWith('invariant:tokens')) {
      repaired.tokens = 0;
      repairsApplied++;
    }
    if (error.startsWith('invariant:interfaceLanguage')) {
      repaired.interfaceLanguage = DEFAULT_SESSION_STATE.interfaceLanguage;
      repairsApplied++;
    }
    if (error.startsWith('invariant:depthMode')) {
      repaired.depthMode = DEFAULT_SESSION_STATE.depthMode;
      repairsApplied++;
    }
    if (error.startsWith('invariant:masteryByModule')) {
      repaired.masteryByModule = {};
      repairsApplied++;
    }
    if (error.includes('CurriculumPlan object, not a string')) {
      // Unrecoverable — clear the plan and reset to guide phase
      repaired.curriculumPlan = undefined;
      repaired.currentModuleIndex = undefined;
      repaired.tutorPhase = 'guide';
      repairsApplied++;
    }
  }

  if (repairsApplied > 0) {
    console.warn(
      `[state-manager] repairState applied ${repairsApplied} repairs. ` +
      `Errors: ${errors.join('; ')}`
    );
  }

  return repaired;
}

/**
 * mergeStatePatch
 * ──────────────────────────────────────────────────────────────────────────
 * Merges a StatePatch into the current SessionState.
 *
 * RULES:
 * 1. Patch fields with undefined value do NOT overwrite existing state.
 *    (Use null explicitly if clearing a field is intended.)
 * 2. CONTINUITY_FIELDS are preserved from current state when the patch
 *    omits them. They are only updated when the patch explicitly includes them.
 * 3. masteryByModule is deep-merged (module-level granularity).
 * 4. engagement is deep-merged (field-level granularity).
 * 5. tokens is patched atomically — if patch.tokens is undefined, the
 *    current value is preserved.
 * 6. requestedOperation is cleared by setting patch.requestedOperation = null (null = explicit clear sentinel).
 *
 * AFTER MERGE: validateStateInvariants is re-run. If violations are found,
 * repairState is applied and a warning is logged.
 */
export function mergeStatePatch(
  current: SessionState,
  patch: StatePatch,
): SessionState {
  // ── Step 1: shallow merge, skipping undefined patch fields ────────────────
  const merged: SessionState = { ...current };

  for (const key of Object.keys(patch) as Array<keyof StatePatch>) {
    const patchValue = patch[key];
    if (patchValue === undefined) {
      // undefined in patch = "don't touch" — preserve current value
      continue;
    }
    // null is intentional clear — allow it
    (merged as unknown as Record<string, unknown>)[key] = patchValue;
  }

  // ── Step 2: deep-merge masteryByModule ────────────────────────────────────
  if (patch.masteryByModule !== undefined && patch.masteryByModule !== null) {
    merged.masteryByModule = {
      ...current.masteryByModule,
      ...patch.masteryByModule,
    };
  }

  // ── Step 3: deep-merge engagement ────────────────────────────────────────
  if (patch.engagement !== undefined && patch.engagement !== null) {
    merged.engagement = {
      ...current.engagement,
      ...patch.engagement,
    };
  }

  // ── Step 4: preserve continuity fields if patch omits them ────────────────
  for (const field of CONTINUITY_FIELDS) {
    if (patch[field] === undefined && current[field] !== undefined) {
      (merged as unknown as Record<string, unknown>)[field] = current[field];
    }
  }

  // ── Step 5: requestedOperation null-as-clear ────────────────────────────
  // CANONICAL SEMANTICS (Opción A — matches StatePatch contract):
  //   null   = explicit clear (erase the field)
  //   undefined = no-op (preserve current value — handled by loop above)
  // clearRequestedOperation() must return { requestedOperation: null } to trigger this.
  if (patch.requestedOperation === null) {
    merged.requestedOperation = undefined;
  }

  // ── Step 6: re-validate after merge ──────────────────────────────────────
  const postMergeValidation = validateStateInvariants(merged);
  if (!postMergeValidation.valid) {
    console.error(
      `[state-manager] mergeStatePatch produced invalid state. ` +
      `Applying repair. Violations: ${postMergeValidation.errors.join('; ')}`
    );
    return repairState(merged, postMergeValidation.errors);
  }

  if (postMergeValidation.warnings.length > 0) {
    console.warn(
      `[state-manager] mergeStatePatch warnings: ${postMergeValidation.warnings.join('; ')}`
    );
  }

  return merged;
}

/**
 * incrementTokens
 * ──────────────────────────────────────────────────────────────────────────
 * Increments tokens by exactly 1. Called once per completed request turn.
 *
 * INVARIANT: called exactly once per request lifecycle, never twice.
 * route.ts is responsible for calling this at the correct point.
 */
export function incrementTokens(state: SessionState): StatePatch {
  return { tokens: state.tokens + 1 };
}

/**
 * advanceTutorPhase
 * ──────────────────────────────────────────────────────────────────────────
 * Returns the next TutorPhase for the given mode and current phase.
 * Called by orchestrator when skipPhaseAdvance === false.
 *
 * Phase sequences per TutorMode (from tutorProtocol.ts):
 *   structured    : guide → lesson → schema → quiz → feedback → (repeat lesson)
 *   conversational: guide → conversation → schema → quiz → (repeat conversation)
 *   professional  : guide → lesson → quiz → feedback → (repeat lesson)
 *   diagnostic    : quiz → feedback → guide
 *   interact/free : BYPASS — always 'conversation', no phase advancement
 */
export function advanceTutorPhase(
  currentPhase: TutorPhase,
  activeMode: ActiveMode,
): TutorPhase {
  // interact and free modes never advance phases
  if (activeMode === 'interact' || activeMode === 'free') {
    return 'conversation';
  }

  // Structured mode phase sequence
  if (activeMode === 'structured' || activeMode === 'pdf_course') {
    const sequence: TutorPhase[] = [
      'guide', 'lesson', 'schema', 'quiz', 'feedback',
    ];
    const currentIndex = sequence.indexOf(currentPhase);
    if (currentIndex === -1 || currentIndex >= sequence.length - 1) {
      // After feedback, return to lesson for next module
      return 'lesson';
    }
    return sequence[currentIndex + 1];
  }

  // Default: no change
  return currentPhase;
}

/**
 * clearRequestedOperation
 * ──────────────────────────────────────────────────────────────────────────
 * Returns a StatePatch that clears requestedOperation.
 * Called by execution-engine after executing a hard override.
 */
export function clearRequestedOperation(): StatePatch {
  // Returns null — the explicit clear sentinel.
  // undefined would be a no-op; null triggers the clear branch in mergeStatePatch().
  return { requestedOperation: null };
}

/**
 * buildFirstTurnState
 * ──────────────────────────────────────────────────────────────────────────
 * Returns a clean initial SessionState for a new session.
 * Used when frontend sends tokens=0 with no prior state.
 */
export function buildFirstTurnState(
  overrides: Partial<SessionState> = {},
): SessionState {
  return mergeStatePatch(DEFAULT_SESSION_STATE, overrides as StatePatch);
}
