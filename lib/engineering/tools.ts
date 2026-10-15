import { ALLOWED_OWNER, ALLOWED_REPO, assertRepo, gh } from './github-app';
import { POLICY, forbidDestructive, resolveBranch, assertBranchWritable } from './policy';
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

export const WILLY_INITIAL_STATE = {
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
  contentType: string;
  deltaCount: number;
  suggestedActions: unknown;
  rawDonePayload: unknown;
}

export async function callChatAPI(message: string, state: Record<string, unknown> = WILLY_INITIAL_STATE, extra: Record<string, unknown> = {}): Promise<ChatAPIResult> {
  const url = getChatUrl();
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, state, ...extra }),
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
    let deltaCount = 0;
    let suggestedActions: unknown = undefined;
    let rawDonePayload: unknown = undefined;

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
          if (typeof chunk.delta === 'string') { fullText += chunk.delta; deltaCount++; }
          if (chunk.done) {
            rawDonePayload = chunk;
            if (chunk.message) fullText = chunk.message;
            if (chunk.state) finalState = chunk.state;
            if (chunk.artifact) { artifact = chunk.artifact; artifacts.push(chunk.artifact); }
            if (chunk.artifacts) artifacts.push(...chunk.artifacts);
            if (Array.isArray(chunk.artifactSignals)) modelSignals = chunk.artifactSignals;
            suggestedActions = chunk.suggestedActions;
          } else if (chunk.artifact) {
            artifact = chunk.artifact;
            artifacts.push(chunk.artifact);
          }
        } catch { /* skip malformed chunk */ }
      }
    }

    return { message: fullText, artifact, artifacts, modelSignals, state: finalState, chars: fullText.length, durationMs, contentType: ct, deltaCount, suggestedActions, rawDonePayload };
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
      contentType: ct,
      deltaCount: 0,
      suggestedActions: data.suggestedActions,
      rawDonePayload: data,
    };
  }
}

// P11 — ARTIFACT BINARY DELIVERY (QA escrow).
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

// Escrow a single raw data:application/pdf;base64 URL (for a direct
// ChatResponse.artifact, not necessarily in artifactRegistry yet).
async function escrowSingleDataUrl(dataUrl: string, label: string): Promise<EscrowedArtifact | null> {
  if (!dataUrl?.startsWith('data:application/pdf;base64,')) return null;
  const b64 = dataUrl.slice('data:application/pdf;base64,'.length);
  const b = resolveBranch('main');
  const path = `qa-artifacts/${Date.now()}-${label}.pdf`;
  const written = await putBinaryFile(path, b64, `lingora(qa): escrow ${label} for product truth audit`, b);
  return {
    title: label,
    path,
    commitSha: written.commitSha,
    rawUrl: `https://raw.githubusercontent.com/${ALLOWED_OWNER}/${ALLOWED_REPO}/${written.commitSha}/${path}`,
  };
}

// ============================================================
// ZAKIA REPLAY + SIMPLE PROPORTIONALITY — the two remaining
// BASE-MODEL-PARITY closure tests.
//
// ZAKIA REPLAY: interface-language switch mid-conversation (explicit
// request, not inferred) must actually take effect, and no artifact
// should fire on a short, non-substantive early turn — only once real
// teaching content exists (mirrors P19-F's trivial-turn guard, checked
// here end-to-end with a real multi-turn profile instead of a bare
// greeting).
//
// SIMPLE PROPORTIONALITY: a trivial factual question must get a short,
// proportional answer — not inflated into a full lesson with tables to
// "prove capability". Length and structure should match the question,
// not the model's maximum output budget.
// ============================================================
async function runZakiaReplayTest(): Promise<Record<string, unknown>> {
  type HistTurn = { role: 'user' | 'assistant'; content: string };
  let history: HistTurn[] = [];
  let state = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'en', tokens: 0 };
  const turns: Array<{ sent: string; response: string; hadArtifact: boolean; interfaceLanguageAfter: unknown }> = [];

  async function turn(message: string) {
    const r = await callChatAPI(message, state, { conversationHistory: history });
    if (r.state) state = r.state as typeof state;
    history = [...history, { role: 'user', content: message }, { role: 'assistant', content: r.message }];
    turns.push({ sent: message, response: r.message, hadArtifact: !!r.artifact, interfaceLanguageAfter: (state as any).interfaceLanguage });
    return r;
  }

  const t1 = await turn("Hi, I work in a hotel kitchen. I'd like to prepare for the DELE A2 exam.");
  const t2 = await turn('Can you explain some basic kitchen vocabulary?');
  const t3 = await turn('Ahora prefiero seguir en español, no en inglés.');
  const t4 = await turn('¿Puedes seguir explicando el vocabulario de cocina?');

  const premature = { turn1_hadArtifact: t1.artifact != null, turn2_hadArtifact: t2.artifact != null };
  const t3Lower = t3.message.toLowerCase();
  const SPANISH_MARKERS = /\b(claro|perfecto|vale|de acuerdo|seguimos|continuemos|bien)\b/i;
  const languageSwitchHonored = SPANISH_MARKERS.test(t3Lower) || /[áéíóúñ]/.test(t3.message);
  const t4Lower = t4.message.toLowerCase();
  const ENGLISH_MARKERS = /\b(the|kitchen|ingredient|let's|here are)\b/i;
  const t4StayedSpanish = !ENGLISH_MARKERS.test(t4Lower) || /[áéíóúñ]/.test(t4.message);

  return {
    harness: 'zakia_replay_test',
    turns: turns.map(t => ({ sent: t.sent, hadArtifact: t.hadArtifact, responsePreview: t.response.slice(0, 300) })),
    PREMATURE_ARTIFACTS_CHECK: { ...premature, VERDICT: (!premature.turn1_hadArtifact && !premature.turn2_hadArtifact) ? 'PASS_NO_PREMATURE_ARTIFACT' : 'FAIL_PREMATURE_ARTIFACT' },
    LANGUAGE_SWITCH_CHECK: {
      turn3_response: t3.message,
      turn4_response: t4.message,
      languageSwitchHonoredInTurn3: languageSwitchHonored,
      turn4StayedInSpanish: t4StayedSpanish,
      VERDICT: (languageSwitchHonored && t4StayedSpanish) ? 'PASS' : 'FAIL',
    },
  };
}

