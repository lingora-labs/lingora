// =============================================================================
// lib/context-pack.ts
// SEEK 5.0 S1 E-11 — ContextPack informs the tutor. It does not reason.
// SEEK 5.0 P2 — compoundPedagogicalAct is information, not a state machine.
//
// 7.3: no regex classification of the student's intent lives here. The pack
// carries facts (language, level, continuity, script) — the Tutor decides.
// =============================================================================
import type { CEFRLevel } from './contracts';
import { buildCommercialContext, formatCommercialFacts, type CommercialContext } from './commercial-context';
import { resolveExplanatoryLanguage, type LanguageSource } from './explanatory-language';

export type DomainProficiency = 'novice' | 'practitioner' | 'expert' | 'unknown';
export type PedagogicalGoal = 'teach' | 'practice' | 'assess' | 'converse' | 'review';
export type ArtifactGoal = 'show_visual' | 'emit_pdf' | 'emit_audio' | 'show_quiz' | null;
export type ActiveFlowType = 'drill' | 'simulation' | 'course' | null;

export interface ContextPack {
  interfaceLanguage: string;
  targetLanguage: string;
  // 7.5: null when the level is unknown (7.4 told the Tutor 'A1' for every student without a level).
  languageProficiency: CEFRLevel | null;
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
  // 7.5 P1-A: where that language comes from (lib/explanatory-language.ts precedence). 'selection' = the
  // language the student picked; 'student_request' = a change they asked for; 'tutor_detected' = OTROS only.
  explanatoryLanguageSource: LanguageSource | null;
  // 7.5 P1-A: this turn was spoken. Facts about the recognition, never instructions.
  voiceInput: VoiceInputFacts | null;
  // 7.5: immersion facts (level, goal, recorded interest, whether frequency allows an invitation). Information, not an order.
  commercial: CommercialContext | null;
}

export type LevelConfirmed = boolean;

/** What the speech recognizer could and could not hear in a spoken turn. */
export interface VoiceInputFacts { uncertain: string[]; interruptedTutor?: { heard: string } | null }

const CEFR: CEFRLevel[] = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function asCefr(value: string | undefined): CEFRLevel | null {
  const raw = (value ?? '').toUpperCase();
  return (CEFR as string[]).includes(raw) ? (raw as CEFRLevel) : null;
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
  explanatoryLanguageSource?: string;
  uiLanguageChoice?: string;
  voiceInput?: VoiceInputFacts | null;
  /** 7.5: session facts for the immersion context; omitted => no commercial facts in this pack. */
  commercialState?: Parameters<typeof buildCommercialContext>[0];
  now?: number;
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
    ...(() => { const a = resolveExplanatoryLanguage({ interfaceLanguage: input.interfaceLanguage, uiLanguageChoice: input.uiLanguageChoice, explanatoryLanguage: input.explanatoryLanguage, explanatoryLanguageSource: input.explanatoryLanguageSource }); return { explanatoryLanguage: a.language, explanatoryLanguageSource: a.source } })(),
    voiceInput: input.voiceInput ?? null,
    commercial: input.commercialState ? buildCommercialContext(input.commercialState, input.now) : null,
  };
}

/** 7.3.2c/d: the language fact is delivered adjacent to the student's turn (a trailing system note, after
 *  the turn). It is the ONLY runtime statement about language. 7.5 P1-A: the language it states is the one
 *  the state contract resolved (lib/explanatory-language.ts); the note informs the Tutor of that decision. */
export function formatLanguageTurnNote(pack: ContextPack, opts: { opening?: boolean; other?: boolean } = {}): string {
  const voice = formatVoiceInputNote(pack)
  if (opts.opening && pack.explanatoryLanguageSource !== 'student_request') {
    // One voice for the opening greeting, defined by the student's selection.
    const free = 'Do not teach and do not produce artifacts on this greeting.'
    if (opts.other) {
      return `[LANGUAGE FOR THIS TURN] Opening greeting: the student has not written yet and picked OTHER because their language is not in the picker. Write ONLY in English: a short warm greeting, then invite them to write one sentence about today in any language they like, or anything at all. ${free} Once they write, explain in the language they use and record it with set_explanatory_language.`
    }
    if (pack.interfaceLanguage === 'es') {
      return `[LANGUAGE FOR THIS TURN] Opening greeting: the student has not written yet and selected Spanish. Write ONLY in Spanish: a short warm greeting, then invite them to write one sentence about today. ${free}`
    }
    return `[LANGUAGE FOR THIS TURN] Opening greeting: the student has not written yet and selected "${pack.interfaceLanguage}" in the picker. Format: first the greeting in Spanish (Spanish is the protagonist), a short warm greeting that invites them to write one sentence about today; then a blank line; then the same greeting in "${pack.interfaceLanguage}" as ONE single paragraph wrapped in single asterisks for italics (no line breaks and no other asterisks inside it). ${free}`
  }
  if (pack.explanatoryLanguage) {
    const why = pack.explanatoryLanguageSource === 'student_request' ? 'the student asked for it' : pack.explanatoryLanguageSource === 'selection' ? 'the student selected it' : 'it is the language this student uses'
    return `[LANGUAGE FOR THIS TURN] explanatoryLanguage = "${pack.explanatoryLanguage}" (${why}). Write your explanations, corrections, the reasons for each correction, your questions and instructions in this language, even though the student's message above may be Spanish practice, contain words of another language or have been transcribed from speech. Spanish stays for the examples, sentences and exercises you teach; examples in other languages are allowed and do not change it. It changes only if the student explicitly asks you to explain in another language: then call set_explanatory_language with that language and evidence = their exact words.${voice}`
  }
  return `[LANGUAGE FOR THIS TURN] No explanatory language exists yet (the student picked OTHER). Answer in the language the student writes in or asks for: any language you can write well. Your explanations, corrections and the reasons for each correction go in that language; Spanish stays for the examples and exercises you teach. When you settle on that language, call set_explanatory_language once so it is remembered (small call; keep writing your reply as usual).${voice}`
}

/** 7.5 P1-A: facts of a spoken turn. The recognizer's doubts are the platform's, never the student's errors. */
export function formatVoiceInputNote(pack: ContextPack): string {
  const v = pack.voiceInput
  if (!v) return ''
  const parts = [' [SPOKEN TURN] The student spoke; the message above is an automatic transcription.']
  if (v.uncertain.length) parts.push(` The recognizer was not sure about: ${v.uncertain.map(u => `«${u}»`).join(', ')}. Do not treat these as the student's mistakes; if they matter for your answer, ask briefly, in explanatoryLanguage, only about them.`)
  if (v.interruptedTutor) parts.push(` The student interrupted your previous spoken answer; they had heard up to: «${v.interruptedTutor.heard.slice(-240)}». Continue from what they say now.`)
  return parts.join('')
}

export function formatContextPack(pack: ContextPack, opts: { opening?: boolean } = {}): string {
  void opts
  const lines = [
    '[ContextPack — information for this turn; not a decision procedure]',
    // The UI default never appears here: one language statement (the turn note), no competing value.
    `targetLanguage: ${pack.targetLanguage}`,
    `languageProficiency: ${pack.languageProficiency ?? 'unknown'}`,
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
    ...formatCommercialFacts(pack.commercial),
  ];
  return lines.join('\n');
}
