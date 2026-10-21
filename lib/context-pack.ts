// =============================================================================
// lib/context-pack.ts
// SEEK 5.0 S1 E-11 — ContextPack informs the tutor. It does not reason.
// SEEK 5.0 P2 — compoundPedagogicalAct is information, not a state machine.
//
// 7.3: no regex classification of the student's intent lives here. The pack
// carries facts (language, level, continuity) — the Tutor decides.
// 7.3.2: the explanatory language is the Tutor's own declared decision.
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
  // 7.3.2: the language the Tutor itself declared for its explanations (any
  // language code), carried by the session. Null until the Tutor declares one.
  explanatoryLanguage: string | null;
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

export function buildContextPack(input: {
  interfaceLanguage?: string;
  languageProficiency?: string;
  message: string;
  lastConcept?: string;
  lastUserGoal?: string;
  turnCount?: number;
  activeMode?: string;
  explanatoryLanguage?: string;
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
    explanatoryLanguage: input.explanatoryLanguage?.trim() || null,
  };
}

/** 7.3.2c/d: the language fact is delivered adjacent to the student's turn (a
 *  trailing system note). It is the ONLY runtime statement about the
 *  explanatory language. The UI default (interfaceLanguage) is visible to the
 *  Tutor only while the student has not written anything yet (`opening`): it
 *  orients the first greeting and has no authority afterwards. */
export function formatLanguageTurnNote(pack: ContextPack, opts: { opening?: boolean } = {}): string {
  if (pack.explanatoryLanguage) {
    return `[LANGUAGE FOR THIS TURN] explanatoryLanguage = "${pack.explanatoryLanguage}". Write your explanations, corrections and the reasons for each correction in this language, even though the student's message below may be Spanish practice. Spanish stays only for the examples, sentences and exercises you teach. Change language only if the student asks or clearly moves to another one; then call set_explanatory_language (small call; keep writing your reply as usual).`
  }
  if (opts.opening) {
    return `[LANGUAGE FOR THIS TURN] The student has not written yet. For this opening greeting only, the UI offered "${pack.interfaceLanguage}" as a starting default. It is not a limit: once the student writes, use the language they write in or ask for, any language you can write well.`
  }
  return '[LANGUAGE FOR THIS TURN] No explanatory language has been declared yet. Answer in the language the student writes in or asks for: any language you can write well, whether or not it appears in any UI picker. Your explanations, corrections and the reasons for each correction go in that language; Spanish stays for the examples and exercises you teach. When you settle on that language, call set_explanatory_language once so it is remembered (small call; keep writing your reply as usual).'
}

export function formatContextPack(pack: ContextPack, opts: { opening?: boolean } = {}): string {
  const lines = [
    '[ContextPack — information for this turn; not a decision procedure]',
    // The UI default is shown only for the opening greeting; once the student
    // writes (or the Tutor declares a language) it is withdrawn: one language
    // statement, no competing value.
    ...(!pack.explanatoryLanguage && opts.opening ? [`interfaceLanguage (starting default for the opening greeting only): ${pack.interfaceLanguage}`] : []),
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
    `explanatoryLanguage: ${pack.explanatoryLanguage ?? 'not declared yet'}`,
    'languageProficiency is CEFR for the target language. domainProficiency is independent of CEFR. Do not reduce domain teaching to the language level.',
  ];
  return lines.join('\n');
}
