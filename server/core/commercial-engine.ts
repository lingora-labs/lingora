// ================================================
// LINGORA 10.0 — COMMERCIAL ENGINE
// Migrated from engine/commercial.js
// Full logic preserved, ported to TypeScript.
// SEEK 3.0: legacy state field names aligned with contracts.ts
//   state.level         → state.confirmedLevel ?? state.userLevel
//   state.interestCount → extended type (not in SessionState)
//   state.samples       → extended type (not in SessionState)
//   state.sessionId     → extended type (not in SessionState)
//   state.commercialOffers → extended type (not in SessionState)
// ================================================

import type { CommercialOffer, CommercialEngineTrigger, SessionState } from '@/lib/contracts'

// Extended state type for fields the engine manages internally
// that are not part of the core SessionState contract.
type CommercialState = Partial<SessionState> & {
  level?:            string
  interestCount?:    number
  samples?:          unknown[]
  sessionId?:        string | null
  commercialOffers?: CommercialOffer[]
}

const CONFIG = {
  bookingLink:         'https://lingora.com/immersion',
  maxOffersPerSession: 1,
  maxOffersPerWeek:    2,
  cooldownDays:        7,
  minLevel:            'A2',
  scoreThreshold:      50,
} as const

const LEVEL_ORDER = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']

const TRIGGERS = [
  'viaje', 'viajar', 'españa', 'mexico', 'colombia', 'argentina', 'perú', 'chile',
  'inmersión', 'programa', 'curso presencial', 'experiencia real', 'vivir en',
  'travel', 'spain', 'mexico', 'colombia', 'immersion', 'estudiar en',
]

function levelIndex(l?: string | null): number {
  return LEVEL_ORDER.indexOf(l || 'A0')
}

function levelAtLeast(current?: string | null, min?: string): boolean {
  return levelIndex(current) >= levelIndex(min)
}

// Resolve level from SEEK 3.0 fields with fallback to legacy field
function resolveLevel(state: CommercialState): string {
  return state.confirmedLevel ?? state.userLevel ?? state.level ?? 'A0'
}

function immersionScore(state: CommercialState): number {
  let s = 0
  const levelPts: Record<string, number> = {
    A0: 0, A1: 10, A2: 20, B1: 40, B2: 60, C1: 80, C2: 100,
  }
  s += levelPts[resolveLevel(state)] || 0
  s += Math.min((state.tokens || 0) / 10, 30)
  s += Math.min((state.interestCount || 0) * 5, 20)
  return Math.min(s, 100)
}

export interface CommercialResult {
  trigger: CommercialEngineTrigger | null
  state:   CommercialState
}

export function commercialEngine(
  message: string,
  state: Partial<SessionState> = {}
): CommercialResult {
  const s = state as CommercialState
  const result: CommercialResult = { trigger: null, state: { ...s } }

  if (!Array.isArray(result.state.commercialOffers)) {
    result.state.commercialOffers = []
  }

  if (!levelAtLeast(resolveLevel(s), CONFIG.minLevel)) return result

  const score = immersionScore(s)

  // Clean offers older than 1 week
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  result.state.commercialOffers = result.state.commercialOffers.filter(
    (o: CommercialOffer) => o.timestamp > weekAgo
  )

  if (result.state.commercialOffers.length >= CONFIG.maxOffersPerWeek) return result

  // Session limit
  const sessionCount = result.state.commercialOffers.filter(
    (o: CommercialOffer) =>
      o.sessionId && s.sessionId && o.sessionId === s.sessionId
  ).length
  if (sessionCount >= CONFIG.maxOffersPerSession) return result

  // Cooldown
  const last = result.state.commercialOffers.at(-1)
  if (last) {
    const days = (Date.now() - last.timestamp) / 86400000
    if (days < CONFIG.cooldownDays) return result
  }

  const lower = String(message || '').toLowerCase()
  const hasInterest = TRIGGERS.some(t => lower.includes(t))

  const samples       = Array.isArray(s.samples) ? s.samples.length : 0
  const interestCount = s.interestCount || 0
  const hasStrongInterest =
    hasInterest && samples >= 3 && (interestCount >= 1 || score >= 35)

  if (!hasStrongInterest && score < CONFIG.scoreThreshold) return result

  result.state.commercialOffers.push({
    timestamp: Date.now(),
    sessionId: s.sessionId || null,
    type:      'immersion',
    score,
    interest:  hasInterest,
  })
  result.state.interestCount = (s.interestCount || 0) + (hasInterest ? 1 : 0)

  let msg: string
  if (score >= 80) {
    msg = `Si ya llevas este tiempo construyendo algo con el espanol, hay un momento en que el idioma necesita salir de la pantalla. No para practicar frases de hotel, sino para usarlo en cosas reales: pedir sin pensar, entender un chiste, seguir una conversacion donde nadie te espera. Eso solo pasa en contexto real. Si alguna vez lo estas considerando: ${CONFIG.bookingLink}`
  } else if (hasStrongInterest) {
    msg = `La pregunta no es solo a donde ir. Es que quieres que ese viaje te deje cuando vuelvas. Un destino hispanohablante puede ser exactamente igual de bueno en lo que buscas, y ademas hacer que todo lo que llevas aprendiendo empiece a sonar diferente. Por si te sirve explorar opciones: ${CONFIG.bookingLink}`
  } else {
    msg = `Hay un punto en el aprendizaje de un idioma donde la pantalla deja de ser suficiente. No porque el metodo falle, sino porque el idioma ya pidio mas. Si llegas a ese punto, hay formas de que el siguiente paso sea tambien una experiencia de vida real. ${CONFIG.bookingLink}`
  }

  result.trigger = {
    type:             'immersion',
    cooldownRespected: true,
    sessionScore:      score,
    level:             score >= 80 ? 'high' : 'medium',
    message:           msg,
  }
  return result
}

export function commercialDebug(state: Partial<SessionState> = {}) {
  const s = state as CommercialState
  const score = immersionScore(s)
  const samples       = Array.isArray(s.samples) ? s.samples.length : 0
  const interestCount = s.interestCount || 0
  const level         = resolveLevel(s)
  return {
    score,
    level,
    levelQualifies:     levelAtLeast(level, CONFIG.minLevel),
    samplesCollected:   samples,
    interestSignals:    interestCount,
    triggerReadiness: {
      needsScore:            score >= CONFIG.scoreThreshold,
      needsSamples:          samples >= 3,
      needsRepeatedInterest: interestCount >= 1,
    },
    offersThisWeek: (s.commercialOffers || []).filter(
      (o: CommercialOffer) =>
        o.timestamp > Date.now() - 7 * 24 * 60 * 60 * 1000
    ).length,
    config: CONFIG,
  }
}
