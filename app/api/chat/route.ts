// ================================================
// FILE: app/api/chat/route.ts
// LINGORA 10.2 — ROUTER (FIXED)
// - Fix 1: messageIs* declared before use
// - Fix 2: nextState not used before init (use enrichedState)
// - Fix 3: level diagnostic input corrected
// ================================================

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

import { detectIntent }                        from '@/server/core/intent-detector'
import { commercialEngine, commercialDebug }   from '@/server/core/commercial-engine'
import { evaluateLevel }                       from '@/server/core/diagnostics'
import { getMentorResponse }                   from '@/server/mentors/mentor-engine'
import { getRagContext, getRagStats }          from '@/server/knowledge/rag'
import { generateSchemaContent }               from '@/server/tools/schema-generator'
import { generateImage }                       from '@/server/tools/image-generator'
import { generatePDF }                         from '@/server/tools/pdf-generator'
import { generateSpeech, evaluatePronunciation, transcribeAudio } from '@/server/tools/audio-toolkit'
import { processAttachment }                   from '@/server/tools/attachment-processor'
import {
  resolvePedagogicalAction,
  resolveTutorMode,
  type PedagogicalAction,
} from '@/lib/tutorProtocol'
import type {
  MessagePayload, ChatResponse, SessionState,
  ArtifactPayload, AudioArtifact, QuizArtifact, QuizItem,
  TableArtifact, TableContent,
  TableMatrixArtifact, TableMatrixContent,
  SchemaProArtifact, SchemaProContent,
} from '@/lib/contracts'

export const runtime     = 'nodejs'
export const maxDuration = 30

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function ok(body: ChatResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-LINGORA': 'v10.2' },
  })
}

function audioArtifact(url: string): AudioArtifact {
  return { type: 'audio', url, method: url.startsWith('data:') ? 'dataurl' : 's3' }
}

function intentToAction(intentType: string): PedagogicalAction | null {
  const map: Partial<Record<string, PedagogicalAction>> = {
    schema:        'schema',
    table:         'schema',
    illustration:  'illustration',
    pdf:           'pdf',
    pronunciation: 'pronunciation',
  }
  return map[intentType] ?? null
}

// ───────────────────────────────────────────────
// QUIZ GENERATOR (JSON enforced)
// ───────────────────────────────────────────────
async function generateQuizContent(
  message: string,
  state: Partial<SessionState>
): Promise<QuizArtifact | null> {

  const level = state.level ?? 'A1'
  const topic = state.topic ?? 'Spanish'
  const lang  = state.lang  ?? 'en'

  const prompt = `Return ONLY JSON.
{
 "title":"...",
 "questions":[
   {"question":"...?",
    "options":["A","B","C","D"],
    "correct":0,
    "explanation":"..."}
 ]
}`

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: `${prompt}\n${message}` }],
      response_format: { type: 'json_object' },
    })

    const parsed = JSON.parse(res.choices?.[0]?.message?.content ?? '')
    if (!parsed.questions?.length) return null

    return {
      type: 'quiz',
      content: {
        title: parsed.title ?? `Quiz: ${topic}`,
        topic,
        level,
        questions: [parsed.questions[0]],
      },
    }
  } catch {
    return null
  }
}

// ───────────────────────────────────────────────
// TABLE DETECTORS
// ───────────────────────────────────────────────
function isTableRequest(m: string) {
  return /tabla|table|compar|conjug/i.test(m)
}
function isMatrixRequest(m: string) {
  return /matriz|audit|riesgos/i.test(m)
}
function isSchemaProRequest(m: string) {
  return /esquema|mapa conceptual/i.test(m)
}
function isQuizRequest(m: string) {
  return /quiz|test|simulacro/i.test(m)
}
function isLevelRequest(m: string) {
  return /nivel|level|califica/i.test(m)
}

// ───────────────────────────────────────────────
// MAIN ROUTE
// ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body: MessagePayload = await req.json()
    const { message, state = {} } = body

    const tutorMode = resolveTutorMode(state.topic ?? null, state.mentor ?? null)
    const enrichedState = { ...state, tutorMode }

    // ── Intent + FIXED DETECTORS ─────────────────
    const intent   = detectIntent(message ?? '')
    const explicit = intentToAction(intent.type)

    const messageIsTable     = isTableRequest(message ?? '')
    const messageIsMatrix    = isMatrixRequest(message ?? '')
    const messageIsSchemaPro = isSchemaProRequest(message ?? '')
    const messageIsQuiz      = isQuizRequest(message ?? '')
    const messageIsLevel     = isLevelRequest(message ?? '')

    // ── LEVEL OVERRIDE FIXED ─────────────────────
    if (messageIsLevel) {
      const report = evaluateLevel(state.samples ?? [])
      return ok({ message: '', diagnostic: report, state: enrichedState })
    }

    // ── QUIZ OVERRIDE FIXED ──────────────────────
    if (messageIsQuiz) {
      const quizArtifact = await generateQuizContent(message ?? '', enrichedState)

      const nextState = {
        ...enrichedState,
        lastAction: 'feedback' as PedagogicalAction,
        tutorPhase: 'feedback',
        tokens: (enrichedState.tokens ?? 0) + 1,
      }

      if (quizArtifact) {
        return ok({
          message: quizArtifact.content.title,
          artifact: quizArtifact,
          state: nextState,
        })
      }
    }

    // ── PROTOCOL ─────────────────────────────────
    const {
      action, systemDirective, nextPhase,
      nextLessonIndex, nextCourseActive,
    } = resolvePedagogicalAction({
      message: message ?? '',
      state: enrichedState,
      explicit,
    })

    let nextState: Partial<SessionState> = {
      ...enrichedState,
      tutorMode,
      tutorPhase: nextPhase,
      lastAction: action,
      lessonIndex: nextLessonIndex,
      courseActive: nextCourseActive,
    }

    // ── SCHEMA ───────────────────────────────────
    if (action === 'schema') {
      const schemaContent = await generateSchemaContent({
        topic: message ?? '',
        level: nextState.level ?? 'A1',
        uiLanguage: nextState.lang ?? 'en',
      })

      return ok({
        message: 'Schema listo',
        artifact: { type: 'schema', content: schemaContent },
        state: nextState,
      })
    }

    // ── DEFAULT CONVERSATION ─────────────────────
    const mentorResponse = await getMentorResponse(message ?? '', nextState, systemDirective)

    nextState = {
      ...nextState,
      tokens: (nextState.tokens ?? 0) + 1,
    }

    return ok({
      message: mentorResponse ?? 'OK',
      state: nextState,
    })

  } catch (err: any) {
    return ok({ message: 'Error interno', error: err.message }, 500)
  }
}
