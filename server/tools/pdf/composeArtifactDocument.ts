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
//
// SEEK 5.0 P13-B — ARTIFACT TYPE COHERENCE (COURSE-vs-LESSON).
// Root gap: documentType was a free-text string with only an inline example
// ("e.g. leccion, guia, resumen tematico"). Nothing constrained it to match
// the actual depth/structure of the content, so a single-turn explanation
// could come back labeled "curso" while a title independently said "Guía" —
// type, title and content could each say something different.
// Fix: closed 7-value taxonomy, explicit definition of what each implies,
// and an explicit instruction that title wording must agree with the chosen
// type. Code-level normalization maps common ES/EN variants to the closed
// set and falls back to the most modest truthful label ('lesson') for
// anything unrecognized — never inflates to 'course' by default.
//
// SEEK 5.0 P19-B — DOCUMENT INTENT (GENERAL ARTIFACT SYSTEM, increment 1).
// Root gap: the documentType taxonomy above is exclusively pedagogical.
// WILLY is free to teach acupuncture theory, compare two options, or write
// an executive-style recommendation — but every one of those, once
// materialized, was forced through a lesson/study_guide/course-shaped
// label because the classification layer had no other vocabulary. A
// scientific dossier and a Spanish lesson were visually indistinguishable
// beyond the badge text. Fix: composer now classifies documentIntent FIRST
// (learning/scientific/executive/comparative/reference) as a broader
// question than documentType, then picks documentType from the taxonomy
// that actually matches that intent — the existing 7-value pedagogical set
// for 'learning', three new honest slugs (dossier/executive_brief/
// comparative_brief) for the others. This is still organization, not new
// pedagogical content — WILLY already decided what kind of content this is
// when it taught; this only lets the composer say so truthfully.
//
// SEEK 5.0 P19-C — COMPOSITION BY INTENT (GENERAL ARTIFACT SYSTEM,
// increment 2). Root gap: documentIntent changed the cover kicker/badge/
// title but not the actual block ORDER or CHOICE inside the document —
// an executive brief and a lesson used the same block sequence, just with
// a different label on the outside. Fix: explicit composition guidance per
// intent (executive: situación → KPI strip → diagnóstico → recomendación
// → riesgo → decisión solicitada; comparative: contexto → criterios →
// matriz comparativa → trade-offs → recomendación → conclusión), paired
// with real render-layer treatment in generateCoursePdf.ts (KPI strip,
// comparison matrix label) so the composition difference is visible, not
// just requested. Still no new block types — same vocabulary, different
// order and render treatment.
//
// SEEK 5.0 P19-E — ANTI-FALSE-KPI + CLASSIFICATION RELIABILITY.
// Root gap 1 (confirmed in production): when the user asked for an
// executive brief without supplying real figures, the composer put metric
// NAMES ("hay que medir retención") into a key_value block anyway, using
// a placeholder word ("medir") as the value. Because a key_value block
// under executive intent renders as a KPI strip (generateCoursePdf.ts /
// renderArtifactHtml.ts — large headline value + label underneath), this
// visually presented an unmeasured metric as if it were an observed one —
// a direct anti-placebo violation. Fix: explicit hard rule forbidding
// placeholder values in the KPI-triggering key_value block; unmeasured
// metrics must render as a "Métricas a monitorear" bullets list instead,
// which carries no observed-value visual claim.
// Root gap 2 (confirmed in production): a genuinely long, deep AUTHOR-mode
// document (17k+ chars, 10 real sections on acupuncture — history,
// mechanisms, evidence, risk, methodology, glossary) was classified
// documentIntent: 'learning' / 'lesson' despite being explanatory content
// about a domain, not a practiced skill. The classifier appears biased
// toward 'learning' by context (this is a Spanish-learning platform) or by
// length (many sections read as a "course"). Fix: explicit instruction that
// classification follows content TYPE, not platform context or length.
// =============================================================================
import type { DocumentContent, DocumentBlock, DocumentBlockType } from './generateCoursePdf'
import type { DocumentIntent } from './brand'

const VALID_BLOCK_TYPES = new Set<DocumentBlockType>([
  'heading', 'paragraph', 'bullets', 'numbered', 'table', 'callout', 'quote',
  'divider', 'key_value', 'exercise', 'answer_key', 'case', 'timeline',
  'comparison', 'framework', 'glossary', 'index', 'summary',
])

// P13-B — closed artifact-type taxonomy. Values are the canonical internal
// slugs; generateCoursePdf.ts's ARTIFACT_TYPE_BADGE maps each to its Spanish
// display label on the cover page.
export type ArtifactTypeSlug =
  | 'lesson' | 'study_guide' | 'course' | 'worksheet'
  | 'reference' | 'assessment' | 'learning_plan'
  // P19-B — non-pedagogical slugs, valid only when documentIntent is not
  // 'learning'. Kept in the SAME enum (not a parallel type) so the
  // renderer's existing ARTIFACT_TYPE_BADGE lookup and badge/kicker logic
  // don't need a second dispatch path.
  | 'dossier' | 'executive_brief' | 'comparative_brief'

