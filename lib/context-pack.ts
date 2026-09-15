// =============================================================================
// lib/context-pack.ts
// SEEK 5.0 S1 E-11 — ContextPack informs the tutor. It does not reason.
// SEEK 5.0 P2 — compoundPedagogicalAct is information, not a state machine.
//
// SEEK 5.0 P19-E — ARTIFACT ACTION / DEPTH.
// Root gap (confirmed in production, P19-E): the ONLY way to make WILLY
// author a genuinely long, substantial document was for the USER to
// happen to type "no me pidas confirmaciones... desarrolla directamente".
// Without that phrase, an explicit "curso completo" request got deflected
// into a clarifying question, and the composer correctly refused to
// materialize the resulting near-empty text (anti-placebo working as
// designed — the actual defect was upstream, never reaching the composer
// with real content). This is a real architectural gap, not something to
// patch with more composer prompt text: the decision of whether this turn
// is MATERIALIZING already-taught content vs AUTHORING a new document (and
// at what depth) needs to exist BEFORE the mentor responds, not be
// inferred retroactively from whatever text happened to come out.
// Fix, following this file's own established pattern (deterministic,
// regex-based, pure information — same as compoundPedagogicalAct above):
// artifactAction ('materialize' | 'author') and artifactDepth ('concise' |
// 'standard' | 'comprehensive') are computed once per turn from the
// user's own message and exposed as ContextPack fields. formatContextPack
// turns 'author' into an explicit standing instruction — write the
// complete content now, do not ask scope/format questions the request
// already answers — so this capability no longer depends on the user
// supplying a specific magic phrase. The mentor still decides how to
// write; this only tells it, structurally, that this turn calls for
// authoring rather than reorganizing, and roughly how much.
// =============================================================================
import type { CEFRLevel } from './contracts';

export type DomainProficiency = 'novice' | 'practitioner' | 'expert' | 'unknown';
export type PedagogicalGoal = 'teach' | 'practice' | 'assess' | 'converse' | 'review';
export type ArtifactGoal = 'show_visual' | 'emit_pdf' | 'emit_audio' | 'show_quiz' | null;
export type ActiveFlowType = 'drill' | 'simulation' | 'course' | null;
export type ArtifactAction = 'materialize' | 'author';
export type ArtifactDepth = 'concise' | 'standard' | 'comprehensive';

export interface ContextPack {
  interfaceLanguage: string;
  targetLanguage: string;
  languageProficiency: CEFRLevel;
  domain: string | null;
  domainProficiency: DomainProficiency;
  pedagogicalGoal: PedagogicalGoal;
  artifactGoal: ArtifactGoal;
  lastConcept: string | null;
  lastUserGoal: string | null;
  activeFlowType: ActiveFlowType;
  turnCount: number;
  compoundPedagogicalAct: boolean;
  // P19-E — see file header. Computed for every turn (cheap, regex-only);
  // only acted on by the mentor when the turn is actually artifact-shaped.
  artifactAction: ArtifactAction;
  artifactDepth: ArtifactDepth;
}

export type LevelConfirmed = boolean;

const CEFR: CEFRLevel[] = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function asCefr(value: string | undefined): CEFRLevel {
  const raw = (value ?? '').toUpperCase();
  return (CEFR as string[]).includes(raw) ? (raw as CEFRLevel) : 'A1';
}

export function isCompoundPedagogicalAct(message: string): boolean {
  const t = (message || '').toLowerCase();
  if (!t.trim()) return false;
  const sequenced = /\b(primero|despu[eé]s|luego|finalmente|then|after that|finally)\b/.test(t);
  const domainShift = /cambia de dominio|acupuntur|otro dominio|sin tratarme como principiante|domain/.test(t);
  const askedParts = (t.match(/ens[eé]ñame|expl[ií]came|teach me|genera(?:r)? dos|curso de|introducci[oó]n seria/g) || []).length;
  return sequenced && (domainShift || askedParts >= 2);
}

// P19-E — MATERIALIZE cues: the user is pointing at content that already
// exists (this conversation, "this explanation") and asking for it to be
// turned into a document — not asking for new content to be developed.
const MATERIALIZE_PATTERNS = /\b(pasa esto a pdf|p[aá]samelo a pdf|convierte est[ae]|convierte esta explicaci[oó]n|exporta esto|exporta esta conversaci[oó]n|hazlo pdf|pon esto en pdf|de lo que (acabamos|hemos) de hablar|de esta conversaci[oó]n|de lo que (dijiste|dijimos|hablamos)|turn this into|convert this into|export this|make this into a)\b/i;

