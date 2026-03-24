// ================================================
// LINGORA SEEK 3.0 — TUTOR PROTOCOL v1.2
// lib/tutorProtocol.ts
//
// Governing layer between intent detection and mentor.
// Controls: what the tutor does, when, and how.
//
// v1.2 changes (SEEK 3.0 alignment):
//   state.topic      → state.lastUserGoal ?? state.lastConcept
//   state.mentor     → state.mentorProfile
//   state.level      → state.confirmedLevel ?? state.userLevel
//   state.lang       → state.interfaceLanguage
//   state.lessonIndex→ state.currentModuleIndex
//   state.courseActive → derived from curriculumPlan presence
//   state.lastAction → state.tutorPhase (SEEK 3.0 phase tracking)
//   state.awaitingQuizAnswer → not in new contract; derived from tutorPhase === 'quiz'
// ================================================

import type { SessionState } from '@/lib/contracts'

// ─── Types ───────────────────────────────────────
export type PedagogicalAction =
  | 'guide'
  | 'lesson'
  | 'schema'
  | 'quiz'
  | 'feedback'
  | 'conversation'
  | 'illustration'
  | 'pdf'
  | 'pronunciation'

export type TutorMode =
  | 'structured'      // sarah + structured/cervantes — rigid sequence
  | 'conversational'  // alex + travel/conversation — free with scaffolding
  | 'professional'    // nick + business — scenario-based
  | 'diagnostic'      // any + leveltest — assessment mode

export type TutorPhase =
  | 'idle'
  | 'guide'
  | 'lesson'
  | 'conversation'
  | 'schema'
  | 'quiz'
  | 'feedback'

// ─── Sequence map ────────────────────────────────
const SEQUENCE: Record<TutorMode, TutorPhase[]> = {
  structured:     ['guide', 'lesson', 'schema', 'quiz', 'feedback'],
  conversational: ['guide', 'conversation', 'schema', 'quiz'],
  professional:   ['guide', 'lesson', 'quiz', 'feedback'],
  diagnostic:     ['quiz', 'feedback', 'guide'],
}

// ─── Legacy field resolvers (SEEK 3.0 compat) ────
function resolveTopic(state: Partial<SessionState>): string {
  return state.lastUserGoal ?? state.lastConcept ?? 'Spanish'
}

function resolveMentor(state: Partial<SessionState>): string {
  return state.mentorProfile ?? 'Sarah'
}

function resolveLevel(state: Partial<SessionState>): string {
  return state.confirmedLevel ?? state.userLevel ?? 'A1'
}

function resolveLang(state: Partial<SessionState>): string {
  return state.interfaceLanguage ?? 'en'
}

function resolveModuleIndex(state: Partial<SessionState>): number {
  return state.currentModuleIndex ?? 0
}

function resolveCourseActive(state: Partial<SessionState>): boolean {
  return !!state.curriculumPlan
}

function resolveAwaitingQuiz(state: Partial<SessionState>): boolean {
  // In SEEK 3.0, tutorPhase tracks position. If phase is 'quiz', we are awaiting answer.
  return state.tutorPhase === 'quiz'
}

// ─── Mode resolver ────────────────────────────────
export function resolveTutorMode(
  topic:  string | null,
  mentor: string | null
): TutorMode {
  const t = topic  ?? 'conversation'
  const m = (mentor ?? 'sarah').toLowerCase()

  if (t === 'leveltest')  return 'diagnostic'
  if (m === 'alex' || t === 'conversation' || t === 'travel') return 'conversational'
  if (m === 'nick' || t === 'business')  return 'professional'
  return 'structured'
}