const ARTIFACT_TYPE_ALIASES: Record<string, ArtifactTypeSlug> = {
  lesson: 'lesson', leccion: 'lesson', 'lección': 'lesson',
  study_guide: 'study_guide', guia: 'study_guide', 'guía': 'study_guide',
  'guia de estudio': 'study_guide', 'guía de estudio': 'study_guide',
  course: 'course', curso: 'course',
  worksheet: 'worksheet', ficha: 'worksheet', 'ficha de ejercicios': 'worksheet', ejercicios: 'worksheet',
  reference: 'reference', referencia: 'reference', 'material de referencia': 'reference',
  assessment: 'assessment', evaluacion: 'assessment', 'evaluación': 'assessment', examen: 'assessment',
  learning_plan: 'learning_plan', 'plan de aprendizaje': 'learning_plan', plan: 'learning_plan',
  dossier: 'dossier', 'dossier explicativo': 'dossier', explainer: 'dossier',
  executive_brief: 'executive_brief', 'documento ejecutivo': 'executive_brief', 'board memo': 'executive_brief', brief: 'executive_brief',
  comparative_brief: 'comparative_brief', 'analisis comparativo': 'comparative_brief', 'análisis comparativo': 'comparative_brief', comparison: 'comparative_brief',
}

const INTENT_ALIASES: Record<string, DocumentIntent> = {
  learning: 'learning', pedagogical: 'learning', aprendizaje: 'learning',
  scientific: 'scientific', explanatory: 'scientific', cientifico: 'scientific', 'científico': 'scientific',
  executive: 'executive', board: 'executive', ejecutivo: 'executive',
  comparative: 'comparative', analytical: 'comparative', comparativo: 'comparative',
  reference: 'reference', referencia: 'reference',
}

// Safest truthful default: an unrecognized/ambiguous type is treated as a
// single-session lesson, never inflated to 'course'.
function normalizeArtifactType(raw: unknown): ArtifactTypeSlug {
  const key = String(raw ?? '').trim().toLowerCase()
  return ARTIFACT_TYPE_ALIASES[key] ?? 'lesson'
}