// P19-E — AUTHOR cues: an explicit request to CREATE a new document of a
// named kind (curso, dossier, white paper, informe, guía, manual, brief,
// reporte) — the document is the ask, not a byproduct of the conversation.
const AUTHOR_PATTERNS = /\b(crea(?:me)? (?:un|una)|desarrolla (?:un|una)|hazme (?:un|una)|genera(?:me)? (?:un|una)|escribe (?:un|una)|dise[ñn]a (?:un|una)|create a|develop a|write a|design a)\s+(curso|dossier|white ?paper|informe|gu[ií]a (?:completa|introductoria)?|manual|brief|reporte|documento completo|course|report)\b/i;

const COMPREHENSIVE_CUES = /\b(completo|completa|a fondo|en profundidad|exhaustiv[oa]|curso (?:introductorio )?completo|no como resumen|documento completo|comprehensive|in depth|in-depth)\b/i;
const CONCISE_CUES = /\b(resumen|breve|r[aá]pido|corto|en pocas palabras|sintetiza|brief summary|quick summary|short)\b/i;

function classifyArtifactAction(message: string): { action: ArtifactAction; depth: ArtifactDepth } {
  const t = (message || '').toLowerCase();
  const isAuthor = AUTHOR_PATTERNS.test(t) && !MATERIALIZE_PATTERNS.test(t);
  const action: ArtifactAction = isAuthor ? 'author' : 'materialize';
  const depth: ArtifactDepth = COMPREHENSIVE_CUES.test(t)
    ? 'comprehensive'
    : CONCISE_CUES.test(t)
      ? 'concise'
      : 'standard';
  return { action, depth };
}

// P19-F2 — ARTIFACT AUTHORITY GATE (see server/core/artifact-side-effect.ts
// for the full rationale). Broader than AUTHOR_PATTERNS/MATERIALIZE_PATTERNS
// above (those classify WHICH kind of artifact request this is, assuming
// one exists) — this answers whether an artifact request exists AT ALL.
// Creation verb + artifact noun, close together (same clause), OR one of
// the existing materialize/author phrasings. A message with neither is not
// an artifact request, regardless of how pedagogically substantial the
// mentor's answer to it ends up being.
const ARTIFACT_NOUNS = 'pdf|tabla|esquema|dossier|informe|gu[ií]a|manual|brief|reporte|documento|material( imprimible)?|hoja(?: de ejercicios)?|ficha|resumen|curso|matriz|comparaci[oó]n|glosario|schema|worksheet|workbook|table|chart|handout';
// P19-F3 — ZAKIA PRODUCT TRUTH: "prepara(?:me)?" never matched the correctly
// accented Spanish imperative "prepárame" (á vs a — the `i` regex flag only
// folds case, not diacritics). Confirmed by direct reproduction: this verb
// form simply never triggered the gate. Fixed here alongside the new
// semantic-intent addition below.
const CREATION_VERBS = '(?:crea(?:me)?|dame|hazme|genera(?:me)?|prep[aá]ra(?:me)?|escribe(?:me)?|dise[ñn]a(?:me)?|desarrolla(?:me)?|quiero|necesito|make me|give me|create|generate|prepare)';
const EXPLICIT_ARTIFACT_REQUEST = new RegExp(`\\b${CREATION_VERBS}\\b[^.!?\\n]{0,40}\\b(?:${ARTIFACT_NOUNS})\\b`, 'i');

// P19-F3 — ZAKIA PRODUCT TRUTH RECOVERY: the gate above requires a literal
// artifact-type noun (pdf/tabla/esquema/...) near a creation verb. Root gap
// confirmed by direct reproduction against the Zakia benchmark's own
// wording: "Quiero algo que pueda imprimir y usar sola para seguir
// preparando el DELE A2..." contains no such noun — "algo" is not
// "material" or "hoja" — so the gate silently denied a request whose
// MEANING is unambiguous (a printable, standalone, take-away document).
// This pattern captures the semantic shape of that intent — a verb of
// wanting/creating followed by a physical/standalone-use cue (imprimir,
// para llevar, usar/estudiar sola, preparado/listo) — independent of
// which artifact-type noun, if any, the student actually names. Distinct
// from EXPLICIT_ARTIFACT_REQUEST (noun-based) and from a same-sentence
// hypothetical/deferred framing ("podrías hacerme algo después" uses
// neither a listed creation verb nor this cue set, and stays excluded).
const SEMANTIC_MATERIAL_CUES = 'imprimir|imprimible|para llevar(?:me)?|que pueda llevar|llevarme (?:esto|esta)|usar (?:sola|solo|despu[eé]s|en casa|por mi cuenta)|estudiar (?:sola|solo|despu[eé]s|por mi cuenta)|preparad[oa]|list[oa] para (?:usar|llevar|estudiar)';
const SEMANTIC_MATERIALIZE_INTENT = new RegExp(`\\b(?:quiero|necesito|prep[aá]ra(?:me)?|dame|hazme|d[eé]jame(?:lo)?)\\b[^.!?\\n]{0,60}\\b(?:${SEMANTIC_MATERIAL_CUES})\\b`, 'i');

