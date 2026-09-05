export const POLICY = {
  owner: 'lingora-labs',
  repo: 'lingora',
  mainWrite: true,
  forcePushMain: false,
  deleteMain: false,
  rollback: 'revert-commit' as const,
};

export function resolveBranch(branch?: string): string {
  return (branch || 'main').replace(/^refs\/heads\//, '');
}

export function forbidDestructive(op: string, branch: string) {
  if (op === 'force_push') throw new Error('Policy: force push is forbidden');
  if (op === 'delete_ref' && branch === 'main') throw new Error('Policy: deleting main is forbidden');
}
