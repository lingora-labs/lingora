// Engineering control plane policy (7.5 S0).
//
// The plane can read and write the repository and run paid model calls, so in
// this candidate everything is OFF unless the deployment opts in explicitly:
//
//   LINGORA_ENGINEERING_PLANE=enabled        → /api/mcp and /api/mcp/health exist (404 otherwise)
//   LINGORA_ENGINEERING_MAIN_WRITE=enabled   → writes, deletes, reverts and merges may target main
//   LINGORA_ENGINEERING_QUERY_KEY=enabled    → the ?key= channel (connector that cannot send headers)
//
// Secrets in a query string end up in access logs and browser history, so the
// ?key= channel is a separate opt-in from the plane itself. The Bearer channel
// is the default.

type Env = Record<string, string | undefined>

const on = (env: Env, name: string) => env[name] === 'enabled'

export function planeEnabled(env: Env = process.env): boolean {
  return on(env, 'LINGORA_ENGINEERING_PLANE')
}

export function mainWritesAllowed(env: Env = process.env): boolean {
  return on(env, 'LINGORA_ENGINEERING_MAIN_WRITE')
}

export function queryKeyAllowed(env: Env = process.env): boolean {
  return on(env, 'LINGORA_ENGINEERING_QUERY_KEY')
}

export function currentPolicy(env: Env = process.env) {
  return {
    owner: 'lingora-labs',
    repo: 'lingora',
    mainWrite: mainWritesAllowed(env),
    queryKeyChannel: queryKeyAllowed(env),
    forcePushMain: false,
    deleteMain: false,
    rollback: 'revert-commit' as const,
  }
}

export function resolveBranch(branch?: string): string {
  return (branch || 'main').replace(/^refs\/heads\//, '')
}

/** Throws unless the operation may mutate `branch`. Every mutating tool calls this first. */
export function assertWritable(branch: string, env: Env = process.env): void {
  const b = resolveBranch(branch)
  if (b === 'main' && !mainWritesAllowed(env))
    throw new Error('Policy: writes to main are disabled on this deployment (LINGORA_ENGINEERING_MAIN_WRITE is not enabled). Use a branch and a pull request.')
}

export function forbidDestructive(op: string, branch: string) {
  if (op === 'force_push') throw new Error('Policy: force push is forbidden')
  if (op === 'delete_ref' && branch === 'main') throw new Error('Policy: deleting main is forbidden')
}
