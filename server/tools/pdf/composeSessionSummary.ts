// =============================================================================
// server/tools/pdf/composeSessionSummary.ts
// SEEK 5.0 P17 Defect 3 — SESSION EXPORT AS A STUDY-READY RECORD.
// Root gap: "Export session as PDF" called generatePDF({content: rawText})
// with no courseContent, which routed to generatePlainTextPdf() — a flat
// dump that hard-slices every line to 88 chars (mid-word truncation) and
// has no content hierarchy. Confirmed empirically on a real production PDF
// (P17 audit): "keep it ", "**es", "médic" cut mid-word, footer section cut
// off entirely for lack of page space.
// Fix: reuse the SAME structuring pattern already proven for artifacts
// (composeArtifactDocument.ts, P9) — one LLM call turns the raw transcript
// into DocumentBlock[] (key concepts, corrections, vocabulary, next step),
// rendered through the SAME renderCoursePdf() pipeline already hardened
// against truncation (P12-A/B: real wrap, dynamic row height, page breaks).
// No new PDF engine. If composition fails, the caller falls back to the
// prior flat-text path — never worse than the pre-P17 baseline.
// =============================================================================
import type { DocumentContent, DocumentBlock, DocumentBlockType } from './generateCoursePdf'

const VALID_BLOCK_TYPES = new Set<DocumentBlockType>([
  'heading', 'paragraph', 'bullets', 'numbered', 'table', 'callout', 'quote',
  'divider', 'key_value', 'exercise', 'answer_key', 'case', 'timeline',
  'comparison', 'framework', 'glossary', 'index', 'summary',
])

const MAX_TRANSCRIPT_CHARS = 24000

export interface ComposeSessionSummaryParams {
  transcript: string
  mentorName: string
  level?: string
  interfaceLanguage?: string
  turnCount: number
  dateStr: string
}

export type ComposeSessionSummaryResult =
  | { ok: true; content: DocumentContent }
  | { ok: false; reason: string }

export async function composeSessionSummary(params: ComposeSessionSummaryParams): Promise<ComposeSessionSummaryResult> {
  if (!params.transcript?.trim()) return { ok: false, reason: 'empty_transcript' }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const { buildModelParams } = await import('../../mentors/mentor-engine')
    const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini'

    const bounded = params.transcript.slice(0, MAX_TRANSCRIPT_CHARS)

    const systemPrompt = `You turn a raw LINGORA tutoring session transcript into a structured, learner-ready study record — not a transcript copy.

Read the whole transcript first. Then produce:
- a specific title naming the actual topic(s) covered (not "Session Summary")
- what the student was working on / their goal, in one or two sentences
- the key concepts actually taught, as a real explanation each (not just a word)
- any corrections the tutor made to the student's actual output, framed as "you wrote X, natural form is Y, because Z" — only include real corrections that appear in the transcript, never invent one
- useful vocabulary/phrases worth keeping, as a table (term / meaning or usage)
- materials mentioned as generated during the session, if any are referenced in the transcript
- one concrete next step

Do not invent content that is not supported by the transcript. Do not pad. If a section has nothing real to report (e.g. no corrections happened), omit that block entirely rather than writing a placeholder.

Respond with valid JSON only — no markdown, no preamble.`

    const userPrompt = `Session transcript ([Student] and [SARAH] turns):
"""
${bounded}
"""

Return ONLY this JSON:
{
  "title": "string - names the actual topic(s), specific",
  "subtitle": "string or null - the student's stated goal, if any appeared",
  "documentType": "one of: lesson, study_guide, course, worksheet, reference, assessment, learning_plan",
  "blocks": [
    {"type":"heading","level":1,"content":"Section title"},
    {"type":"paragraph","content":"Prose text..."},
    {"type":"bullets","items":["item one","item two"]},
    {"type":"table","headers":["Col A","Col B"],"rows":[["a1","b1"]]},
    {"type":"key_value","items":["clave: valor"]}
  ],
  "nextStep": "string"
}`

    const completion = await openai.chat.completions.create({
      ...buildModelParams(RUNTIME_MODEL, 3500, 0.3),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })

    const raw = completion.choices?.[0]?.message?.content ?? ''
    if (!raw.trim()) return { ok: false, reason: 'empty_completion' }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch (parseErr) {
      return { ok: false, reason: `json_parse_failed:${parseErr instanceof Error ? parseErr.message.slice(0, 120) : 'unknown'}` }
    }

    const rawBlocks = Array.isArray(parsed.blocks) ? (parsed.blocks as Array<Record<string, unknown>>) : []
    if (rawBlocks.length === 0) return { ok: false, reason: 'no_blocks_in_response' }

    const blocks: DocumentBlock[] = rawBlocks.map((b) => ({
      type: (typeof b.type === 'string' && VALID_BLOCK_TYPES.has(b.type as DocumentBlockType) ? b.type : 'paragraph') as DocumentBlockType,
      level: typeof b.level === 'number' ? (b.level as 1 | 2 | 3) : undefined,
      content: typeof b.content === 'string' ? b.content : undefined,
      items: Array.isArray(b.items) ? (b.items as unknown[]).map(String) : undefined,
      headers: Array.isArray(b.headers) ? (b.headers as unknown[]).map(String) : undefined,
      rows: Array.isArray(b.rows) ? (b.rows as string[][]) : undefined,
    }))

    const hasContent = blocks.some((b) => (b.type === 'heading' || b.type === 'paragraph') && !!b.content)
    if (!hasContent) return { ok: false, reason: `insufficient_content_blocks:${blocks.length}` }

    return {
      ok: true,
      content: {
        title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : `LINGORA — Sesión del ${params.dateStr}`,
        subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : undefined,
        // P17 Defect 3 — never show a bare "N/A": if no level has actually
        // been diagnosed/confirmed, say so honestly instead of inventing one.
        documentType: 'study_guide',
        level: params.level ?? 'Nivel aún no confirmado',
        mentorName: params.mentorName,
        nativeLanguage: params.interfaceLanguage,
        studentName: 'Estudiante',
        blocks,
        nextStep: typeof parsed.nextStep === 'string' ? parsed.nextStep : '',
        generatedAt: params.dateStr,
      },
    }
  } catch (e) {
    return { ok: false, reason: `exception:${e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160)}` }
  }
}
