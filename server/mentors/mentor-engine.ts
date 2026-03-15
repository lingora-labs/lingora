// ================================================
// LINGORA 10.0 — MENTOR ENGINE
// ================================================

import OpenAI from 'openai'
import { getMentorProfile } from './profiles'
import type { SessionState } from '@/lib/contracts'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const FALLBACKS: Record<string, string> = {
  es: 'Lo siento, no pude procesar tu mensaje. Intenta de nuevo.',
  en: 'Sorry, I could not process your message right now. Please try again.',
  no: 'Beklager, jeg kunne ikke behandle meldingen din. Proev igjen.',
  fr: 'Desole, je nai pas pu traiter votre message. Reessayez.',
  de: 'Entschuldigung, ich konnte Ihre Nachricht nicht verarbeiten. Versuchen Sie es erneut.',
  it: 'Mi dispiace, non ho potuto elaborare il tuo messaggio. Riprova.',
  pt: 'Desculpe, nao consegui processar sua mensagem. Tente novamente.',
}

function buildSessionContext(state: Partial<SessionState>): string {
  const parts: string[] = []
  if (state.level && state.level !== 'A0')  parts.push('- Nivel estimado: ' + state.level)
  if ((state.tokens || 0) > 0)               parts.push('- Mensajes en sesion: ' + state.tokens)
  if (state.lang)                            parts.push('- Idioma de interaccion: ' + state.lang)
  if (state.topic)                           parts.push('- Topico seleccionado: ' + state.topic)
  if (state.lastTask)                        parts.push('- Ultima tarea pedida: ' + state.lastTask)
  if (state.lastArtifact)                    parts.push('- Ultimo artefacto generado: ' + state.lastArtifact)
  if (state.samples && state.samples.length > 0) parts.push('- Muestras analizadas: ' + state.samples.length)
  return parts.length > 0
    ? '\n\nContexto de sesion activa:\n' + parts.join('\n')
    : ''
}

const NORTH_STAR = '\n\nUna regla que nunca se rompe: conservas todas las capacidades conversacionales de una IA de proposito general. No eres un sistema restringido. Eres un mentor con especialidad, no un bot con guion.'

export async function getMentorResponse(
  message: string,
  state: Partial<SessionState> = {}
): Promise<string> {
  const profile    = getMentorProfile(state.mentor)
  const context    = buildSessionContext(state)
  const systemPrompt = profile.system + context + NORTH_STAR

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Mentor timeout')), 12000)
    )
    const completion = await Promise.race([
      openai.chat.completions.create({
        model:       'gpt-4o',
        messages:    [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: String(message || '') },
        ],
        temperature: 0.82,
        top_p:       0.9,
        max_tokens:  600,
      }),
      timeout,
    ])
    return (completion.choices?.[0]?.message?.content || '').trim()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[MENTOR] Error:', msg)
    const lang = state.lang || 'en'
    return FALLBACKS[lang] || FALLBACKS.en
  }
}
