// ================================================
// LINGORA 10.2 — MENTOR ENGINE v1.1
// NORTH_STAR removed — mentor is governed, not free.
// tutorPhase and courseActive now in context.
// ================================================

import OpenAI from 'openai'
import { getMentorProfile }           from './profiles'
import { getModeInstruction, TUTOR_PROHIBITIONS } from '@/lib/tutorProtocol'
import type { SessionState }          from '@/lib/contracts'
import type { TutorMode }             from '@/lib/tutorProtocol'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const FALLBACKS: Record<string, string> = {
  es: 'No pude procesar tu mensaje. Intenta de nuevo.',
  en: 'Could not process your message. Please try again.',
  no: 'Kunne ikke behandle meldingen din. Prøv igjen.',
  fr: 'Je n\'ai pas pu traiter votre message. Réessayez.',
  de: 'Konnte Ihre Nachricht nicht verarbeiten. Versuchen Sie es erneut.',
  it: 'Non ho potuto elaborare il tuo messaggio. Riprova.',
  pt: 'Não consegui processar sua mensagem. Tente novamente.',
  ar: 'لم أتمكن من معالجة رسالتك. يرجى المحاولة مرة أخرى.',
  ja: 'メッセージを処理できませんでした。もう一度お試しください。',
  zh: '无法处理您的消息。请重试。',
}

function buildContext(state: Partial<SessionState>): string {
  const parts: string[] = []

  if (state.level && state.level !== 'A0')  parts.push(`Level: ${state.level}`)
  if ((state.tokens ?? 0) > 0)              parts.push(`Exchanges: ${state.tokens}`)
  if (state.topic)                          parts.push(`Topic: ${state.topic}`)
  if (state.lang)                           parts.push(`Student language: ${state.lang}`)
  if (state.lastAction)                     parts.push(`Last action: ${state.lastAction}`)
  if (state.lessonIndex && state.lessonIndex > 0) parts.push(`Lesson index: ${state.lessonIndex}`)

  // Tutor protocol state — critical for consistent behavior
  if (state.tutorPhase)                     parts.push(`Current phase: ${state.tutorPhase}`)
  if (state.courseActive !== undefined)     parts.push(`Course active: ${state.courseActive}`)
  if (state.awaitingQuizAnswer)             parts.push(`Awaiting quiz answer: true`)
  if ((state.samples ?? []).length > 0)     parts.push(`Student samples collected: ${state.samples!.length}`)

  return parts.length > 0
    ? '\n\n[Session state: ' + parts.join(' · ') + ']'
    : ''
}

export async function getMentorResponse(
  message:          string,
  state:            Partial<SessionState> = {},
  systemDirective?: string
): Promise<string> {
  const profile  = getMentorProfile(state.mentor)
  const mode     = (state.tutorMode ?? 'conversational') as TutorMode
  const context  = buildContext(state)
  const modeInstructions = getModeInstruction(mode, state.topic ?? null)

  // System prompt composition:
  // 1. Mentor personality (who they are — from profiles.ts)
  // 2. Mode instructions (how they behave in this context)
  // 3. Action directive (what to do right now — from tutorProtocol)
  // 4. Prohibitions (what to never do)
  // 5. Session context (current state)
  const systemPrompt = [
    profile.system,
    modeInstructions,
    systemDirective ? `\n\n${systemDirective}` : '',
    TUTOR_PROHIBITIONS,
    context,
  ].filter(Boolean).join('')

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Mentor timeout')), 14000)
    )
    const completion = await Promise.race([
      openai.chat.completions.create({
        model:       'gpt-4o',
        messages:    [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: String(message || '') },
        ],
        temperature: 0.7,    // Reduced from 0.82 for more consistent tutoring behavior
        top_p:       0.88,
        max_tokens:  650,
      }),
      timeout,
    ])
    return (completion.choices?.[0]?.message?.content ?? '').trim()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[MENTOR] Error:', msg)
    const lang = state.lang ?? 'en'
    return FALLBACKS[lang] ?? FALLBACKS.en
  }
}