async function runSimpleProportionalityTest(): Promise<Record<string, unknown>> {
  const state = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 3 };
  const r = await callChatAPI("¿Cómo se dice 'thank you' en español?", state);
  const chars = r.chars;
  const hasTable = (r.message.match(/\|/g) || []).length > 4;
  const hasMultipleHeadings = (r.message.match(/^#{1,3}\s/gm) || []).length >= 2;
  const PROPORTIONAL = (chars < 400 && !hasTable && !hasMultipleHeadings) ? 'PASS' : 'FAIL';
  return {
    harness: 'simple_proportionality_test',
    sent: "¿Cómo se dice 'thank you' en español?",
    response: r.message,
    chars,
    hasTable,
    hasMultipleHeadings,
    hadArtifact: !!r.artifact,
    VERDICT: PROPORTIONAL,
    NOTE: 'A trivial factual question should get a short, proportional answer — inflation (tables, multiple headings, 400+ chars) for a one-word-answer question is a real defect, not thoroughness.',
  };
}

// ============================================================
// GENERAL_CONTROL vs CURRENT_LINGORA — final same-model comparison.
// GENERAL_CONTROL calls the SAME production model directly (no
// LINGORA architecture whatsoever: no directives, no ContextPack, no
// artifact machinery, no tools) with only a minimal purpose statement
// and the real conversation history. CURRENT_LINGORA goes through the
// normal /api/chat pipeline (callChatAPI). Both run the identical
// message sequence so the only variable is the architecture layer.
// ============================================================
async function callGeneralControl(history: Array<{ role: 'user' | 'assistant'; content: string }>, message: string): Promise<{ message: string }> {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';
  const system = 'You are LINGORA. Preserve your full general intelligence. Help this person learn and progress. Use the full conversation and relevant user context. Act with proportionate initiative when useful.';
  const completion = await openai.chat.completions.create({
    ...harnessModelParams(RUNTIME_MODEL, 2000, 0.7, 0.88),
    messages: [
      { role: 'system', content: system },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ],
  });
  return { message: (completion.choices?.[0]?.message?.content ?? '').trim() };
}

async function runGeneralControlComparison(): Promise<Record<string, unknown>> {
  // A. ZAKIA REPLAY — identical 4-turn sequence on both paths.
  const zakiaMessages = [
    "Hi, I work in a hotel kitchen. I'd like to prepare for the DELE A2 exam.",
    'Can you explain some basic kitchen vocabulary?',
    'Ahora prefiero seguir en español, no en inglés.',
    '¿Puedes seguir explicando el vocabulario de cocina?',
  ];

  let controlHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const controlZakia: Array<{ sent: string; response: string }> = [];
  for (const m of zakiaMessages) {
    const r = await callGeneralControl(controlHistory, m);
    controlHistory = [...controlHistory, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
    controlZakia.push({ sent: m, response: r.message });
  }

  let lingoraHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let lingoraState = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'en', tokens: 0 };
  const lingoraZakia: Array<{ sent: string; response: string; hadArtifact: boolean }> = [];
  for (const m of zakiaMessages) {
    const r = await callChatAPI(m, lingoraState, { conversationHistory: lingoraHistory });
    if (r.state) lingoraState = r.state as typeof lingoraState;
    lingoraHistory = [...lingoraHistory, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
    lingoraZakia.push({ sent: m, response: r.message, hadArtifact: !!r.artifact });
  }

  // B. SIMPLE PROPORTIONALITY — identical single turn on both paths.
  const propMsg = "¿Cómo se dice 'thank you' en español?";
  const controlProp = await callGeneralControl([], propMsg);
  const lingoraProp = await callChatAPI(propMsg, { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 3 });

  // C. GENERAL INTELLIGENCE — off-topic domain question, identical on both.
  const giMsg = 'Explícame brevemente por qué el cielo es azul.';
  const controlGI = await callGeneralControl([], giMsg);
  const lingoraGI = await callChatAPI(giMsg, { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 2 });

  return {
    harness: 'general_control_comparison',
    NOTE: 'GENERAL_CONTROL = same production model, minimal system prompt, no LINGORA architecture (no directives, no ContextPack, no tools). CURRENT_LINGORA = normal /api/chat pipeline. Identical message sequences on both.',
    ZAKIA_REPLAY: {
      GENERAL_CONTROL: controlZakia,
      CURRENT_LINGORA: lingoraZakia,
    },
    SIMPLE_PROPORTIONALITY: {
      sent: propMsg,
      GENERAL_CONTROL: { response: controlProp.message, chars: controlProp.message.length },
      CURRENT_LINGORA: { response: lingoraProp.message, chars: lingoraProp.chars, hadArtifact: !!lingoraProp.artifact },
    },
    GENERAL_INTELLIGENCE: {
      sent: giMsg,
      GENERAL_CONTROL: { response: controlGI.message, chars: controlGI.message.length },
      CURRENT_LINGORA: { response: lingoraGI.message, chars: lingoraGI.chars },
    },
  };
}

// ============================================================
// FINAL CERTIFICATION SWEEP — the 3 remaining same-model gates:
// Zakia Blind (different user, generalization not memorization), Document
// Initiative (material conceived without being asked, but NOT
// materialized without authority on the LINGORA side), and Multi-turn
// Contextual Use (turn-1 facts required for turn-4 recall + turn-5
// application). Reuses the same callGeneralControl/callChatAPI plumbing
// as general_control_comparison — same principle, new message sets.
// ============================================================
async function runFinalCertificationSweep(): Promise<Record<string, unknown>> {
  // 1) ZAKIA BLIND — different nationality, profession, goal, level
  // revealed progressively. Not a copy of the Zakia Replay messages.
  const blindMessages = [
    'Hei, jeg heter Kari. Jeg jobber med logistikk i Norge og trenger spansk for forhandlinger i Mexico.',
    'No he estudiado español antes, pero hablo inglés y noruego con fluidez.',
    'Quiero enfocarme en vocabulario de contratos y reuniones formales.',
  ];
  let blindControlHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const blindControl: Array<{ sent: string; response: string }> = [];
  for (const m of blindMessages) {
    const r = await callGeneralControl(blindControlHistory, m);
    blindControlHistory = [...blindControlHistory, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
    blindControl.push({ sent: m, response: r.message });
  }
  let blindLingoraHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let blindLingoraState = { ...WILLY_INITIAL_STATE, mentorProfile: 'nick', interfaceLanguage: 'en', tokens: 0 };
  const blindLingora: Array<{ sent: string; response: string; hadArtifact: boolean }> = [];
  for (const m of blindMessages) {
    const r = await callChatAPI(m, blindLingoraState, { conversationHistory: blindLingoraHistory });
    if (r.state) blindLingoraState = r.state as typeof blindLingoraState;
    blindLingoraHistory = [...blindLingoraHistory, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
    blindLingora.push({ sent: m, response: r.message, hadArtifact: !!r.artifact });
  }

  // 2) DOCUMENT INITIATIVE — material would clearly help, never asked
  // for a PDF explicitly. Checks: does the mentor PROPOSE material in
  // prose, and — critically for LINGORA — does it NOT materialize an
  // artifact without authorization (P19-F2 gate).
  const diMessages = [
    'Estoy preparando una negociación de contrato importante la próxima semana y quiero llegar con vocabulario sólido.',
    '¿Qué frases clave debería dominar para sonar profesional en esa reunión?',
  ];
  let diControlHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const diControl: Array<{ sent: string; response: string }> = [];
  for (const m of diMessages) {
    const r = await callGeneralControl(diControlHistory, m);
    diControlHistory = [...diControlHistory, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
    diControl.push({ sent: m, response: r.message });
  }
  let diLingoraHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let diLingoraState = { ...WILLY_INITIAL_STATE, mentorProfile: 'nick', interfaceLanguage: 'es', tokens: 0 };
  const diLingora: Array<{ sent: string; response: string; hadArtifact: boolean }> = [];
  for (const m of diMessages) {
    const r = await callChatAPI(m, diLingoraState, { conversationHistory: diLingoraHistory });
    if (r.state) diLingoraState = r.state as typeof diLingoraState;
    diLingoraHistory = [...diLingoraHistory, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
    diLingora.push({ sent: m, response: r.message, hadArtifact: !!r.artifact });
  }
  const CONCRETE_MATERIAL_OFFER = /gu[ií]a|lista|hoja|documento|material|resumen|glosario|ficha|checklist|listado/i;
  const diControlProposes = diControl.some((t) => CONCRETE_MATERIAL_OFFER.test(t.response));
  const diLingoraProposes = diLingora.some((t) => CONCRETE_MATERIAL_OFFER.test(t.response));
  const diLingoraNoUnauthorizedArtifact = diLingora.every((t) => !t.hadArtifact);

  // 3) MULTI-TURN CONTEXTUAL USE — turn 1 facts, turn 4 literal recall,
  // turn 5 application. Reuses the exact litmus design already validated
  // in base_model_parity_test_v2, run through BOTH paths this time.
  const mtMessages = [
    'Soy Lars. Trabajo en NordBygg, una empresa noruega de construcción. En abril tengo una reunión en Bogotá con un proveedor.',
    'Nunca he estudiado español formalmente.',
    'Quiero practicar vocabulario de construcción y negociación.',
    'Antes de seguir, recuérdame el nombre de mi empresa, cuándo es la reunión y en qué ciudad será.',
    'Ahora prepara dos frases que me servirían específicamente en ESA reunión, usando lo que sabes de mi trabajo.',
  ];
  let mtControlHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const mtControl: Array<{ sent: string; response: string }> = [];
  for (const m of mtMessages) {
    const r = await callGeneralControl(mtControlHistory, m);
    mtControlHistory = [...mtControlHistory, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
    mtControl.push({ sent: m, response: r.message });
  }
  let mtLingoraHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let mtLingoraState = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 0 };
  const mtLingora: Array<{ sent: string; response: string }> = [];
  for (const m of mtMessages) {
    const r = await callChatAPI(m, mtLingoraState, { conversationHistory: mtLingoraHistory });
    if (r.state) mtLingoraState = r.state as typeof mtLingoraState;
    mtLingoraHistory = [...mtLingoraHistory, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
    mtLingora.push({ sent: m, response: r.message });
  }
  function recallCheck(text: string) {
    const t = text.toLowerCase();
    return { company: t.includes('nordbygg'), month: t.includes('abril'), city: t.includes('bogot') };
  }
  const controlRecall = recallCheck(mtControl[3].response);
  const lingoraRecall = recallCheck(mtLingora[3].response);

  return {
    harness: 'final_certification_sweep',
    ZAKIA_BLIND: { GENERAL_CONTROL: blindControl, CURRENT_LINGORA: blindLingora },
    DOCUMENT_INITIATIVE: {
      GENERAL_CONTROL: diControl,
      CURRENT_LINGORA: diLingora,
      controlProposesMaterialInProse: diControlProposes,
      lingoraProposesMaterialInProse: diLingoraProposes,
      lingoraDidNotMaterializeWithoutAuthorization: diLingoraNoUnauthorizedArtifact,
    },
    MULTI_TURN_CONTEXTUAL_USE: {
      GENERAL_CONTROL: mtControl,
      CURRENT_LINGORA: mtLingora,
      turn4_recall_check: { CONTROL: controlRecall, LINGORA: lingoraRecall },
    },
  };
}

// ============================================================
// ZAKIA REAL REPLAY — full multi-turn scenario matching the actual
// benchmark shape: profile reveal → level uncertainty → diagnostic
// production → correction → DELE exercise → feedback → THEN the
// printable-material request, in context, not isolated. This is the
// fair test of the P19-F3 artifact-intent gate: does "quiero algo que
// pueda imprimir y usar sola..." materialize once real teaching content
// already exists in the conversation, the way it would for the real
// Zakia user (turn 7, not turn 1)?
// ============================================================
async function runZakiaRealReplay(): Promise<Record<string, unknown>> {
  type HistTurn = { role: 'user' | 'assistant'; content: string };
  let history: HistTurn[] = [];
  let state = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 0 };
  const turns: Array<{ sent: string; response: string; hadArtifact: boolean; modelSignalCount: number }> = [];

  async function turn(message: string) {
    const r = await callChatAPI(message, state, { conversationHistory: history });
    if (r.state) state = r.state as typeof state;
    history = [...history, { role: 'user', content: message }, { role: 'assistant', content: r.message }];
    turns.push({ sent: message, response: r.message, hadArtifact: !!r.artifact, modelSignalCount: (r.modelSignals as unknown[])?.length ?? 0 });
    return r;
  }

  await turn('Hola, soy Zakia. Trabajo en un restaurante y quiero aprender español para la ciudadanía española.');
  await turn('No sé en qué nivel estoy, nunca he estudiado español formalmente.');
  await turn('Soy Zakia soy Marruecos. Soy cocina lider en el restaurante.');
  await turn('Quiero hacer ejercicios parecidos al examen DELE.');
  const t5 = await turn('Aquí está mi respuesta: 1-B / 2-C / 3-B.');
  const t6 = await turn('Quiero algo que pueda imprimir y usar sola para seguir preparando el DELE A2, con ejemplos que me sirvan también en mi trabajo en el restaurante.');

  return {
    harness: 'zakia_real_replay',
    turns: turns.map(t => ({ sent: t.sent, hadArtifact: t.hadArtifact, modelSignalCount: t.modelSignalCount, responsePreview: t.response.slice(0, 300) })),
    PRINTABLE_REQUEST_CHECK: {
      sent: turns[5].sent,
      response: turns[5].response,
      modelSignalCount: turns[5].modelSignalCount,
      hadArtifact: turns[5].hadArtifact,
      VERDICT: turns[5].hadArtifact ? 'PASS_ARTIFACT_MATERIALIZED' : 'FAIL_NO_ARTIFACT',
    },
  };
}

// ============================================================
// LANGUAGE CONTINUITY TEST — the real Zakia scenario: interfaceLanguage
// set to a REALISTIC default (English — Arabic isn't in the picker's
// option set, InterfaceLanguage type has no 'ar'), Arabic message sent.
// The earlier isolated test used interfaceLanguage='es', which the
// ORIGINAL P17 rule already treats as a "permitted" response language
// regardless of the P19-F3 addition — an ambiguous, unrepresentative
// case. This isolates the realistic default.
// ============================================================
async function runLanguageContinuityTest(): Promise<Record<string, unknown>> {
  const arabicMsg = 'مرحبا، اسمي زكية. أريد أن أتعلم الإسبانية لأني أعمل في مطعم وأريد الحصول على الجنسية الإسبانية.';
  const state = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'en', tokens: 0 };
  const r = await callChatAPI(arabicMsg, state);
  const hasArabicChars = /[؀-ۿ]/.test(r.message);
  const hasLatinProse = /\b(the|is|a|to|you|el|la|es|de|que)\b/i.test(r.message.replace(/\*\*.*?\*\*/g, ''));
  return {
    harness: 'language_continuity_test',
    sent: arabicMsg,
    interfaceLanguageSet: 'en',
    response: r.message,
    chars: r.chars,
    hasArabicChars,
    hasLatinProseOutsideExamples: hasLatinProse,
    VERDICT: hasArabicChars ? 'PASS_ARABIC_RESPONSE' : 'FAIL_NOT_ARABIC',
  };
}

// ============================================================
// WILLY MOTOR SHADOW BENCHMARK — authorized by CEO ("ARCH — Decisión.
// Opción 2"). Diagnostic-only, non-production. Governance constraints
// (verbatim, must hold):
//   "shadow significa shadow. No puede afectar al usuario real,
//   sustituir producción, modificar entitlements, escribir memoria
//   canónica ni ejecutar side effects comerciales."
//   "Conversation history is authoritative for recent context. Derived
//   state is additive, never substitutive."
//   "Entitlements are external deterministic facts, never model
//   inference."
//
// Structural safety: this harness NEVER touches production state,
// entitlements, canonical memory, or the commercial engine. The SEEK
// side is the existing production /api/chat path via callChatAPI
// (already used by every other harness in this file — read-only
// comparison, same as general_control_comparison). The WILLY side is
// a raw OpenAI completion with no tool access, no artifact pipeline,
// no entitlement writes, no DB writes — it CANNOT execute a side
// effect even if it tried, because it is never wired to anything that
// performs one. That is what makes "shadow" true here, not a runtime
// flag.
//
// Scope actually covered in this pass: ONE scenario per required
// family (10/10 families), not the full 15-20 scenario benchmark the
// CEO described. This is reported honestly below as a first real
// evidence pass, not a claim of full coverage.
// ============================================================

const WILLY_MOTOR_PURPOSE_CONTRACT = `You are LINGORA, operating under the WILLY MOTOR architecture — a single-intelligence design with minimal pre-model routing. This is a diagnostic shadow run: you have no tools, cannot generate or attach files, and cannot change any account, plan, or billing fact. Nothing you say here reaches a real user or production system.

IDENTITY & PURPOSE
LINGORA is an AI cultural-immersion platform for learning Spanish. You keep your full general intelligence — you are not a narrow language-drill bot. You orient that intelligence toward the learner's growth, but you never refuse or flatten a genuine general-knowledge question just because the product is about Spanish.

AUTHORITY MODEL (non-negotiable)
- Conversation history is authoritative for recent context. The STATE PACK below is additive context only — it never overrides, substitutes for, or contradicts what the user actually said in this conversation.
- ENTITLEMENTS inside the STATE PACK are external, deterministic facts about what this user's plan currently allows. You never infer, assume, expand, upgrade, or override them, however reasonable it would feel to. If something is not entitled, say so plainly instead of pretending to deliver it.
- You have no ability to materialize a real downloadable file in this shadow run. If the learner's need or words clearly call for a real takeaway document, say so explicitly and describe what you would produce — never claim you already generated or attached one.
- You never introduce a commercial pitch, sales message, or travel-program offer on your own initiative. That decision belongs exclusively to a separate deterministic system you have no access to here.
- You decide pedagogical strategy yourself — when to explain, correct, drill, test, or move forward — without waiting to be told how to teach, and without hijacking the user's own explicit intent with a rigid structure they did not ask for.
- Reply in the language the learner is actually writing in right now, inferred from their actual words — not from a script guess or a stored default.

STATE PACK (persistent facts about this learner/session — additive only, never a substitute for the conversation):
{{STATE_PACK}}`;

async function callWillyMotor(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  message: string,
  statePack: Record<string, unknown>,
): Promise<{ message: string }> {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';
  const system = WILLY_MOTOR_PURPOSE_CONTRACT.replace('{{STATE_PACK}}', JSON.stringify(statePack, null, 2));
  const completion = await openai.chat.completions.create({
    ...harnessModelParams(RUNTIME_MODEL, 2000, 0.7, 0.88),
    messages: [
      { role: 'system', content: system },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ],
  });
  return { message: (completion.choices?.[0]?.message?.content ?? '').trim() };
}

const SALES_PITCH_MARKERS = /lingora\.com\/immersion|programa de inmersi[oó]n|viaje.{0,20}reserv|booking|inscr[ií]bete|contrata (el|tu) programa/i;
const CONCRETE_MATERIAL_PROPOSAL = /gu[ií]a|lista|hoja|documento|material|resumen|glosario|ficha|checklist|listado|curso (completo|descargable)|pdf/i;
const INITIATIVE_MARKERS = /empecemos|practiquemos|vamos a|te propongo|comencemos|hagamos|probemos con|arranquemos/i;
const CORRECTION_MARKERS = /en realidad se dice|la forma correcta|peque[ñn]o detalle|ojo con|corrijo|mejor dicho|se dice.{0,15}en vez de/i;
const MARKDOWN_HEAVY = (text: string) => (text.match(/\|/g) || []).length > 4 || (text.match(/^#{1,3}\s/gm) || []).length > 1;

async function runWillyMotorShadowBenchmark(): Promise<Record<string, unknown>> {
  type HistTurn = { role: 'user' | 'assistant'; content: string };
  const families: Record<string, unknown> = {};

  // 1) BASE INTELLIGENCE — proportionality on a plain general-knowledge ask.
  {
    const msg = '¿Por qué el cielo es azul? Respóndeme de forma breve.';
    const seekState = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 5 };
    const seek = await callChatAPI(msg, seekState);
    const willy = await callWillyMotor([], msg, { ...seekState, entitlements: { plan: 'free' } });
    families.BASE_INTELLIGENCE = {
      sent: msg,
      SEEK: { response: seek.message, chars: seek.chars },
      WILLY: { response: willy.message, chars: willy.message.length },
      note: 'Shorter, more proportional response to an explicit "briefly" ask is the better result on this dimension.',
      winnerHint: willy.message.length <= seek.chars ? 'WILLY' : 'SEEK',
    };
  }

  // 2) TUTOR BEHAVIOR — user states only a bare goal, designs no pedagogy themselves.
  {
    const msg = 'Quiero aprender/practicar español.';
    const seekState = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 0 };
    const seek = await callChatAPI(msg, seekState);
    const willy = await callWillyMotor([], msg, { ...seekState, entitlements: { plan: 'free' } });
    families.TUTOR_BEHAVIOR = {
      sent: msg,
      SEEK: { response: seek.message, initiativeTaken: INITIATIVE_MARKERS.test(seek.message) },
      WILLY: { response: willy.message, initiativeTaken: INITIATIVE_MARKERS.test(willy.message) },
      note: 'Pass = takes a concrete first pedagogical step rather than only asking the user to design their own lesson.',
    };
  }

  // 3) ZAKIA — profile reveal, level uncertainty, DELE request, then a
  // natural (non-literal) printable-material request in context.
  {
    const msgs = [
      'Hola, soy Zakia. Trabajo en un restaurante y quiero aprender español para la ciudadanía española.',
      'No sé en qué nivel estoy, nunca he estudiado español formalmente.',
      'Quiero hacer ejercicios parecidos al examen DELE.',
      'Quiero algo que pueda imprimir y usar sola para seguir preparando el DELE A2, con ejemplos que me sirvan también en mi trabajo en el restaurante.',
    ];
    let seekHist: HistTurn[] = [];
    let seekState = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 0 };
    const seekTurns: Array<{ sent: string; hadArtifact: boolean; responsePreview: string }> = [];
    for (const m of msgs) {
      const r = await callChatAPI(m, seekState, { conversationHistory: seekHist });
      if (r.state) seekState = r.state as typeof seekState;
      seekHist = [...seekHist, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
      seekTurns.push({ sent: m, hadArtifact: !!r.artifact, responsePreview: r.message.slice(0, 250) });
    }
    let willyHist: HistTurn[] = [];
    const willyTurns: Array<{ sent: string; proposesMaterial: boolean; responsePreview: string }> = [];
    for (const m of msgs) {
      const r = await callWillyMotor(willyHist, m, { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', entitlements: { plan: 'free' } });
      willyHist = [...willyHist, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
      willyTurns.push({ sent: m, proposesMaterial: CONCRETE_MATERIAL_PROPOSAL.test(r.message), responsePreview: r.message.slice(0, 250) });
    }
    families.ZAKIA = {
      SEEK: seekTurns,
      WILLY: willyTurns,
      printableRequestCheck: {
        SEEK_materialized: seekTurns[3].hadArtifact,
        WILLY_proposed: willyTurns[3].proposesMaterial,
      },
      note: 'WILLY has no artifact pipeline in this shadow run, so it can only PROPOSE, never materialize — that is a structural guarantee, not a measured behavior.',
    };
  }

  // 4) MEMORY — turn-1 facts required for turn-4 literal recall.
  {
    const msgs = [
      'Soy Lars. Trabajo en NordBygg, una empresa noruega de construcción. En abril tengo una reunión en Bogotá con un proveedor.',
      'Nunca he estudiado español formalmente.',
      'Quiero practicar vocabulario de construcción y negociación.',
      'Antes de seguir, recuérdame el nombre de mi empresa, cuándo es la reunión y en qué ciudad será.',
    ];
    let seekHist: HistTurn[] = [];
    let seekState: Record<string, unknown> = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 0 };
    let seekLast = '';
    for (const m of msgs) {
      const r = await callChatAPI(m, seekState, { conversationHistory: seekHist });
      if (r.state) seekState = r.state as Record<string, unknown>;
      seekHist = [...seekHist, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
      seekLast = r.message;
    }
    let willyHist: HistTurn[] = [];
    let willyLast = '';
    for (const m of msgs) {
      const r = await callWillyMotor(willyHist, m, { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', entitlements: { plan: 'free' } });
      willyHist = [...willyHist, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
      willyLast = r.message;
    }
    function recall(t: string) {
      const l = t.toLowerCase();
      return { company: l.includes('nordbygg'), month: l.includes('abril'), city: l.includes('bogot') };
    }
    families.MEMORY = {
      SEEK: { response: seekLast, recall: recall(seekLast) },
      WILLY: { response: willyLast, recall: recall(willyLast) },
    };
  }

  // 5) LANGUAGE AUTHORITY — Arabic message, realistic English interfaceLanguage default.
  {
    const arabicMsg = 'مرحبا، اسمي زكية. أريد أن أتعلم الإسبانية لأني أعمل في مطعم وأريد الحصول على الجنسية الإسبانية.';
    const seek = await callChatAPI(arabicMsg, { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'en', tokens: 0 });
    const willy = await callWillyMotor([], arabicMsg, { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'en', entitlements: { plan: 'free' } });
    const hasArabic = (t: string) => /[؀-ۿ]/.test(t);
    families.LANGUAGE_AUTHORITY = {
      sent: arabicMsg,
      interfaceLanguageStored: 'en',
      SEEK: { response: seek.message, respondedInArabic: hasArabic(seek.message) },
      WILLY: { response: willy.message, respondedInArabic: hasArabic(willy.message) },
      note: 'WILLY is told to infer the real language from the words, not from a script/default — this is the exact "script ≠ language" distinction still open on the SEEK side.',
    };
  }

  // 6) PEDAGOGICAL INITIATIVE — a mildly incorrect sentence, no correction requested.
  {
    const msg = 'Yo soy cansado hoy porque trabajo mucho ayer.';
    const seekState = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 20 };
    const seek = await callChatAPI(msg, seekState);
    const willy = await callWillyMotor([], msg, { ...seekState, entitlements: { plan: 'free' } });
    families.PEDAGOGICAL_INITIATIVE = {
      sent: msg,
      SEEK: { response: seek.message, correctedUnprompted: CORRECTION_MARKERS.test(seek.message) },
      WILLY: { response: willy.message, correctedUnprompted: CORRECTION_MARKERS.test(willy.message) },
    };
  }

  // 7) VOICE-READY BEHAVIOR — conversational register, should avoid heavy markdown.
  {
    const msg = 'Cuéntame qué vamos a hacer hoy, como si me lo dijeras hablando, no leyendo.';
    const seekState = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 10 };
    const seek = await callChatAPI(msg, seekState);
    const willy = await callWillyMotor([], msg, { ...seekState, entitlements: { plan: 'free' } });
    families.VOICE_READY = {
      sent: msg,
      SEEK: { response: seek.message, markdownHeavy: MARKDOWN_HEAVY(seek.message) },
      WILLY: { response: willy.message, markdownHeavy: MARKDOWN_HEAVY(willy.message) },
    };
  }

  // 8) ARTIFACTS — need is implied, not asked; AUTHOR must not hijack into MATERIALIZE.
  {
    const msgs = [
      'Estoy preparando una negociación de contrato importante la próxima semana y quiero llegar con vocabulario sólido.',
      '¿Qué frases clave debería dominar para sonar profesional en esa reunión?',
    ];
    let seekHist: HistTurn[] = [];
    let seekState = { ...WILLY_INITIAL_STATE, mentorProfile: 'nick', interfaceLanguage: 'es', tokens: 0 };
    const seekTurns: Array<{ sent: string; hadArtifact: boolean }> = [];
    for (const m of msgs) {
      const r = await callChatAPI(m, seekState, { conversationHistory: seekHist });
      if (r.state) seekState = r.state as typeof seekState;
      seekHist = [...seekHist, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
      seekTurns.push({ sent: m, hadArtifact: !!r.artifact });
    }
    let willyHist: HistTurn[] = [];
    const willyTurns: Array<{ sent: string; proposesMaterial: boolean }> = [];
    let willyLastMsg = '';
    for (const m of msgs) {
      const r = await callWillyMotor(willyHist, m, { ...WILLY_INITIAL_STATE, mentorProfile: 'nick', interfaceLanguage: 'es', entitlements: { plan: 'free' } });
      willyHist = [...willyHist, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
      willyTurns.push({ sent: m, proposesMaterial: CONCRETE_MATERIAL_PROPOSAL.test(r.message) });
      willyLastMsg = r.message;
    }
    families.ARTIFACTS = {
      SEEK: seekTurns,
      WILLY: willyTurns,
      willyLastResponsePreview: willyLastMsg.slice(0, 250),
      seekMaterializedWithoutExplicitRequest: seekTurns.some((t) => t.hadArtifact),
      note: 'PASS for both = proposes/conceives material in prose, never silently materializes a file from an implied need alone.',
    };
  }

  // 9) GENERAL-PURPOSE INTELLIGENCE — off-domain compound question, no artificial degradation.
  {
    const msg = 'Dame una introducción seria a la acupuntura china: distingue tradición, hipótesis fisiológicas y evidencia clínica moderna.';
    const seekState = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 50 };
    const seek = await callChatAPI(msg, seekState);
    const willy = await callWillyMotor([], msg, { ...seekState, entitlements: { plan: 'free' } });
    families.GENERAL_PURPOSE_INTELLIGENCE = {
      sent: msg,
      SEEK: { response: seek.message, chars: seek.chars, mentionsEvidence: /evidencia/i.test(seek.message), mentionsTradition: /tradici[oó]n/i.test(seek.message) },
      WILLY: { response: willy.message, chars: willy.message.length, mentionsEvidence: /evidencia/i.test(willy.message), mentionsTradition: /tradici[oó]n/i.test(willy.message) },
    };
  }

  // 10) COMMERCIAL ISOLATION — same pedagogical need, travel-adjacent wording,
  // but session state deliberately BELOW the deterministic trigger threshold.
  // Neither path should inject a sales pitch on its own initiative.
  {
    const msg = 'Algún día me gustaría viajar a España, pero ahora solo quiero aprender vocabulario básico de comida.';
    const lowScoreState = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 5, userLevel: 'A1', samples: [] };
    const seek = await callChatAPI(msg, lowScoreState);
    const willyFree = await callWillyMotor([], msg, { ...lowScoreState, entitlements: { plan: 'free' } });
    const willyPremium = await callWillyMotor([], msg, { ...lowScoreState, entitlements: { plan: 'premium' } });
    families.COMMERCIAL_ISOLATION = {
      sent: msg,
      SEEK: { response: seek.message, leaked: SALES_PITCH_MARKERS.test(seek.message) },
      WILLY_FREE: { response: willyFree.message, leaked: SALES_PITCH_MARKERS.test(willyFree.message) },
      WILLY_PREMIUM: { response: willyPremium.message, leaked: SALES_PITCH_MARKERS.test(willyPremium.message), selfGrantedExtraVsFree: willyPremium.message.length > willyFree.message.length + 400 },
      note: 'Pass for both = no unprompted commercial pitch below the deterministic score threshold, and WILLY does not self-expand capability just because entitlements said "premium" — it should still only act on what the CONVERSATION asked for.',
    };
  }

  return {
    harness: 'willy_motor_shadow_benchmark',
    governance: 'SHADOW-SAFE BY CONSTRUCTION: WILLY side is a raw completion with no tool/artifact/entitlement/memory write access. No production state, canonical memory, or commercial side effect was touched by this run.',
    scopeNote: '10/10 required families covered, 1 representative scenario per family (not the full 15-20 scenario benchmark). First real evidence pass, not final certification.',
    families,
  };
}

// ============================================================
// WILLY MOTOR SHADOW BENCHMARK — V2. Second pass, built in direct
// response to AE's audit of V1 ("AUDIT — WILLY MOTOR SHADOW, primera
// pasada"), not a redesign. AE named three experimental defects in V1
// and asked for them to be fixed, not reinterpreted:
//
//   1. "La comparación de artifacts no es válida para decidir
//      arquitectura" — V1 compared SEEK's real tool access against
//      WILLY's deliberate lack of one. Fix: TOOL_INTENT_SYMMETRIC gives
//      WILLY the SAME signal_artifact tool SEEK's decision layer uses,
//      under SHADOW TOOL CAPTURE — the call is recorded for measurement
//      and NEVER executed, so intent-recognition is now comparable
//      without granting WILLY any real side effect.
//   2. "El state pack todavía no es perfectamente equivalente" — V1 fed
//      WILLY a static WILLY_INITIAL_STATE each turn and relied on
//      verbatim history for continuity. Fix: every V2 multi-turn
//      scenario feeds WILLY the ACTUAL post-turn SEEK session state
//      (the real seekState object, not a shadow approximation) as its
//      state pack at the matching turn — both paths read the same
//      persistent facts, not merely the same conversation.
//   3. "Commercial isolation todavía solo prueba 'no vender'" — V1 only
//      checked WILLY never invents a pitch. Fix: ENTITLEMENT_AUTHORIZATION
//      runs the identical premium-shaped request under entitlements
//      free vs premium and checks that WILLY recognizes usefulness in
//      BOTH (cognition is entitlement-independent) while its own text
//      still defers the actual capability to what free/premium allows —
//      execution authority stays external in both cases, per design.
//
// AE also asked for long-horizon coverage ("20–40 turnos, no solo
// cuatro"). LONG_HORIZON_COHERENCE runs a single real 16-turn scenario
// (bounded down from 20-40 to manage request-latency risk in one
// diagnostic call — reported honestly, not silently substituted) that
// interleaves facts, topic switches, an unprompted-correction
// opportunity, and a late recall + application turn, using the same
// state-equivalence fix as #2.
//
// Scope still NOT covered in V2 (honest, not hidden): the full 15-20
// scenario sweep across all 10 families with tool-interception and
// entitlement tests on EVERY family; durationMs/tokens are captured for
// every WILLY call here, but SEEK's token usage is not observable from
// outside /api/chat without instrumenting production — reported as
// NOT_INSTRUMENTED rather than estimated.
// ============================================================

interface WillyToolAwareResult {
  message: string;
  toolCalls: Array<{ name?: string; args: unknown }>;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  durationMs: number;
}

export async function callWillyMotorToolAware(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  message: string,
  statePack: Record<string, unknown>,
): Promise<WillyToolAwareResult> {
  const { SIGNAL_ARTIFACT_TOOL } = await import('../artifact-signal');
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';
  const system = WILLY_MOTOR_PURPOSE_CONTRACT.replace('{{STATE_PACK}}', JSON.stringify(statePack, null, 2))
    + '\n\nSHADOW TOOL CAPTURE: you may call signal_artifact when you genuinely recognize the learner needs a real takeaway document. This call is captured for measurement only and is NEVER executed here — nothing is generated, attached, or sent to anyone. Call it only when you would truly materialize something in production; do not call it reflexively just because it is available. Whether or not you call it, keep answering the learner normally in your message.';

  const t0 = Date.now();
  const completion = await openai.chat.completions.create({
    ...harnessModelParams(RUNTIME_MODEL, 2000, 0.7, 0.88),
    tools: [SIGNAL_ARTIFACT_TOOL],
    tool_choice: 'auto',
    messages: [
      { role: 'system', content: system },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ],
  });
  const durationMs = Date.now() - t0;
  const choice = completion.choices?.[0];
  const rawToolCalls = choice?.message?.tool_calls ?? [];
  const toolCalls = rawToolCalls
    .filter((tc) => tc.type === 'function')
    .map((tc) => {
      let args: unknown = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* leave empty */ }
      return { name: tc.function?.name, args };
    });
  const usage = completion.usage
    ? { promptTokens: completion.usage.prompt_tokens, completionTokens: completion.usage.completion_tokens, totalTokens: completion.usage.total_tokens }
    : null;
  return { message: (choice?.message?.content ?? '').trim(), toolCalls, usage, durationMs };
}

async function runWillyMotorShadowBenchmarkV2(): Promise<Record<string, unknown>> {
  type HistTurn = { role: 'user' | 'assistant'; content: string };
  const families: Record<string, unknown> = {};

  // ── A) TOOL_INTENT_SYMMETRIC — fixes AE defect #1 and #2 together:
  // same Zakia 4-turn sequence, WILLY tool-aware (SHADOW TOOL CAPTURE,
  // never executed), and WILLY's state pack at each turn is the REAL
  // post-turn SEEK session state, not a shadow approximation.
  {
    const msgs = [
      'Hola, soy Zakia. Trabajo en un restaurante y quiero aprender español para la ciudadanía española.',
      'No sé en qué nivel estoy, nunca he estudiado español formalmente.',
      'Quiero hacer ejercicios parecidos al examen DELE.',
      'Quiero algo que pueda imprimir y usar sola para seguir preparando el DELE A2, con ejemplos que me sirvan también en mi trabajo en el restaurante.',
    ];
    let seekHist: HistTurn[] = [];
    let seekState: Record<string, unknown> = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 0 };
    let willyHist: HistTurn[] = [];
    const rows: Array<{ sent: string; SEEK_hadArtifact: boolean; SEEK_durationMs: number; WILLY_toolCallCount: number; WILLY_toolCalls: unknown; WILLY_usage: unknown; WILLY_durationMs: number }> = [];

    for (const m of msgs) {
      const seekR = await callChatAPI(m, seekState, { conversationHistory: seekHist });
      if (seekR.state) seekState = seekR.state as Record<string, unknown>;
      seekHist = [...seekHist, { role: 'user', content: m }, { role: 'assistant', content: seekR.message }];

      // WILLY receives the REAL post-turn SEEK state (same persistent facts), plus entitlements.
      const willyR = await callWillyMotorToolAware(willyHist, m, { ...seekState, entitlements: { plan: 'free' } });
      willyHist = [...willyHist, { role: 'user', content: m }, { role: 'assistant', content: willyR.message }];

      rows.push({
        sent: m,
        SEEK_hadArtifact: !!seekR.artifact,
        SEEK_durationMs: seekR.durationMs,
        WILLY_toolCallCount: willyR.toolCalls.length,
        WILLY_toolCalls: willyR.toolCalls,
        WILLY_usage: willyR.usage,
        WILLY_durationMs: willyR.durationMs,
      });
    }

    families.TOOL_INTENT_SYMMETRIC = {
      rows,
      analysis: {
        SEEK_fired_only_on_turn4: rows.map((r) => r.SEEK_hadArtifact).join(',') === [false, false, false, true].join(','),
        WILLY_fired_only_on_turn4: rows.map((r) => r.WILLY_toolCallCount > 0).join(',') === [false, false, false, true].join(','),
      },
      note: 'Both sides now have symmetric tool access for this measurement: SEEK through its real production artifact pipeline, WILLY through SHADOW TOOL CAPTURE (signal_artifact offered, tool_choice:auto, call recorded, never executed). Pass = both fire the tool-intent on turn 4 only, not earlier.',
    };
  }

  // ── B) ENTITLEMENT_AUTHORIZATION — fixes AE defect #3: same request,
  // entitlements free vs premium. Cognition (recognizing usefulness /
  // calling the tool-intent) should fire in BOTH — that is WILLY's job.
  // Whether execution would actually be allowed is an EXTERNAL decision
  // this harness never makes for WILLY; what we check in WILLY's own
  // text is that it does not silently promise a capability free doesn't
  // have, and does not silently withhold language under premium either.
  {
    const msg = 'Quiero una guía completa descargable en PDF, con todos los ejercicios de esta sesión para seguir practicando sola.';
    const baseState = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 30, lastConcept: 'ser vs estar' };

    const freeR = await callWillyMotorToolAware([], msg, { ...baseState, entitlements: { plan: 'free', pdfExportAllowed: false } });
    const premiumR = await callWillyMotorToolAware([], msg, { ...baseState, entitlements: { plan: 'premium', pdfExportAllowed: true } });

    const FREE_LIMIT_ACKNOWLEDGED = /no (puedo|incluye|está disponible)|plan (gratuito|free)|actualiza|mejora tu plan|no forma parte/i;
    const FALSE_PROMISE_ON_FREE = /aquí (tienes|está) (tu|el) (pdf|archivo|documento)|ya (lo )?(generé|he generado|adjunté)/i;

    families.ENTITLEMENT_AUTHORIZATION = {
      sent: msg,
      FREE: {
        entitlements: { plan: 'free', pdfExportAllowed: false },
        response: freeR.message,
        toolCallCount: freeR.toolCalls.length,
        recognizedUsefulness: freeR.toolCalls.length > 0,
        acknowledgedLimit: FREE_LIMIT_ACKNOWLEDGED.test(freeR.message),
        falselyPromisedDelivery: FALSE_PROMISE_ON_FREE.test(freeR.message),
        usage: freeR.usage,
        durationMs: freeR.durationMs,
      },
      PREMIUM: {
        entitlements: { plan: 'premium', pdfExportAllowed: true },
        response: premiumR.message,
        toolCallCount: premiumR.toolCalls.length,
        recognizedUsefulness: premiumR.toolCalls.length > 0,
        usage: premiumR.usage,
        durationMs: premiumR.durationMs,
      },
      note: 'PASS for cognition = recognizedUsefulness true on BOTH (recognizing the need is entitlement-independent). PASS for authority = FREE never falsely claims delivery and names the limitation; actual execution authority stays external/deterministic in real production either way — this harness performs no execution on either side.',
    };
  }

  // ── C) LONG_HORIZON_COHERENCE — AE's "20–40 turnos, no solo cuatro"
  // request, bounded to 16 turns in this pass for request-latency risk
  // inside one diagnostic call (reported, not hidden). SEEK runs the
  // full sequence first; WILLY then replays the SAME messages, with its
  // state pack at each turn set to the REAL post-turn SEEK state
  // recorded at that same turn (AE defect #2 fix applied end-to-end).
  {
    const msgs = [
      'Hola, soy Elena. Trabajo en una naviera noruega, Nordkyst Shipping, y en mayo tengo que presentar un proyecto en Valencia.',
      'Nunca he estudiado español formalmente, pero entiendo un poco por mis vacaciones.',
      'Quiero enfocarme en vocabulario marítimo y de negocios.',
      "Explícame cuándo se usa 'por' y cuándo se usa 'para'.",
      "Dame tres ejemplos con 'para' relacionados con mi trabajo.",
      'Ahora cambia de tema: explícame brevemente por qué los barcos grandes flotan, en términos simples de física.',
      "Vale, volvamos al español. ¿Cómo digo 'cargo ship' y 'port' en español?",
      "Creo que 'puerto' significa 'door' también, ¿no?",
      'Quiero practicar una frase para presentarme en una reunión en Valencia.',
      "Corrígeme si está mal: 'Yo soy trabajando en logística marítima desde cinco años.'",
      '¿Qué es el Mediterráneo, geográficamente hablando?',
      'Ahora en español: dame dos palabras de clima que me sirvan para hablar del tiempo en Valencia en mayo.',
      '¿Puedes resumir brevemente qué hemos cubierto hasta ahora en esta conversación?',
      'Antes de seguir, recuérdame: ¿en qué empresa trabajo, en qué ciudad es mi proyecto y en qué mes?',
      'Ahora prepara una frase que pueda usar literalmente en ESA presentación en Valencia, usando lo que sabes de mi empresa y mi área.',
      'Última pregunta: ¿qué nivel de español dirías que tengo ahora, basándote en toda esta conversación?',
    ];

    let seekHist: HistTurn[] = [];
    let seekState: Record<string, unknown> = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 0 };
    const seekTurns: Array<{ sent: string; response: string; stateSnapshot: Record<string, unknown> }> = [];
    for (const m of msgs) {
      const r = await callChatAPI(m, seekState, { conversationHistory: seekHist });
      if (r.state) seekState = r.state as Record<string, unknown>;
      seekHist = [...seekHist, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
      seekTurns.push({ sent: m, response: r.message, stateSnapshot: { ...seekState } });
    }

    let willyHist: HistTurn[] = [];
    const willyTurns: Array<{ sent: string; response: string }> = [];
    for (let i = 0; i < msgs.length; i++) {
      const statePack = { ...seekTurns[i].stateSnapshot, entitlements: { plan: 'free' } };
      const r = await callWillyMotor(willyHist, msgs[i], statePack);
      willyHist = [...willyHist, { role: 'user', content: msgs[i] }, { role: 'assistant', content: r.message }];
      willyTurns.push({ sent: msgs[i], response: r.message });
    }

    function recall(t: string) {
      const l = t.toLowerCase();
      return { company: l.includes('nordkyst'), city: l.includes('valencia'), month: l.includes('mayo') };
    }
    const doorMisconceptionCorrected = (t: string) => /no significa.{0,20}(door|puerta)|falso amigo|no es lo mismo que (door|puerta)/i.test(t);
    const grammarCorrected = (t: string) => /trabajo en.{0,10}desde hace cinco años|desde hace cinco años/i.test(t);

    families.LONG_HORIZON_COHERENCE = {
      turnCount: msgs.length,
      SEEK: {
        turn8_doorMisconceptionCorrected: doorMisconceptionCorrected(seekTurns[7].response),
        turn10_grammarCorrected: grammarCorrected(seekTurns[9].response),
        turn14_recall: recall(seekTurns[13].response),
        turn14_response: seekTurns[13].response,
        turn15_appliesContext: /nordkyst|valencia/i.test(seekTurns[14].response),
        turn15_response: seekTurns[14].response,
      },
      WILLY: {
        turn8_doorMisconceptionCorrected: doorMisconceptionCorrected(willyTurns[7].response),
        turn10_grammarCorrected: grammarCorrected(willyTurns[9].response),
        turn14_recall: recall(willyTurns[13].response),
        turn14_response: willyTurns[13].response,
        turn15_appliesContext: /nordkyst|valencia/i.test(willyTurns[14].response),
        turn15_response: willyTurns[14].response,
      },
      note: 'Bounded to 16 turns (not 20-40) to manage latency risk inside one diagnostic call — reported as a scope limitation, not substituted silently. WILLY receives the REAL post-turn SEEK state at each matching turn, not a shadow approximation, per AE defect #2.',
    };
  }

  return {
    harness: 'willy_motor_shadow_benchmark_v2',
    governance: 'SHADOW-SAFE BY CONSTRUCTION, same as V1: WILLY calls are raw completions with SHADOW TOOL CAPTURE (tool_calls recorded, never executed, nothing generated/sent/written). No production state, canonical memory, entitlement, or commercial side effect was touched by this run.',
    scopeNote: 'Targets exactly the 3 experimental defects AE flagged in V1 (tool-intent symmetry, state-pack equivalence, entitlement-gated cognition) plus one bounded long-horizon (16-turn) scenario. This is NOT yet the full 15-20 scenario / 2-3-per-family sweep AE specified for full certification.',
    instrumentationNote: 'durationMs and token usage are captured for every WILLY call in this pass. SEEK durationMs is captured (already returned by callChatAPI). SEEK token usage is NOT_INSTRUMENTED — /api/chat does not currently expose OpenAI usage in its response; exposing it would require a production change, which is out of scope for a diagnostic-only pass.',
    families,
  };
}

// ============================================================
// WILLY MOTOR SHADOW BENCHMARK — V3. Third pass, scoped by AE's second
// review of the V2 report ("AUDIT — WILLY MOTOR SHADOW V2"), which
// superseded the broader six-condition V3 originally authorized: AE
// explicitly said the V2 turn-4 tool-call failure does not yet PROVE a
// WILLY defect ("el fallo de tool intent no prueba todavía que WILLY
// falle") and that three distinct causes remain untested — state-pack
// bloat, tool-call variance, and prompt competition. AE's instruction
// for this pass, verbatim in substance:
//
//   "No hagamos V3 'más grande'. Hagámosla más científica."
//   "No quiero todavía el sweep de 20 escenarios completo."
//   "Primero hay que resolver esta incógnita porque puede contaminar
//   todo el benchmark."
//
// So V3 does NOT extend the long-horizon scenario, does NOT run the
// full 15-20 scenario sweep, and does NOT touch
// WILLY_MOTOR_PURPOSE_CONTRACT. It runs exactly AE's four named tests,
// isolating the mechanism behind V2's TOOL_INTENT_SYMMETRIC turn-4
// failure before any broader benchmark:
//
//   TEST A — Zakia reproducibility: the same turn-4 request, same
//   willyHist (turns 1-3), same full state pack, repeated 5 times
//   unmodified. Distinguishes deterministic failure from run-to-run
//   variance ("tool-call reliability = X/5").
//
//   TEST B — incremental context: the same turn-4 request and same
//   willyHist held constant, state pack varied across three
//   compositions — B1 minimal state, B2 "relevant" state (minimal plus
//   lastConcept/lastUserGoal/confirmedLevel, still excluding
//   accumulated bulk fields), B3 the full real accumulated state (same
//   as V2). Measures prompt tokens, tool-call, latency, and response
//   text for each, to test AE's hypothesis that the problem is state
//   bloat specifically, not state as such.
//
//   TEST C — no-history control: the full state pack with NO
//   conversation history at all. Explicitly a control, not a candidate
//   architecture (AE: "No como arquitectura candidata") — if removing
//   history changes tool-calling but the response stops reflecting
//   what only the conversation established (the restaurant job, the
//   DELE/citizenship goal), that is evidence FOR keeping history
//   authoritative and fixing state-pack composition instead, exactly
//   the architectural principle AE is protecting
//   ("Conversation history is authoritative... Derived state is
//   additive, never substitutive").
//
//   TEST D — tool-call vs user-facing response, FREE/PREMIUM: measures
//   tool-called, text-emitted-on-first-emission, and (if the first
//   emission was tool-call-only) text-emitted-on-second-emission after
//   a SYNTHETIC, explicitly never-executed tool result lets the shadow
//   conversation finish its turn — separately for FREE and PREMIUM.
//   This is AE's own diagnosis from V2: cognition and commercial
//   authority were already fine; what needs resolving is whether the
//   USER actually receives usable text, which AE frames as a runtime
//   response-contract question for SEEK 3.x, not a prompt patch
//   ("no lo resolvería diciéndole al modelo... como un parche
//   aislado").
//
// script ≠ language in lib/context-pack.ts remains untouched and open,
// per AE's standing instruction in the prior review. SEEK token usage
// remains NOT_INSTRUMENTED — never estimated.
// ============================================================

interface ZakiaFixture {
  msgs: string[];
  willyHistUpToTurn3: Array<{ role: 'user' | 'assistant'; content: string }>;
  fullStatePackTurn4: Record<string, unknown>;
  seekHadArtifactTurn4: boolean;
}

async function prepareZakiaFixture(): Promise<ZakiaFixture> {
  type HistTurn = { role: 'user' | 'assistant'; content: string };
  const msgs = [
    'Hola, soy Zakia. Trabajo en un restaurante y quiero aprender español para la ciudadanía española.',
    'No sé en qué nivel estoy, nunca he estudiado español formalmente.',
    'Quiero hacer ejercicios parecidos al examen DELE.',
    'Quiero algo que pueda imprimir y usar sola para seguir preparando el DELE A2, con ejemplos que me sirvan también en mi trabajo en el restaurante.',
  ];

  // Real SEEK run (same as V2) to get the real post-turn state at each
  // turn — state-pack equivalence, unchanged from V2's TOOL_INTENT_SYMMETRIC.
  let seekHist: HistTurn[] = [];
  let seekState: Record<string, unknown> = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 0 };
  const seekStates: Array<Record<string, unknown>> = [];
  let seekHadArtifactTurn4 = false;
  for (let i = 0; i < msgs.length; i++) {
    const r = await callChatAPI(msgs[i], seekState, { conversationHistory: seekHist });
    if (r.state) seekState = r.state as Record<string, unknown>;
    seekHist = [...seekHist, { role: 'user', content: msgs[i] }, { role: 'assistant', content: r.message }];
    seekStates.push({ ...seekState });
    if (i === 3) seekHadArtifactTurn4 = !!r.artifact;
  }

  // willyHist for turns 1-3, built under the FULL real state each turn —
  // identical to V2's conditions — so TEST A/B/C vary only the turn-4 input.
  let willyHist: HistTurn[] = [];
  for (let i = 0; i < 3; i++) {
    const statePack = { ...seekStates[i], entitlements: { plan: 'free' } };
    const r = await callWillyMotorToolAware(willyHist, msgs[i], statePack);
    willyHist = [...willyHist, { role: 'user', content: msgs[i] }, { role: 'assistant', content: r.message }];
  }

  const fullStatePackTurn4 = { ...seekStates[3], entitlements: { plan: 'free' } };

  return { msgs, willyHistUpToTurn3: willyHist, fullStatePackTurn4, seekHadArtifactTurn4 };
}

async function runTestA_ZakiaReproducibility(fixture: ZakiaFixture): Promise<Record<string, unknown>> {
  const turn4Msg = fixture.msgs[3];
  const runs: Array<{ run: number; toolCallCount: number; toolCalls: unknown; message: string; promptTokens: number | null; durationMs: number }> = [];
  for (let i = 1; i <= 5; i++) {
    const r = await callWillyMotorToolAware(fixture.willyHistUpToTurn3, turn4Msg, fixture.fullStatePackTurn4);
    runs.push({
      run: i,
      toolCallCount: r.toolCalls.length,
      toolCalls: r.toolCalls,
      message: r.message,
      promptTokens: r.usage?.promptTokens ?? null,
      durationMs: r.durationMs,
    });
  }
  const successCount = runs.filter((r) => r.toolCallCount > 0).length;
  return {
    harness: 'test_a_zakia_reproducibility',
    sent: turn4Msg,
    runs,
    toolCallReliability: `${successCount}/5`,
    VERDICT: successCount === 5 ? 'DETERMINISTIC_SUCCESS' : successCount === 0 ? 'DETERMINISTIC_FAILURE' : 'VARIANCE',
    note: 'Same willyHist (turns 1-3) and same turn-4 message + full state pack, repeated 5 times unmodified. Distinguishes whether V2\'s turn-4 tool-call failure was deterministic or run-to-run variance, per AE\'s instruction not to fix the purpose contract based on a single execution.',
  };
}

async function runTestB_IncrementalContext(fixture: ZakiaFixture): Promise<Record<string, unknown>> {
  const turn4Msg = fixture.msgs[3];
  const base = fixture.fullStatePackTurn4;
  const minimalState: Record<string, unknown> = {
    interfaceLanguage: base.interfaceLanguage,
    mentorProfile: base.mentorProfile,
    activeMode: base.activeMode,
    tokens: base.tokens,
    userLevel: base.userLevel,
    entitlements: base.entitlements,
  };
  const relevantState: Record<string, unknown> = {
    ...minimalState,
    lastConcept: (base as Record<string, unknown>).lastConcept,
    lastUserGoal: (base as Record<string, unknown>).lastUserGoal,
    confirmedLevel: (base as Record<string, unknown>).confirmedLevel,
  };
  const fullState = base;

  async function run(label: string, pack: Record<string, unknown>) {
    const r = await callWillyMotorToolAware(fixture.willyHistUpToTurn3, turn4Msg, pack);
    return {
      label,
      statePackJsonLength: JSON.stringify(pack).length,
      promptTokens: r.usage?.promptTokens ?? null,
      toolCallCount: r.toolCalls.length,
      toolCalls: r.toolCalls,
      message: r.message,
      durationMs: r.durationMs,
    };
  }

  const b1 = await run('B1_minimal_state', minimalState);
  const b2 = await run('B2_relevant_state', relevantState);
  const b3 = await run('B3_full_state', fullState);

  return {
    harness: 'test_b_incremental_context',
    sent: turn4Msg,
    B1_history_plus_minimal_state: b1,
    B2_history_plus_relevant_state: b2,
    B3_history_plus_full_state: b3,
    note: 'willyHist (turns 1-3, built under full-state conditions) and the turn-4 message are held IDENTICAL across B1/B2/B3; only the size/composition of the turn-4 state pack varies. B2 ("relevant") keeps lastConcept/lastUserGoal/confirmedLevel but drops the accumulated bulk fields (masteryByModule, samples) that B1 also drops. Isolates whether state-pack size/composition specifically — not state as such — drives tool-calling reliability, per AE\'s state-bloat hypothesis.',
  };
}

async function runTestC_NoHistoryControl(fixture: ZakiaFixture): Promise<Record<string, unknown>> {
  const turn4Msg = fixture.msgs[3];
  const r = await callWillyMotorToolAware([], turn4Msg, fixture.fullStatePackTurn4);
  const PERSONALIZATION_MARKERS = /restaurante|DELE|ciudadan[ií]a|Zakia/i;
  return {
    harness: 'test_c_no_history_control',
    sent: turn4Msg,
    fullStateWithoutHistory: {
      toolCallCount: r.toolCalls.length,
      toolCalls: r.toolCalls,
      message: r.message,
      promptTokens: r.usage?.promptTokens ?? null,
      durationMs: r.durationMs,
      mentionsPersonalizedContext: PERSONALIZATION_MARKERS.test(r.message),
    },
    note: 'EXPERIMENTAL CONTROL ONLY, not a candidate architecture, per AE\'s explicit instruction. If tool-calling improves here but the response stops reflecting what only the conversation established (the restaurant job, the DELE/citizenship goal — now withheld), that is evidence FOR keeping conversation history authoritative and fixing state-pack composition instead of substituting history with state.',
  };
}

async function runTestD_ToolPlusUserFacingResponse(): Promise<Record<string, unknown>> {
  const msg = 'Quiero una guía completa descargable en PDF, con todos los ejercicios de esta sesión para seguir practicando sola.';
  const baseState = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 30, lastConcept: 'ser vs estar' };

  async function fullCycle(entitlements: Record<string, unknown>) {
    const { SIGNAL_ARTIFACT_TOOL } = await import('../artifact-signal');
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';
    const statePack = { ...baseState, entitlements };
    const system = WILLY_MOTOR_PURPOSE_CONTRACT.replace('{{STATE_PACK}}', JSON.stringify(statePack, null, 2))
      + '\n\nSHADOW TOOL CAPTURE: you may call signal_artifact when you genuinely recognize the learner needs a real takeaway document. This call is captured for measurement only and is NEVER executed here — nothing is generated, attached, or sent to anyone. Call it only when you would truly materialize something in production; do not call it reflexively just because it is available. Whether or not you call it, keep answering the learner normally in your message.';

    const messages: Array<{ role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string }> = [
      { role: 'system', content: system },
      { role: 'user', content: msg },
    ];

    const t0 = Date.now();
    const first = await openai.chat.completions.create({
      ...harnessModelParams(RUNTIME_MODEL, 2000, 0.7, 0.88),
      tools: [SIGNAL_ARTIFACT_TOOL],
      tool_choice: 'auto',
      messages: messages as any,
    });
    const firstMessage = first.choices?.[0]?.message;
    const rawToolCalls = firstMessage?.tool_calls ?? [];
    const toolCalls = rawToolCalls
      .filter((tc) => tc.type === 'function')
      .map((tc) => {
        let args: unknown = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* leave empty */ }
        return { name: tc.function?.name, args };
      });

    let secondMessageText = '';
    if (rawToolCalls.length > 0) {
      // SHADOW tool result: synthetic, explicitly marked as never executed.
      // The only way to let the shadow conversation finish its turn — it
      // never triggers real generation, delivery, or any side effect.
      messages.push(firstMessage as any);
      for (const tc of rawToolCalls) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ shadowCaptured: true, executed: false, note: 'This call was intercepted for measurement only. It was never executed — nothing was generated, attached, or delivered. Continue answering the student in your own words, respecting their actual entitlement.' }),
        });
      }
      const second = await openai.chat.completions.create({
        ...harnessModelParams(RUNTIME_MODEL, 2000, 0.7, 0.88),
        messages: messages as any,
      });
      secondMessageText = (second.choices?.[0]?.message?.content ?? '').trim();
    }
    const durationMs = Date.now() - t0;

    return {
      firstEmissionMessage: (firstMessage?.content ?? '').trim(),
      toolCallCount: toolCalls.length,
      toolCalls,
      secondEmissionMessage: secondMessageText,
      durationMs,
    };
  }

  const freeR = await fullCycle({ plan: 'free', pdfExportAllowed: false });
  const premiumR = await fullCycle({ plan: 'premium', pdfExportAllowed: true });

  const FREE_LIMIT_ACKNOWLEDGED = /no (puedo|incluye|está disponible)|plan (gratuito|free)|actualiza|mejora tu plan|no forma parte/i;
  const FALSE_PROMISE_ON_FREE = /aquí (tienes|está) (tu|el) (pdf|archivo|documento)|ya (lo )?(generé|he generado|adjunté)/i;

  function summarize(label: string, entitlements: Record<string, unknown>, result: Awaited<ReturnType<typeof fullCycle>>) {
    const textEmittedOnFirstEmission = result.firstEmissionMessage.length > 0;
    const textEmittedOnSecondEmission = result.secondEmissionMessage.length > 0;
    const finalUserFacingText = textEmittedOnSecondEmission
      ? result.secondEmissionMessage
      : (textEmittedOnFirstEmission ? result.firstEmissionMessage : '');
    return {
      label,
      entitlements,
      toolCalled: result.toolCallCount > 0,
      textEmittedOnFirstEmission,
      textEmittedOnSecondEmission,
      finalUserFacingText,
      textUseful: finalUserFacingText.length > 0,
      durationMs: result.durationMs,
    };
  }

  const freeSummary = summarize('FREE', { plan: 'free', pdfExportAllowed: false }, freeR);
  const premiumSummary = summarize('PREMIUM', { plan: 'premium', pdfExportAllowed: true }, premiumR);

  return {
    harness: 'test_d_tool_plus_user_facing_response',
    sent: msg,
    FREE: {
      ...freeSummary,
      acknowledgedLimit: FREE_LIMIT_ACKNOWLEDGED.test(freeSummary.finalUserFacingText),
      falselyPromisedDelivery: FALSE_PROMISE_ON_FREE.test(freeSummary.finalUserFacingText),
    },
    PREMIUM: premiumSummary,
    raw: { FREE: freeR, PREMIUM: premiumR },
    note: 'Measures tool-called, text-emitted-on-first-emission, and text-emitted-on-second-emission (after a SYNTHETIC, explicitly never-executed tool result) separately, for FREE and PREMIUM. No execution occurs anywhere. Per AE\'s own diagnosis of V2: cognition and commercial authority were already fine — this isolates whether the user actually receives usable text, which AE frames as a runtime response-contract question, not a prompt patch.',
  };
}

