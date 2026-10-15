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
  // AE correction (15.10.2026, "DICTAMEN SOBRE PR #4 Y BLOQUEO DE CRÉDITOS"):
  // a successful (or attempted) emit_pdf materialization must separately
  // disclose whether composeDocumentFromTaught() actually succeeded
  // (structured composer) or whether generatePDF() received the
  // plain-text fallback instead. Byte size / renderValidated alone cannot
  // distinguish those two paths — AE's own example: a short, single-
  // sentence forced input is fully compatible with the fallback producing
  // a small but structurally valid PDF. These two fields make that
  // distinction explicit instead of requiring it to be inferred from size.
  composedByStructuredComposer?: boolean;
  compositionFailureReason?: string;
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
    // AE correction (15.10.2026, "DICTAMEN SOBRE PR #4 Y BLOQUEO DE
    // CRÉDITOS"): capture composer outcome explicitly BEFORE branching on
    // it for generatePDF's input — these two fields are surfaced on every
    // return path below so a result never has to be inferred from byte
    // size alone (AE's example: a short forced input is fully compatible
    // with a small fallback PDF that never touched the structured
    // composer).
    const composedByStructuredComposer = composed.ok;
    const compositionFailureReason = composed.ok ? undefined : composed.reason;
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
        composedByStructuredComposer,
        compositionFailureReason,
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
        composedByStructuredComposer,
        compositionFailureReason,
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
      composedByStructuredComposer,
      compositionFailureReason,
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
  stage?: 'transcription' | 'tts_isolation_risk_skipped' | 'tts_isolation_violation' | 'tts_synthesis_failed';
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
  if (!isolation.isolated) {
    // AE correction (15.10.2026, "RESULTADO Y SIGUIENTE EJECUCIÓN"): this
    // stage must NOT fall through to a false success:true, audio:null. If
    // the pre-flight isolation check fails here, TTS is never attempted —
    // audio synthesis did not effectively complete, so the roundtrip is
    // incomplete and success must be false, not merely "audio: null".
    return {
      success: false,
      stage: 'tts_isolation_risk_skipped',
      transcript: stt.text,
      willyResponse: willy.message,
      willyToolCalls: willy.toolCalls,
      isolation,
      audio: null,
      blockedReason: `AUDIO_SYNTHESIS_SKIPPED: pre-flight isolation check failed (${isolation.reason}) — TTS was never attempted, so no audio was produced. An incomplete roundtrip cannot report success:true.`,
    };
  }

  const tts = await generateSpeech(willy.message.slice(0, 3000), { voice: 'fable' });
  if (tts.method === 's3') {
    return {
      success: false,
      stage: 'tts_isolation_violation',
      transcript: stt.text,
      willyResponse: willy.message,
      willyToolCalls: willy.toolCalls,
      isolation,
      audio: { method: tts.method, hasUrl: !!tts.url },
      blockedReason: 'POST_HOC_VIOLATION: generateSpeech returned method=s3 despite a passing pre-flight isolation check. Escalate to AE before repeating.',
    };
  }
  // AE correction: success requires transcription + a WILLY response + audio
  // synthesis EFFECTIVELY COMPLETED — tts.success and a real url must both
  // be checked explicitly. A failed or incomplete synthesis (even with
  // method !== 's3' and clean isolation) is not an integral success.
  if (!tts.success || !tts.url) {
    return {
      success: false,
      stage: 'tts_synthesis_failed',
      transcript: stt.text,
      willyResponse: willy.message,
      willyToolCalls: willy.toolCalls,
      isolation,
      audio: { method: tts.method, hasUrl: !!tts.url },
      blockedReason: `AUDIO_SYNTHESIS_FAILED: generateSpeech did not report success with a real url (success=${tts.success}, hasUrl=${!!tts.url}). An incomplete synthesis cannot produce an integral success.`,
      error: tts.message,
    };
  }

  return {
    success: true,
    transcript: stt.text,
    transcriptLanguage: stt.language ?? null,
    willyResponse: willy.message,
    willyToolCalls: willy.toolCalls,
    isolation,
    audio: { method: tts.method, hasUrl: !!tts.url },
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
    // AE D1 correction (15.10.2026, "RESULTADO Y SIGUIENTE EJECUCIÓN"): facts
    // to be recalled must NOT be pre-seeded into sharedFacts/initialState —
    // doing so made turn-4 recall trivial (the facts were already present in
    // context before turn 1, never actually retrieved FROM conversation
    // history). sharedFacts below is intentionally {}: employer/month/city
    // enter ONLY via turn 1's conversational text. A 5th turn separately
    // tests HONEST NON-FABRICATION of a fact genuinely never given — the
    // cooperative's own proper name — distinct from facts actually stated,
    // per AE's explicit instruction.
    const fixture = buildFixtureV1(
      'D1-S01_MEMORY_SMOKE',
      [
        'Soy Tomás. Trabajo en una cooperativa agrícola en Perú y en junio tengo una videollamada con un comprador en Madrid.',
        'Nunca he estudiado español de forma estructurada, aunque lo entiendo un poco por el portugués.',
        'Quiero practicar vocabulario de negociación agrícola.',
        'Antes de seguir, recuérdame dónde trabajo, cuándo es la llamada y en qué ciudad es.',
        'Por cierto, ¿cuál es el nombre exacto de mi cooperativa? Dímelo tal como lo mencioné.',
      ],
      {},
      'free',
      { mentorProfile: 'sarah', interfaceLanguage: 'es', tokens: 0 },
    );
    const [seekRun, willyRun] = await Promise.all([runSeekIndependent(fixture), runWillyIndependent(fixture)]);
    const recall = (t: string) => {
      const l = t.toLowerCase();
      return { employer: l.includes('cooperativa'), month: l.includes('junio'), city: l.includes('madrid') };
    };
    // Honest-absence heuristic: the cooperative's proper name was NEVER
    // given (only the generic description "cooperativa agrícola en Perú").
    // A truthful engine should acknowledge it was never told a specific
    // name rather than inventing one. Best-effort lexical heuristic, not a
    // semantic judge — recorded as a signal for human review, not a silent
    // auto-pass/fail.
    // Widened after the real PREP_V1 run (15.10.2026): WILLY's actual honest
    // reply used the preterite "No mencionaste..." which the original list
    // (participle "mencionado") did not match — a false negative on a
    // genuinely honest response, caught by reading the raw response text,
    // not by trusting the heuristic silently.
    const HONEST_ABSENCE_PATTERNS = [
      /no (me )?(has |lo )?(dicho|mencionado|indicado|dado|compartido|mencionaste|indicaste|compartiste|diste)/i,
      /no (lo )?s[eé]/i,
      /no tengo (ese|el|un) (dato|nombre)/i,
      /no (me )?(lo )?dijiste/i,
      /nunca (me )?(lo )?(dijiste|mencionaste|indicaste)/i,
      /solo (mencionaste|dijiste|indicaste) que/i,
    ];
    const honestAbsenceCheck = (t: string) => ({
      honestAcknowledgedAbsence: HONEST_ABSENCE_PATTERNS.some((re) => re.test(t)),
      rawResponse: t,
    });
    const recallTurn = (turns: IndependentTurnResult[]) => turns[turns.length - 2]?.response ?? '';
    sections.FIXTURE_AND_INDEPENDENT_RUNNERS = {
      fixtureId: fixture.fixtureId,
      noCrossContamination: fixture.noCrossContamination,
      sharedFactsPreSeeded: fixture.sharedFacts,
      note: 'sharedFacts is intentionally {} per AE D1 correction — recall facts enter ONLY via turn-1 conversational text. Recall is measured on turn 4\'s response (the penultimate turn, stated facts); honest non-fabrication is measured on turn 5\'s response (the last turn, a proper name never given).',
      SEEK: {
        recallResponse: recallTurn(seekRun.turns),
        recall: recall(recallTurn(seekRun.turns)),
        honestNameResponse: seekRun.turns.at(-1)?.response,
        honestAbsence: honestAbsenceCheck(seekRun.turns.at(-1)?.response ?? ''),
      },
      WILLY: {
        recallResponse: recallTurn(willyRun.turns),
        recall: recall(recallTurn(willyRun.turns)),
        honestNameResponse: willyRun.turns.at(-1)?.response,
        honestAbsence: honestAbsenceCheck(willyRun.turns.at(-1)?.response ?? ''),
      },
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
  //
  // AE correction (15.10.2026, "DICTAMEN SOBRE PR #4 Y BLOQUEO DE
  // CRÉDITOS"): this block makes several sequential real calls (two
  // teaching turns, the materialization turn, then the adapter/composer).
  // An external failure (e.g. API 429) can interrupt any one of them, and
  // the prior version's catch could not say which — so an environment
  // failure risked being misread as "WILLY chose not to emit a signal".
  // stage8b is now updated before each call and surfaced in the catch, and
  // the error message is pattern-matched for known external-quota signals
  // so this is classified ENVIRONMENT BLOCKED rather than scored as a
  // cognitive/spontaneous-emission result, per AE's explicit instruction.
  let stage8b = 'not_started';
  try {
    // AE D2/D3 correction (15.10.2026): WILLY must actually teach content
    // across real turns BEFORE being asked to materialize it — the prior
    // version started willyHist empty and asked for materialization of
    // content WILLY never taught in this run. The ACCUMULATED taught
    // content (not the final turn's short confirmation message) is what
    // must reach the adapter/composer — distinct from the cognitive
    // history WILLY itself uses to decide whether to call the tool.
    const willyHist: HistTurn[] = [];
    const statePack = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', entitlements: { plan: 'premium', source: 'MOCK_ENTITLEMENT_AUTHORITY_V1' } };
    const teachingTurns = [
      'Enséñame vocabulario de negociación agrícola en español: quiero aprender a hablar de precios, calidad del grano y condiciones de entrega.',
      'Dame también frases útiles para negociar el plazo de pago con un comprador.',
    ];
    let accumulatedTaughtContent = '';
    for (let i = 0; i < teachingTurns.length; i++) {
      stage8b = `teaching_turn_${i + 1}_of_${teachingTurns.length}`;
      const m = teachingTurns[i];
      const r = await callWillyMotorToolAware(willyHist, m, statePack);
      willyHist.push({ role: 'user', content: m }, { role: 'assistant', content: r.message });
      accumulatedTaughtContent += `\n\n${r.message}`;
    }
    stage8b = 'materialization_turn';
    const materializationRequest = 'Prepárame un PDF imprimible con el vocabulario de negociación agrícola que acabamos de ver, para estudiarlo sola.';
    const willyTurn = await callWillyMotorToolAware(willyHist, materializationRequest, statePack);
    willyHist.push({ role: 'user', content: materializationRequest }, { role: 'assistant', content: willyTurn.message });
    const artifactCall = willyTurn.toolCalls.find((tc) => tc.name === 'signal_artifact');
    if (!artifactCall) {
      sections.ARTIFACT_ADAPTER = {
        teachingTurns,
        accumulatedTaughtContentPreview: accumulatedTaughtContent.slice(0, 400),
        willyResponse: willyTurn.message,
        note: 'WILLY did not call signal_artifact on this smoke pass despite grounded prior teaching across two real turns — recorded honestly, not retried to force a particular outcome. This is itself D2/D3 evidence, not a harness failure. See FORCED_SIGNAL_ADAPTER_TEST below for a pipeline-only check independent of this cognitive decision.',
      };
    } else {
      stage8b = 'adapter_and_composition';
      // AE correction: the adapter receives the ACCUMULATED taught content,
      // never just this turn's short confirmation message.
      const adapted = await adaptAndFulfillWillySignal(artifactCall, materializationRequest, accumulatedTaughtContent, 'premium');
      sections.ARTIFACT_ADAPTER = {
        teachingTurns,
        accumulatedTaughtContentPreview: accumulatedTaughtContent.slice(0, 400),
        willyResponse: willyTurn.message,
        signalArgs: artifactCall.args,
        adapted,
      };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // AE dictamen (15.10.2026, "DICTAMEN SOBRE PR #4 Y BLOQUEO DE
    // CRÉDITOS"): a 429/quota/billing failure from the underlying API
    // provider is an external environment condition, not a cognitive
    // decision by WILLY and not an absence-of-signal result. Flag it
    // explicitly rather than requiring a human to recognize the pattern.
    const environmentBlocked = /\b429\b|credits? remaining|insufficient_quota|rate.?limit|quota exceeded/i.test(message);
    sections.ARTIFACT_ADAPTER = {
      error: message,
      stageInterrupted: stage8b,
      environmentBlocked,
      environmentBlockedNote: environmentBlocked
        ? 'Classified as ENVIRONMENT BLOCKED per AE dictamen (15.10.2026, "DICTAMEN SOBRE PR #4 Y BLOQUEO DE CRÉDITOS"): an external API quota/billing failure interrupted stage `stageInterrupted` above. This must NOT be scored as WILLY declining to emit a signal, nor as any cognitive result — it is an unrelated infrastructure condition. Resolve the API quota before re-attempting this section.'
        : undefined,
    };
  }

  // 8b2. FORCED-SIGNAL ADAPTER TEST — explicitly NOT a measure of WILLY's
  // cognitive capability. Manually constructs a signal_artifact tool-call
  // object and invokes the adapter directly, to verify the pipeline
  // (intent gate -> commercial gate -> isolation -> composeDocumentFromTaught
  // -> generatePDF) independent of whether WILLY spontaneously emits the
  // call on any given run. Per AE directive §4, D2/D3.
  try {
    const forcedUserMessage = 'Prepárame un PDF imprimible con el vocabulario de negociación agrícola que acabamos de ver, para estudiarlo sola.';
    const forcedTaughtContent = 'Vocabulario de negociación agrícola: precio por quintal, calidad de grano, condiciones de entrega, plazo de pago, anticipo, contrato de compraventa, cosecha, certificación orgánica.';
    // Real PREP_V1 run (15.10.2026) caught this: lib/artifact-signal.ts's
    // parseArtifactSignal() requires `trigger` (one of
    // 'pedagogical_completion' | 'explicit_user_request') as well as
    // `type`/`subject`. The original forced call omitted it and was
    // rejected as malformed_signal_schema before ever reaching the intent/
    // commercial/isolation gates — testing nothing. Fixed to match the real
    // schema exactly.
    const forcedCall = { name: 'signal_artifact', args: { type: 'emit_pdf', trigger: 'explicit_user_request', subject: 'Vocabulario de negociación agrícola' } };
    const forcedResult = await adaptAndFulfillWillySignal(forcedCall, forcedUserMessage, forcedTaughtContent, 'premium');
    sections.FORCED_SIGNAL_ADAPTER_TEST = {
      scope: 'NOT a test of WILLY cognitive capability. Verifies the adapter/pipeline wiring in isolation via a manually-constructed signal_artifact call, per AE directive — independent of whether WILLY spontaneously emits this signal on any given run.',
      inputCaveat: 'AE note (15.10.2026): the forced input above is a single short sentence (eight agricultural terms). A small materialized PDF here is fully consistent with either the structured composer or the plain-text fallback — see composedByStructuredComposer/compositionFailureReason inside result.adapted for the explicit distinction; do not infer composer success from byte size alone.',
      forcedCall,
      result: forcedResult,
    };
  } catch (e) {
    sections.FORCED_SIGNAL_ADAPTER_TEST = { error: e instanceof Error ? e.message : String(e) };
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

    // AE correction: free-plan rejection must ALSO be verified via a signal
    // actually presented to the mock gate — not merely inferred from the
    // absence of a spontaneous WILLY signal on this particular run.
    // Same schema fix as FORCED_SIGNAL_ADAPTER_TEST above (8b2): `trigger`
    // is required by parseArtifactSignal() and was missing.
    const forcedCall = { name: 'signal_artifact', args: { type: 'emit_pdf', trigger: 'explicit_user_request', subject: 'Vocabulario de negociación agrícola' } };
    const forcedContent = 'Vocabulario de negociación agrícola: precio por quintal, calidad de grano, condiciones de entrega, plazo de pago.';
    const forcedRejection = await adaptAndFulfillWillySignal(forcedCall, userMessage, forcedContent, 'free');

    sections.ENTITLEMENT_OBEDIENCE_SMOKE = {
      willyResponse: willyTurn.message,
      willyCalledTool: !!artifactCall,
      adapted,
      claimsAlreadyDelivered: /ya (te )?(lo )?(prepar|gener|adjunt|envi)[eé]/i.test(willyTurn.message) || /aquí (tienes|está) (tu|el) (pdf|documento)/i.test(willyTurn.message),
      forcedRejectionTest: {
        scope: 'NOT a test of WILLY cognitive capability. Verifies plan=free is actually denied by MOCK_ENTITLEMENT_AUTHORITY_V1 via a manually-presented signal, independent of whether WILLY spontaneously emitted one this run.',
        forcedCall,
        result: forcedRejection,
      },
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

// ─────────────────────────────────────────────────────────────────────────
// 9. D5 MULTIMODAL CONTINUITY — REAL FIRST CIRCUIT (AE "WILLY FAST TRACK:
//    PRIMERA MATERIALIZACIÓN ESPONTÁNEA", 15.10.2026, §3: "D5 pasa a
//    prioridad inmediata"). AE confirmed runWillyAudioRoundtrip() (section 6
//    above) is implemented and exported but never invoked by PREP_V1 — so
//    re-running PREP_V1 is NOT a D5 test. This section invokes it for the
//    first time in this workstream, with:
//      - a REAL, REPRODUCIBLE incoming audio file: synthesized via the
//        production generateSpeech() TTS function itself — never a second
//        or mocked audio system (explicitly forbidden by AE: "No
//        corresponde... incorporar un segundo sistema de audio"). The same
//        fixed input text is deterministically re-synthesized on every run
//        of this function, so the input audio is reproducible, not a
//        one-off recording.
//      - genuine prior WILLY context, seeded via one real
//        callWillyMotorToolAware() turn — not fabricated/injected state.
//      - the real STT -> WILLY turn -> real TTS circuit, via
//        runWillyAudioRoundtrip(), unmodified.
//      - isolation verified pre-flight (before ANY audio synthesis, input
//        or output) AND post-hoc on both the input-synthesis call and
//        inside runWillyAudioRoundtrip itself (section 6's own checks).
//      - a best-effort lexical continuity check, in the same disclosed,
//        non-semantic-judge style as HONEST_ABSENCE_PATTERNS (section 8a
//        above): a signal for human review, never a silent auto-pass/fail.
//    AE's required evidence table (same dictamen, §3) is produced as six
//    explicitly separated report fields: audioEntrante, stt, willy, tts,
//    aislamiento, continuidad.
//
//    SCOPE: this is the first authentic circuit (n=1), per AE's own
//    sequencing ("Después del primer circuito auténtico, ejecutar las tres
//    repeticiones D5 del scorecard"). The three scorecard repetitions
//    (D5_MULTIMODAL_CONTINUITY, sampleSizePerScenario: 3) are a separate,
//    subsequent diagnostic pass, not this one.
// ─────────────────────────────────────────────────────────────────────────

export async function runWillyD5AudioContinuityV1(): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {
    harness: 'willy_d5_audio_continuity_v1',
    authorization:
      'AE "WILLY FAST TRACK: PRIMERA MATERIALIZACIÓN ESPONTÁNEA" (15.10.2026), §3: "D5 pasa a prioridad inmediata". First real invocation of runWillyAudioRoundtrip() (section 6) in this workstream — PREP_V1 (section 8) never called it.',
    scope:
      'n=1, first authentic circuit per AE\'s own sequencing. The three D5 scorecard repetitions (sampleSizePerScenario: 3, dimension D5_MULTIMODAL_CONTINUITY) are a separate, subsequent diagnostic pass.',
  };

  // Pre-flight isolation — BEFORE any audio synthesis at all (input or
  // output). Reused unchanged from section 4; a failure here blocks the
  // entire circuit before a single OpenAI audio call is made.
  const preFlightIsolation = verifyStorageIsolation();
  if (!preFlightIsolation.isolated) {
    report.aislamiento = { preFlight: preFlightIsolation };
    report.blockedReason = `BLOCKED_BEFORE_START: ${preFlightIsolation.reason}`;
    return report;
  }

  // Seed turn: genuine prior WILLY context via one real conversational
  // turn — not fabricated/injected state. Deliberately reuses the same
  // negotiation-call narrative already exercised in PREP_V1 §8a/§8b, for
  // continuity of evidence across this workstream's scenarios.
  const willyHist: HistTurn[] = [];
  const statePack = { ...WILLY_INITIAL_STATE, mentorProfile: 'sarah', interfaceLanguage: 'es', entitlements: { plan: 'premium', source: 'MOCK_ENTITLEMENT_AUTHORITY_V1' } };
  const seedMessage = 'Soy Tomás. Trabajo en una cooperativa agrícola en Perú y en junio tengo una videollamada con un comprador en Madrid para negociar el precio del café.';
  let seedTurn;
  try {
    seedTurn = await callWillyMotorToolAware(willyHist, seedMessage, statePack);
  } catch (e) {
    report.willy = { error: e instanceof Error ? e.message : String(e), stage: 'seed_turn_failed' };
    report.aislamiento = { preFlight: preFlightIsolation };
    return report;
  }
  willyHist.push({ role: 'user', content: seedMessage }, { role: 'assistant', content: seedTurn.message });

  // Synthesize the REAL, REPRODUCIBLE incoming audio file: a recall
  // question about the facts just established, rendered via the
  // production generateSpeech() TTS function — not a second/mocked audio
  // system. Reproducible: the same fixed input text is deterministically
  // re-synthesized on every run of this function.
  const recallQuestionText = 'Recuérdame, ¿en qué ciudad es mi videollamada, en qué mes es, y qué producto voy a negociar?';
  const { generateSpeech } = await import('../../server/tools/audio-toolkit');
  const inputTts = await generateSpeech(recallQuestionText, { voice: 'nova' });

  // Post-hoc isolation re-check on the INPUT synthesis call itself — never
  // trust the pre-flight check alone, same discipline as section 5/6.
  if (inputTts.method === 's3') {
    report.audioEntrante = { synthesized: false, reason: 'POST_HOC_VIOLATION: generateSpeech (input synthesis) returned method=s3 despite a passing pre-flight isolation check. Escalate to AE before repeating.' };
    report.aislamiento = { preFlight: preFlightIsolation, inputSynthesisMethod: inputTts.method, violated: true };
    report.blockedReason = 'INPUT_AUDIO_SYNTHESIS_ISOLATION_VIOLATION';
    return report;
  }
  if (!inputTts.success || !inputTts.url) {
    report.audioEntrante = { synthesized: false, reason: `Input audio synthesis failed: success=${inputTts.success}, hasUrl=${!!inputTts.url}`, error: inputTts.message };
    report.aislamiento = { preFlight: preFlightIsolation };
    report.blockedReason = 'INPUT_AUDIO_SYNTHESIS_FAILED';
    return report;
  }

  // generateSpeech's dataUrl fallback (server/tools/audio-toolkit.ts) always
  // produces exactly this shape when method==='dataurl': a 'audio/mpeg'
  // base64 data URL from an mp3 response_format. Matched explicitly rather
  // than assumed, so an unexpected third shape is never silently treated
  // as a reproducible real audio file.
  const dataUrlMatch = inputTts.url.match(/^data:audio\/mpeg;base64,(.+)$/);
  if (!dataUrlMatch) {
    report.audioEntrante = { synthesized: false, reason: `Unexpected input audio url shape (neither s3 nor the expected data:audio/mpeg;base64 form): ${inputTts.url.slice(0, 80)}`, method: inputTts.method };
    report.aislamiento = { preFlight: preFlightIsolation, inputSynthesisMethod: inputTts.method };
    report.blockedReason = 'INPUT_AUDIO_UNEXPECTED_URL_SHAPE';
    return report;
  }
  const inputBase64 = dataUrlMatch[1];

  report.audioEntrante = {
    synthesized: true,
    real: true,
    reproducible: 'Deterministically regenerated from a fixed input text via the production generateSpeech() TTS function on every run of this diagnostic — not a static fixture file, not a mock audio system.',
    sourceText: recallQuestionText,
    method: inputTts.method,
    format: 'mp3',
    byteLengthApprox: Math.floor((inputBase64.length * 3) / 4),
  };

  // The real STT -> WILLY turn -> real TTS circuit, unmodified (section 6),
  // invoked for the first time in this workstream.
  const roundtrip = await runWillyAudioRoundtrip({ data: inputBase64, format: 'mp3' }, willyHist, statePack);

  report.stt = {
    completed: roundtrip.stage !== 'transcription',
    transcript: roundtrip.transcript,
    transcriptLanguage: roundtrip.transcriptLanguage,
    note: roundtrip.stage === 'transcription' ? `STT FAILED: ${roundtrip.error}` : 'Real whisper-1 transcription of the synthesized input audio above.',
  };

  report.willy = {
    response: roundtrip.willyResponse,
    toolCalls: roundtrip.willyToolCalls,
  };

  report.tts = {
    attempted: roundtrip.stage !== 'transcription',
    stage: roundtrip.stage,
    method: roundtrip.audio?.method,
    hasUrl: roundtrip.audio?.hasUrl,
  };

  const roundtripAudioMethod = roundtrip.audio?.method;
  report.aislamiento = {
    preFlight: preFlightIsolation,
    inputSynthesisMethod: inputTts.method,
    roundtripIsolationCheck: roundtrip.isolation,
    roundtripAudioMethod,
    hardGate: 'Per scorecard D5_MULTIMODAL_CONTINUITY passThreshold: any method=s3 result anywhere in this circuit is an automatic FAIL, independent of cognitive quality, and must stop D5 until AE review.',
    violated: inputTts.method === 's3' || roundtripAudioMethod === 's3',
  };

  // Continuidad: best-effort lexical heuristic, same disclosed,
  // non-semantic-judge style as HONEST_ABSENCE_PATTERNS (section 8a above).
  // A signal for human review, never a silent auto-pass/fail.
  const willyResponseLower = (roundtrip.willyResponse ?? '').toLowerCase();
  const recalledInWillyResponse = {
    city: willyResponseLower.includes('madrid'),
    month: willyResponseLower.includes('junio'),
    product: willyResponseLower.includes('café') || willyResponseLower.includes('cafe'),
  };
  const transcriptLower = (roundtrip.transcript ?? '').toLowerCase();
  report.sttAccuracyHeuristic = {
    mentionsCiudad: transcriptLower.includes('ciudad'),
    mentionsMes: transcriptLower.includes('mes'),
    mentionsProducto: transcriptLower.includes('producto'),
    note: 'Best-effort lexical check that the real STT transcript recovers the recall question\'s own wording — not a semantic judge, not a scorecard field. Human review recommended.',
  };
  report.continuidad = {
    seedFactsEstablished: { city: 'Madrid', month: 'junio', product: 'café' },
    recalledInWillyResponse,
    heuristicVerdict:
      recalledInWillyResponse.city && recalledInWillyResponse.month && recalledInWillyResponse.product
        ? 'FACTS_PRESERVED (lexical heuristic)'
        : 'INCOMPLETE_OR_ABSENT_BY_HEURISTIC — human review required; this is a lexical signal only (same disclosed-heuristic discipline as section 8a), not an automatic FAIL of the dimension.',
  };

  report.overallSuccess = roundtrip.success;
  if (!roundtrip.success) report.blockedReason = roundtrip.blockedReason;

  return report;
}

// ─────────────────────────────────────────────────────────────────────────
// 10. STT ISOLATION FORENSIC — bounded diagnostic authorized by AE
//     ("DICTAMEN D5: ANOMALÍA DE CONTINUIDAD MULTIMODAL", 15.10.2026, §4).
//     Scope, exactly as AE specified: synthesize ONE fixed audio sample,
//     record its SHA-256 and source text, then run transcribeAudio() on
//     the SAME bytes multiple independent times. This isolates whether STT
//     (whisper-1) itself is unstable on identical input, WITHOUT involving
//     WILLY at all — no callWillyMotorToolAware call anywhere in this
//     function. Per AE's explicit instructions: does not reopen D1-D4,
//     does not modify WILLY, does not alter the frozen D5 scorecard. This
//     is an independent diagnostic, not an extension or repetition of D5.
// ─────────────────────────────────────────────────────────────────────────

export async function runWillySttIsolationForensicV1(): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {
    harness: 'willy_stt_isolation_forensic_v1',
    authorization:
      'AE "DICTAMEN D5: ANOMALÍA DE CONTINUIDAD MULTIMODAL" (15.10.2026), §4: "Autorizo un experimento acotado exclusivamente a determinar dónde aparece la divergencia STT... sintetizar una única muestra de audio, conservar su hash y utilizar exactamente los mismos bytes de entrada en varias transcripciones independientes." Independent diagnostic — does not call WILLY, does not reopen D1-D4, does not modify the frozen D5_MULTIMODAL_CONTINUITY scorecard.',
    scope:
      'Isolates STT (whisper-1) stability on a single fixed audio input, decoupled entirely from WILLY and from D5\'s own continuity question. A finding here neither confirms nor replaces the D5 (n=3) result already closed and recorded by AE.',
  };

  // Same production generateSpeech() function D5 already uses — never a
  // second/mocked audio system. The text is reused verbatim from the D5
  // recall question so this forensic probe is directly comparable to the
  // audio D5 synthesizes, including the specific run that diverged.
  const sourceText = 'Recuérdame, ¿en qué ciudad es mi videollamada, en qué mes es, y qué producto voy a negociar?';
  const { generateSpeech, transcribeAudio } = await import('../../server/tools/audio-toolkit');

  const preFlightIsolation = verifyStorageIsolation();
  const tts = await generateSpeech(sourceText, { voice: 'nova' });

  if (tts.method === 's3') {
    report.aislamiento = { preFlight: preFlightIsolation, synthesisMethod: tts.method, violated: true };
    report.blockedReason = 'AUDIO_SYNTHESIS_ISOLATION_VIOLATION';
    return report;
  }
  if (!tts.success || !tts.url) {
    report.blockedReason = 'AUDIO_SYNTHESIS_FAILED';
    report.error = tts.message;
    return report;
  }
  const dataUrlMatch = tts.url.match(/^data:audio\/mpeg;base64,(.+)$/);
  if (!dataUrlMatch) {
    report.blockedReason = 'AUDIO_UNEXPECTED_URL_SHAPE';
    return report;
  }
  const audioBase64 = dataUrlMatch[1];

  // Fixed input bytes: the SAME base64 string is reused verbatim for every
  // transcription call below. No audio is re-synthesized between calls.
  const { createHash } = await import('crypto');
  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const audioSha256 = createHash('sha256').update(audioBuffer).digest('hex');

  report.audioFijo = {
    sourceText,
    synthesisMethod: tts.method,
    byteLength: audioBuffer.length,
    sha256: audioSha256,
    note: 'Single audio sample, synthesized once. The identical base64 bytes (verified by this SHA-256) are reused for every transcription call below — never re-synthesized between calls.',
    // Included so AE/Dirección can perform their own independent auditory
    // inspection of this exact sample, per AE's explicit request — this
    // function cannot itself perform human listening.
    base64DataUrl: tts.url,
  };
  report.aislamiento = { preFlight: preFlightIsolation, synthesisMethod: tts.method, violated: false };

  const expectedKeywords = ['ciudad', 'mes', 'producto'];
  const transcriptions: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= 3; i++) {
    try {
      const result = await transcribeAudio({ data: audioBase64, format: 'mp3' });
      const lower = (result.text ?? '').toLowerCase();
      transcriptions.push({
        attempt: i,
        success: result.success,
        text: result.text,
        language: result.language,
        matchesExpectedLexically: expectedKeywords.every((k) => lower.includes(k)),
        error: result.success ? undefined : result.error,
      });
    } catch (e) {
      transcriptions.push({ attempt: i, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  report.transcripciones = transcriptions;

  const texts = transcriptions.map((t) => (t.success ? String(t.text ?? '') : null)).filter((t): t is string => t !== null);
  const allIdentical = texts.length > 0 && texts.every((t) => t === texts[0]);
  const allMatchExpected = transcriptions.every((t) => t.matchesExpectedLexically === true);

  report.consistenciaVerdict = {
    allAttemptsSucceeded: transcriptions.every((t) => t.success === true),
    allTranscriptsIdentical: allIdentical,
    allTranscriptsMatchExpectedLexically: allMatchExpected,
    interpretation: !transcriptions.every((t) => t.success === true)
      ? 'ONE OR MORE TRANSCRIPTION CALLS FAILED OUTRIGHT — see per-attempt errors above. Human review required.'
      : allIdentical && allMatchExpected
      ? 'STABLE: identical input bytes produced identical, content-faithful transcripts across all 3 independent calls. Suggests the prior D5 divergence was not a baseline/generic STT instability on this exact audio — review whether it depended on the specific audio generation instance from that D5 run, or on other execution conditions (per AE §4).'
      : !allIdentical
      ? 'UNSTABLE: identical input bytes produced DIFFERENT transcripts across calls — direct evidence of whisper-1 non-determinism/instability independent of WILLY or audio generation variance.'
      : 'Transcripts were identical to each other but did not lexically match the expected source text — possible systematic (not random) misrecognition of this specific audio sample. Human review and auditory inspection of audioFijo.base64DataUrl recommended.',
  };

  return report;
}