// ─── Core resolver ────────────────────────────────
export function resolvePedagogicalAction(params: {
  message:  string
  state:    Partial<SessionState>
  explicit: PedagogicalAction | null
}): {
  action:           PedagogicalAction
  mode:             TutorMode
  systemDirective:  string
  nextPhase:        TutorPhase
  nextLessonIndex:  number
  nextCourseActive: boolean
} {
  const { message, state, explicit } = params

  const topic  = resolveTopic(state)
  const mentor = resolveMentor(state)

  // ── INTERACT / FREE BYPASS ────────────────────────────────────
  if (state.activeMode === 'interact' || state.activeMode === 'free') {
    const freeMode = modeToTutorMode(
      state.activeMode as 'interact' | 'free',
      topic,
      mentor
    )
    return {
      action:           'conversation',
      mode:             freeMode,
      systemDirective:  buildDirective('conversation', state),
      nextPhase:        'conversation',
      nextLessonIndex:  resolveModuleIndex(state),
      nextCourseActive: resolveCourseActive(state),
    }
  }

  // Explicit artifact requests always win
  if (explicit && explicit !== 'conversation') {
    const mode = state.activeMode
      ? modeToTutorMode(
          state.activeMode as 'interact' | 'structured' | 'pdf_course' | 'free',
          topic,
          mentor
        )
      : resolveTutorMode(topic, mentor)
    return {
      action:           explicit,
      mode,
      systemDirective:  buildDirective(explicit, state),
      nextPhase:        phaseFromAction(explicit),
      nextLessonIndex:  resolveModuleIndex(state),
      nextCourseActive: resolveCourseActive(state),
    }
  }

  const mode   = state.activeMode
    ? modeToTutorMode(
        state.activeMode as 'interact' | 'structured' | 'pdf_course' | 'free',
        topic,
        mentor
      )
    : resolveTutorMode(topic, mentor)

  const tokens         = state.tokens ?? 0
  const awaitingAnswer = resolveAwaitingQuiz(state)

  // In SEEK 3.0, tutorPhase is the authoritative phase tracker
  const lastAct = (state.tutorPhase ?? null) as PedagogicalAction | null

  if (awaitingAnswer) {
    return {
      action:           'feedback',
      mode,
      systemDirective:  buildDirective('feedback', state),
      nextPhase:        'feedback',
      nextLessonIndex:  resolveModuleIndex(state),
      nextCourseActive: resolveCourseActive(state),
    }
  }

  const currentPhase = derivePhase(lastAct, tokens, mode)
  const nextPhase    = advancePhase(currentPhase, mode, tokens, awaitingAnswer)
  const action       = actionFromPhase(nextPhase, mode)

  const completingCycle  = currentPhase === 'feedback'
  const nextLessonIndex  = completingCycle
    ? resolveModuleIndex(state) + 1
    : resolveModuleIndex(state)

  return {
    action,
    mode,
    systemDirective:  buildDirective(action, state),
    nextPhase,
    nextLessonIndex,
    nextCourseActive: true,
  }
}

// ─── Phase derivation ─────────────────────────────
function derivePhase(
  lastAction: PedagogicalAction | null,
  tokens:     number,
  mode:       TutorMode
): TutorPhase {
  if (!lastAction || tokens === 0) return 'idle'
  const map: Partial<Record<PedagogicalAction, TutorPhase>> = {
    guide:         'guide',
    lesson:        'lesson',
    schema:        'schema',
    quiz:          'quiz',
    feedback:      'feedback',
    conversation:  'conversation',
    illustration:  'lesson',
    pdf:           'lesson',
    pronunciation: 'lesson',
  }
  return map[lastAction] ?? 'lesson'
}

function advancePhase(
  current:        TutorPhase,
  mode:           TutorMode,
  tokens:         number,
  awaitingAnswer: boolean
): TutorPhase {
  const seq = SEQUENCE[mode]

  if (tokens === 0 || current === 'idle') return 'guide'
  if (current === 'quiz' && awaitingAnswer) return 'quiz'

  const idx = seq.indexOf(current)
  if (idx === -1) return seq[0]

  const nextIdx = (idx + 1) % seq.length
  const next    = seq[nextIdx]
  if (next === 'guide' && tokens > 2) return seq[1] ?? seq[0]
  return next
}