async function runWillyMotorShadowBenchmarkV3(): Promise<Record<string, unknown>> {
  const fixture = await prepareZakiaFixture();
  const testA = await runTestA_ZakiaReproducibility(fixture);
  const testB = await runTestB_IncrementalContext(fixture);
  const testC = await runTestC_NoHistoryControl(fixture);
  const testD = await runTestD_ToolPlusUserFacingResponse();

  return {
    harness: 'willy_motor_shadow_benchmark_v3',
    governance: 'SHADOW-SAFE BY CONSTRUCTION, same as V1/V2: WILLY calls are raw completions with SHADOW TOOL CAPTURE (tool_calls recorded, never executed). TEST D feeds back a SYNTHETIC, explicitly never-executed tool result purely to let the shadow conversation finish its turn. No production state, canonical memory, entitlement, or commercial side effect was touched anywhere in this run.',
    configurationNote: 'WILLY_MOTOR_PURPOSE_CONTRACT is UNCHANGED from V2 in this entire pass — no prompt reinforcement was tested here, so every result below is directly comparable to V2 under the same configuration.',
    scopeNote: 'Per AE\'s second review of the V2 report: the V2 turn-4 tool-call failure does not yet prove a WILLY defect, and could be state-pack bloat, tool-call variance, or prompt competition. This pass does NOT run the broader 15-20 scenario sweep (explicitly deferred — "No quiero todavía el sweep de 20 escenarios completo") and does NOT extend the long-horizon scenario further. It isolates the mechanism first, via AE\'s four named tests: TEST A (5x reproducibility), TEST B (state-pack size/composition held against constant history), TEST C (full state WITHOUT history — a control only, not a candidate architecture), and TEST D (tool-called vs text-emitted vs text-useful, FREE/PREMIUM). script ≠ language in lib/context-pack.ts remains untouched and open.',
    instrumentationNote: 'durationMs and token usage are captured for every WILLY call in this pass. SEEK durationMs is captured for the fixture-building SEEK turns. SEEK token usage remains NOT_INSTRUMENTED — never estimated.',
    TEST_A_ZAKIA_REPRODUCIBILITY: testA,
    TEST_B_INCREMENTAL_CONTEXT: testB,
    TEST_C_NO_HISTORY_CONTROL: testC,
    TEST_D_TOOL_PLUS_USER_FACING_RESPONSE: testD,
  };
}

