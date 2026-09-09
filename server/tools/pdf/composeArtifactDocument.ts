// =============================================================================
// server/tools/pdf/composeArtifactDocument.ts
// SEEK 5.0 P9 — structures ALREADY-TAUGHT content into DocumentBlock[] so it
// can be rendered by the existing rich pipeline (renderCoursePdf). Does NOT
// generate new pedagogical content, does NOT decide domain complexity — the
// mentor already decided that when it taught. This is organization only.
//
// SEEK 5.0 P9b — SUBJECT CONTENT ISOLATION.
// Root gap: the caller used to pass a blind text.slice(start, start+6000)
// excerpt per subject. For a compound act with 2 subjects, that window
// sometimes captured cross-turn meta text (opening "voy a hacerlo en...")
// instead of the actual subject content, and sometimes bled into the
// neighboring subject's material.
// Fix: pass the FULL taught text (not a slice) plus the list of the OTHER
// subjects taught in the same turn. The composer is instructed to select and
// structure ONLY the portion belonging to ITS subject, and explicitly to
// exclude turn-level meta text and any content belonging to the other named
// subjects. This is a materialization-layer decision (which slice of
// already-taught text belongs to this artifact) — not a pedagogical one
// (what to teach). No domain names are hardcoded; subjects and otherSubjects
// are always caller-supplied strings.
// =============================================================================
import type { DocumentContent, DocumentBlock, DocumentBlockType } from './generateCoursePdf'

const VALID_BLOCK_TYPES = new Set<DocumentBlockType>([
  'heading', 'paragraph', 'bullets', 'numbered', 'table', 'callout', 'quote',
  'divider', 'key_value', 'exercise', 'answer_key', 'case', 'timeline',
  'comparison', 'framework', 'glossary', 'index', 'summary',
])

// Full taught text can legitimately run long for a rich compound act.
// This is a safety ceiling against runaway input, not a content-selection
// mechanism — the composer itself decides what belongs to its subject.
const MAX_FULL_CONTENT_CHARS = 24000

export interface ComposeParams {
  subject: string
  fullContent: string
  otherSubjects: string[]
  mentorName: string
  level?: string
  nativeLanguage?: string
}

export type ComposeResult =
  | { ok: true; content: DocumentContent }
  | { ok: false; reason: string }

export async function composeDocumentFromTaught(params: ComposeParams): Promise<ComposeResult> {
  if (!params.fullContent?.trim()) return { ok: false, reason: 'empty_body' }

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const { buildModelParams } = await import('../../mentors/mentor-engine')
    const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini'

    const boundedContent = params.fullContent.slice(0, MAX_FULL_CONTENT_CHARS)
    const otherSubjectsLine = params.otherSubjects.length > 0
      ? params.otherSubjects.map((s) => `"${s}"`).join(', ')
      : '(none — this was the only subject taught in this turn)'

    const systemPrompt = `You structure already-taught pedagogical content into a JSON document for PDF rendering. The text you receive is the FULL turn as taught, which may cover more than one subject. Your first job is ISOLATION: select only the portion that genuinely belongs to your assigned subject. Your second job is STRUCTURING: organize that portion into clear blocks.

Isolation rules:
- Exclude turn-level framing text (e.g. "I will do this in the order you asked", opening/closing summaries that talk ABOUT the plan rather than teaching content).
- Exclude any content that belongs to the other subjects listed below — do not summarize them, do not reference them, do not include their exercises or examples.
- Exclude a closing activity/exercise unless it is specifically about YOUR subject, not a different one.
- If the source text has a clear section (e.g. under a heading) dedicated to your subject, treat that as your primary source.

Structuring rules:
- Do not invent new content. Do not change complexity, register, or level — that was already decided correctly by the tutor when it taught. Do not simplify or infantilize.
- Organize into clear blocks: headings, paragraphs, tables where the content is naturally tabular, bullet or numbered lists where appropriate, and one exercise block if practice material specific to YOUR subject is present.
- If almost nothing in the text belongs to your subject, it is correct to produce a shorter document rather than padding it with unrelated content.

Respond with valid JSON only — no markdown, no preamble.`

    const userPrompt = `Your assigned subject: "${params.subject}"

Other subjects taught in the SAME turn (their content does not belong to you — exclude it): ${otherSubjectsLine}

Full taught text for this turn:
"""
${boundedContent}
"""

Return ONLY this JSON:
{
  "title": "string - specific to \"${params.subject}\", not generic",
  "subtitle": "string or null",
  "documentType": "string (e.g. leccion, guia, resumen tematico)",
  "blocks": [
    {"type":"heading","level":1,"content":"Section title"},
    {"type":"paragraph","content":"Prose text..."},
    {"type":"table","headers":["Col A","Col B"],"rows":[["a1","b1"]]},
    {"type":"bullets","items":["item one","item two"]},
    {"type":"exercise","label":"Practica","content":"..."}
  ],
  "nextStep": "string"
}`

    const completion = await openai.chat.completions.create({
      ...buildModelParams(RUNTIME_MODEL, 4500, 0.3),
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
      label: typeof b.label === 'string' ? b.label : undefined,
      style: typeof b.style === 'string' ? (b.style as DocumentBlock['style']) : undefined,
      items: Array.isArray(b.items) ? (b.items as unknown[]).map(String) : undefined,
      headers: Array.isArray(b.headers) ? (b.headers as unknown[]).map(String) : undefined,
      rows: Array.isArray(b.rows) ? (b.rows as string[][]) : undefined,
    }))

    const hasContent = blocks.length >= 2 && blocks.some((b) => (b.type === 'heading' || b.type === 'paragraph') && !!b.content)
    if (!hasContent) return { ok: false, reason: `insufficient_content_blocks:${blocks.length}` }

    return {
      ok: true,
      content: {
        title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : `LINGORA — ${params.subject}`,
        subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : undefined,
        documentType: typeof parsed.documentType === 'string' ? parsed.documentType : 'documento',
        level: params.level,
        mentorName: params.mentorName,
        nativeLanguage: params.nativeLanguage,
        studentName: 'Estudiante',
        blocks,
        nextStep: typeof parsed.nextStep === 'string' ? parsed.nextStep : '',
        generatedAt: new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }),
      },
    }
  } catch (e) {
    return { ok: false, reason: `exception:${e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160)}` }
  }
}
