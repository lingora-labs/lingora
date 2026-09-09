// =============================================================================
// server/tools/pdf/composeArtifactDocument.ts
// SEEK 5.0 P9 — structures ALREADY-TAUGHT content into DocumentBlock[] so it
// can be rendered by the existing rich pipeline (renderCoursePdf). Does NOT
// generate new pedagogical content, does NOT decide domain complexity — the
// mentor already decided that when it taught. This is organization only.
// Falls back to null on any failure; caller falls back to the plain-text path.
// =============================================================================
import type { DocumentContent, DocumentBlock, DocumentBlockType } from './generateCoursePdf'

const VALID_BLOCK_TYPES = new Set<DocumentBlockType>([
  'heading', 'paragraph', 'bullets', 'numbered', 'table', 'callout', 'quote',
  'divider', 'key_value', 'exercise', 'answer_key', 'case', 'timeline',
  'comparison', 'framework', 'glossary', 'index', 'summary',
])

export interface ComposeParams {
  subject: string
  body: string
  mentorName: string
  level?: string
  nativeLanguage?: string
}

export async function composeDocumentFromTaught(params: ComposeParams): Promise<DocumentContent | null> {
  if (!params.body?.trim()) return null

  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const { buildModelParams } = await import('../../mentors/mentor-engine')
    const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini'

    const systemPrompt = `You structure already-taught pedagogical content into a JSON document for PDF rendering. You do not invent new content. You do not change its complexity, register, or level — that was already decided correctly by the tutor when it taught. You do not simplify or infantilize. You organize what was already written into clear blocks: headings, paragraphs, tables where the content is naturally tabular, bullet or numbered lists where appropriate, and one exercise block if practice material is present in the source text. Respond with valid JSON only — no markdown, no preamble.`

    const userPrompt = `Subject: "${params.subject}"

Already-taught content to structure (organize it, do not rewrite its substance or simplify it):
"""
${params.body}
"""

Return ONLY this JSON:
{
  "title": "string - specific to this subject, not generic",
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
      ...buildModelParams(RUNTIME_MODEL, 4000, 0.3),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })

    const raw = completion.choices?.[0]?.message?.content ?? ''
    if (!raw.trim()) return null

    const parsed = JSON.parse(raw) as Record<string, unknown>
    const rawBlocks = Array.isArray(parsed.blocks) ? (parsed.blocks as Array<Record<string, unknown>>) : []
    if (rawBlocks.length === 0) return null

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
    if (!hasContent) return null

    return {
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
    }
  } catch (e) {
    console.warn('[P9] composeDocumentFromTaught failed', e instanceof Error ? e.message : e)
    return null
  }
}
