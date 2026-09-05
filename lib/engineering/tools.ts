import { ALLOWED_OWNER, ALLOWED_REPO, assertRepo, gh } from './github-app';
import { POLICY, forbidDestructive, resolveBranch } from './policy';

type GhRef = { object: { sha: string } };
type GhCommit = {
  sha: string;
  html_url?: string;
  commit?: { message: string; tree: { sha: string } };
  parents?: Array<{ sha: string }>;
};
type GhContent = { sha?: string; content?: string; encoding?: string; html_url?: string; type?: string };

function repoPath() {
  return `/repos/${ALLOWED_OWNER}/${ALLOWED_REPO}`;
}

export async function repoStatus() {
  const { data: repo } = await gh<{ default_branch: string; html_url: string }>('GET', repoPath());
  const { data: ref } = await gh<GhRef>('GET', `${repoPath()}/git/ref/heads/main`);
  return {
    owner: ALLOWED_OWNER,
    repo: ALLOWED_REPO,
    defaultBranch: repo.default_branch,
    mainHead: ref.object.sha,
    htmlUrl: repo.html_url,
    policy: POLICY,
  };
}

export async function listBranches() {
  const { data } = await gh<Array<{ name: string; commit: { sha: string }; protected: boolean }>>(
    'GET',
    `${repoPath()}/branches?per_page=100`,
  );
  return data.map((b) => ({ name: b.name, sha: b.commit.sha, protected: b.protected }));
}

export async function listTree(ref = 'main') {
  const { data } = await gh<{ truncated: boolean; tree: Array<{ path: string; type: string; sha: string }> }>(
    'GET',
    `${repoPath()}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  return { truncated: data.truncated, tree: data.tree };
}

export async function readFile(path: string, ref = 'main') {
  const { status, data } = await gh<GhContent>(
    'GET',
    `${repoPath()}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
  );
  if (status === 404) return { found: false, path, ref };
  const raw = data.encoding === 'base64' && data.content
    ? Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8')
    : data.content || '';
  return { found: true, path, ref, sha: data.sha, content: raw };
}

export async function getCommit(sha: string) {
  const { data } = await gh<GhCommit>('GET', `${repoPath()}/commits/${encodeURIComponent(sha)}`);
  return data;
}

