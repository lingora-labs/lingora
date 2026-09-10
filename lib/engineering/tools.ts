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

// P11 — ARTIFACT BINARY DELIVERY (QA escrow).
// Manual base64 reproduction (DAE retyping a 10K+ char string into bash) was
// demonstrated to corrupt bytes: a single-character substitution
// (WinAnsiEncoding -> RinAnsiEncoding) and, separately, a wrong byte length
// entirely. That is a transcription-fidelity problem, not a product defect.
// Fix: the base64 already sitting in the artifact's data: URL — produced by
// the server, never touched by DAE — is written AS-IS (no decode/re-encode)
// to a QA-only path in this repo via the GitHub Contents API, whose base64
// handling is done by code, not by DAE retyping text. DAE then retrieves the
// exact bytes via raw.githubusercontent.com, which IS reachable from the
// sandbox (unlike lingora-labs.vercel.app), using curl — zero manual copy at
// any step. No new secrets: reuses the GitHub App credentials this MCP
// already holds. Does not touch artifactRegistry, mentor-engine, or any
// product runtime file.
async function putBinaryFile(path: string, base64Content: string, message: string, branch: string) {
  const existing = await readFile(path, branch);
  const { status, data } = await gh<{
    commit: { sha: string; html_url: string };
    content: { sha: string };
  }>(
    'PUT',
    `${repoPath()}/contents/${encodeURIComponent(path)}`,
    {
      message,
      content: base64Content,
      branch,
      ...(existing.found && existing.sha ? { sha: existing.sha } : {}),
    },
  );
  if (status >= 400) throw new Error(`putBinaryFile failed: ${status} ${JSON.stringify(data)}`);
  return { path, commitSha: data.commit.sha, blobSha: data.content.sha };
}

interface EscrowedArtifact {
  id?: string;
  title?: string;
  path: string;
  commitSha: string;
  rawUrl: string;
  serverSha256?: string;
  serverByteLength?: number;
}

async function escrowPdfArtifacts(registryEntries: Array<{ id?: string; title?: string; payload?: any }>): Promise<EscrowedArtifact[]> {
  const b = resolveBranch('main');
  const out: EscrowedArtifact[] = [];
  const ts = Date.now();
  let i = 0;
  for (const entry of registryEntries) {
    const url: string | undefined = entry?.payload?.url;
    if (!url || !url.startsWith('data:application/pdf;base64,')) continue;
    const b64 = url.slice('data:application/pdf;base64,'.length);
    const path = `qa-artifacts/${ts}-${i}.pdf`;
    const written = await putBinaryFile(path, b64, `lingora(qa): escrow artifact ${entry.id ?? i} for P9c visual certification`, b);
    out.push({
      id: entry.id,
      title: entry.title,
      path,
      commitSha: written.commitSha,
      rawUrl: `https://raw.githubusercontent.com/${ALLOWED_OWNER}/${ALLOWED_REPO}/${written.commitSha}/${path}`,
      serverSha256: entry?.payload?.pdfSha256,
      serverByteLength: entry?.payload?.pdfByteLength,
    });
    i++;
  }
  return out;
}