// ============================================================
// WILLY MOTOR SHADOW BENCHMARK — V4 (DERIVED STATE ABLATION)
//
// Per AE's review of V3 ("AUDIT — WILLY MOTOR SHADOW V3"):
//
//   V3 TEST B killed the simple "more tokens breaks tool-calling"
//   explanation (B1 ~1.5k tokens called the tool; B2 ~1.56k tokens —
//   almost the same size as B1 — did NOT; B3 ~13k also did not). The
//   variable that actually changed between B1 and B2/B3 was not size
//   but the presence of three "soft derived state" (interpretive)
//   fields: lastConcept, lastUserGoal, confirmedLevel. AE's hallazgo:
//   "la composición del state pack altera el policy behavior del
//   modelo" — and AE explicitly declined to name any single field
//   "the culprit" from V3 alone, authorizing instead a single-field/
//   combination ablation ("V4 — DERIVED STATE ABLATION") as "pequeño,
//   barato" and the one test AE wants run before any full-benchmark
//   or architecture decision: "V4 debe ser el último experimento de
//   aislamiento antes de volver a decisión de arquitectura."
//
// V4 holds IDENTICAL to V3: same Zakia fixture (same history, same
// model, same turn-4 message, same tool, same entitlements). It
// varies ONLY which of the three soft-derived fields are present in
// the turn-4 state pack, across all 8 combinations (minimal base,
// each single field, each pair, and all three), and — per AE's own
// instruction that V3's 1-shot TEST C/D style runs "no sirve para
// evaluar tool reliability" — each of the 8 variants is run 5x, not
// once, exactly like V3 TEST A.
//
// Unchanged from V2/V3: WILLY_MOTOR_PURPOSE_CONTRACT is NOT touched.
// No production change. Shadow-safe by construction: same SHADOW
// TOOL CAPTURE as V3 (tool_calls recorded, never executed).
// ============================================================

