// =============================================================================
// lib/context-pack.ts
// SEEK 5.0 S1 E-11 — ContextPack informs the tutor. It does not reason.
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
  // P19-F4 — ZAKIA LANGUAGE AUTHORITY. See detectScriptLanguage() below.
  // Null when the message is Latin-script or too short/ambiguous to classify.
  detectedScriptLanguage: string | null;
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
// A student writing entirely in a non-Latin script (e.g. Arabic) must be
// answered in that language even when interfaceLanguage is a fallback default.
// Script detection is a FACT about the characters typed (reliable by range),
// not an intent classification; the mentor still decides how to use it.
// Latin-script languages are deliberately not distinguished here.
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

// A short fragment in a non-Latin script is still an unambiguous signal.
export function detectScriptLanguage(message: string): string | null {
  const t = (message || '').trim();
  if (!t) return null;
  for (const { name, pattern } of SCRIPT_RANGES) {
    if (pattern.test(t)) return name;
  }
  return null;
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
  // P19-F4 — placed as an outright override, not a suggestion weighed against
  // interfaceLanguage (the prose-only version lost to the explicit state value).
  if (pack.detectedScriptLanguage) {
    lines.push(
      `LANGUAGE OVERRIDE: the student's current message is written in ${pack.detectedScriptLanguage} script — this was detected deterministically from the actual characters typed, not inferred. `
      + `Respond to this turn in that same language, REGARDLESS of what interfaceLanguage says above (interfaceLanguage is only ever a fallback default — a starting point the UI happened to offer, e.g. because the student's real language wasn't an option in the picker — never an instruction to answer in a language the student is not using). `
      + 'This does not apply to the Spanish target-language content itself (vocabulary, example sentences, exercises the student is learning) — those stay in Spanish as always. It applies to your own explanatory prose, questions, and conversation. '
      + 'If the student explicitly asks to continue in a different language, honor that request on this and subsequent turns instead.',
    );
  }
  return lines.join('\n');
}