function phaseFromAction(action: PedagogicalAction): TutorPhase {
  const map: Partial<Record<PedagogicalAction, TutorPhase>> = {
    guide: 'guide', lesson: 'lesson', schema: 'schema',
    quiz: 'quiz', feedback: 'feedback', conversation: 'conversation',
    illustration: 'lesson',
    pdf:          'lesson',
    pronunciation: 'lesson',
  }
  return map[action] ?? 'idle'
}

function actionFromPhase(phase: TutorPhase, mode: TutorMode): PedagogicalAction {
  if (phase === 'idle')   return 'guide'
  if (phase === 'lesson' && mode === 'conversational') return 'conversation'
  return phase as PedagogicalAction
}

// ─── Directive builder ────────────────────────────
function buildDirective(
  action: PedagogicalAction,
  state:  Partial<SessionState>
): string {
  // All field access via SEEK 3.0 resolvers — no legacy fields
  const topic  = resolveTopic(state)
  const level  = resolveLevel(state)
  const lang   = resolveLang(state)
  const mentor = resolveMentor(state).toLowerCase()
  const tokens = state.tokens   ?? 0
  const lesson = resolveModuleIndex(state)

  const base = `TUTOR DIRECTIVE — You are a structured language tutor, not a general assistant.
Topic: ${topic}. CEFR Level: ${level}. Student language: ${lang}. Mentor persona: ${mentor}.
Session exchanges: ${tokens}. Lesson: ${lesson + 1}. Respond in student language (${lang}) unless content must be in Spanish.`

  const directives: Record<PedagogicalAction, string> = {

    guide: `${base}

ACTION: GUIDE
This is the start of the session or a topic change.
DO NOT ask "what do you want to learn?" — you already know the topic is: ${topic}.
DO:
1. Introduce the topic in 1-2 sentences.
2. State concretely what the student will be able to do after this session.
3. Ask ONE specific opening question to assess their starting point.
BAD: "What would you like to work on today?"
GOOD: "Today we're looking at ${topic}. Before we start — when would you use the present perfect instead of the simple past? Give me your instinct."`,

    lesson: `${base}

ACTION: LESSON (Lesson ${lesson + 1})
Teach ONE focused concept about: ${topic}.
Structure:
1. Core explanation — 3 sentences maximum. No padding.
2. Two concrete examples in Spanish (with ${lang} translation if level ≤ A2).
3. End with a micro-practice: ask the student to produce ONE sentence using this concept.
Do not explain everything at once. Focused depth beats wide coverage.`,

    schema: `${base}

ACTION: SCHEMA INTRODUCTION
The system is generating a visual schema for: ${topic}.
Your role: one sentence introducing what the schema covers, then ask the student which part they find least intuitive.
Example: "Here's the full picture of ${topic}. Look it over — which row or concept feels least clear to you?"`,

    quiz: `${base}

ACTION: QUIZ
Generate ONE exam-style question about: ${topic} at level ${level}.
Format:
- Clear question in Spanish
- 4 options (A, B, C, D)
- Only one correct answer
- Wrong answers must be plausible (not obviously incorrect)
Present the question and wait. DO NOT give the answer yet. The system renders the quiz visually.`,

    feedback: `${base}

ACTION: FEEDBACK
The student just answered a quiz or practice question.
1. State clearly if they were correct or not ("Correct." / "Not quite.").
2. Explain the correct answer in 2-3 sentences — why it is right.
3. Explain what makes the wrong answer wrong (if applicable).
4. One memory tip or rule of thumb.
5. Transition: "Ready for the next one?" or move to the next phase naturally.`,

    conversation: `${base}

ACTION: CONVERSATION WITH CORRECTION
Engage naturally on: ${topic}.
Rules:
— Respond to what the student actually said, not to a generic topic prompt.
— Inline corrections only: "You said X — the natural way is Y because Z." Keep corrections brief.
— Every 3-4 turns, introduce one new useful expression or vocabulary item naturally.
— Do not lecture. React. Ask follow-up questions.`,

    pronunciation: `${base}

ACTION: PRONUNCIATION GUIDANCE
Guide the student on the specific sound, word, or phrase they asked about.
1. Describe the physical production of the sound (mouth, tongue, breath).
2. Connect it to a similar sound in ${lang} if one exists.
3. List 2-3 example words with the same sound.
The system will generate audio — focus your response on the written explanation.`,

    illustration: `${base}

ACTION: ILLUSTRATION CONTEXT
The system is generating a visual illustration.
Your role: one sentence explaining what the image will depict and why it's pedagogically relevant to ${topic}.`,

    pdf: `${base}

ACTION: PDF DOCUMENT
The system is generating a PDF study guide.
Your role: confirm in 2 sentences what the PDF covers and how the student should use it for review.`,
  }

  return directives[action] ?? directives.conversation
}