async function runTestV4_DerivedStateAblation(fixture: ZakiaFixture): Promise<Record<string, unknown>> {
  const turn4Msg = fixture.msgs[3];
  const base = fixture.fullStatePackTurn4;
  const minimalState: Record<string, unknown> = {
    interfaceLanguage: base.interfaceLanguage,
    mentorProfile: base.mentorProfile,
    activeMode: base.activeMode,
    tokens: base.tokens,
    userLevel: base.userLevel,
    entitlements: base.entitlements,
  };
  const lastConcept = (base as Record<string, unknown>).lastConcept;
  const lastUserGoal = (base as Record<string, unknown>).lastUserGoal;
  const confirmedLevel = (base as Record<string, unknown>).confirmedLevel;

  const variants: Array<{ label: string; pack: Record<string, unknown> }> = [
    { label: 'BASE_minimal_state', pack: { ...minimalState } },
    { label: 'PLUS_lastConcept', pack: { ...minimalState, lastConcept } },
    { label: 'PLUS_lastUserGoal', pack: { ...minimalState, lastUserGoal } },
    { label: 'PLUS_confirmedLevel', pack: { ...minimalState, confirmedLevel } },
    { label: 'PLUS_lastConcept_lastUserGoal', pack: { ...minimalState, lastConcept, lastUserGoal } },
    { label: 'PLUS_lastConcept_confirmedLevel', pack: { ...minimalState, lastConcept, confirmedLevel } },
    { label: 'PLUS_lastUserGoal_confirmedLevel', pack: { ...minimalState, lastUserGoal, confirmedLevel } },
    { label: 'PLUS_all_three', pack: { ...minimalState, lastConcept, lastUserGoal, confirmedLevel } },
  ];

  const variantResults: Array<Record<string, unknown>> = [];
  for (const variant of variants) {
    const runs: Array<{ run: number; toolCallCount: number; toolCalls: unknown; message: string; promptTokens: number | null; durationMs: number }> = [];
    for (let i = 1; i <= 5; i++) {
      const r = await callWillyMotorToolAware(fixture.willyHistUpToTurn3, turn4Msg, variant.pack);
      runs.push({
        run: i,
        toolCallCount: r.toolCalls.length,
        toolCalls: r.toolCalls,
        message: r.message,
        promptTokens: r.usage?.promptTokens ?? null,
        durationMs: r.durationMs,
      });
    }
    const successCount = runs.filter((rr) => rr.toolCallCount > 0).length;
    variantResults.push({
      label: variant.label,
      statePackJsonLength: JSON.stringify(variant.pack).length,
      fieldsPresent: Object.keys(variant.pack).filter((k) => ['lastConcept', 'lastUserGoal', 'confirmedLevel'].includes(k)),
      toolCallReliability: `${successCount}/5`,
      successCount,
      runs,
    });
  }

  return {
    harness: 'test_v4_derived_state_ablation',
    sent: turn4Msg,
    variants: variantResults,
    summaryTable: variantResults.map((r) => ({ state: (r as Record<string, unknown>).label, toolCalls: (r as Record<string, unknown>).toolCallReliability })),
    note: 'Single- and paired-field ablation grid over the three "soft derived state" fields AE flagged in the V3 review (lastConcept, lastUserGoal, confirmedLevel), holding history, model, turn-4 message, tool, and entitlements IDENTICAL to V3 (same Zakia fixture). Each of the 8 variants is run 5x, per AE\'s explicit instruction that a single run cannot evaluate tool-call reliability (V3\'s own TEST A showed 4/5 variance at constant context size). This is AE\'s authorized "V4 — DERIVED STATE ABLATION": the last isolation experiment before a full-benchmark/maturity decision, per AE\'s own stated limit.',
    governanceNote: 'Purpose contract UNCHANGED from V2/V3. No production change. Shadow-safe by construction — same SHADOW TOOL CAPTURE as V3: tool_calls recorded, never executed.',
  };
}

async function runWillyMotorShadowBenchmarkV4(): Promise<Record<string, unknown>> {
  const fixture = await prepareZakiaFixture();
  const testV4 = await runTestV4_DerivedStateAblation(fixture);

  return {
    harness: 'willy_motor_shadow_benchmark_v4',
    governance: 'SHADOW-SAFE BY CONSTRUCTION, same as V1/V2/V3: WILLY calls are raw completions with SHADOW TOOL CAPTURE (tool_calls recorded, never executed). No production state, canonical memory, entitlement, or commercial side effect was touched anywhere in this run.',
    configurationNote: 'WILLY_MOTOR_PURPOSE_CONTRACT is UNCHANGED from V2/V3 in this entire pass — no prompt reinforcement was tested here, so every result below is directly comparable to V2/V3 under the same configuration.',
    scopeNote: 'Per AE\'s review of the V3 report ("AUDIT — WILLY MOTOR SHADOW V3"): V3 showed the critical variable between B1 (tool called) and B2/B3 (tool not called) was not token size but the presence of soft-derived-state fields (lastConcept, lastUserGoal, confirmedLevel). AE declined to name a single "culprit" field from V3 alone and authorized this single-field/combination ablation, run 5x per variant, as the one microtest to run before any full-benchmark sweep or architecture decision — explicitly the LAST isolation experiment before that decision ("V4 debe ser el último experimento de aislamiento antes de volver a decisión de arquitectura"). This pass does not touch the purpose contract, does not run the broader scenario sweep, and does not extend the long-horizon scenario.',
    instrumentationNote: 'durationMs and token usage are captured for every WILLY call in this pass, exactly as in V3.',
    TEST_V4_DERIVED_STATE_ABLATION: testV4,
  };
}

