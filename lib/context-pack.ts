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
    `explanatoryLanguage: ${pack.explanatoryLanguage ?? 'not declared yet'}`,
    'languageProficiency is CEFR for the target language. domainProficiency is independent of CEFR. Do not reduce domain teaching to the language level.',
  ];
  // 7.3.2: language is the Tutor's decision, remembered by the session.
  // interfaceLanguage is a starting default, never a limit on what the Tutor
  // can speak. The student's language, declared or evident, always wins.
  lines.push(
    pack.explanatoryLanguage
      ? `LANGUAGE: you previously settled on "${pack.explanatoryLanguage}" as the language of your explanations for this student. Keep explaining in it, including when the student writes Spanish practice, short answers or exercises (Spanish stays the target language of vocabulary, examples and exercises). Change only if the student asks for another language or clearly moves to one; when you change it, call set_explanatory_language (small call; keep writing your normal reply as usual).`
      : 'LANGUAGE: no explanatory language has been declared yet. interfaceLanguage is only the starting default offered by the UI, not a limit: you may use ANY language you can write well, whether or not it appears in the UI picker. Use the language the student actually writes in or asks for. Once you settle on the language of your explanations, call set_explanatory_language once (small call; keep writing your normal reply as usual).',
  );
  return lines.join('\n');
}
