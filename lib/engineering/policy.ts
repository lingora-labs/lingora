export const POLICY = {
  owner: 'lingora-labs',
  repo: 'lingora',
  // GATE-01 (AE "STOP DE ARQUITECTURA", 15.10.2026): direct writes to main
  // are no longer permitted from any internal engineering command. All
  // changes must go through create_branch -> write_file(s) on that branch
  // -> create_pull_request -> independent human approval + passing checks
  // -> merge_pull_request. This flag is enforced in code (tools.ts), not
  // merely declarative — see assertBranchWritable() below.
  mainWrite: false,
  forcePushMain: false,
  deleteMain: false,
  rollback: 'revert-commit' as const,
  // GATE-01: mergePullRequest() in tools.ts now requires, before calling
  // GitHub's merge endpoint:
  //  - at least one APPROVED review from a user other than the PR author
  //  - at least one check-run on the PR head SHA, and all of them 'success'
  // Both conditions are enforced in code, not only documented here.
  requireIndependentApprovalForMerge: true,
  requireChecksForMerge: true,
} as const;

export function resolveBranch(branch?: string): string {
  return (branch || 'main').replace(/^refs\/heads\//, '');
}

export function forbidDestructive(op: string, branch: string) {
  if (op === 'force_push') throw new Error('Policy: force push is forbidden');
  if (op === 'delete_ref' && branch === 'main') throw new Error('Policy: deleting main is forbidden');
}

// GATE-01: fails closed. Any internal command attempting to create, update
// or delete a file directly on `main` is refused here, unconditionally,
// while POLICY.mainWrite is false. The only path onto main is a reviewed,
// checked pull request merge — see mergePullRequest() in tools.ts.
export function assertBranchWritable(branch: string) {
  if (branch === 'main' && !POLICY.mainWrite) {
    throw new Error(
      'Policy (GATE-01): direct writes to main are forbidden. Create a branch, ' +
        'open a pull request, and merge only after independent approval and passing checks.',
    );
  }
}
