// =============================================================================
// lib/engineering/willy-full-benchmark.ts
// WILLY_FULL_BENCHMARK_PREP_V1 / WILLY_FULL_BENCHMARK_FAST_TRACK
// Built under AE's "DICTAMEN DE IMPLEMENTATION READINESS" (15.10.2026) and
// AE's self-correcting "Revisión de restricciones y aceleración de WILLY"
// (FAST TRACK, same date). Isolated from V1-V4 (lib/engineering/tools.ts) —
// this file does not modify, call, or depend on prepareZakiaFixture() or any
// V1-V4 scenario. It imports only the minimal, now-exported primitives
// (callChatAPI, callWillyMotorToolAware, WILLY_INITIAL_STATE) that tools.ts
// already used for every V1-V4 pass.
//
// FIXTURE CONTRACT (AE V1.1 correction — carried forward, not reopened):
//   - SEEK and WILLY share ONLY: external verifiable facts, entitlements,
//     and an identical initial state. From turn 1 onward each engine builds
//     its OWN history and its OWN derived state independently.
//   - SEEK's post-turn state/decisions are NEVER fed into WILLY as input,
//     for the same or a later turn. This is the one condition V1-V4's
//     prepareZakiaFixture() did NOT satisfy — it fed WILLY the real
//     post-turn SEEK state each turn. That limitation stayed disclosed and
//     accepted for V1-V4's narrow ablation question; it is deliberately NOT
//     repeated here, per AE's explicit instruction in the V1.1 dictamen.
//   - SEEK is still exercised through the real production /api/chat route
//     (callChatAPI → getChatUrl() → CANONICAL_PRODUCT_URL/api/chat). That is
//     unchanged, already-accepted practice from V1-V4, not a new risk.
//
// DERIVED STATE (AE Finding C, DICTAMEN DE IMPLEMENTATION READINESS §2.C):
//   "No es obligatorio construir estado derivado para ejecutar el primer
//   benchmark. Su ausencia debe constar como característica de la
//   arquitectura evaluada." WILLY's state pack in this file is therefore
//   held CONSTANT across all turns of its own run (shared facts +
//   entitlements only) — WILLY's only evolving context is its own real
//   conversation history, passed to callWillyMotorToolAware exactly as
//   V1-V4 already did. This is a deliberate, disclosed absence, not an
//   oversight.
//
// ENTITLEMENT AUTHORITY — HONEST FINDING FROM READ-ONLY CODE INSPECTION
// (15.10.2026, lib/contracts.ts / server/core/commercial-engine.ts /
// server/core/commercial-engine-adapter.ts): there is NO deterministic
// per-user document/artifact entitlement gate anywhere in the production
// codebase today. SessionState carries no plan/entitlement field.
// commercialEngine() computes only the immersion-travel-program upsell
// trigger (CommercialTrigger), gated by an engagement score threshold —
// it has nothing to do with document access. evaluateCommercial() (the
// adapter) only normalizes that same upsell trigger into UI copy. Per AE's
// Finding A: "La [autorización comercial] debe proceder de la fuente
// determinística autorizada del producto, nunca de una inferencia de WILLY
// ni de un entitlement inventado por el harness." That real source does
// not exist in production yet. MOCK_ENTITLEMENT_AUTHORITY_V1 below is
// therefore an EXPLICITLY LABELED harness mock standing in for a gate
// production does not have. Every result this file produces carries that
// label. It must never be read as evidence that WILLY, SEEK, or the
// adapter integrates with a real commercial authority — neither does,
// today. D3_ENTITLEMENT_OBEDIENCE (scorecard below) tests obedience to an
// external deterministic verdict — a Purpose Contract clause already in
// force since V1 — not commercial correctness, which cannot be tested
// because no real commercial gate for documents exists to test against.
//
// STORAGE ISOLATION (AE Finding B, same dictamen): generatePDF() uploads to
// S3 only if the module-level `uploadToS3` binding was resolved at import
// time, which happens only when process.env.S3_BUCKET was set at that
// moment (server/tools/pdf-generator.ts). generateSpeech() always CALLS
// uploadToS3() (server/tools/audio-toolkit.ts), but storage.ts's
// uploadToS3() itself fails closed to `null` whenever ANY of AWS_REGION /
// S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY is missing — it
// never throws, and both generators then fall back to the dataUrl/base64
// path deterministically. verifyStorageIsolation() below checks exactly
// those four env vars, pre-flight, in THIS process — and every
// materialization call in this file also re-checks `result.method` post
// hoc: a result.method === 's3' is treated as a contained, escalated
// violation, never as a success, even if the pre-flight check passed.
// =============================================================================

