// ================================================
// LINGORA 10.0 — COMMERCIAL ENGINE
// Migrated from engine/commercial.js
// Full logic preserved, ported to TypeScript.
// ================================================

import type { CommercialOffer, CommercialTrigger, SessionState } from '@/lib/contracts'

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

function immersionScore(state: Partial<SessionState>): number {
  let s = 0
  const levelPts: Record<string, number> = {
    A0: 0, A1: 10, A2: 20, B1: 40, B2: 60, C1: 80, C2: 100,
  }
  s += levelPts[state.level || 'A0'] || 0
  s += Math.min((state.tokens || 0) / 10, 30)
  s += Math.min((state.interestCount || 0) * 5, 20)
  return Math.min(s, 100)
}

export interface CommercialResult {
  trigger: CommercialTrigger | null
  state: Partial<SessionState>
}

export function commercialEngine(
  message: string,
  state: Partial<SessionState> = {}
): CommercialResult {
  const result: CommercialResult = { trigger: null, state: { ...state } }

  if (!Array.isArray(result.state.commercialOffers)) {
    result.state.commercialOffers = []
  }

  if (!levelAtLeast(state.level, CONFIG.minLevel)) return result

  const score = immersionScore(state)

  // Clean offers older than 1 week
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  result.state.commercialOffers = result.state.commercialOffers.filter(
    (o: CommercialOffer) => o.timestamp > weekAgo
  )

  if (result.state.commercialOffers.length >= CONFIG.maxOffersPerWeek) return result

  // Session limit
  const sessionCount = result.state.commercialOffers.filter(
    (o: CommercialOffer) =>
      o.sessionId && state.sessionId && o.sessionId === state.sessionId
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

  const samples = Array.isArray(state.samples) ? state.samples.length : 0
  const interestCount = state.interestCount || 0
  const hasStrongInterest =
    hasInterest && samples >= 3 && (interestCount >= 1 || score >= 35)

  if (!hasStrongInterest && score < CONFIG.scoreThreshold) return result

  result.state.commercialOffers.push({
    timestamp:  Date.now(),
    sessionId:  state.sessionId || null,
    type:       'immersion',
    score,
    interest:   hasInterest,
  })
  result.state.interestCount = (state.interestCount || 0) + (hasInterest ? 1 : 0)

  let msg: string
  if (score >= 80) {
    msg = `Si ya llevas este tiempo construyendo algo con el espanol, hay un momento en que el idioma necesita salir de la pantalla. No para practicar frases de hotel, sino para usarlo en cosas reales: pedir sin pensar, entender un chiste, seguir una conversacion donde nadie te espera. Eso solo pasa en contexto real. Si alguna vez lo estas considerando: ${CONFIG.bookingLink}`
  } else if (hasStrongInterest) {
    msg = `La pregunta no es solo a donde ir. Es que quieres que ese viaje te deje cuando vuelvas. Un destino hispanohablante puede ser exactamente igual de bueno en lo que buscas, y ademas hacer que todo lo que llevas aprendiendo empiece a sonar diferente. Por si te sirve explorar opciones: ${CONFIG.bookingLink}`
  } else {
    msg = `Hay un punto en el aprendizaje de un idioma donde la pantalla deja de ser suficiente. No porque el metodo falle, sino porque el idioma ya pidio mas. Si llegas a ese punto, hay formas de que el siguiente paso sea tambien una experiencia de vida real. ${CONFIG.bookingLink}`
  }

  result.trigger = {
    type:    'immersion',
    level:   score >= 80 ? 'high' : 'medium',
    message: msg,
  }
  return result
}

export function commercialDebug(state: Partial<SessionState> = {}) {
  const score = immersionScore(state)
  const samples = Array.isArray(state.samples) ? state.samples.length : 0
  const interestCount = state.interestCount || 0
  return {
    score,
    level:              state.level || 'A0',
    levelQualifies:     levelAtLeast(state.level, CONFIG.minLevel),
    samplesCollected:   samples,
    interestSignals:    interestCount,
    triggerReadiness: {
      needsScore:           score >= CONFIG.scoreThreshold,
      needsSamples:         samples >= 3,
      needsRepeatedInterest: interestCount >= 1,
    },
    offersThisWeek: (state.commercialOffers || []).filter(
      (o: CommercialOffer) =>
        o.timestamp > Date.now() - 7 * 24 * 60 * 60 * 1000
    ).length,
    config: CONFIG,
  }
}