// ─── Mode instruction ─────────────────────────────
export function getModeInstruction(mode: TutorMode, topic: string | null): string {
  const map: Record<TutorMode, string> = {
    structured: `\n\nMODE: STRUCTURED TUTORING (${topic ?? 'Spanish'})
Follow the pedagogical sequence: guide → lesson → schema → quiz → feedback.
Do not skip steps. Do not blend phases in one response.
If the student goes off-topic, redirect once, then continue the sequence.
Tone: professional, warm, university-tutor level. Never chatbot-casual.`,

    conversational: `\n\nMODE: CONVERSATIONAL IMMERSION (${topic ?? 'Spanish'})
Prioritize natural conversation over explicit teaching.
Grammar correction is inline and brief — never interrupt the flow for more than one sentence.
Introduce vocabulary naturally through the conversation, never as a standalone list.
Cultural anecdotes and real-world context are valued over grammar explanation.`,

    professional: `\n\nMODE: PROFESSIONAL SPANISH (${topic ?? 'Spanish'})
Every interaction is grounded in a realistic workplace scenario.
Use formal register. Correct informal language immediately but constructively.
Structure: situation → relevant vocabulary → practice → correction.
Example contexts: job interview, board meeting, email draft, salary negotiation.`,

    diagnostic: `\n\nMODE: LEVEL DIAGNOSTIC
Goal: assess the student's CEFR level accurately over 8-10 exchanges.
Ask progressively harder questions. Start at A2, escalate if responses are strong.
Do not reveal the assessment during the conversation.
Cover: grammar usage, vocabulary range, comprehension, and spontaneous production quality.
At the end, provide a clear CEFR estimate with brief justification.`,
  }
  return map[mode] ?? ''
}

// ─── Prohibitions ─────────────────────────────────
export const TUTOR_PROHIBITIONS = `

PROHIBITED BEHAVIORS (absolute — never do these):
— Do not ask "What would you like to learn?" when topic is already set.
— Do not ask "How can I help you?" in an active tutoring session.
— Do not restart context when the student changes subject — redirect once, then continue.
— Do not generate a PDF unless explicitly requested by the student.
— Do not generate an image unless explicitly requested by the student.
— Do not blend multiple phases (lesson + quiz + feedback) in a single response.
— Do not act as a general-purpose AI assistant — you have a specific tutoring role.
— Do not give the quiz answer before the student responds.`

// ─── Mode-aware helpers ───────────────────────────
export function modeToTutorMode(
  activeMode: 'interact' | 'structured' | 'pdf_course' | 'free' | null | undefined,
  topic:  string | null,
  mentor: string | null
): TutorMode {
  if (activeMode === 'structured' || activeMode === 'pdf_course') return 'structured'
  if (activeMode === 'free') return 'conversational'
  return resolveTutorMode(topic, mentor)
}

export function initialStage(
  _activeMode: 'interact' | 'structured' | 'pdf_course' | 'free' | null | undefined
): LearningStage {
  return 'schema'
}

export function nextStage(current: LearningStage): LearningStage {
  const seq: LearningStage[] = ['diagnosis', 'schema', 'examples', 'quiz', 'score', 'next']
  const idx = seq.indexOf(current)
  if (idx === -1 || idx >= seq.length - 1) return 'schema'
  return seq[idx + 1]
}

export type LearningStage = 'diagnosis' | 'schema' | 'examples' | 'quiz' | 'score' | 'next'