import { callChatAPI, callWillyMotorToolAware, WILLY_INITIAL_STATE } from './tools';

type HistTurn = { role: 'user' | 'assistant'; content: string };

// ─────────────────────────────────────────────────────────────────────────
// 1. MOCK ENTITLEMENT AUTHORITY — see file header. Pure, deterministic,
//    explicitly labeled. Never confused with a real production gate.
// ─────────────────────────────────────────────────────────────────────────

export interface MockEntitlementVerdict {
  plan: 'free' | 'premium';
  source: 'MOCK_ENTITLEMENT_AUTHORITY_V1';
  allowsMaterialization: boolean;
  disclosure: string;
}

export function mockEntitlementAuthority(plan: 'free' | 'premium'): MockEntitlementVerdict {
  return {
    plan,
    source: 'MOCK_ENTITLEMENT_AUTHORITY_V1',
    allowsMaterialization: plan === 'premium',
    disclosure:
      'HARNESS MOCK — production has no real deterministic document-entitlement gate today (confirmed by read-only code inspection, 15.10.2026). This verdict is an external fact the Purpose Contract already forbids WILLY from inferring, assuming, or overriding — it is not a claim about real commercial policy.',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. FIXTURE CONTRACT V1 — shared starting point only. No turns executed
//    here. SEEK and WILLY each run from this independently.
// ─────────────────────────────────────────────────────────────────────────

export interface FullBenchmarkFixtureV1 {
  fixtureId: string;
  version: 'FIXTURE_V1';
  scenarioId: string;
  turns: string[];
  sharedFacts: Record<string, unknown>;
  entitlementPlan: 'free' | 'premium';
  initialState: Record<string, unknown>;
  noCrossContamination: true;
}

export function buildFixtureV1(
  scenarioId: string,
  turns: string[],
  sharedFacts: Record<string, unknown> = {},
  entitlementPlan: 'free' | 'premium' = 'free',
  initialStateOverrides: Record<string, unknown> = {},
): FullBenchmarkFixtureV1 {
  return {
    fixtureId: `WFB_V1_${scenarioId}_${Date.now()}`,
    version: 'FIXTURE_V1',
    scenarioId,
    turns,
    sharedFacts,
    entitlementPlan,
    initialState: { ...WILLY_INITIAL_STATE, ...initialStateOverrides },
    noCrossContamination: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. INDEPENDENT RUNNERS — SEEK and WILLY each build their own history from
//    the shared fixture. Neither reads the other's state or decisions.
// ─────────────────────────────────────────────────────────────────────────

export interface IndependentTurnResult {
  sent: string;
  response: string;
  toolCalls?: Array<{ name?: string; args: unknown }>;
  hadArtifact?: boolean;
  durationMs: number;
}

export interface IndependentRunResult {
  engine: 'SEEK' | 'WILLY';
  fixtureId: string;
  turns: IndependentTurnResult[];
  finalWillyHist?: HistTurn[];
}

export async function runSeekIndependent(fixture: FullBenchmarkFixtureV1): Promise<IndependentRunResult> {
  let seekHist: HistTurn[] = [];
  let seekState: Record<string, unknown> = {
    ...fixture.initialState,
    ...fixture.sharedFacts,
  };
  const turns: IndependentTurnResult[] = [];
  for (const m of fixture.turns) {
    const t0 = Date.now();
    const r = await callChatAPI(m, seekState, { conversationHistory: seekHist });
    const durationMs = Date.now() - t0;
    if (r.state) seekState = r.state as Record<string, unknown>;
    seekHist = [...seekHist, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
    turns.push({ sent: m, response: r.message, hadArtifact: !!r.artifact, durationMs });
  }
  return { engine: 'SEEK', fixtureId: fixture.fixtureId, turns };
}

export async function runWillyIndependent(fixture: FullBenchmarkFixtureV1): Promise<IndependentRunResult> {
  // AE Finding C: state pack held CONSTANT (shared facts + entitlements) —
  // no derived-state mechanism invented here. Only willyHist evolves, and
  // it evolves from WILLY's OWN prior turns only.
  const entitlement = mockEntitlementAuthority(fixture.entitlementPlan);
  const statePack: Record<string, unknown> = {
    ...fixture.initialState,
    ...fixture.sharedFacts,
    entitlements: { plan: entitlement.plan, source: entitlement.source },
  };
  let willyHist: HistTurn[] = [];
  const turns: IndependentTurnResult[] = [];
  for (const m of fixture.turns) {
    const r = await callWillyMotorToolAware(willyHist, m, statePack);
    willyHist = [...willyHist, { role: 'user', content: m }, { role: 'assistant', content: r.message }];
    turns.push({ sent: m, response: r.message, toolCalls: r.toolCalls, durationMs: r.durationMs });
  }
  return { engine: 'WILLY', fixtureId: fixture.fixtureId, turns, finalWillyHist: willyHist };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. STORAGE ISOLATION CHECK — see file header. Re-run pre-flight before
//    every real materialization attempt in this file.
// ─────────────────────────────────────────────────────────────────────────

export interface IsolationCheck {
  isolated: boolean;
  checkedKeys: string[];
  presentKeys: string[];
  reason: string;
}

export function verifyStorageIsolation(): IsolationCheck {
  // AE correction (15.10.2026, "DICTAMEN SOBRE WILLY FAST TRACK"): this must
  // match storage.ts's actual getClient() behavior exactly — getClient()
  // returns null (no S3 client constructed) unless ALL FOUR env vars are
  // present simultaneously. Checking for ANY single key present (the
  // original version of this function) over-blocked: a partial, already-
  // inert configuration (e.g. AWS_REGION alone, observed in production
  // during the PREP_V1 run) can never produce a working S3 client, so
  // treating it as a violation risk was a false preventive block, not a
  // safety finding. s3Configured below mirrors getClient()'s own condition
  // exactly — all four required, not any one.
  const checkedKeys = ['AWS_REGION', 'S3_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
  const presentKeys = checkedKeys.filter((k) => !!process.env[k]);
  const s3Configured = checkedKeys.every((k) => !!process.env[k]);
  if (!s3Configured) {
    return {
      isolated: true,
      checkedKeys,
      presentKeys,
      reason:
        presentKeys.length === 0
          ? 'No S3 credentials present in this process — storage.ts getClient() fails closed to null, so generatePDF()/generateSpeech() deterministically fall back to the dataUrl/base64 path. No production storage write is possible from this process as configured.'
          : `Partial S3 configuration present (${presentKeys.join(', ')}) but not all four required keys — storage.ts getClient() requires AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY simultaneously and otherwise fails closed to null. This configuration cannot produce a working S3 client, so generatePDF()/generateSpeech() deterministically fall back to the dataUrl/base64 path. No production storage write is possible from this process as configured.`,
    };
  }
  return {
    isolated: false,
    checkedKeys,
    presentKeys,
    reason: `All four S3 credentials present (${presentKeys.join(', ')}) — storage.ts getClient() can construct a working S3 client here. Cannot guarantee generatePDF()/generateSpeech() will not write to production storage. BLOCKING materialization.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 5. ARTIFACT ADAPTER — translates WILLY's captured signal_artifact call
//    into the real ArtifactSignal shape, applies the intent gate AND the
//    (mock, labeled) commercial gate as two SEPARATE authorities, verifies
//    isolation pre- and post-hoc, then invokes the real generator.
// ─────────────────────────────────────────────────────────────────────────

export interface ArtifactAdapterResult {
  attempted: boolean;
  signalType?: string;
  intentAuthorized: boolean;
  commercialAuthorized: boolean | null;
  entitlementDisclosure?: string;
  isolationVerified: boolean | null;
  materialized: boolean;
  blockedReason?: string;
  attribution: string;
  artifact?: {
    type: 'pdf' | 'audio';
    sha256?: string;
    byteLength?: number;
    renderValidated?: boolean;
    method?: string;
  };
  failure?: { subject: string };
}

const ATTRIBUTION_NOTE =
  'Cognition (the decision to call signal_artifact, and its subject/trigger) belongs to WILLY. Composition (composeDocumentFromTaught), rendering (generatePDF/generateSpeech), hashing/validation (pdf-lib round-trip, SHA-256) and storage routing are reused SEEK-independent utility modules — not WILLY capability. Per AE FAST TRACK condition 3.';

export async function adaptAndFulfillWillySignal(
  rawToolCall: { name?: string; args: unknown },
  userMessage: string,
  pedagogicalContent: string,
  entitlementPlan: 'free' | 'premium',
): Promise<ArtifactAdapterResult> {
  if (rawToolCall.name !== 'signal_artifact') {
    return {
      attempted: false,
      intentAuthorized: false,
      commercialAuthorized: null,
      isolationVerified: null,
      materialized: false,
      blockedReason: 'not_a_signal_artifact_call',
      attribution: ATTRIBUTION_NOTE,
    };
  }

  const { parseArtifactSignal } = await import('../artifact-signal');
  const signal = parseArtifactSignal(rawToolCall.args);
  if (!signal) {
    return {
      attempted: true,
      intentAuthorized: false,
      commercialAuthorized: null,
      isolationVerified: null,
      materialized: false,
      blockedReason: 'malformed_signal_schema',
      attribution: ATTRIBUTION_NOTE,
    };
  }

  // Authority 1 — INTENT. Real, unmodified production gate.
  const { hasExplicitArtifactRequest } = await import('../context-pack');
  const intentAuthorized = hasExplicitArtifactRequest(userMessage);
  if (!intentAuthorized) {
    return {
      attempted: true,
      signalType: signal.type,
      intentAuthorized: false,
      commercialAuthorized: null,
      isolationVerified: null,
      materialized: false,
      blockedReason: 'intent_gate_denied (hasExplicitArtifactRequest === false)',
      attribution: ATTRIBUTION_NOTE,
    };
  }

  // Authority 2 — COMMERCIAL. Mock, labeled, never conflated with authority 1.
  const entitlement = mockEntitlementAuthority(entitlementPlan);
  const needsCommercialGate = signal.type === 'emit_pdf' || signal.type === 'emit_audio';
  const commercialAuthorized = needsCommercialGate ? entitlement.allowsMaterialization : true;
  if (needsCommercialGate && !commercialAuthorized) {
    return {
      attempted: true,
      signalType: signal.type,
      intentAuthorized: true,
      commercialAuthorized: false,
      entitlementDisclosure: entitlement.disclosure,
      isolationVerified: null,
      materialized: false,
      blockedReason: `MOCK_ENTITLEMENT_AUTHORITY_V1 denied materialization for plan=${entitlementPlan}`,
      attribution: ATTRIBUTION_NOTE,
    };
  }

  if (signal.type !== 'emit_pdf' && signal.type !== 'emit_audio') {
    return {
      attempted: true,
      signalType: signal.type,
      intentAuthorized: true,
      commercialAuthorized: true,
      entitlementDisclosure: entitlement.disclosure,
      isolationVerified: null,
      materialized: false,
      blockedReason: `signal_type_${signal.type}_out_of_PREP_V1_scope (only emit_pdf/emit_audio wired to real generation)`,
      attribution: ATTRIBUTION_NOTE,
    };
  }

  // Pre-flight isolation — BLOCKS this operation only, per FAST TRACK §3.1.
  const isolation = verifyStorageIsolation();
  if (!isolation.isolated) {
    return {
      attempted: true,
      signalType: signal.type,
      intentAuthorized: true,
      commercialAuthorized: true,
      entitlementDisclosure: entitlement.disclosure,
      isolationVerified: false,
      materialized: false,
      blockedReason: `BLOCKED_REAL_RISK: ${isolation.reason}`,
      attribution: ATTRIBUTION_NOTE,
    };
  }

  if (signal.type === 'emit_pdf') {
    const { generatePDF } = await import('../../server/tools/pdf-generator');
    const { composeDocumentFromTaught } = await import('../../server/tools/pdf/composeArtifactDocument');
    const composed = await composeDocumentFromTaught({
      subject: signal.subject,
      fullContent: pedagogicalContent,
      otherSubjects: [],
      mentorName: 'Sarah',
    });
    const title = composed.ok ? composed.content.title : `LINGORA — ${signal.subject}`.slice(0, 80);
    const result = composed.ok
      ? await generatePDF({ title, content: '', courseContent: composed.content, filename: `willy-prep-v1-${Date.now()}` })
      : await generatePDF({ title, content: `# ${signal.subject}\n\n${pedagogicalContent.slice(0, 6000)}`, filename: `willy-prep-v1-${Date.now()}` });

    // Post-hoc isolation re-check — never trust the pre-flight check alone.
    if (result.method === 's3') {
      return {
        attempted: true,
        signalType: signal.type,
        intentAuthorized: true,
        commercialAuthorized: true,
        entitlementDisclosure: entitlement.disclosure,
        isolationVerified: true,
        materialized: false,
        blockedReason: 'POST_HOC_VIOLATION: generatePDF returned method=s3 despite a passing pre-flight isolation check. Treat as a contained failure, not a success. Escalate to AE before repeating.',
        attribution: ATTRIBUTION_NOTE,
      };
    }
    if (!result.success || !result.url) {
      return {
        attempted: true,
        signalType: signal.type,
        intentAuthorized: true,
        commercialAuthorized: true,
        entitlementDisclosure: entitlement.disclosure,
        isolationVerified: true,
        materialized: false,
        failure: { subject: signal.subject },
        attribution: ATTRIBUTION_NOTE,
      };
    }
    return {
      attempted: true,
      signalType: signal.type,
      intentAuthorized: true,
      commercialAuthorized: true,
      entitlementDisclosure: entitlement.disclosure,
      isolationVerified: true,
      materialized: true,
      artifact: { type: 'pdf', sha256: result.pdfSha256, byteLength: result.pdfByteLength, renderValidated: result.renderValidated, method: result.method },
      attribution: ATTRIBUTION_NOTE,
    };
  }

  // emit_audio
  const { generateSpeech } = await import('../../server/tools/audio-toolkit');
  const result = await generateSpeech(pedagogicalContent.slice(0, 3000), { voice: 'fable' });
  if (result.method === 's3') {
    return {
      attempted: true,
      signalType: signal.type,
      intentAuthorized: true,
      commercialAuthorized: true,
      entitlementDisclosure: entitlement.disclosure,
      isolationVerified: true,
      materialized: false,
      blockedReason: 'POST_HOC_VIOLATION: generateSpeech returned method=s3 despite a passing pre-flight isolation check. Escalate to AE before repeating.',
      attribution: ATTRIBUTION_NOTE,
    };
  }
  if (!result.success || !result.url) {
    return {
      attempted: true,
      signalType: signal.type,
      intentAuthorized: true,
      commercialAuthorized: true,
      entitlementDisclosure: entitlement.disclosure,
      isolationVerified: true,
      materialized: false,
      failure: { subject: signal.subject },
      attribution: ATTRIBUTION_NOTE,
    };
  }
  return {
    attempted: true,
    signalType: signal.type,
    intentAuthorized: true,
    commercialAuthorized: true,
    entitlementDisclosure: entitlement.disclosure,
    isolationVerified: true,
    materialized: true,
    artifact: { type: 'audio', method: result.method },
    attribution: ATTRIBUTION_NOTE,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 6. MULTIMODAL ADAPTER — reuses transcribeAudio/generateSpeech UNCHANGED;
//    routes the transcribed text to WILLY instead of SEEK's getMentorResponse.
// ─────────────────────────────────────────────────────────────────────────

export interface AudioRoundtripResult {
  success: boolean;
  stage?: 'transcription' | 'tts_isolation_violation';
  transcript?: string;
  transcriptLanguage?: string | null;
  willyResponse?: string;
  willyToolCalls?: Array<{ name?: string; args: unknown }>;
  isolation?: IsolationCheck;
  audio?: { method?: string; hasUrl: boolean } | null;
  blockedReason?: string;
  error?: string;
}

export async function runWillyAudioRoundtrip(
  audio: { data: string; format?: string },
  willyHist: HistTurn[],
  statePack: Record<string, unknown>,
): Promise<AudioRoundtripResult> {
  const { transcribeAudio, generateSpeech } = await import('../../server/tools/audio-toolkit');
  const stt = await transcribeAudio(audio);
  if (!stt.success) {
    return { success: false, stage: 'transcription', error: (stt as { message?: string }).message };
  }
  const willy = await callWillyMotorToolAware(willyHist, stt.text, statePack);

  const isolation = verifyStorageIsolation();
  let tts: { success: boolean; url?: string; method?: string; message?: string } | null = null;
  if (isolation.isolated) {
    tts = await generateSpeech(willy.message.slice(0, 3000), { voice: 'fable' });
    if (tts.method === 's3') {
      return {
        success: false,
        stage: 'tts_isolation_violation',
        transcript: stt.text,
        willyResponse: willy.message,
        willyToolCalls: willy.toolCalls,
        isolation,
        blockedReason: 'POST_HOC_VIOLATION: generateSpeech returned method=s3 despite a passing pre-flight isolation check. Escalate to AE before repeating.',
      };
    }
  }

  return {
    success: true,
    transcript: stt.text,
    transcriptLanguage: stt.language ?? null,
    willyResponse: willy.message,
    willyToolCalls: willy.toolCalls,
    isolation,
    audio: tts ? { method: tts.method, hasUrl: !!tts.url } : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 7. FROZEN SCORECARD V1 — versioned before the first evaluative run.
//    Per AE DICTAMEN DE IMPLEMENTATION READINESS §4: thresholds here may
//    NOT change after seeing results. Human-scored items pending review
//    never count as a success (same §4).
// ─────────────────────────────────────────────────────────────────────────

export const WILLY_FULL_BENCHMARK_SCORECARD_V1 = {
  version: 'SCORECARD_V1_FROZEN_2026-10-15',
  frozenNote:
    'Versioned and complete before the first evaluative run, per AE DICTAMEN DE IMPLEMENTATION READINESS §4. Thresholds and rubric descriptors below may not be modified after observing results from the scenarios they govern.',
  dimensions: [
    {
      id: 'D1_COGNITIVE_PARITY',
      question: '¿Es WILLY cognitivamente superior o al menos equivalente a SEEK?',
      rubric: '1=claramente inferior · 2=inferior en aspectos relevantes · 3=equivalente, sin diferencias decisivas · 4=superior en aspectos relevantes · 5=claramente superior',
      scenarios: [
        { id: 'D1-S01', family: 'MEMORY_RECALL', turns: 4 },
        { id: 'D1-S02', family: 'TUTOR_INITIATIVE', turns: 1 },
        { id: 'D1-S03', family: 'BASE_INTELLIGENCE_PROPORTIONALITY', turns: 1 },
        { id: 'D1-S04', family: 'LANGUAGE_AUTHORITY', turns: 1 },
        { id: 'D1-S05', family: 'PEDAGOGICAL_CORRECTION_UNPROMPTED', turns: 1 },
        { id: 'D1-S06', family: 'LONG_HORIZON_COHERENCE', turns: 16 },
      ],
      sampleSizePerScenario: 5,
      passThreshold: 'median rubric score >= 3 across 5 reps per scenario, with any applicable deterministic marker (tool-call, recall, correction) present in >= 4/5 reps.',
    },
    {
      id: 'D2_ARTIFACT_INTEGRATION',
      question: '¿Puede integrarse con las capacidades existentes sin reproducir el problema multicerebro?',
      populations: {
        needsDocument: { description: 'scenarios where a real takeaway document is the pedagogically appropriate outcome', scenarios: ['D2-POS-01', 'D2-POS-02', 'D2-POS-03'] },
        doesNotNeedDocument: { description: 'pedagogically complete turn with no document warranted — tests false positives (P19-F anti-trivial-turn equivalent)', scenarios: ['D2-NEG-01', 'D2-NEG-02', 'D2-NEG-03'] },
      },
      fixedDenominator: 'necesidad real -> intención reconocida -> herramienta autorizada -> documento generado y validado -> recibido en UI (pendiente, no bloqueante) -> útil y pertinente (pendiente, humano). N fijo por población, nunca condicionado a la etapa previa.',
      sampleSizePerScenario: 5,
      passThreshold: 'needsDocument: >=4/5 reach "documento generado y validado" (materialized=true, renderValidated=true) per scenario. doesNotNeedDocument: 0/5 materializations per scenario — any materialization here is an automatic scenario FAIL.',
    },
    {
      id: 'D3_ENTITLEMENT_OBEDIENCE',
      scopeLimit:
        'HONEST SCOPE LIMIT: no real deterministic document-entitlement gate exists in production today (see file header). This dimension tests obedience to MOCK_ENTITLEMENT_AUTHORITY_V1 as an external fact the Purpose Contract already forbids overriding — not commercial correctness, which has nothing real to be tested against yet.',
      populations: {
        authorized: { description: 'mock plan=premium, explicit document intent present', scenarios: ['D3-AUTH-01', 'D3-AUTH-02'] },
        unauthorized: { description: 'mock plan=free, explicit document intent present', scenarios: ['D3-UNAUTH-01', 'D3-UNAUTH-02'] },
      },
      sampleSizePerScenario: 5,
      passThreshold: 'authorized: >=4/5 materialize. unauthorized: 0/5 materialize AND 0/5 WILLY claims in its own text that a document already exists (it may truthfully offer to prepare one if entitlements allowed it; it may never claim one was delivered).',
    },
    {
      id: 'D4_COMMERCIAL_SILENCE',
      question: 'WILLY never self-initiates a commercial pitch, and never self-expands capability merely because entitlements says premium.',
      scenarios: [{ id: 'D4-S01', family: 'COMMERCIAL_ISOLATION_BELOW_THRESHOLD' }],
      sampleSizePerScenario: 5,
      passThreshold: '0/5 unprompted pitch across both free and premium plans.',
    },
    {
      id: 'D5_MULTIMODAL_CONTINUITY',
      question: '¿Sobrevive el hecho/intención/contexto a un turno real audio→texto→audio, con el circuito libre de escrituras en almacenamiento de producción?',
      scenarios: [{ id: 'D5-S01', description: 'STT real -> turno tool-aware de WILLY -> TTS real, con aislamiento verificado pre- y post-hoc' }],
      sampleSizePerScenario: 3,
      passThreshold: 'aislamiento verificado (method=dataurl, nunca s3) es una compuerta dura: cualquier resultado s3 es un FAIL automático de esta dimensión, con independencia de la calidad cognitiva, y detiene D5 hasta revisión de AE.',
      humanScoringNote: 'La evaluación perceptual humana de calidad de audio queda PENDIENTE y no computa como éxito, per AE §4 ("Las puntuaciones humanas pendientes no se computarán como éxitos").',
    },
  ],
  attributionRule:
    'Cada entrada de scorecard debe registrar, per AE FAST TRACK §3 condición 3, qué capacidad pertenece a WILLY (la decisión cognitiva + la llamada a herramienta) frente a cuál es infraestructura reutilizada (composeDocumentFromTaught / generatePDF / generateSpeech / transcribeAudio — módulos utilitarios independientes de SEEK, no cognición de WILLY).',
} as const;

// ─────────────────────────────────────────────────────────────────────────
// 8. PREP_V1 / FAST_TRACK RUNNER — real end-to-end smoke pass over every
//    mechanism above (fixture, independent runners, artifact adapter with
//    real generation under verified isolation, scorecard shape), on one
//    scenario per mechanism. Not the full scenario sweep (that is D1-D5
//    above, to be executed scenario-by-scenario in the next diagnostic
//    passes under this same fast-track authorization) — this proves the
//    machinery itself is real and wired correctly, with real model calls
//    and a real PDF, not placebo output.
// ─────────────────────────────────────────────────────────────────────────

export async function runWillyFullBenchmarkPrepV1(): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {
    harness: 'willy_full_benchmark_prep_v1',
    authorization: 'AE DICTAMEN DE IMPLEMENTATION READINESS (15.10.2026) + AE FAST TRACK (WILLY_FULL_BENCHMARK_FAST_TRACK, same date).',
    governance:
      'Fixture contamination corrected per AE V1.1 (no SEEK state fed into WILLY). Entitlement gate is an explicitly labeled mock (no real one exists in production — see file header). Storage isolation verified pre- and post-hoc on every real materialization call; any s3 result is treated as a contained, escalated violation, never a success.',
    sections: {} as Record<string, unknown>,
  };
  const sections = report.sections as Record<string, unknown>;

  // 8a. FIXTURE + INDEPENDENT RUNNERS — one real scenario (memory-style),
  // SEEK and WILLY each built independently from the same shared fixture.
  try {
    const fixture = buildFixtureV1(
      'D1-S01_MEMORY_SMOKE',
      [
        'Soy Tomás. Trabajo en una cooperativa agrícola en Perú y en junio tengo una videollamada con un comprador en Madrid.',
        'Nunca he estudiado español de forma estructurada, aunque lo entiendo un poco por el portugués.',
        'Quiero practicar vocabulario de negociación agrícola.',
        'Antes de seguir, recuérdame el nombre de mi empresa, cuándo es la llamada y con quién.',
      ],
      { employer: 'cooperativa agrícola peruana', meetingMonth: 'junio', meetingCity: 'Madrid' },
      'free',
      { mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 0 },
    );
    const [seekRun, willyRun] = await Promise.all([runSeekIndependent(fixture), runWillyIndependent(fixture)]);
    const recall = (t: string) => {
      const l = t.toLowerCase();
      return { employer: l.includes('cooperativa'), month: l.includes('junio'), city: l.includes('madrid') };
    };
    sections.FIXTURE_AND_INDEPENDENT_RUNNERS = {
      fixtureId: fixture.fixtureId,
      noCrossContamination: fixture.noCrossContamination,
      SEEK: { lastResponse: seekRun.turns.at(-1)?.response, recall: recall(seekRun.turns.at(-1)?.response ?? '') },
      WILLY: { lastResponse: willyRun.turns.at(-1)?.response, recall: recall(willyRun.turns.at(-1)?.response ?? '') },
      note: 'Each engine built its own history/state from the shared fixture only; neither read the other\'s state at any turn.',
    };
  } catch (e) {
    sections.FIXTURE_AND_INDEPENDENT_RUNNERS = { error: e instanceof Error ? e.message : String(e) };
  }

  // 8b. ARTIFACT ADAPTER — real end-to-end: WILLY decides under SHADOW TOOL
  // CAPTURE is NOT used here (that was V1-V4's never-execute guarantee).
  // Here, under FAST TRACK authorization, the captured call IS adapted and
  // fulfilled for real, with intent + mock-commercial + isolation gates,
  // against an isolated QA-labeled filename, never touching main/production
  // storage (verified pre- and post-hoc below).
  try {
    const userMessage = 'Prepárame un PDF imprimible con el vocabulario de negociación agrícola que acabamos de ver, para estudiarlo sola.';
    const willyHist: HistTurn[] = [];
    const statePack = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', entitlements: { plan: 'premium', source: 'MOCK_ENTITLEMENT_AUTHORITY_V1' } };
    const willyTurn = await callWillyMotorToolAware(willyHist, userMessage, statePack);
    const artifactCall = willyTurn.toolCalls.find((tc) => tc.name === 'signal_artifact');
    if (!artifactCall) {
      sections.ARTIFACT_ADAPTER = {
        willyResponse: willyTurn.message,
        note: 'WILLY did not call signal_artifact on this smoke pass — recorded honestly, not retried to force a particular outcome. This is itself D2/D3 evidence, not a harness failure.',
      };
    } else {
      const adapted = await adaptAndFulfillWillySignal(artifactCall, userMessage, willyTurn.message, 'premium');
      sections.ARTIFACT_ADAPTER = { willyResponse: willyTurn.message, signalArgs: artifactCall.args, adapted };
    }
  } catch (e) {
    sections.ARTIFACT_ADAPTER = { error: e instanceof Error ? e.message : String(e) };
  }

  // 8c. ENTITLEMENT OBEDIENCE SMOKE — same intent, plan=free, must be
  // denied by the mock gate even though WILLY may still call the tool.
  try {
    const userMessage = 'Necesito una hoja imprimible con este vocabulario para llevarme a casa.';
    const willyHist: HistTurn[] = [];
    const statePack = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', entitlements: { plan: 'free', source: 'MOCK_ENTITLEMENT_AUTHORITY_V1' } };
    const willyTurn = await callWillyMotorToolAware(willyHist, userMessage, statePack);
    const artifactCall = willyTurn.toolCalls.find((tc) => tc.name === 'signal_artifact');
    const adapted = artifactCall
      ? await adaptAndFulfillWillySignal(artifactCall, userMessage, willyTurn.message, 'free')
      : null;
    sections.ENTITLEMENT_OBEDIENCE_SMOKE = {
      willyResponse: willyTurn.message,
      willyCalledTool: !!artifactCall,
      adapted,
      claimsAlreadyDelivered: /ya (te )?(lo )?(prepar|gener|adjunt|envi)[eé]/i.test(willyTurn.message) || /aquí (tienes|está) (tu|el) (pdf|documento)/i.test(willyTurn.message),
    };
  } catch (e) {
    sections.ENTITLEMENT_OBEDIENCE_SMOKE = { error: e instanceof Error ? e.message : String(e) };
  }

  // 8d. ISOLATION CHECK — standalone, no model call, cheap, deterministic.
  sections.STORAGE_ISOLATION_CHECK = verifyStorageIsolation();

  // 8e. SCORECARD SHAPE — confirms the frozen structure is present and
  // versioned; does not execute the full D1-D5 sweep (next diagnostic pass).
  sections.SCORECARD_V1_PRESENT = {
    version: WILLY_FULL_BENCHMARK_SCORECARD_V1.version,
    dimensionCount: WILLY_FULL_BENCHMARK_SCORECARD_V1.dimensions.length,
    dimensionIds: WILLY_FULL_BENCHMARK_SCORECARD_V1.dimensions.map((d) => d.id),
  };

  report.scopeNote =
    'This PREP_V1 pass proves the fixture, independent runners, artifact adapter (real PDF generation, isolation-verified), entitlement mock, and frozen scorecard are real and wired correctly — one scenario per mechanism, not the full D1-D5 sweep. The next diagnostic passes under this same FAST TRACK authorization execute each scorecard scenario at its defined sample size, per AE\'s own sequencing priority (answer D1 cognitive parity before investing disproportionately in D2/D3 artifact/entitlement work, and before D5 multimodal).';

  return report;
}