export function hasExplicitArtifactRequest(message: string): boolean {
  const t = (message || '').trim();
  if (!t) return false;
  return EXPLICIT_ARTIFACT_REQUEST.test(t) || MATERIALIZE_PATTERNS.test(t) || AUTHOR_PATTERNS.test(t) || SEMANTIC_MATERIALIZE_INTENT.test(t);
}

function extractDomain(message: string, lastConcept?: string): string | null {
  const text = message.trim();
  if (!text) return lastConcept?.trim() || null;
  const sobre = text.match(/\b(?:sobre|acerca de|de)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][^,.;?!]{2,60})/i);
  if (sobre) {
    const candidate = sobre[1].trim();
    if (!/^(español|spanish|pdf|curso|nivel)$/i.test(candidate)) return candidate;
  }
  const teach = text.match(/(?:ens[eé]name|ensename|expl[ií]came|teach me)\s+(.+?)(?:\s+y\s+|\s+en pdf|$)/i);
  if (teach) {
    const candidate = teach[1].replace(/\b(como una profesora|por favor)\b/ig, '').trim();
    if (candidate.length > 2 && !/^(español|spanish)$/i.test(candidate)) return candidate;
  }
  return lastConcept?.trim() || null;
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
  const domain = extractDomain(input.message, input.lastConcept);
  const { action, depth } = classifyArtifactAction(input.message);
  return {
    interfaceLanguage: input.interfaceLanguage ?? 'en',
    targetLanguage: 'es',
    languageProficiency: asCefr(input.languageProficiency),
    domain,
    domainProficiency: 'unknown',
    pedagogicalGoal: 'teach',
    artifactGoal: null,
    lastConcept: input.lastConcept ?? null,
    lastUserGoal: input.lastUserGoal ?? null,
    activeFlowType: input.activeMode === 'pdf_course' || input.activeMode === 'structured' ? 'course' : null,
    turnCount: input.turnCount ?? 0,
    compoundPedagogicalAct: isCompoundPedagogicalAct(input.message),
    artifactAction: action,
    artifactDepth: depth,
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
    `pedagogicalGoal: ${pack.pedagogicalGoal}`,
    `artifactGoal: ${pack.artifactGoal ?? 'null'}`,
    `lastConcept: ${pack.lastConcept ?? 'null'}`,
    `lastUserGoal: ${pack.lastUserGoal ?? 'null'}`,
    `activeFlowType: ${pack.activeFlowType ?? 'null'}`,
    `turnCount: ${pack.turnCount}`,
    `compoundPedagogicalAct: ${pack.compoundPedagogicalAct ? 'true' : 'false'}`,
    `artifactAction: ${pack.artifactAction}`,
    `artifactDepth: ${pack.artifactDepth}`,
    'languageProficiency is CEFR for the target language. domainProficiency is independent of CEFR. Do not reduce domain teaching to the language level.',
  ];
  if (pack.compoundPedagogicalAct) {
    lines.push('The student explicitly sequenced more than one pedagogical request in this message. That is information about the request shape, not a router.');
  }
  // P19-E — this is the structural replacement for the "no me pidas
  // confirmaciones" workaround: a standing instruction the mentor gets on
  // every turn classified as authoring, not a phrase the user has to
  // remember to include.
  if (pack.artifactAction === 'author') {
    lines.push(
      `The student is asking you to AUTHOR a new document (not materialize something already said), at depth "${pack.artifactDepth}". `
      + 'Write the complete content for it directly in this response now — do not ask a clarifying question about scope, audience or format if the request already gives you enough to proceed reasonably (it usually does). '
      + 'concise: a focused, complete answer covering the core points only. '
      + 'standard: solid explanatory coverage with real depth on the main points named. '
      + 'comprehensive: develop real depth on EVERY topic area the student named, in sequence — this is expected to be a long, substantial response, not a summary; do not pad, but do not compress either.',
    );
  }
  return lines.join('\n');
}
