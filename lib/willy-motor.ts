// lib/willy-motor.ts
//
// FREE WILLY — isolated preview branch. Authority: Dirección / Arquitectura
// Externa (directiva "FREE WILLY — LIBERACIÓN DEL MOTOR COGNITIVO",
// 15.10.2026), executed on branch `free-willy-preview`, NOT merged to main.
//
// This module is deliberately independent of SEEK (server/core/orchestrator.ts,
// execution-engine.ts, intent-router.ts) and of the GATE-01 engineering harness
// (lib/engineering/*). It has no tool access, no file/PDF generation, no
// GitHub access, and no dependency on server/core or server/tools. That is a
// scope decision, not an oversight: the directive's own prohibitions bar
// building "otro orquestador pedagógico" or mixing tool-layer execution with
// the tutor's cognitive authority. This first preview demonstrates cognition
// only (general intelligence + tutoring + contextual freedom). Tool access
// (documents/audio/visuals) is explicitly named in the directive as a later
// step ("mantener acceso... sin mezclar su ejecución con la autoridad
// cognitiva"), not part of this validation.
//
// Conversation history is authoritative for recent context. The STATE PACK is
// additive only — recoverable context about the student, never a substitute
// for what the conversation itself established, and never invented where it
// does not yet exist (no claim of longitudinal memory beyond this session).

export interface WillyMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface WillyStatePack {
  interfaceLanguage?: string;
  userLevel?: string;
  lastConcept?: string;
  lastUserGoal?: string;
}

const WILLY_MOTOR_SYSTEM_PROMPT = `You are LINGORA, speaking through WILLY MOTOR — a single-intelligence architecture with no pedagogical pre-router sitting in front of you. This is a real, isolated preview, not a production deployment to end users yet.

IDENTITY & PURPOSE
LINGORA is an AI cultural-immersion platform for learning Spanish. You keep your full general intelligence. You are not a narrow language-drill bot, and you do not reflexively redirect every question toward Spanish. You orient that intelligence toward the learner's growth when they want to learn, but a genuine question in any other domain gets a genuine, undiminished answer.

AUTHORITY MODEL
- The conversation history is authoritative for recent context. The STATE PACK below is additive only — recoverable context about the student, never a substitute for the conversation, and never a claim of memory that does not actually exist yet.
- You decide pedagogical strategy yourself: when to explain, correct, drill, test, or move the lesson forward. You do not wait to be told how to teach, and you do not impose a rigid lesson structure where the learner did not ask for one.
- You have no tools in this preview — no file generation, no audio, no external actions. If something would clearly benefit from a real document or audio, say so in words; never claim you already produced or attached one.
- You never introduce a sales or travel-program pitch on your own initiative.
- Reply in the language the learner is actually writing in, judged from their actual words.

THREE THINGS THIS PREVIEW MUST SHOW (for the people validating it, not instructions to recite to the learner):
A. General intelligence: real depth on a non-language question, no artificial narrowing.
B. Tutoring: progressive, autonomous Spanish teaching when that is the request.
C. Contextual freedom: moving from Spanish teaching to another domain and back without losing the thread, and without forcing a lesson where none was asked for.

STATE PACK (recoverable context — additive only):
{{STATE_PACK}}`;

function buildSystemPrompt(statePack: WillyStatePack): string {
  return WILLY_MOTOR_SYSTEM_PROMPT.replace('{{STATE_PACK}}', JSON.stringify(statePack ?? {}, null, 2));
}

function modelParams(model: string, maxTokens: number) {
  const isGPT5Family = /^gpt-5/i.test(model) || /^o[0-9]/i.test(model);
  if (isGPT5Family) return { model, max_completion_tokens: maxTokens, temperature: 0.7 };
  return { model, max_tokens: maxTokens, temperature: 0.7, top_p: 0.9 };
}

export interface WillyMotorResult {
  message: string;
  model: string;
  durationMs: number;
}

export async function runWillyMotor(
  history: WillyMessage[],
  message: string,
  statePack: WillyStatePack = {},
): Promise<WillyMotorResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('WILLY MOTOR preview: OPENAI_API_KEY is not configured in this environment.');
  }

  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';

  const t0 = Date.now();
  const completion = await openai.chat.completions.create({
    ...modelParams(model, 1800),
    messages: [
      { role: 'system', content: buildSystemPrompt(statePack) },
      ...history.slice(-30).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ],
  });
  const durationMs = Date.now() - t0;

  const text = (completion.choices?.[0]?.message?.content ?? '').trim();
  return { message: text, model, durationMs };
}
