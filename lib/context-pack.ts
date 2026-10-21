// =============================================================================
// lib/context-pack.ts
// SEEK 5.0 S1 E-11 — ContextPack informs the tutor. It does not reason.
// SEEK 5.0 P2 — compoundPedagogicalAct is information, not a state machine.
//
// 7.3: no regex classification of the student's intent lives here. The pack
// carries facts (language, level, continuity, script) — the Tutor decides.
// =============================================================================
import type { CEFRLevel } from './contracts';

export type DomainProficiency = 'novice' | 'practitioner' | 'expert' | 'unknown';
export type PedagogicalGoal = 'teach' | 'practice' | 'assess' | 'converse' | 'review';
export type ArtifactGoal = 'show_visual' | 'emit_pdf' | 'emit_audio' | 'show_quiz' | null;
export type ActiveFlowType = 'drill' | 'simulation' | 'course' | null;

export interface ContextPack {
  interfaceLanguage: string;
  targetLanguage: string;
  languageProficiency: CEFRLevel;
  domain: string | null;
  domainProficiency: DomainProficiency;
  pedagogicalGoal: PedagogicalGoal | null;
  artifactGoal: ArtifactGoal;
  lastConcept: string | null;
  lastUserGoal: string | null;
  activeFlowType: ActiveFlowType;
  turnCount: number;
  // P19-F4 — ZAKIA LANGUAGE AUTHORITY. See detectScriptLanguage() below for
  // the root-gap rationale. Null when the message is Latin-script or too
  // short/ambiguous to classify — in that case interfaceLanguage remains
  // the only signal, unchanged from before.
  detectedScriptLanguage: string | null;
  // 'recent' = taken from the student's most recent earlier message in the
  // conversation window (a character-range fact, not an intent guess).
  scriptLanguageSource?: 'current' | 'recent';
}

export type LevelConfirmed = boolean;

const CEFR: CEFRLevel[] = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function asCefr(value: string | undefined): CEFRLevel {
  const raw = (value ?? '').toUpperCase();
  return (CEFR as string[]).includes(raw) ? (raw as CEFRLevel) : 'A1';
}

/** @deprecated 7.3 — intent is the Tutor's. Kept only so the offline benchmark
 *  harness (lib/engineering/willy-full-benchmark.ts) still compiles. */
export function hasExplicitArtifactRequest(_message: string): boolean {
  return false;
}

// P19-F4 — ZAKIA LANGUAGE AUTHORITY.
// Root gap confirmed by direct production reproduction (language_continuity_test
// harness): a student writing entirely in Arabic, with interfaceLanguage at
// a realistic default ('en' — Arabic is not and cannot be an
// InterfaceLanguage value; the picker never offers it), received an
// ENGLISH response. The P19-F3 prompt-only fix ("follow the student's
// actual language") was not strong enough on its own — buried in a long
// system prompt alongside many other instructions, it lost to
// interfaceLanguage's explicit state value.
// Architecture: separate DETECTION (deterministic, code-level, like every
// other ContextPack signal) from DECISION (the mentor still decides how to
// use it — this is not a hard router). detectScriptLanguage() answers one
// narrow, reliable question: is this message written in a NON-LATIN
// script LINGORA can name with confidence (Arabic, Cyrillic, Hebrew, CJK,
// Devanagari, Greek, Thai, Korean, etc.)? This deliberately does NOT
// attempt to distinguish between Latin-script languages (Norwegian vs.
// English vs. French) — that class of detection is unreliable by regex
// and remains the mentor's own judgment, per the existing P19-F3
// instruction (unchanged). But script-level detection is exactly where a
// regex answer is both reliable and general — not an "if Arabic" special
// case; the same ranges cover any student writing in any of these
// scripts. When detected, formatContextPack emits an explicit,
// structured, high-priority instruction — the same escalation pattern
// already used for artifactAction — rather than relying on that signal
// surviving buried in prose.
const SCRIPT_RANGES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Arabic', pattern: /[؀-ۿݐ-ݿ]/ },
  { name: 'Cyrillic (Russian/Ukrainian/etc.)', pattern: /[Ѐ-ӿ]/ },
  { name: 'Hebrew', pattern: /[֐-׿]/ },
  { name: 'Chinese', pattern: /[一-鿿]/ },
  { name: 'Japanese', pattern: /[぀-ヿ]/ },
  { name: 'Korean', pattern: /[가-힯]/ },
  { name: 'Devanagari (Hindi/etc.)', pattern: /[ऀ-ॿ]/ },
  { name: 'Greek', pattern: /[Ͱ-Ͽ]/ },
  { name: 'Thai', pattern: /[฀-๿]/ },
];

