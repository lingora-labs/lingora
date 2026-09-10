import { ALLOWED_OWNER, ALLOWED_REPO, assertRepo, gh } from './github-app';
import { POLICY, forbidDestructive, resolveBranch } from './policy';
import { CANONICAL_PRODUCT_URL } from '../product';

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

// ─── run_diagnostic ──────────────────────────────────────────────────────────
// Calls /api/chat via the canonical production URL (server-to-server, no
// browser). DAE can invoke this tool directly to run WILLY FREE without a
// human intermediary.

const WILLY_FREE_PROMPT = `Quiero que me enseñes de verdad, no que me resumas. Supón que tengo nivel A1 de español pero buena capacidad intelectual general.

Primero enséñame a presentarme en español y explícame claramente SER/ESTAR, HAY/ESTÁ, presente regular y ME GUSTA/ME GUSTAN. Quiero una explicación pedagógica larga, como una profesora real, no como una ficha.

Dentro de la respuesta normal del chat, incluye cuadros visuales comparativos ricos, claramente diferenciados, con estructura visual fuerte. No quiero solo Markdown plano ni una tabla mínima.

Después cambia de dominio sin tratarme como principiante intelectual: dame una introducción seria a la acupuntura china, distinguiendo tradición, hipótesis y evidencia moderna. Mi A1 es de español, no de acupuntura.

Finalmente genera dos artifacts reales y descargables: 1. un curso de español A1; 2. un curso introductorio de acupuntura china.

No me pidas confirmaciones intermedias. Toma iniciativa pedagógica y termina proponiendo una sola actividad concreta para continuar.`;

const WILLY_INITIAL_STATE = {
  interfaceLanguage: 'es',
  mentorProfile: 'sarah',
  activeMode: 'interact',
  tutorPhase: 'guide',
  tokens: 0,
  targetLanguage: 'es',
  confirmedLevel: null,
  userLevel: 'A1',
  lastConcept: null,
  lastUserGoal: null,
  masteryByModule: {},
  samples: [],
};

function getChatUrl(): string {
  // Prefer the canonical production alias — it is the public domain real
  // users and other agents already reach successfully.
  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3000/api/chat';
  }
  return `${CANONICAL_PRODUCT_URL}/api/chat`;
}

const DIAGNOSTIC_HEADER_KEYS = [
  'x-vercel-id',
  'www-authenticate',
  'server',
  'content-type',
  'set-cookie',
  'location',
  'x-vercel-cache',
] as const;

function extractDiagnosticHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of DIAGNOSTIC_HEADER_KEYS) {
    const value = headers.get(key);
    if (value) out[key] = value;
  }
  return out;
}

interface ChatAPIResult {
  message: string;
  artifact: unknown;
  artifacts: unknown[];
  modelSignals: unknown[];
  state: unknown;
  chars: number;
  durationMs: number;
}

async function callChatAPI(message: string, state: Record<string, unknown> = WILLY_INITIAL_STATE): Promise<ChatAPIResult> {
  const url = getChatUrl();
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, state }),
  });

  const durationMs = Date.now() - t0;

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const diagHeaders = extractDiagnosticHeaders(res.headers);
    throw new Error(
      `chat API error: HTTP ${res.status} url=${url} `
      + `headers=${JSON.stringify(diagHeaders)} `
      + `bodyLen=${bodyText.length} body=${bodyText.slice(0, 300)}`,
    );
  }

  const ct = res.headers.get('content-type') || '';

  if (ct.includes('text/event-stream')) {
    // SSE — accumulate stream
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No readable body');
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let finalState: unknown = null;
    let artifact: unknown = null;
    const artifacts: unknown[] = [];
    let modelSignals: unknown[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const chunk = JSON.parse(line.slice(6).trim());
          if (typeof chunk.delta === 'string') fullText += chunk.delta;
          if (chunk.done) {
            if (chunk.message) fullText = chunk.message;
            if (chunk.state) finalState = chunk.state;
            if (chunk.artifact) { artifact = chunk.artifact; artifacts.push(chunk.artifact); }
            if (chunk.artifacts) artifacts.push(...chunk.artifacts);
            if (Array.isArray(chunk.artifactSignals)) modelSignals = chunk.artifactSignals;
          } else if (chunk.artifact) {
            artifact = chunk.artifact;
            artifacts.push(chunk.artifact);
          }
        } catch { /* skip malformed chunk */ }
      }
    }

    return { message: fullText, artifact, artifacts, modelSignals, state: finalState, chars: fullText.length, durationMs };
  } else {
    const data = await res.json();
    const msg = data.message || '';
    const art = data.artifact || null;
    return {
      message: msg,
      artifact: art,
      artifacts: art ? [art] : [],
      modelSignals: Array.isArray(data.artifactSignals) ? data.artifactSignals : [],
      state: data.state,
      chars: msg.length,
      durationMs,
    };
  }
}

