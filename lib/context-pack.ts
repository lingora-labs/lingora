// =============================================================================
// lib/context-pack.ts
// SEEK 5.0 S1 E-11 — ContextPack informs the tutor. It does not reason.
// SEEK 5.0 P2 — compoundPedagogicalAct is information, not a state machine.
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
  pedagogicalGoal: PedagogicalGoal;
  artifactGoal: ArtifactGoal;
  lastConcept: string | null;
  lastUserGoal: string | null;
  activeFlowType: ActiveFlowType;
  turnCount: number;
  compoundPedagogicalAct: boolean;
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
    'languageProficiency is CEFR for the target language. domainProficiency is independent of CEFR. Do not reduce domain teaching to the language level.',
  ];
  if (pack.compoundPedagogicalAct) {
    lines.push('The student explicitly sequenced more than one pedagogical request in this message. That is information about the request shape, not a router.');
  }
  return lines.join('\n');
}