export async function compareRefs(base: string, head: string) {
  const { data } = await gh(
    'GET',
    `${repoPath()}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
  );
  return data;
}

async function getHeadSha(branch: string): Promise<string> {
  const { status, data } = await gh<GhRef>('GET', `${repoPath()}/git/ref/heads/${branch}`);
  if (status === 404) throw new Error(`Branch not found: ${branch}`);
  return data.object.sha;
}

export async function createBranch(name: string, from = 'main') {
  const sha = await getHeadSha(resolveBranch(from));
  const { status, data } = await gh<{ ref: string; object: { sha: string } }>(
    'POST',
    `${repoPath()}/git/refs`,
    {
      ref: `refs/heads/${name}`,
      sha,
    },
  );
  if (status >= 400) throw new Error(`create_branch failed: ${status} ${JSON.stringify(data)}`);
  return { branch: name, sha: data.object.sha };
}

async function putFile(path: string, content: string, message: string, branch: string) {
  const existing = await readFile(path, branch);
  const { status, data } = await gh<{
    commit: { sha: string; html_url: string };
    content: { sha: string };
  }>(
    'PUT',
    `${repoPath()}/contents/${encodeURIComponent(path)}`,
    {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      ...(existing.found && existing.sha ? { sha: existing.sha } : {}),
    },
  );
  if (status >= 400) throw new Error(`write_file failed: ${status} ${JSON.stringify(data)}`);
  return { path, commitSha: data.commit.sha, url: data.commit.html_url };
}

export async function writeFile(
  path: string,
  content: string,
  message: string,
  branch = 'main',
) {
  const b = resolveBranch(branch);
  return putFile(path, content, message, b);
}

export async function writeFiles(
  files: Array<{ path: string; content: string }>,
  message: string,
  branch = 'main',
) {
  const b = resolveBranch(branch);
  if (files.length === 1) return writeFile(files[0].path, files[0].content, message, b);

  const head = await getHeadSha(b);
  const { data: headCommit } = await gh<{ tree: { sha: string }; sha: string }>(
    'GET',
    `${repoPath()}/git/commits/${head}`,
  );

  const blobs: Array<{ path: string; sha: string; mode: string; type: string }> = [];

  for (const f of files) {
    const { status, data } = await gh<{ sha: string }>(
      'POST',
      `${repoPath()}/git/blobs`,
      {
        content: Buffer.from(f.content, 'utf8').toString('base64'),
        encoding: 'base64',
      },
    );
    if (status >= 400) throw new Error(`blob failed: ${JSON.stringify(data)}`);
    blobs.push({ path: f.path, sha: data.sha, mode: '100644', type: 'blob' });
  }

  const { status: ts, data: tree } = await gh<{ sha: string }>(
    'POST',
    `${repoPath()}/git/trees`,
    {
      base_tree: headCommit.tree.sha,
      tree: blobs,
    },
  );
  if (ts >= 400) throw new Error(`tree failed: ${JSON.stringify(tree)}`);

  const { status: cs, data: commit } = await gh<{ sha: string; html_url?: string }>(
    'POST',
    `${repoPath()}/git/commits`,
    {
      message,
      tree: tree.sha,
      parents: [head],
    },
  );
  if (cs >= 400) throw new Error(`commit failed: ${JSON.stringify(commit)}`);

  const { status: rs, data: ref } = await gh(
    'PATCH',
    `${repoPath()}/git/refs/heads/${b}`,
    {
      sha: commit.sha,
      force: false,
    },
  );
  if (rs >= 400) throw new Error(`update ref failed: ${JSON.stringify(ref)}`);

  return {
    commitSha: commit.sha,
    branch: b,
    files: files.map((f) => f.path),
  };
}

export async function deleteFile(path: string, message: string, branch = 'main') {
  const b = resolveBranch(branch);
  const existing = await readFile(path, b);

  if (!existing.found || !existing.sha) {
    throw new Error(`File not found: ${path}`);
  }

  const { status, data } = await gh<{ commit: { sha: string } }>(
    'DELETE',
    `${repoPath()}/contents/${encodeURIComponent(path)}`,
    {
      message,
      sha: existing.sha,
      branch: b,
    },
  );

  if (status >= 400) throw new Error(`delete_file failed: ${JSON.stringify(data)}`);
  return { path, commitSha: data.commit.sha };
}

export async function rollbackCommit(sha?: string, branch = 'main') {
  forbidDestructive('force_push', branch);

  const b = resolveBranch(branch);
  const head = await getHeadSha(b);
  const target = sha || head;

  const { data: commit } = await gh<{
    parents: Array<{ sha: string }>;
    sha: string;
    commit: { message: string };
  }>(
    'GET',
    `${repoPath()}/commits/${target}`,
  );

  const parent = commit.parents?.[0]?.sha;
  if (!parent) throw new Error('Cannot revert: no parent');

  if (target !== head) {
    throw new Error('rollback_commit currently reverts only HEAD (no history rewrite)');
  }

  const { data: parentCommit } = await gh<{
    commit: { tree: { sha: string } };
  }>(
    'GET',
    `${repoPath()}/commits/${parent}`,
  );

  const { status, data: newCommit } = await gh<{ sha: string }>(
    'POST',
    `${repoPath()}/git/commits`,
    {
      message: `lingora(mcp): revert ${target.slice(0, 7)}`,
      tree: parentCommit.commit.tree.sha,
      parents: [head],
    },
  );

  if (status >= 400) {
    throw new Error(`revert commit failed: ${JSON.stringify(newCommit)}`);
  }

  const { status: rs, data: ref } = await gh(
    'PATCH',
    `${repoPath()}/git/refs/heads/${b}`,
    {
      sha: newCommit.sha,
      force: false,
    },
  );

  if (rs >= 400) {
    throw new Error(`revert ref failed: ${JSON.stringify(ref)}`);
  }

  return {
    reverted: target,
    newHead: newCommit.sha,
    branch: b,
  };
}

export async function createPullRequest(
  title: string,
  head: string,
  base = 'main',
  body = '',
) {
  const { status, data } = await gh<{ number: number; html_url: string }>(
    'POST',
    `${repoPath()}/pulls`,
    {
      title,
      head,
      base,
      body,
    },
  );

  if (status >= 400) {
    throw new Error(`create_pull_request failed: ${JSON.stringify(data)}`);
  }

  return data;
}

export async function listPullRequests(
  state: 'open' | 'closed' | 'all' = 'open',
) {
  const { data } = await gh(
    'GET',
    `${repoPath()}/pulls?state=${state}&per_page=20`,
  );
  return data;
}

export async function getPullRequest(number: number) {
  const { data } = await gh(
    'GET',
    `${repoPath()}/pulls/${number}`,
  );
  return data;
}

export async function mergePullRequest(number: number) {
  const { status, data } = await gh<{ merged: boolean; sha: string }>(
    'PUT',
    `${repoPath()}/pulls/${number}/merge`,
    {
      merge_method: 'squash',
    },
  );

  if (status >= 400) {
    throw new Error(`merge failed: ${JSON.stringify(data)}`);
  }

  return data;
}

export function toolCatalog() {
  return [
    { name: 'repo_status', description: 'HEAD, policy, repo identity for lingora-labs/lingora' },
    { name: 'list_tree', description: 'Recursive git tree for a ref (default main)' },
    { name: 'list_branches', description: 'List branches' },
    { name: 'read_file', description: 'Read a text file from a ref' },
    { name: 'read_files', description: 'Read multiple text files' },
    { name: 'get_commit', description: 'Commit metadata by SHA or ref' },
    { name: 'compare_refs', description: 'Compare two refs' },
    { name: 'write_file', description: 'Create or update one file. branch may be main.' },
    { name: 'write_files', description: 'Atomic multi-file commit. branch may be main.' },
    { name: 'delete_file', description: 'Delete one file on a branch' },
    { name: 'create_branch', description: 'Create a branch from main or given SHA source' },
    { name: 'rollback_commit', description: 'Revert HEAD via new commit (no force push)' },
    { name: 'create_pull_request', description: 'Open a PR' },
    { name: 'get_pull_request', description: 'Read one PR' },
    { name: 'list_pull_requests', description: 'List PRs' },
    { name: 'merge_pull_request', description: 'Squash-merge a PR when policy allows' },
  ];
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  assertRepo(ALLOWED_OWNER, ALLOWED_REPO);

  switch (name) {
    case 'repo_status':
      return repoStatus();

    case 'list_tree':
      return listTree(String(args.ref || 'main'));

    case 'list_branches':
      return listBranches();

    case 'read_file':
      return readFile(String(args.path), String(args.ref || 'main'));

    case 'read_files': {
      const paths = args.paths as string[];
      const out = [];
      for (const p of paths || []) {
        out.push(await readFile(p, String(args.ref || 'main')));
      }
      return out;
    }

    case 'get_commit':
      return getCommit(String(args.sha || 'main'));

    case 'compare_refs':
      return compareRefs(
        String(args.base || 'main'),
        String(args.head),
      );

    case 'write_file':
      return writeFile(
        String(args.path),
        String(args.content),
        String(args.message || `lingora(mcp): update ${args.path}`),
        String(args.branch || 'main'),
      );

    case 'write_files':
      return writeFiles(
        (args.files as Array<{ path: string; content: string }>) || [],
        String(args.message || 'lingora(mcp): update files'),
        String(args.branch || 'main'),
      );

    case 'delete_file':
      return deleteFile(
        String(args.path),
        String(args.message || `lingora(mcp): delete ${args.path}`),
        String(args.branch || 'main'),
      );

    case 'create_branch':
      return createBranch(
        String(args.branch),
        String(args.from_branch || 'main'),
      );

    case 'rollback_commit':
      return rollbackCommit(
        args.sha ? String(args.sha) : undefined,
        String(args.branch || 'main'),
      );

    case 'create_pull_request':
      return createPullRequest(
        String(args.title),
        String(args.head),
        String(args.base || 'main'),
        String(args.body || ''),
      );

    case 'get_pull_request':
      return getPullRequest(Number(args.number));

    case 'list_pull_requests':
      return listPullRequests(
        (args.state as 'open' | 'closed' | 'all') || 'open',
      );

    case 'merge_pull_request':
      return mergePullRequest(Number(args.number));

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