// A short greeting/proper-noun fragment in a non-Latin script is still a
// real, unambiguous signal — no minimum-length gate here, unlike
// artifactAction's noun-proximity requirement. Script identity doesn't
// get more or less certain with message length the way intent does.
export function detectScriptLanguage(message: string): string | null {
  const t = (message || '').trim();
  if (!t) return null;
  for (const { name, pattern } of SCRIPT_RANGES) {
    if (pattern.test(t)) return name;
  }
  return null;
}

/** The student's explanatory language is continuity, not a per-message guess:
 *  if the current message is Latin-script (e.g. Spanish practice answers) but an
 *  earlier student message in the window was in another script, keep that fact. */
export function withRecentScriptLanguage(
  pack: ContextPack,
  history: Array<{ role: string; content: string }>,
): ContextPack {
  if (pack.detectedScriptLanguage) return { ...pack, scriptLanguageSource: 'current' };
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') continue;
    const found = detectScriptLanguage(history[i].content);
    if (found) return { ...pack, detectedScriptLanguage: found, scriptLanguageSource: 'recent' };
  }
  return pack;
}

export function buildContextPack(input: {
  interfaceLanguage?: string;
  languageProficiency?: string;
  message: string;
  lastConcept?: string;
  lastUserGoal?: string;
  turnCount?: number;
  activeMode?: string;
}): ContextPack {
  const domain = input.lastConcept?.trim() || null;
  return {
    interfaceLanguage: input.interfaceLanguage ?? 'en',
    targetLanguage: 'es',
    languageProficiency: asCefr(input.languageProficiency),
    domain,
    domainProficiency: 'unknown',
    pedagogicalGoal: null,
    artifactGoal: null,
    lastConcept: input.lastConcept ?? null,
    lastUserGoal: input.lastUserGoal ?? null,
    activeFlowType: input.activeMode === 'pdf_course' || input.activeMode === 'structured' ? 'course' : null,
    turnCount: input.turnCount ?? 0,
    detectedScriptLanguage: detectScriptLanguage(input.message),
  };
}

export function formatContextPack(pack: ContextPack): string {
  const lines = [
    '[ContextPack — information for this turn; not a decision procedure]',
    `interfaceLanguage: ${pack.interfaceLanguage}`,
    `targetLanguage: ${pack.targetLanguage}`,
    `languageProficiency: ${pack.languageProficiency}`,
    `domain: ${pack.domain ?? 'null'}`,
    `domainProficiency: ${pack.domainProficiency}`,
    ...(pack.pedagogicalGoal != null ? [`pedagogicalGoal: ${pack.pedagogicalGoal}`] : []),
    `artifactGoal: ${pack.artifactGoal ?? 'null'}`,
    `lastConcept: ${pack.lastConcept ?? 'null'}`,
    `lastUserGoal: ${pack.lastUserGoal ?? 'null'}`,
    `activeFlowType: ${pack.activeFlowType ?? 'null'}`,
    `turnCount: ${pack.turnCount}`,
    `detectedScriptLanguage: ${pack.detectedScriptLanguage ?? 'null'}`,
    'languageProficiency is CEFR for the target language. domainProficiency is independent of CEFR. Do not reduce domain teaching to the language level.',
  ];
  // P19-F4 — ZAKIA LANGUAGE AUTHORITY. Placed first among the conditional
  // instructions and phrased as an outright override, not a suggestion
  // weighed against interfaceLanguage — this is exactly the escalation the
  // production reproduction showed was missing: the earlier prose-only
  // version of this instruction (P19-F3) lost to interfaceLanguage's
  // explicit state value once buried among many other lines.
  if (pack.detectedScriptLanguage) {
    const recent = pack.scriptLanguageSource === 'recent';
    lines.push(
      recent
        ? `LANGUAGE CONTINUITY: earlier in this conversation the student wrote in ${pack.detectedScriptLanguage} script (detected from the actual characters, not inferred). That is the language they use to understand you. Keep your explanatory prose, questions and conversation in that language, REGARDLESS of interfaceLanguage above, even when their latest message is Spanish practice or a short answer. `
        : `LANGUAGE OVERRIDE: the student's current message is written in ${pack.detectedScriptLanguage} script — this was detected deterministically from the actual characters typed, not inferred. Respond to this turn in that same language, REGARDLESS of what interfaceLanguage says above (interfaceLanguage is only ever a fallback default — a starting point the UI happened to offer, e.g. because the student's real language wasn't an option in the picker — never an instruction to answer in a language the student is not using). `,
      'This does not apply to the Spanish target-language content itself (vocabulary, example sentences, exercises the student is learning) — those stay in Spanish as always. It applies to your own explanatory prose, questions, and conversation. '
      + 'If the student explicitly asks to continue in a different language, honor that request on this and subsequent turns instead.',
    );
  }
  return lines.join('\n');
}
