// =============================================================================
// lib/context-pack.ts
// SEEK 5.0 S1 E-11 — ContextPack informs the tutor. It does not reason.
// =============================================================================
// languageProficiency ≠ domainProficiency.
// A1 Spanish does not flatten acupuncture / chakras / Mate to "español A1 general".
//
// levelConfirmed is NOT a ContextPack field.
// It lives on SessionState (E-07 chrome). Documented here so it is not smuggled
// into the pack as if DAE had approved it inside this contract.

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
}

/** Session-level chrome gate. Not part of ContextPack. */
export type LevelConfirmed = boolean;

const CEFR: CEFRLevel[] = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function asCefr(value: string | undefined): CEFRLevel {
  const raw = (value ?? '').toUpperCase();
  return (CEFR as string[]).includes(raw) ? (raw as CEFRLevel) : 'A1';
}

function extractDomain(message: string, lastConcept?: string): string | null {
  const text = message.trim();
  if (!text) return lastConcept?.trim() || null;
  const sobre = text.match(/\b(?:sobre|acerca de|de)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][^,.;?!]{2,60})/i);
  if (sobre) {
    const candidate = sobre[1].trim();
    if (!/^(español|spanish|pdf|curso|nivel)$/i.test(candidate)) return candidate;
  }
  const teach = text.match(/(?:ens[eé]ñame|ensename|expl[ií]came|teach me)\s+(.+?)(?:\s+y\s+|\s+en pdf|$)/i);
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
    domainProficiency: domain ? 'unknown' : 'unknown',
    pedagogicalGoal: 'teach',
    artifactGoal: null,
    lastConcept: input.lastConcept ?? null,
    lastUserGoal: input.lastUserGoal ?? null,
    activeFlowType: input.activeMode === 'pdf_course' || input.activeMode === 'structured' ? 'course' : null,
    turnCount: input.turnCount ?? 0,
  };
}