export async function runDiagnostic(prompt?: string): Promise<Record<string, unknown>> {
  if (prompt && prompt.startsWith('decision_harness_json')) {
    const parts = prompt.split(':');
    const runs = Math.max(1, Math.min(50, Number(parts[1]) || 20));
    return runDecisionHarnessJSON(runs);
  }
  if (prompt && prompt.startsWith('decision_harness')) {
    const parts = prompt.split(':');
    const runs = Math.max(1, Math.min(50, Number(parts[1]) || 20));
    return runDecisionHarness(runs);
  }

  const isEscrow = prompt === 'willy_escrow';
  const isWilly = isEscrow || !prompt || prompt === 'willy';
  const actualPrompt = isWilly ? WILLY_FREE_PROMPT : prompt;
  const label = isWilly ? 'WILLY FREE' : 'CUSTOM';

  const result = await callChatAPI(actualPrompt);

  const msg = result.message;
  const arts = result.artifacts;
  const chars = result.chars;
  const modelSignals = result.modelSignals as Array<{ type?: string; subject?: string; trigger?: string }>;

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

  const registryEntries = (result.state as { artifactRegistry?: Array<{ id?: string; title?: string; payload?: any }> } | null)
    ?.artifactRegistry ?? [];

  const verdict = mentorFirst && streamComplete && compoundActAcupuncture ? 'PROGRESO' : 'FAIL';

  const out: Record<string, unknown> = {
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

  if (isEscrow) {
    try {
      out.escrow = await escrowPdfArtifacts(registryEntries);
    } catch (e) {
      out.escrowError = e instanceof Error ? e.message : String(e);
    }
  }

  return out;
}

function harnessModelParams(model: string, tokens: number, temperature?: number, topP?: number) {
  const isGPT5Family = /^gpt-5/i.test(model) || /^o[0-9]/i.test(model);
  if (isGPT5Family) return { model, max_completion_tokens: tokens, ...(temperature !== undefined ? { temperature } : {}) };
  return { model, max_tokens: tokens, ...(temperature !== undefined ? { temperature } : {}), ...(topP !== undefined ? { top_p: topP } : {}) };
}

async function captureTaught(openai: any, harnessModelParamsFn: typeof harnessModelParams, model: string, system: string, user: string): Promise<string> {
  const teachCompletion = await openai.chat.completions.create({
    ...harnessModelParamsFn(model, 8192, 0.7, 0.88),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return (teachCompletion.choices?.[0]?.message?.content ?? '').trim();
}

// P10 — baseline harness: replicates production's tool-calling decision exactly
// (mentor-engine.ts getMentorResponseStream), N times against ONE captured
// taught text. No production file touched.
async function runDecisionHarness(runs: number): Promise<Record<string, unknown>> {
  const { SIGNAL_ARTIFACT_TOOL, parseArtifactSignal, ARTIFACT_CHANNEL_INSTRUCTION } = await import('../artifact-signal');
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';

  const system = `You are Sarah, a warm and expert Spanish tutor at LINGORA, teaching an adult student with strong general intelligence.${ARTIFACT_CHANNEL_INSTRUCTION}\n\nRespond with full pedagogical depth. Use tables, structured explanations, and examples when they serve the student. Do not pad. Do not repeat. If the student sequenced several requests in this message, cover that sequence in this turn instead of deferring parts.`;
  const user = WILLY_FREE_PROMPT;

  const taught = await captureTaught(openai, harnessModelParams, RUNTIME_MODEL, system, user);

  const decisionSystemAddition =
    '\nYou already taught. Now decide side-effects only via signal_artifact. No student-facing text.'
    + '\nIf the content you taught covered multiple distinct subjects, call signal_artifact once per subject that warrants materialization — each with a distinct subject field. Do not merge subjects into one call.';

  const outcomes: Array<{ count: number; subjects: string[]; finishReason?: string; rawToolCallCount?: number }> = [];
  for (let i = 0; i < runs; i++) {
    try {
      const decision = await openai.chat.completions.create({
        ...harnessModelParams(RUNTIME_MODEL, 700, 0),
        tools: [SIGNAL_ARTIFACT_TOOL],
        tool_choice: 'auto',
        messages: [
          { role: 'system', content: system + decisionSystemAddition },
          { role: 'user', content: user },
          { role: 'assistant', content: taught.slice(0, 40000) },
        ],
      });
      const rawToolCalls = decision.choices?.[0]?.message?.tool_calls ?? [];
      const subjects: string[] = [];
      for (const tc of rawToolCalls) {
        if (tc.function?.name !== 'signal_artifact') continue;
        try {
          const parsed = parseArtifactSignal(JSON.parse(tc.function.arguments || '{}'));
          if (parsed) subjects.push(parsed.subject);
        } catch { /* drop */ }
      }
      outcomes.push({
        count: subjects.length,
        subjects,
        finishReason: decision.choices?.[0]?.finish_reason,
        rawToolCallCount: rawToolCalls.length,
      });
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
    harness: 'decision_harness (tool_calls baseline)',
    taughtChars: taught.length,
    taughtPreview: taught.slice(0, 300),
    runs,
    distribution,
    outcomes,
  };
}

// P10 — alternative design: instead of relying on the model to emit MULTIPLE
// tool_calls in a single completion (probabilistic — baseline harness shows
// 16-20/20 depending on the specific taught text), ask for a single JSON
// object listing every subject that warrants materialization, then let CODE
// deterministically construct one ArtifactSignal per listed subject. The
// MODEL still decides what/whether to materialize (untouched authority);
// the CODE deterministically executes that decision instead of hoping the
// API returns N tool_calls in one turn. Same taught-capture, same subjects,
// only the decision mechanism differs. No production file touched.
async function runDecisionHarnessJSON(runs: number): Promise<Record<string, unknown>> {
  const { parseArtifactSignal, ARTIFACT_CHANNEL_INSTRUCTION } = await import('../artifact-signal');
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';

  const system = `You are Sarah, a warm and expert Spanish tutor at LINGORA, teaching an adult student with strong general intelligence.${ARTIFACT_CHANNEL_INSTRUCTION}\n\nRespond with full pedagogical depth. Use tables, structured explanations, and examples when they serve the student. Do not pad. Do not repeat. If the student sequenced several requests in this message, cover that sequence in this turn instead of deferring parts.`;
  const user = WILLY_FREE_PROMPT;

  const taught = await captureTaught(openai, harnessModelParams, RUNTIME_MODEL, system, user);

  const jsonDecisionSystem =
    'You already taught the content below. Now decide, for the ENTIRE taught content, which distinct subjects warrant a materialized artifact (e.g. a downloadable PDF course). '
    + 'List EVERY subject that warrants one — if the content covered two distinct domains and both deserve materialization, list both as separate entries. Do not merge distinct subjects into one entry. '
    + 'Respond with ONLY this JSON object, no other text: {"artifacts": [{"type": "emit_pdf", "trigger": "pedagogical_completion", "subject": "exact subject name"}]} — the array may have 0, 1, or more entries.';

  const outcomes: Array<{ count: number; subjects: string[]; finishReason?: string; rawEntryCount?: number }> = [];
  for (let i = 0; i < runs; i++) {
    try {
      const decision = await openai.chat.completions.create({
        ...harnessModelParams(RUNTIME_MODEL, 700, 0),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: jsonDecisionSystem },
          { role: 'user', content: user },
          { role: 'assistant', content: taught.slice(0, 40000) },
        ],
      });
      const raw = decision.choices?.[0]?.message?.content ?? '{}';
      let rawEntries: unknown[] = [];
      try {
        const parsed = JSON.parse(raw);
        rawEntries = Array.isArray(parsed.artifacts) ? parsed.artifacts : [];
      } catch { /* leave empty */ }
      const subjects: string[] = [];
      for (const entry of rawEntries) {
        const parsed = parseArtifactSignal(entry);
        if (parsed) subjects.push(parsed.subject);
      }
      outcomes.push({
        count: subjects.length,
        subjects,
        finishReason: decision.choices?.[0]?.finish_reason,
        rawEntryCount: rawEntries.length,
      });
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
    harness: 'decision_harness_json (structured list alternative)',
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
    { name: 'run_diagnostic', description: 'Run WILLY FREE ("willy"), WILLY with binary escrow of PDF artifacts ("willy_escrow"), a custom prompt, decision_harness:<N>, or decision_harness_json:<N>. No browser needed.' },
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