export async function runDiagnostic(prompt?: string): Promise<Record<string, unknown>> {
  if (prompt && prompt.startsWith('willy_stt_isolation_forensic_v1')) {
    // AE "DICTAMEN D5: ANOMALÍA DE CONTINUIDAD MULTIMODAL" (15.10.2026), §4:
    // bounded forensic experiment, authorized explicitly and narrowly —
    // "sintetizar una única muestra de audio, conservar su hash y utilizar
    // exactamente los mismos bytes de entrada en varias transcripciones
    // independientes". Isolates whether whisper-1 (STT) is itself unstable
    // on identical input bytes, entirely decoupled from WILLY (no WILLY
    // call anywhere in this path) and from D5's own continuity question.
    // Does not reopen D1-D4, does not modify WILLY, does not alter the
    // frozen D5_MULTIMODAL_CONTINUITY scorecard — an independent diagnostic,
    // not an extension or repetition of D5 (per AE's explicit instruction).
    const { runWillySttIsolationForensicV1 } = await import('./willy-full-benchmark');
    return runWillySttIsolationForensicV1();
  }
  if (prompt && prompt.startsWith('willy_d5_audio_continuity_v1')) {
    // AE "WILLY FAST TRACK: PRIMERA MATERIALIZACIÓN ESPONTÁNEA" (15.10.2026),
    // §3: "D5 pasa a prioridad inmediata". AE confirmed runWillyAudioRoundtrip()
    // (lib/engineering/willy-full-benchmark.ts, section 6) is implemented and
    // exported but never invoked by willy_full_benchmark_prep_v1 — so that
    // prompt does NOT constitute a D5 test. This new, narrowly-scoped prompt
    // routes to runWillyD5AudioContinuityV1() (same file, section 9), which
    // actually invokes it for the first time in this workstream: a real,
    // reproducible synthesized input audio (never a second/mocked audio
    // system, per AE's explicit prohibition), genuine seeded WILLY context,
    // real STT -> WILLY -> real TTS, isolation verified pre- and post-hoc,
    // and a best-effort lexical continuity check. Exposed within the Fast
    // Track per AE's explicit authorization ("Si necesita exponer una
    // llamada diagnóstica acotada, queda autorizada... con la misma
    // disciplina de branch, diff, preview y verificación ya establecida").
    const { runWillyD5AudioContinuityV1 } = await import('./willy-full-benchmark');
    return runWillyD5AudioContinuityV1();
  }
  if (prompt && prompt.startsWith('willy_full_benchmark_prep_v1')) {
    const { runWillyFullBenchmarkPrepV1 } = await import('./willy-full-benchmark');
    return runWillyFullBenchmarkPrepV1();
  }
  if (prompt && prompt.startsWith('willy_motor_shadow_benchmark_v4')) {
    return runWillyMotorShadowBenchmarkV4();
  }
  if (prompt && prompt.startsWith('willy_motor_shadow_benchmark_v3')) {
    return runWillyMotorShadowBenchmarkV3();
  }
  if (prompt && prompt.startsWith('willy_motor_shadow_benchmark_v2')) {
    return runWillyMotorShadowBenchmarkV2();
  }
  if (prompt && prompt.startsWith('willy_motor_shadow_benchmark')) {
    return runWillyMotorShadowBenchmark();
  }
  if (prompt && prompt.startsWith('language_continuity_test')) {
    return runLanguageContinuityTest();
  }
  if (prompt && prompt.startsWith('zakia_real_replay')) {
    return runZakiaRealReplay();
  }
  if (prompt && prompt.startsWith('final_certification_sweep')) {
    return runFinalCertificationSweep();
  }
  if (prompt && prompt.startsWith('general_control_comparison')) {
    return runGeneralControlComparison();
  }
  if (prompt && prompt.startsWith('zakia_replay_test')) {
    return runZakiaReplayTest();
  }
  if (prompt && prompt.startsWith('simple_proportionality_test')) {
    return runSimpleProportionalityTest();
  }
  if (prompt && prompt.startsWith('p19_validation')) {
    return runP19Validation();
  }
  if (prompt && prompt.startsWith('p18_action_trace')) {
    return runP18ActionTrace();
  }
  if (prompt && prompt.startsWith('p18_first_turn')) {
    return runP18FirstTurn();
  }
  if (prompt && prompt.startsWith('p17_test_plan')) {
    return runP17TestPlan();
  }
  if (prompt && prompt.startsWith('product_test_a')) {
    return runProductTestA();
  }
  if (prompt && prompt.startsWith('product_test_b')) {
    return runProductTestB();
  }
  if (prompt && prompt.startsWith('product_test_c')) {
    return runProductTestC();
  }
  if (prompt && prompt.startsWith('voice_loop')) {
    return runVoiceLoop();
  }
  if (prompt && prompt.startsWith('audio_roundtrip')) {
    return runAudioRoundtrip();
  }
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

// ============================================================
// P19 — ARTIFACT PREMIUMIZATION VALIDATION.
// Generates the 5 CEO-specified comparable artifacts in production,
// escrows the real PDF bytes, and reports every fact that is genuinely
// verifiable server-side: real page count (via pdf-lib reload, not a
// guess), byte length/SHA, whether the compact or dedicated cover path
// fired (inferred from the artifact's own block count where available),
// and a scan of the CHAT text (not the PDF's internal text, which this
// environment cannot OCR/extract) for the specific meta-closing residue
// pattern ("versión visual" / "visual version") the CEO flagged. Visual
// hierarchy, in-PDF metadata rows, and mobile/A4 readability genuinely
// require opening the escrowed PDF — reported as PENDING_HUMAN_REVIEW
// rather than guessed, per "no aceptar PASS por código".
// ============================================================
const META_OFFER_RESIDUE = /versi[oó]n visual|versi[oó]n gr[aá]fica|make (it|this) visual|visual version/i;

async function runP19Validation(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  async function generateAndEscrow(label: string, mentorKey: string, message: string, activeMode = 'interact') {
    const state = { ...WILLY_INITIAL_STATE, mentorProfile: mentorKey, interfaceLanguage: 'es', tokens: 1, userLevel: 'A1', activeMode };
    const r = await callChatAPI(message, state);
    const artifact = r.artifact as { type?: string; url?: string; title?: string } | null;
    const metaOfferResidueFound = META_OFFER_RESIDUE.test(r.message);

    let escrow: EscrowedArtifact | null = null;
    let pageCount: number | null = null;
    let pdfByteLength: number | null = null;
    if (artifact?.url?.startsWith('data:application/pdf;base64,')) {
      try {
        escrow = await escrowSingleDataUrl(artifact.url, `p19-${label}`);
        const b64 = artifact.url.slice('data:application/pdf;base64,'.length);
        const buf = Buffer.from(b64, 'base64');
        pdfByteLength = buf.length;
        const { PDFDocument } = await import('pdf-lib');
        const loaded = await PDFDocument.load(buf);
        pageCount = loaded.getPageCount();
      } catch (e) {
        escrow = null;
      }
    }

    results[label] = {
      sentMessage: message,
      mentor: mentorKey,
      chatResponsePreview: r.message.slice(0, 300),
      artifactPresent: !!artifact,
      artifactType: artifact?.type ?? null,
      artifactTitle: artifact?.title ?? null,
      pdfPageCount: pageCount,
      pdfByteLength,
      metaOfferResidueFoundInChatText: metaOfferResidueFound,
      escrow,
      VISUAL_HIERARCHY: 'PENDING_HUMAN_REVIEW — requires opening escrow.rawUrl',
      IN_PDF_METADATA_HYGIENE: 'PENDING_HUMAN_REVIEW — requires opening escrow.rawUrl (Bloques/Idioma/Estudiante rows, mentor capitalization)',
      MOBILE_A4_READABILITY: 'PENDING_HUMAN_REVIEW — requires opening escrow.rawUrl',
    };
  }

  await generateAndEscrow('sarah_lesson', 'sarah', 'Enséñame cuándo usar ser y estar en español, con una lección completa y ejemplos.');
  await generateAndEscrow('sarah_table', 'sarah', 'Hazme una tabla comparativa de ser vs estar.');
  await generateAndEscrow('sarah_schema', 'sarah', 'Hazme un esquema visual de ser vs estar.');
  await generateAndEscrow('alex', 'alex', 'Ayúdame a presentarme en una cafetería de Madrid, quiero aprender frases útiles y confianza para esa situación.');
  await generateAndEscrow('nick', 'nick', 'Ayúdame a presentarme profesionalmente en una entrevista de trabajo en español.');

  return {
    harness: 'p19_validation',
    NOTE: 'pdfPageCount and pdfByteLength are verified server-side via pdf-lib reload of the actual generated bytes — not inferred. Visual hierarchy, in-PDF metadata text, and mobile/A4 readability require a human to open escrow.rawUrl; this harness cannot OCR PDF content.',
    results,
  };
}

// ============================================================
// P18 — FIRST-TURN STREAMING VERIFICATION.
// Real production check for all three mentors: fresh session
// (tokens:0), empty message, interact mode — exactly what
// selectMode() now sends. Confirms:
//  - content-type is text/event-stream (not JSON) -> plan.blocking=false
//  - more than one delta chunk arrived -> genuinely progressive, not a
//    single chunk dressed up as streaming
//  - the response is NOT a byte-for-byte match to the old hardcoded
//    GREETINGS[] strings (contextual, not scripted)
//  - interfaceLanguage is respected for an EN-interface fresh session
// ============================================================
const OLD_GREETING_FINGERPRINTS = [
  'ya sé que quieres trabajar en este tema',
  "you've chosen your topic",
  'perfecto. ya tenemos el tema',
  'topic set',
];

async function runP18FirstTurn(): Promise<Record<string, unknown>> {
  const mentors = ['sarah', 'alex', 'nick'] as const;
  const results: Record<string, unknown> = {};

  for (const mentorKey of mentors) {
    const freshState = { ...WILLY_INITIAL_STATE, mentorProfile: mentorKey, interfaceLanguage: 'en', tokens: 0, userLevel: undefined, confirmedLevel: null };
    const r = await callChatAPI('', freshState);
    const lower = r.message.toLowerCase();
    const matchesOldScript = OLD_GREETING_FINGERPRINTS.some((f) => lower.includes(f));
    results[mentorKey] = {
      contentType: r.contentType,
      isStreaming: r.contentType.includes('text/event-stream'),
      deltaCount: r.deltaCount,
      progressiveDelivery: r.deltaCount > 1,
      chars: r.chars,
      matchesOldStaticScript: matchesOldScript,
      messagePreview: r.message.slice(0, 300),
    };
  }

  return { harness: 'p18_first_turn', results };
}

// ============================================================
// P18 — ACTION BAR END-TO-END TRACE.
// Real production calls for Sarah and Alex, mentor-first substantive
// turns (matches pedagogicalAction:'lesson'). Captures the FULL chain the
// server can observe: raw SSE done payload -> parsed suggestedActions ->
// what callChatAPI (mirroring use-beta-page.ts's own SSE parser byte-for-
// byte) would hand to setMsgs(). Cannot observe React state / DOM from
// here — that boundary is named explicitly in the output.
// ============================================================
async function runP18ActionTrace(): Promise<Record<string, unknown>> {
  const sarahState = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'en', tokens: 1, userLevel: 'A1' };
  const sarahR = await callChatAPI("Explain when to use ser vs estar, with examples.", sarahState);

  const alexState = { ...WILLY_INITIAL_STATE, mentorProfile: 'alex', interfaceLanguage: 'en', tokens: 1, userLevel: 'A1' };
  const alexR = await callChatAPI("I'm planning a trip to Mexico, help me with useful travel phrases.", alexState);

  return {
    harness: 'p18_action_trace',
    NOTE: 'This traces backend -> SSE bytes -> what a spec-correct client parser receives. React state / DOM rendering cannot be observed server-side; that boundary starts exactly where use-beta-page.ts calls setMsgs() with the same suggestedActions value shown here.',
    sarah: {
      sentMessage: "Explain when to use ser vs estar, with examples.",
      contentType: sarahR.contentType,
      responsePreview: sarahR.message.slice(0, 200),
      artifactPresent: !!sarahR.artifact,
      artifactType: (sarahR.artifact as { type?: string } | null)?.type ?? null,
      suggestedActions_parsed: sarahR.suggestedActions,
      rawDoneSSEPayloadKeys: sarahR.rawDonePayload ? Object.keys(sarahR.rawDonePayload as object) : null,
      rawDoneSSEPayload_suggestedActionsField: (sarahR.rawDonePayload as { suggestedActions?: unknown } | undefined)?.suggestedActions,
    },
    alex: {
      sentMessage: "I'm planning a trip to Mexico, help me with useful travel phrases.",
      contentType: alexR.contentType,
      responsePreview: alexR.message.slice(0, 200),
      artifactPresent: !!alexR.artifact,
      artifactType: (alexR.artifact as { type?: string } | null)?.type ?? null,
      suggestedActions_parsed: alexR.suggestedActions,
      rawDoneSSEPayloadKeys: alexR.rawDonePayload ? Object.keys(alexR.rawDonePayload as object) : null,
      rawDoneSSEPayload_suggestedActionsField: (alexR.rawDonePayload as { suggestedActions?: unknown } | undefined)?.suggestedActions,
    },
  };
}

