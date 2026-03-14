// ================================================
// LINGORA 10.0 — DIAGNOSTIC ENGINE
// Migrated from engine/diagnostic.js
// Full CEFR accumulative logic preserved.
// ================================================

import type { DiagnosticState } from '@/lib/contracts'

const CEFR_LEVELS = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']

export function evaluateLevel(samples: string[]): DiagnosticState {
  if (!Array.isArray(samples) || samples.length < 3) {
    return {
      level:      'A0',
      confidence: 'insufficient',
      samples:    samples?.length || 0,
    }
  }

  let score    = 0
  let maxScore = 0

  for (const rawSample of samples) {
    const sample = String(rawSample || '').toLowerCase()
    const words  = sample.trim().split(/\s+/).filter(Boolean)

    score    += Math.min(words.length, 20) * 2
    maxScore += 40

    if (sample.includes(' porque ') || sample.includes(' ya que ')) score += 5
    if (sample.includes(' cuando ') || sample.includes(' donde ')  || sample.includes('donde')) score += 5
    if (sample.includes(' habia ')  || sample.includes(' hubo ')   || sample.includes('tenia')) score += 10

    const advancedWords = ['sin embargo', 'ademas', 'por lo tanto', 'aunque', 'mientras']
    for (const word of advancedWords) {
      if (sample.includes(word)) score += 5
    }

    maxScore += 30
  }

  const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0
  let level: string      = 'A1'
  let confidence: DiagnosticState['confidence'] = 'low'

  if (percentage > 80 && samples.length >= 10) {
    level      = 'C1'
    confidence = 'high'
  } else if (percentage > 65 && samples.length >= 8) {
    level      = 'B2'
    confidence = 'medium'
  } else if (percentage > 50 && samples.length >= 5) {
    level      = 'B1'
    confidence = 'medium'
  } else if (percentage > 30 && samples.length >= 3) {
    level      = 'A2'
    confidence = 'low'
  }

  return {
    level,
    confidence,
    samples:   samples.length,
    score:     Math.round(percentage),
    nextLevel: CEFR_LEVELS[CEFR_LEVELS.indexOf(level) + 1] || 'C2',
  }
}
