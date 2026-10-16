// PLACEHOLDER - will replace with full content in next step if needed
export interface ExecutionTrace {
  requestId: string;
  intentResult: IntentResult | null;
  executionPlan: ExecutionPlan;
  stepResults: ExecutionStepResult[];
  totalDurationMs: number;
  statePatchApplied: StatePatch;
}