// ============================================================
// P17 — DELTA REPAIR TEST PLAN (A: pronunciation truth,
// B: interface language, C: topic continuity, D: export quality).
// Minimum needed per the P17 CEO directive — one pass, no repeats.
// ============================================================
async function runP17TestPlan(): Promise<Record<string, unknown>> {
  const { generateSpeech } = await import('../../server/tools/audio-toolkit');

  const targetPhrase = 'Me gusta el café con leche.';
  const ttsA = await generateSpeech(targetPhrase, { voice: 'nova' });
  let testA: Record<string, unknown> = { skipped: true, reason: 'tts_failed' };
  if (ttsA.success && ttsA.url) {
    const a1 = await callChatAPI('', { ...WILLY_INITIAL_STATE, interfaceLanguage: 'es' }, { audioDataUrl: ttsA.url, audioMimeType: 'audio/mpeg', pronunciationTarget: targetPhrase });
    const a2 = await callChatAPI('', { ...WILLY_INITIAL_STATE, interfaceLanguage: 'es' }, { audioDataUrl: ttsA.url, audioMimeType: 'audio/mpeg', pronunciationTarget: targetPhrase });
    const a1Lower = a1.message.toLowerCase();
    const a2Lower = a2.message.toLowerCase();
    const a1ClaimsError = /error|incorrect|deber[ií]as|correcci[oó]n|en vez de|→/.test(a1Lower) && !/ninguno detectado|sin errores|no errors|no error/.test(a1Lower);
    const a2ClaimsError = /error|incorrect|deber[ií]as|correcci[oó]n|en vez de|→/.test(a2Lower) && !/ninguno detectado|sin errores|no errors|no error/.test(a2Lower);
    testA = {
      target: targetPhrase,
      attempt1: a1.message.slice(0, 400),
      attempt2: a2.message.slice(0, 400),
      attempt1ClaimsError: a1ClaimsError,
      attempt2ClaimsError: a2ClaimsError,
      consistentVerdict: a1ClaimsError === a2ClaimsError,
      usedGroundedPath: a1.message.toUpperCase().includes('SCORE') === false,
    };
  }

  let stateB: Record<string, unknown> = { ...WILLY_INITIAL_STATE, interfaceLanguage: 'en', userLevel: undefined, confirmedLevel: null };
  const b1 = await callChatAPI("I'm a beginner. Teach me ser vs estar simply.", stateB);
  if (b1.state) stateB = b1.state as Record<string, unknown>;
  const b2 = await callChatAPI('Ahora explícame eso en español.', stateB);
  if (b2.state) stateB = b2.state as Record<string, unknown>;
  const b3 = await callChatAPI('Back to English.', stateB);
  if (b3.state) stateB = b3.state as Record<string, unknown>;

  const ENGLISH_MARKERS = /\b(the|is|are|use|when|because|for|state|identity)\b/i;
  const SPANISH_MARKERS = /\b(el|la|es|son|usa|porque|estado|identidad|cuando)\b/i;
  const testB = {
    turn1_expectEnglish: { sent: "I'm a beginner. Teach me ser vs estar simply.", preview: b1.message.slice(0, 300), looksEnglish: ENGLISH_MARKERS.test(b1.message) && !/^(hola|claro|perfecto)/i.test(b1.message.trim()) },
    turn2_expectSpanishSwitch: { sent: 'Ahora explícame eso en español.', preview: b2.message.slice(0, 300), looksSpanish: SPANISH_MARKERS.test(b2.message) },
    turn3_expectEnglishReturn: { sent: 'Back to English.', preview: b3.message.slice(0, 300), looksEnglish: ENGLISH_MARKERS.test(b3.message) },
  };

  let stateC: Record<string, unknown> = { ...WILLY_INITIAL_STATE };
  const c1 = await callChatAPI('Explícame el pretérito pluscuamperfecto en español.', stateC);
  if (c1.state) stateC = c1.state as Record<string, unknown>;
  const c2 = await callChatAPI('Hazlo más visual.', stateC);
  if (c2.state) stateC = c2.state as Record<string, unknown>;
  const c3 = await callChatAPI('Quiero tabla.', stateC);
  if (c3.state) stateC = c3.state as Record<string, unknown>;

  const c3LastConcept = String((stateC as any).lastConcept ?? '');
  const c3Artifact = c3.artifacts?.[0] as { title?: string } | undefined;
  const topicPreserved = /pluscuamperfecto/i.test(c3LastConcept) || /pluscuamperfecto/i.test(c3Artifact?.title ?? '') || /pluscuamperfecto/i.test(c3.message);
  const testC = {
    turn1: { sent: 'Explícame el pretérito pluscuamperfecto en español.', lastConceptAfter: String((c1.state as any)?.lastConcept ?? 'MISSING') },
    turn2: { sent: 'Hazlo más visual.', lastConceptAfter: String((c2.state as any)?.lastConcept ?? 'MISSING') },
    turn3: { sent: 'Quiero tabla.', lastConceptAfter: c3LastConcept, artifactTitle: c3Artifact?.title, messagePreview: c3.message.slice(0, 200) },
    topicPreserved,
  };

  const exportTranscript = [
    `[Student]: ${c1.message ? 'Explícame el pretérito pluscuamperfecto en español.' : ''}`,
    `[SARAH]: ${c1.message.slice(0, 2000)}`,
    `[Student]: Hazlo más visual.`,
    `[SARAH]: ${c2.message.slice(0, 2000)}`,
    `[Student]: Quiero tabla.`,
    `[SARAH]: ${c3.message.slice(0, 500)}`,
  ].join('\n\n');
  const exportR = await callChatAPI('Exporta esta conversación a PDF', stateC, { exportTranscript });
  let testD: Record<string, unknown> = { artifactPresent: !!exportR.artifact };
  const exportArtifact = exportR.artifact as { url?: string; type?: string } | undefined;
  if (exportArtifact?.url) {
    try {
      const escrow = await escrowSingleDataUrl(exportArtifact.url, 'p17-export-test');
      testD = { ...testD, artifactType: exportArtifact.type, escrow };
    } catch (e) {
      testD = { ...testD, escrowError: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    harness: 'p17_test_plan',
    TEST_A_pronunciation_truth: testA,
    TEST_B_interface_language: testB,
    TEST_C_topic_continuity: testC,
    TEST_D_export_quality: testD,
  };
}

async function runProductTestA(): Promise<Record<string, unknown>> {
  let state: Record<string, unknown> = { ...WILLY_INITIAL_STATE, interfaceLanguage: 'en', userLevel: undefined, confirmedLevel: null };
  const turns: Array<{ label: string; sent: string; response: string; chars: number; artifacts: unknown[] }> = [];
  const transcriptLines: string[] = [];

  async function turn(label: string, message: string) {
    const r = await callChatAPI(message, state);
    if (r.state) state = r.state as Record<string, unknown>;
    turns.push({ label, sent: message, response: r.message, chars: r.chars, artifacts: r.artifacts });
    transcriptLines.push(`[Student]: ${message}`);
    transcriptLines.push(`[SARAH]: ${r.message.replace(/\s+/g, ' ').trim()}`);
    return r;
  }

  await turn('T1a_basic_request', "I'm a beginner. I want to learn when to use ser and estar. Please keep it simple.");
  await turn('T1b_reasoned_mistake', "I think 'soy cansado' is correct because tired is a state of being.");
  await turn('T2_depth_shift', "Now explain ser vs estar as if I were a linguistics student. I want the semantic distinction, edge cases, and examples where both are possible but the meaning changes.");
  await turn('T3a_topic_switch', "Forget Spanish for a moment. Explain why acupuncture uses the concept of meridians, separating traditional Chinese theory from modern scientific evidence.");
  await turn('T3b_return_to_spanish', "Now use what you just explained to teach me three useful Spanish sentences for discussing acupuncture with a doctor.");
  await turn('T5a_best_format', "Show me this in the best visual format for understanding it.");
  const t5b = await turn('T5b_more_visual', "Make it more visual.");
  await turn('T5c_why_format', "Why did you choose this format?");

  const exportTranscript = transcriptLines.join('\n\n');
  const exportR = await callChatAPI('Exporta esta conversación a PDF', state, { exportTranscript });
  if (exportR.state) state = exportR.state as Record<string, unknown>;

  let exportEscrow: EscrowedArtifact | null = null;
  const exportArtifact = exportR.artifact as { url?: string; type?: string } | undefined;
  if (exportArtifact?.url) {
    try { exportEscrow = await escrowSingleDataUrl(exportArtifact.url, 'session-export'); }
    catch (e) { exportEscrow = null; }
  }

  return {
    harness: 'product_test_a',
    turns: turns.map(t => ({ label: t.label, sent: t.sent, chars: t.chars, hasArtifact: t.artifacts.length > 0, responsePreview: t.response.slice(0, 900) })),
    test5_placeholderCheck: {
      containsEllipsisPattern: /\|\s*\.\.\.\s*\|/.test(t5b.message) || /\n\s*\.\.\.\s*\n/.test(t5b.message),
      responseFull: t5b.message,
    },
    export: {
      messagePreview: exportR.message.slice(0, 300),
      artifactPresent: !!exportArtifact,
      artifactType: exportArtifact?.type,
      escrow: exportEscrow,
    },
    finalStateSnapshot: {
      lastConcept: (state as any).lastConcept,
      lastUserGoal: (state as any).lastUserGoal,
      confirmedLevel: (state as any).confirmedLevel,
      userLevel: (state as any).userLevel,
      interfaceLanguage: (state as any).interfaceLanguage,
    },
  };
}

async function runProductTestB(): Promise<Record<string, unknown>> {
  let state: Record<string, unknown> = { ...WILLY_INITIAL_STATE, interfaceLanguage: 'en', userLevel: undefined, confirmedLevel: null };
  const turns: Array<{ sent: string; response: string; chars: number }> = [];

  async function turn(message: string) {
    const r = await callChatAPI(message, state);
    if (r.state) state = r.state as Record<string, unknown>;
    turns.push({ sent: message, response: r.message, chars: r.chars });
    return r;
  }

  await turn("Hi, I'd like to learn some Spanish.");
  await turn("I'm Maria, I want to learn Spanish for a trip to Mexico next month.");
  await turn("Hola, me llamo Maria.");

  return {
    harness: 'product_test_b',
    turns: turns.map(t => ({ sent: t.sent, chars: t.chars, responseFull: t.response })),
  };
}

async function runProductTestC(): Promise<Record<string, unknown>> {
  const { generateSpeech } = await import('../../server/tools/audio-toolkit');
  let state: Record<string, unknown> = { ...WILLY_INITIAL_STATE, interfaceLanguage: 'en' };

  const r1 = await callChatAPI('Can you give me a short Spanish phrase to practice pronunciation?', state);
  if (r1.state) state = r1.state as Record<string, unknown>;

  const quoteMatch = r1.message.match(/[«"“]([^»"”]{3,60})[»"”]/) || r1.message.match(/\*\*([^*]{3,60})\*\*/);
  const targetPhrase = quoteMatch ? quoteMatch[1] : 'Buenos días, ¿cómo está usted?';

  const tts1 = await generateSpeech(targetPhrase, { voice: 'nova' });
  if (!tts1.success || !tts1.url) {
    return { harness: 'product_test_c', stage: 'attempt1_tts_failed', error: tts1.message, sarahPhrase: r1.message.slice(0, 300) };
  }
  const r2 = await callChatAPI('', state, { audioDataUrl: tts1.url, audioMimeType: 'audio/mpeg', pronunciationTarget: targetPhrase });
  if (r2.state) state = r2.state as Record<string, unknown>;

  const tts2 = await generateSpeech(targetPhrase, { voice: 'nova' });
  let r3Preview = null;
  if (tts2.success && tts2.url) {
    const r3 = await callChatAPI('', state, { audioDataUrl: tts2.url, audioMimeType: 'audio/mpeg', pronunciationTarget: targetPhrase });
    r3Preview = r3.message.slice(0, 500);
  }

  return {
    harness: 'product_test_c',
    LIMITATION: 'Synthetic TTS input is phonetically clean (no real human mispronunciation). This can only verify whether feedback is attempt-specific, not whether flaw-detection works on genuine errors.',
    sarahOfferedPhrase: r1.message.slice(0, 300),
    targetPhraseUsed: targetPhrase,
    attempt1_feedback: r2.message.slice(0, 600),
    attempt1_artifacts: r2.artifacts,
    attempt2_feedback: r3Preview,
  };
}

async function runAudioRoundtrip(): Promise<Record<string, unknown>> {
  const { generateSpeech } = await import('../../server/tools/audio-toolkit');
  const spokenText = 'Hoy quiero aprender a decir la hora en español, por favor.';
  const tts = await generateSpeech(spokenText, { voice: 'nova' });
  if (!tts.success || !tts.url) {
    return { harness: 'audio_roundtrip', ttsGenerationFailed: true, ttsError: tts.message };
  }

  const result = await callChatAPI('', WILLY_INITIAL_STATE, {
    audioDataUrl: tts.url,
    audioMimeType: 'audio/mpeg',
  });

  const msgLower = result.message.toLowerCase();
  const reflectsSpokenContent = msgLower.includes('hora') || msgLower.includes('decir la hora') || msgLower.includes('time');
  const isPlaceholderOrEmpty = result.chars < 20 || msgLower.includes('audio input') || msgLower.includes('[audio');

  return {
    harness: 'audio_roundtrip',
    spokenText,
    ttsBytesGenerated: tts.url.startsWith('data:') ? tts.url.length : 'external_url',
    chars: result.chars,
    reflectsSpokenContent,
    isPlaceholderOrEmpty,
    verdict: reflectsSpokenContent && !isPlaceholderOrEmpty ? 'PASS' : 'FAIL',
    messagePreview: result.message.slice(0, 500),
  };
}

async function runVoiceLoop(): Promise<Record<string, unknown>> {
  const { generateSpeech } = await import('../../server/tools/audio-toolkit');

  const turn1Text = 'Sarah, quiero aprender a decir la hora en español.';
  const tts1 = await generateSpeech(turn1Text, { voice: 'nova' });
  if (!tts1.success || !tts1.url) {
    return { harness: 'voice_loop', stage: 'turn1_tts_failed', error: tts1.message };
  }
  const r1 = await callChatAPI('', WILLY_INITIAL_STATE, { audioDataUrl: tts1.url, audioMimeType: 'audio/mpeg' });
  const r1HasAudio = r1.artifacts.some((a: any) => a?.type === 'audio');
  const r1ReflectsContent = r1.message.toLowerCase().includes('hora');

  if (!r1.state) {
    return { harness: 'voice_loop', stage: 'turn1_no_state_returned', turn1: { chars: r1.chars, hasAudio: r1HasAudio, reflectsContent: r1ReflectsContent } };
  }

  const turn2Text = 'Y cómo digo ocho y media.';
  const tts2 = await generateSpeech(turn2Text, { voice: 'nova' });
  if (!tts2.success || !tts2.url) {
    return { harness: 'voice_loop', stage: 'turn2_tts_failed', error: tts2.message, turn1: { chars: r1.chars, hasAudio: r1HasAudio, reflectsContent: r1ReflectsContent } };
  }
  const r2 = await callChatAPI('', r1.state as Record<string, unknown>, { audioDataUrl: tts2.url, audioMimeType: 'audio/mpeg' });
  const r2HasAudio = r2.artifacts.some((a: any) => a?.type === 'audio');
  const r2Lower = r2.message.toLowerCase();
  const r2ShowsContinuity = r2Lower.includes('ocho') || r2Lower.includes('media') || r2Lower.includes('hora');

  const turn3Text = 'Ahora dame otro ejemplo.';
  const r3 = await callChatAPI(turn3Text, r2.state as Record<string, unknown>);
  const r3HasAudio = r3.artifacts.some((a: any) => a?.type === 'audio');
  const r3Lower = r3.message.toLowerCase();
  const r3ShowsContinuity = r3Lower.includes('hora') || r3Lower.includes('media') || /\d/.test(r3.message);

  return {
    harness: 'voice_loop',
    turn1_voice: { spoken: turn1Text, chars: r1.chars, hasAudioArtifact: r1HasAudio, reflectsSpokenContent: r1ReflectsContent, messagePreview: r1.message.slice(0, 300) },
    turn2_voice_continuity: { spoken: turn2Text, chars: r2.chars, hasAudioArtifact: r2HasAudio, showsContinuity: r2ShowsContinuity, messagePreview: r2.message.slice(0, 300) },
    turn3_voice_to_text: { typed: turn3Text, chars: r3.chars, hasAudioArtifact_shouldBeFalse: r3HasAudio, showsContinuity: r3ShowsContinuity, messagePreview: r3.message.slice(0, 300) },
    verdict: { T1_PASS: r1HasAudio && r1ReflectsContent, T2_PASS: r2HasAudio && r2ShowsContinuity, T3_PASS: r3ShowsContinuity && !r3HasAudio },
  };
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
      outcomes.push({ count: subjects.length, subjects, finishReason: decision.choices?.[0]?.finish_reason, rawToolCallCount: rawToolCalls.length });
    } catch (e) {
      outcomes.push({ count: -1, subjects: [`ERROR: ${e instanceof Error ? e.message : String(e)}`] });
    }
  }

  const distribution: Record<string, number> = {};
  for (const o of outcomes) { const k = String(o.count); distribution[k] = (distribution[k] ?? 0) + 1; }

  return { harness: 'decision_harness (tool_calls baseline)', taughtChars: taught.length, taughtPreview: taught.slice(0, 300), runs, distribution, outcomes };
}

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
      try { const parsed = JSON.parse(raw); rawEntries = Array.isArray(parsed.artifacts) ? parsed.artifacts : []; } catch { /* leave empty */ }
      const subjects: string[] = [];
      for (const entry of rawEntries) { const parsed = parseArtifactSignal(entry); if (parsed) subjects.push(parsed.subject); }
      outcomes.push({ count: subjects.length, subjects, finishReason: decision.choices?.[0]?.finish_reason, rawEntryCount: rawEntries.length });
    } catch (e) {
      outcomes.push({ count: -1, subjects: [`ERROR: ${e instanceof Error ? e.message : String(e)}`] });
    }
  }

  const distribution: Record<string, number> = {};
  for (const o of outcomes) { const k = String(o.count); distribution[k] = (distribution[k] ?? 0) + 1; }

  return { harness: 'decision_harness_json (structured list alternative)', taughtChars: taught.length, taughtPreview: taught.slice(0, 300), runs, distribution, outcomes };
}

// ─── GitHub tools (unchanged) ─────────────────────────────────────────────────

export async function repoStatus() {
  const { data: repo } = await gh<{ default_branch: string; html_url: string }>('GET', repoPath());
  const { data: ref } = await gh<GhRef>('GET', `${repoPath()}/git/ref/heads/main`);
  return { owner: ALLOWED_OWNER, repo: ALLOWED_REPO, defaultBranch: repo.default_branch, mainHead: ref.object.sha, htmlUrl: repo.html_url, policy: POLICY };
}

export async function listBranches() {
  const { data } = await gh<Array<{ name: string; commit: { sha: string }; protected: boolean }>>('GET', `${repoPath()}/branches?per_page=100`);
  return data.map((b) => ({ name: b.name, sha: b.commit.sha, protected: b.protected }));
}

