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
  if (opts.opening) {
    const free = 'Do not teach and do not produce artifacts on this greeting.'
    if (opts.other) return '[LANGUAGE FOR THIS TURN] The student selected OTHER and has not spoken yet. Greet briefly in English and invite them to write in any language. ' + free
    if (pack.interfaceLanguage === 'es') return '[LANGUAGE FOR THIS TURN] Greet briefly in Spanish. ' + free
    return '[LANGUAGE FOR THIS TURN] The student selected ' + pack.interfaceLanguage + '. Give a short friendly greeting in Spanish with a concise explanation in ' + pack.interfaceLanguage + '; do not start a full lesson. ' + free
  }
  const remembered = pack.explanatoryLanguage ?? (opts.other ? 'not yet established' : pack.interfaceLanguage)
  return '[LANGUAGE FOR THIS TURN] Remembered explanatory language: "' + remembered + '"; Spanish is the LEARNING TARGET. Determine the response language from the meaning of the student\'s LATEST turn and the conversation. A genuine conversational shift of language (e.g. a Russian dialogue followed by a student speaking Portuguese) normally changes the reply language without requiring a formal request. An exercise answer, example phrase, quotation, translation target, code or doubtful ASR fragment must NOT change it. Explicit preference to keep a language takes priority. If the explanation language changes, call set_explanatory_language with the new BCP-47 language, basis=conversation_shift or explicit_request, and evidence quoting exact words of THIS turn. The UI follows this declaration automatically. Continue the original learning task, with Spanish examples in Spanish. ' + voice
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