function normalizeIntent(raw: unknown): DocumentIntent {
  const key = String(raw ?? '').trim().toLowerCase()
  return INTENT_ALIASES[key] ?? 'learning'
}

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

    const systemPrompt = `You structure already-taught content into a JSON document for PDF rendering. The text you receive is the FULL turn as taught, which may cover more than one subject. Your first job is ISOLATION: select only the portion that genuinely belongs to your assigned subject. Your second job is CLASSIFYING PURPOSE: this content is not always a lesson — decide honestly what KIND of document it actually is. Your third job is STRUCTURING and HONEST TYPING within that purpose.

Isolation rules:
- Exclude turn-level framing text (e.g. "I will do this in the order you asked", opening/closing summaries that talk ABOUT the plan rather than teaching content).
- Exclude any content that belongs to the other subjects listed below — do not summarize them, do not reference them, do not include their exercises or examples.
- Exclude a closing activity/exercise unless it is specifically about YOUR subject, not a different one.
- If the source text has a clear section (e.g. under a heading) dedicated to your subject, treat that as your primary source.

Structuring rules:
- Do not invent new content. Do not change complexity, register, or level — that was already decided correctly by the tutor when it taught. Do not simplify or infantilize.
- Organize into clear blocks: headings, paragraphs, tables where the content is naturally tabular, bullet or numbered lists where appropriate, key_value for terminology/KPI-style facts, callout for a recommendation or important note, comparison/framework for contrast-heavy content, and one exercise block if practice material specific to YOUR subject is present.
- If almost nothing in the text belongs to your subject, it is correct to produce a shorter document rather than padding it with unrelated content.

CLASSIFYING PURPOSE — choose exactly ONE documentIntent, honestly, based on what the content actually IS:
- "learning": teaching a skill or concept for the reader to practice/acquire (most language-learning content).
- "scientific": explaining a domain with theory, evidence, or open questions — a dossier, not an exercise. Use this for content like "how acupuncture works" — it is explanatory, not a lesson to practice.
- "executive": diagnosis + recommendation + decision framed for someone who needs to decide or act, not learn a skill.
- "comparative": the content's core value is contrasting two or more things and recommending between them.
- "reference": a lookup-style compilation of facts/terms with minimal narrative, not meant to be studied in sequence.
Do NOT default to "learning" just because the audience is a language student — classify by what THIS content actually does.

HONEST TYPING — once you know the intent, choose exactly ONE documentType:
If documentIntent is "learning", choose from: "lesson" (a single teaching episode — correct for almost all single-turn output), "study_guide" (review-style overview), "course" (genuinely multi-module curriculum — never for single-turn output), "worksheet" (mostly exercises), "reference", "assessment", "learning_plan" (a roadmap, not the content itself).
If documentIntent is "scientific", documentType is "dossier".
If documentIntent is "executive", documentType is "executive_brief".
If documentIntent is "comparative", documentType is "comparative_brief".
If documentIntent is "reference" (non-learning), documentType is "reference".
Your title MUST agree with both intent and type: never use words like "Curso"/"Course" unless documentType is "course"; never call something a "Guía"/"Guide" unless it is guide-shaped; a scientific dossier's title should read like a dossier, not a lesson. When in doubt within "learning", choose "lesson" — it is always truthful for single-turn output.

COMPOSITION BY INTENT (P19-C/P19-E) — this is not just a label. The block ORDER and CHOICE must make the document look and function differently depending on intent, using the SAME block vocabulary:
- "executive": open with 1-2 sentences of situación/mandato (paragraph). Then, ONLY IF the source content contains 2-5 genuinely quantifiable facts THAT WERE ACTUALLY STATED (real numbers, percentages, counts, named statuses — e.g. "240 usuarios", "34%", "18 dólares"), put them in ONE key_value block IMMEDIATELY after — each item as "Short label: short value" (the value should be short enough to read as a headline — this block renders as a literal KPI strip with the value shown large, so it visually claims to be an observed metric). Then a diagnóstico paragraph. Then a callout with style "tip" for the recommendation. If there is real risk/uncertainty, a callout with style "warning". Close with a heading "Decisión solicitada" or "Próxima acción" plus a short paragraph naming exactly what the reader must decide or do next — do not simply repeat nextStep.
  ANTI-FALSE-KPI RULE (P19-E, hard constraint): if the source content does NOT contain real stated figures — only the NAMES of metrics that should eventually be tracked (e.g. "hay que medir retención", "seguir el CAC") — do NOT put those into a key_value block. A key_value block under executive intent is rendered as a KPI strip showing each value as a large headline number; putting a placeholder word like "medir" or "pendiente" as that value visually claims it as an observed metric, which is false. Instead, list those as a bullets block under a heading like "Métricas a monitorear" or "Plan de medición" — clearly framed as a future measurement plan, never as a current KPI strip.
- "comparative": open with 1 short paragraph naming the two (or more) things being compared and why it matters. Then bullets or a short paragraph listing the criteria used. Then put the actual contrast in ONE table block (this renders as a labeled comparison matrix — make headers and rows genuinely comparative, e.g. headers ["Criterio", "Opción A", "Opción B"], not a generic fact table). Then a paragraph on trade-offs. Then a callout style "tip" with the recommendation. Close with a short conclusion paragraph.
- "scientific": open with a short abstract/executive-summary paragraph (what this document covers and its overall conclusion in a few sentences). Use heading level 1 per major chapter (history, mechanisms, evidence, risks, etc.) with paragraphs carrying the explanatory weight. Use a table for evidence-by-area or comparative-framework content when the source has several parallel items (this is exactly the kind of content that suits a table). Use key_value for a glossary when terms are defined. Use callout style "warning" for genuine risk/safety content and style "tip" only for a genuinely notable caveat or open methodological question — never as decoration. Close with a real concluding paragraph, not a generic summary.
- "learning": the existing pattern — explanation, table/bullets for structured contrast, one exercise block.
Do not force a KPI strip or comparison matrix where the content doesn't genuinely have quantifiable facts or a real two-way contrast — an honest shorter document beats a padded one.

CLASSIFICATION RELIABILITY (P19-E): classify documentIntent from what the content teaches ABOUT, never from the fact that this is a language-learning platform or from document length. A long, deep explanatory document about a domain (history, mechanisms, evidence, risk) is "scientific" even if it has 10 sections and reads like a course — length alone does not make something "learning". Reserve "learning" specifically for content that teaches a skill THE READER practices (a language point, a professional communication skill) — if the content is about a domain the reader is learning ABOUT rather than a skill they are practicing, it is "scientific", "reference", or another non-learning intent.

Respond with valid JSON only — no markdown, no preamble.`

    const userPrompt = `Your assigned subject: "${params.subject}"

Other subjects taught in the SAME turn (their content does not belong to you — exclude it): ${otherSubjectsLine}

Full taught text for this turn:
"""
${boundedContent}
"""

Return ONLY this JSON:
{
  "title": "string - specific to \"${params.subject}\", must agree with documentIntent and documentType, not generic",
  "subtitle": "string or null",
  "documentIntent": "one of: learning, scientific, executive, comparative, reference",
  "documentType": "if learning: lesson, study_guide, course, worksheet, reference, assessment, learning_plan — otherwise must match documentIntent: dossier (scientific), executive_brief (executive), comparative_brief (comparative), reference (reference)",
  "blocks": [
    {"type":"heading","level":1,"content":"Section title"},
    {"type":"paragraph","content":"Prose text..."},
    {"type":"table","headers":["Col A","Col B"],"rows":[["a1","b1"]]},
    {"type":"key_value","items":["Term: definition"]},
    {"type":"callout","label":"Recomendación","style":"tip","content":"..."},
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
        documentIntent: normalizeIntent(parsed.documentIntent),
        documentType: normalizeArtifactType(parsed.documentType),
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