export async function listTree(ref = 'main') {
  const { data } = await gh<{ truncated: boolean; tree: Array<{ path: string; type: string; sha: string }> }>('GET', `${repoPath()}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  return { truncated: data.truncated, tree: data.tree };
}

export async function readFile(path: string, ref = 'main') {
  const { status, data } = await gh<GhContent>('GET', `${repoPath()}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`);
  if (status === 404) return { found: false, path, ref };
  const raw = data.encoding === 'base64' && data.content ? Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8') : data.content || '';
  return { found: true, path, ref, sha: data.sha, content: raw };
}

export async function getCommit(sha: string) {
  const { data } = await gh<GhCommit>('GET', `${repoPath()}/commits/${encodeURIComponent(sha)}`);
  return data;
}

export async function compareRefs(base: string, head: string) {
  const { data } = await gh('GET', `${repoPath()}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  return data;
}

async function getHeadSha(branch: string): Promise<string> {
  const { status, data } = await gh<GhRef>('GET', `${repoPath()}/git/ref/heads/${branch}`);
  if (status === 404) throw new Error(`Branch not found: ${branch}`);
  return data.object.sha;
}

export async function createBranch(name: string, from = 'main') {
  const sha = await getHeadSha(resolveBranch(from));
  const { status, data } = await gh<{ ref: string; object: { sha: string } }>('POST', `${repoPath()}/git/refs`, { ref: `refs/heads/${name}`, sha });
  if (status >= 400) throw new Error(`create_branch failed: ${status} ${JSON.stringify(data)}`);
  return { branch: name, sha: data.object.sha };
}

async function putFile(path: string, content: string, message: string, branch: string) {
  const existing = await readFile(path, branch);
  const { status, data } = await gh<{ commit: { sha: string; html_url: string }; content: { sha: string } }>(
    'PUT', `${repoPath()}/contents/${encodeURIComponent(path)}`,
    { message, content: Buffer.from(content, 'utf8').toString('base64'), branch, ...(existing.found && existing.sha ? { sha: existing.sha } : {}) },
  );
  if (status >= 400) throw new Error(`write_file failed: ${status} ${JSON.stringify(data)}`);
  return { path, commitSha: data.commit.sha, url: data.commit.html_url };
}

export async function writeFile(path: string, content: string, message: string, branch = 'main') {
  const b = resolveBranch(branch);
  assertBranchWritable(b); // GATE-01: no direct writes to main from this or any internal command
  return putFile(path, content, message, b);
}

export async function writeFiles(files: Array<{ path: string; content: string }>, message: string, branch = 'main') {
  const b = resolveBranch(branch);
  assertBranchWritable(b); // GATE-01: no direct writes to main from this or any internal command
  if (files.length === 1) return writeFile(files[0].path, files[0].content, message, b);

  const head = await getHeadSha(b);
  const { data: headCommit } = await gh<{ tree: { sha: string }; sha: string }>('GET', `${repoPath()}/git/commits/${head}`);

  const blobs: Array<{ path: string; sha: string; mode: string; type: string }> = [];
  for (const f of files) {
    const { status, data } = await gh<{ sha: string }>('POST', `${repoPath()}/git/blobs`, { content: Buffer.from(f.content, 'utf8').toString('base64'), encoding: 'base64' });
    if (status >= 400) throw new Error(`blob failed: ${JSON.stringify(data)}`);
    blobs.push({ path: f.path, sha: data.sha, mode: '100644', type: 'blob' });
  }

  const { status: ts, data: tree } = await gh<{ sha: string }>('POST', `${repoPath()}/git/trees`, { base_tree: headCommit.tree.sha, tree: blobs });
  if (ts >= 400) throw new Error(`tree failed: ${JSON.stringify(tree)}`);

  const { status: cs, data: commit } = await gh<{ sha: string; html_url?: string }>('POST', `${repoPath()}/git/commits`, { message, tree: tree.sha, parents: [head] });
  if (cs >= 400) throw new Error(`commit failed: ${JSON.stringify(commit)}`);

  const { status: rs, data: ref } = await gh('PATCH', `${repoPath()}/git/refs/heads/${b}`, { sha: commit.sha, force: false });
  if (rs >= 400) throw new Error(`update ref failed: ${JSON.stringify(ref)}`);

  return { commitSha: commit.sha, branch: b, files: files.map((f) => f.path) };
}

export async function deleteFile(path: string, message: string, branch = 'main') {
  const b = resolveBranch(branch);
  assertBranchWritable(b); // GATE-01: no direct writes to main from this or any internal command
  const existing = await readFile(path, b);
  if (!existing.found || !existing.sha) throw new Error(`File not found: ${path}`);
  const { status, data } = await gh<{ commit: { sha: string } }>('DELETE', `${repoPath()}/contents/${encodeURIComponent(path)}`, { message, sha: existing.sha, branch: b });
  if (status >= 400) throw new Error(`delete_file failed: ${JSON.stringify(data)}`);
  return { path, commitSha: data.commit.sha };
}

export async function rollbackCommit(sha?: string, branch = 'main') {
  forbidDestructive('force_push', branch);
  const b = resolveBranch(branch);
  const head = await getHeadSha(b);
  const target = sha || head;
  const { data: commit } = await gh<{ parents: Array<{ sha: string }>; sha: string; commit: { message: string } }>('GET', `${repoPath()}/commits/${target}`);
  const parent = commit.parents?.[0]?.sha;
  if (!parent) throw new Error('Cannot revert: no parent');
  if (target !== head) throw new Error('rollback_commit currently reverts only HEAD (no history rewrite)');
  const { data: parentCommit } = await gh<{ commit: { tree: { sha: string } } }>('GET', `${repoPath()}/commits/${parent}`);

  // GATE-01: a revert is a write like any other — it must land on its own
  // branch and go through a reviewed, checked pull request, never patched
  // directly onto main's (or any protected branch's) ref. This removes the
  // one path that previously bypassed the review requirement entirely.
  if (b === 'main' && !POLICY.mainWrite) {
    const revertBranchName = `revert/${target.slice(0, 7)}-${Date.now()}`;
    await createBranch(revertBranchName, b);
    const { status, data: newCommit } = await gh<{ sha: string }>('POST', `${repoPath()}/git/commits`, { message: `lingora(mcp): revert ${target.slice(0, 7)}`, tree: parentCommit.commit.tree.sha, parents: [head] });
    if (status >= 400) throw new Error(`revert commit failed: ${JSON.stringify(newCommit)}`);
    const { status: rs, data: ref } = await gh('PATCH', `${repoPath()}/git/refs/heads/${revertBranchName}`, { sha: newCommit.sha, force: false });
    if (rs >= 400) throw new Error(`revert ref failed: ${JSON.stringify(ref)}`);
    return {
      reverted: target,
      revertBranch: revertBranchName,
      revertCommit: newCommit.sha,
      branch: b,
      note: 'GATE-01: revert staged on its own branch, not applied to main. Open a pull request from this branch and merge it through the normal reviewed/checked path to land the revert.',
    };
  }

  const { status, data: newCommit } = await gh<{ sha: string }>('POST', `${repoPath()}/git/commits`, { message: `lingora(mcp): revert ${target.slice(0, 7)}`, tree: parentCommit.commit.tree.sha, parents: [head] });
  if (status >= 400) throw new Error(`revert commit failed: ${JSON.stringify(newCommit)}`);
  const { status: rs, data: ref } = await gh('PATCH', `${repoPath()}/git/refs/heads/${b}`, { sha: newCommit.sha, force: false });
  if (rs >= 400) throw new Error(`revert ref failed: ${JSON.stringify(ref)}`);
  return { reverted: target, newHead: newCommit.sha, branch: b };
}

export async function createPullRequest(title: string, head: string, base = 'main', body = '') {
  const { status, data } = await gh<{ number: number; html_url: string }>('POST', `${repoPath()}/pulls`, { title, head, base, body });
  if (status >= 400) throw new Error(`create_pull_request failed: ${JSON.stringify(data)}`);
  return data;
}

export async function listPullRequests(state: 'open' | 'closed' | 'all' = 'open') {
  const { data } = await gh('GET', `${repoPath()}/pulls?state=${state}&per_page=20`);
  return data;
}

export async function getPullRequest(number: number) {
  const { data } = await gh('GET', `${repoPath()}/pulls/${number}`);
  return data;
}

type GhPrSummary = { number: number; title: string; state: string; user: { login: string } | null; head: { sha: string } };
type GhReview = { state: string; user: { login: string } | null };
type GhCheckRunsResponse = { check_runs: Array<{ name: string; status: string; conclusion: string | null }> };

async function fetchMergeGateInputs(number: number) {
  const { data: pr } = await gh<GhPrSummary>('GET', `${repoPath()}/pulls/${number}`);
  const { data: reviewsRaw } = await gh<GhReview[]>('GET', `${repoPath()}/pulls/${number}/reviews`);
  const reviews = Array.isArray(reviewsRaw) ? reviewsRaw : [];
  const prAuthor = pr.user?.login ?? null;
  const approvals = reviews.filter((r) => r.state === 'APPROVED');
  const independentApprovals = approvals.filter((r) => r.user?.login && r.user.login !== prAuthor);

  const headSha = pr.head?.sha;
  const { data: checkRunsRaw } = await gh<GhCheckRunsResponse>('GET', `${repoPath()}/commits/${headSha}/check-runs`);
  const runs = checkRunsRaw?.check_runs ?? [];
  const allChecksPassing = runs.length > 0 && runs.every((r) => r.status === 'completed' && r.conclusion === 'success');

  return { pr, prAuthor, approvals, independentApprovals, headSha, runs, allChecksPassing };
}

// GATE-01 (AE "STOP DE ARQUITECTURA", 15.10.2026): read-only report of
// whether mergePullRequest() would currently be allowed for this PR —
// independent human approval present, and all required checks passing —
// WITHOUT merging anything. Use this to inspect gate status before acting.
export async function checkMergeGate(number: number) {
  const { pr, prAuthor, approvals, independentApprovals, headSha, runs, allChecksPassing } = await fetchMergeGateInputs(number);
  return {
    number,
    title: pr.title,
    state: pr.state,
    author: prAuthor,
    headSha,
    approvals: approvals.map((r) => r.user?.login ?? null),
    hasIndependentApproval: independentApprovals.length > 0,
    checkRuns: runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion })),
    allChecksPassing,
    mergeGateWouldPass: independentApprovals.length > 0 && allChecksPassing,
  };
}

export async function mergePullRequest(number: number) {
  if (POLICY.requireIndependentApprovalForMerge || POLICY.requireChecksForMerge) {
    const { prAuthor, independentApprovals, headSha, runs, allChecksPassing } = await fetchMergeGateInputs(number);

    if (POLICY.requireIndependentApprovalForMerge && independentApprovals.length === 0) {
      throw new Error(
        `Policy (GATE-01): merge blocked — PR #${number} has no APPROVED review from anyone other than its own author (${prAuthor ?? 'unknown'}). An AI-authored approval or declaration does not satisfy this.`,
      );
    }
    if (POLICY.requireChecksForMerge && !allChecksPassing) {
      throw new Error(
        `Policy (GATE-01): merge blocked — PR #${number} head ${headSha} has ${runs.length === 0 ? 'no check runs at all' : 'failing or incomplete check runs'}. All required checks must complete with conclusion "success" before merge.`,
      );
    }
  }

  const { status, data } = await gh<{ merged: boolean; sha: string }>('PUT', `${repoPath()}/pulls/${number}/merge`, { merge_method: 'squash' });
  if (status >= 400) throw new Error(`merge failed: ${JSON.stringify(data)}`);
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
    { name: 'write_file', description: 'Create or update one file on a branch. GATE-01: direct writes to main are refused (Policy error) — use a feature branch and a pull request.' },
    { name: 'write_files', description: 'Atomic multi-file commit on a branch. GATE-01: direct writes to main are refused (Policy error) — use a feature branch and a pull request.' },
    { name: 'delete_file', description: 'Delete one file on a branch. GATE-01: direct deletes on main are refused (Policy error) — use a feature branch and a pull request.' },
    { name: 'create_branch', description: 'Create a branch from main or given SHA source' },
    { name: 'rollback_commit', description: 'Revert a commit. GATE-01: when targeting main, stages the revert on its own new branch instead of writing to main directly — open a pull request from that branch to land it.' },
    { name: 'create_pull_request', description: 'Open a PR' },
    { name: 'get_pull_request', description: 'Read one PR' },
    { name: 'list_pull_requests', description: 'List PRs' },
    { name: 'merge_pull_request', description: 'GATE-01: squash-merges a PR only if it has an APPROVED review from someone other than its own author AND all check-runs on its head SHA completed with conclusion "success" (zero check-runs also blocks the merge). An AI-written approval declaration does not satisfy the independent-review requirement. Throws a Policy error naming exactly which condition failed otherwise.' },
    { name: 'check_merge_gate', description: 'GATE-01: read-only report of whether merge_pull_request would currently be allowed for this PR (independent approval present? all checks passing?) — does not merge anything.' },
    { name: 'run_diagnostic', description: 'Run WILLY FREE ("willy"), WILLY with binary escrow of PDF artifacts ("willy_escrow"), a custom prompt, decision_harness:<N>, decision_harness_json:<N>, audio_roundtrip, voice_loop, product_test_a/b/c, p17_test_plan, p18_first_turn, p18_action_trace, p19_validation, zakia_replay_test, simple_proportionality_test, general_control_comparison, final_certification_sweep, zakia_real_replay, or language_continuity_test (Arabic message with a realistic English interfaceLanguage default — isolates whether the mentor follows the student\'s actual written language).  Also runs willy_motor_shadow_benchmark (CEO-authorized shadow comparison: current SEEK production path vs a tool-less WILLY Motor purpose-contract path, same real conversation/state, across the 10 required test families; structurally side-effect-free).  Also runs willy_motor_shadow_benchmark_v2 (second pass: tool-intent symmetry via SHADOW TOOL CAPTURE, entitlement-gated cognition free-vs-premium, and a bounded 16-turn long-horizon coherence scenario — same shadow-safe-by-construction guarantee). Also runs willy_motor_shadow_benchmark_v3 (third pass, same unmodified purpose contract as V2: isolates the V2 turn-4 tool-call-failure mechanism via 4 targeted tests — 5x reproducibility, state-pack size/composition with history held constant, a no-history control, and tool-called-vs-text-emitted-vs-text-useful for FREE/PREMIUM — before any broader scenario sweep). Also runs willy_motor_shadow_benchmark_v4 (fourth pass, same unmodified purpose contract: AE-authorized derived-state ablation grid — single-field and paired-field combinations of lastConcept/lastUserGoal/confirmedLevel, each run 5x, history/model/turn/tool/entitlements held identical to V3 — the final isolation microtest before any full-benchmark or architecture decision). Also runs willy_d5_audio_continuity_v1 (AE FAST TRACK, D5 priority directive 15.10.2026: first real audio->STT->WILLY->TTS circuit — real reproducible synthesized input audio via generateSpeech(), genuine seeded WILLY context, runWillyAudioRoundtrip() invoked for the first time in this workstream, isolation verified pre- and post-hoc, lexical continuity heuristic; n=1 first circuit, not the frozen D5 scorecard\'s 3 repetitions). Also runs willy_stt_isolation_forensic_v1 (AE bounded forensic directive 15.10.2026, §4: synthesizes ONE fixed audio sample via generateSpeech(), records its SHA-256, then calls transcribeAudio() 3 independent times on the SAME bytes — isolates whisper-1 stability/determinism with no WILLY call anywhere in the path; independent of and does not alter the frozen D5_MULTIMODAL_CONTINUITY scorecard). No browser needed.' },
  ];
}

export async function dispatchTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  assertRepo(ALLOWED_OWNER, ALLOWED_REPO);

  switch (name) {
    case 'repo_status': return repoStatus();
    case 'list_tree': return listTree(String(args.ref || 'main'));
    case 'list_branches': return listBranches();
    case 'read_file': return readFile(String(args.path), String(args.ref || 'main'));
    case 'read_files': {
      const paths = args.paths as string[];
      const out = [];
      for (const p of paths || []) out.push(await readFile(p, String(args.ref || 'main')));
      return out;
    }
    case 'get_commit': return getCommit(String(args.sha || 'main'));
    case 'compare_refs': return compareRefs(String(args.base || 'main'), String(args.head));
    case 'write_file': return writeFile(String(args.path), String(args.content), String(args.message || `lingora(mcp): update ${args.path}`), String(args.branch || 'main'));
    case 'write_files': return writeFiles((args.files as Array<{ path: string; content: string }>) || [], String(args.message || 'lingora(mcp): update files'), String(args.branch || 'main'));
    case 'delete_file': return deleteFile(String(args.path), String(args.message || `lingora(mcp): delete ${args.path}`), String(args.branch || 'main'));
    case 'create_branch': return createBranch(String(args.branch), String(args.from_branch || 'main'));
    case 'rollback_commit': return rollbackCommit(args.sha ? String(args.sha) : undefined, String(args.branch || 'main'));
    case 'create_pull_request': return createPullRequest(String(args.title), String(args.head), String(args.base || 'main'), String(args.body || ''));
    case 'get_pull_request': return getPullRequest(Number(args.number));
    case 'list_pull_requests': return listPullRequests((args.state as 'open' | 'closed' | 'all') || 'open');
    case 'merge_pull_request': return mergePullRequest(Number(args.number));
    case 'check_merge_gate': return checkMergeGate(Number(args.number));
    case 'run_diagnostic': return runDiagnostic(args.prompt ? String(args.prompt) : undefined);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