export async function runDiagnostic(prompt?: string): Promise<Record<string, unknown>> {
  // P10 — ARTIFACT EMISSION RELIABILITY harness.
  // Isolates the signal_artifact decision call from full teaching+render, so
  // emission reliability can be measured N times against ONE captured taught
  // text without paying for N full WILLY runs (teaching regeneration + PDF
  // materialization). Reuses buildMentorPrompt/buildModelParams from
  // mentor-engine.ts and SIGNAL_ARTIFACT_TOOL/parseArtifactSignal from
  // artifact-signal.ts UNCHANGED — no production file touched by this harness.
  if (prompt && prompt.startsWith('decision_harness')) {
    const parts = prompt.split(':');
    const runs = Math.max(1, Math.min(50, Number(parts[1]) || 20));
    return runDecisionHarness(runs);
  }

  const isWilly = !prompt || prompt === 'willy';
  const actualPrompt = isWilly ? WILLY_FREE_PROMPT : prompt;
  const label = isWilly ? 'WILLY FREE' : 'CUSTOM';

  const result = await callChatAPI(actualPrompt);

  const msg = result.message;
  const arts = result.artifacts;
  const chars = result.chars;
  const modelSignals = result.modelSignals as Array<{ type?: string; subject?: string; trigger?: string }>;

  // Evaluate WILLY FREE criteria
  const mentorFirst = chars > 200
    && !msg.slice(0, 400).toLowerCase().includes('has pedido artifact')
    && !msg.slice(0, 400).toLowerCase().includes('solicitud explícita de artefacto');
  const compoundActAcupuncture = msg.toLowerCase().includes('acupun');
  const streamComplete = chars > 3000;
  const hasVisualTable = (msg.match(/\|/g) || []).length > 4;
  const artifactCount = arts.length;
  const multiSignal = artifactCount >= 2;
  const noAudio = !arts.some((a: any) => a?.type === 'audio');
  const noDebugJson = !msg.includes('"executor"') && !msg.includes('"pedagogicalAction"');
  const artifactSubjects = arts.map((a: any) => a?.subject || a?.title || a?.type || '?');
  const artifactComposerStatus = arts.map((a: any) => a?.composerStatus ?? 'unknown');

  const registryEntries = (result.state as { artifactRegistry?: Array<{ id?: string; title?: string }> } | null)
    ?.artifactRegistry ?? [];

  const verdict = mentorFirst && streamComplete && compoundActAcupuncture ? 'PROGRESO' : 'FAIL';

  return {
    test: label,
    verdict,
    chars,
    durationMs: result.durationMs,
    trace: {
      modelSignalCount: modelSignals.length,
      modelSignals: modelSignals.map((s) => ({ type: s?.type, subject: s?.subject, trigger: s?.trigger })),
      artifactRegistryCount: registryEntries.length,
      artifactRegistry: registryEntries.map((e) => ({ id: e?.id, title: e?.title })),
      composerStatusPerArtifact: artifactComposerStatus,
    },
    criteria: {
      mentorFirst,
      compoundActAcupuncture,
      streamComplete,
      hasVisualTable,
      artifactCount,
      multiSignal,
      multiSignalGate: 2,
      noAudio,
      noDebugJson,
      artifactSubjects,
    },
    messagePreview: msg.slice(0, 600),
    state: result.state,
  };
}

async function runDecisionHarness(runs: number): Promise<Record<string, unknown>> {
  const { buildMentorPrompt, buildModelParams } = await import('../../server/mentors/mentor-engine');
  const { SIGNAL_ARTIFACT_TOOL, parseArtifactSignal } = await import('../artifact-signal');
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';

  const { system, user } = buildMentorPrompt({ message: WILLY_FREE_PROMPT, state: WILLY_INITIAL_STATE });

  // Step 1: capture ONE realistic compound taught text (teaching only, no
  // decision call, no PDF materialization) — reused for all N decision runs.
  const teachCompletion = await openai.chat.completions.create({
    ...buildModelParams(RUNTIME_MODEL, 8192, 0.7, 0.88),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const taught = (teachCompletion.choices?.[0]?.message?.content ?? '').trim();

  // Step 2: replicate the exact production decision call (mentor-engine.ts
  // getMentorResponseStream), unmodified in logic, `runs` times against the
  // SAME taught text.
  const decisionSystemAddition =
    '\nYou already taught. Now decide side-effects only via signal_artifact. No student-facing text.'
    + '\nIf the content you taught covered multiple distinct subjects, call signal_artifact once per subject that warrants materialization — each with a distinct subject field. Do not merge subjects into one call.';

  const outcomes: Array<{ count: number; subjects: string[] }> = [];
  for (let i = 0; i < runs; i++) {
    try {
      const decision = await openai.chat.completions.create({
        ...buildModelParams(RUNTIME_MODEL, 700, 0),
        tools: [SIGNAL_ARTIFACT_TOOL],
        tool_choice: 'auto',
        messages: [
          { role: 'system', content: system + decisionSystemAddition },
          { role: 'user', content: user },
          { role: 'assistant', content: taught.slice(0, 40000) },
        ],
      });
      const subjects: string[] = [];
      for (const tc of decision.choices?.[0]?.message?.tool_calls ?? []) {
        if (tc.function?.name !== 'signal_artifact') continue;
        try {
          const parsed = parseArtifactSignal(JSON.parse(tc.function.arguments || '{}'));
          if (parsed) subjects.push(parsed.subject);
        } catch { /* drop */ }
      }
      outcomes.push({ count: subjects.length, subjects });
    } catch (e) {
      outcomes.push({ count: -1, subjects: [`ERROR: ${e instanceof Error ? e.message : String(e)}`] });
    }
  }

  const distribution: Record<string, number> = {};
  for (const o of outcomes) {
    const k = String(o.count);
    distribution[k] = (distribution[k] ?? 0) + 1;
  }

  return {
    harness: 'decision_harness',
    taughtChars: taught.length,
    taughtPreview: taught.slice(0, 300),
    runs,
    distribution,
    outcomes,
  };
}

// ─── GitHub tools (unchanged) ─────────────────────────────────────────────────

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
    { name: 'run_diagnostic', description: 'Run WILLY FREE, a custom prompt, or decision_harness:<N> against /api/chat / OpenAI directly. No browser needed.' },
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

    case 'run_diagnostic':
      return runDiagnostic(args.prompt ? String(args.prompt) : undefined);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
