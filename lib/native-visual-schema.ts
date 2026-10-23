// LINGORA 7.5 — the instrumental contract for native components, advertised to the Tutor
// and verified by runtime. 7.5 removed every cognitive cap (how many sections, rows, columns,
// questions, branches, characters a label may have). What remains are RESOURCE limits —
// bytes the browser and the PDF engine can hold — and validity (references resolve, ids are
// unique, numbers occur in the turn). A component over a resource limit is refused with its
// reason, never trimmed. Layout adapts to the content (wrapping, wider canvases, scrolling,
// pagination), never the other way round.
// Pure module: no model calls, routing or intent classification.

/** Resource limits only. Not pedagogical choices. */
export const NATIVE_RESOURCE_LIMITS = {
  /** Serialized size of one component's content. A 100-row bilingual table is ~20 KB. */
  contentChars: 1_000_000,
  /** One string (cell, label, section body). */
  textChars: 20_000,
  /** Items in one list (rows, nodes, questions…). Memory/DOM bound, three orders above any lesson. */
  items: 5_000,
} as const

/** Validity minimums: below these the component is not a table / diagram / quiz at all. */
export const VISUAL_MINIMUMS = {
  flow: { nodes: 2, edges: 1 },
  infographic: { sections: 1 },
  table: { columns: 1, rows: 1 },
  quiz: { questions: 1, options: 2 },
  chart: { categories: 1, panels: 1 },
} as const

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => Boolean(v && typeof v === 'object' && !Array.isArray(v))

/** Valid display text: non-empty, within the resource limit, not markup. */
export const displayText = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= NATIVE_RESOURCE_LIMITS.textChars && !/<\s*\/?\s*[a-z][^>]*>/i.test(v)

/** Why a component exceeds a resource limit, or null. */
export function resourceRefusal(content: unknown): string | null {
  let size = 0
  try { size = JSON.stringify(content ?? null).length } catch { return 'contenido no serializable' }
  if (size > NATIVE_RESOURCE_LIMITS.contentChars) return `el contenido ocupa ${size} caracteres; el máximo técnico es ${NATIVE_RESOURCE_LIMITS.contentChars}`
  const walk = (v: unknown): string | null => {
    if (Array.isArray(v)) {
      if (v.length > NATIVE_RESOURCE_LIMITS.items) return `una lista tiene ${v.length} elementos; el máximo técnico es ${NATIVE_RESOURCE_LIMITS.items}`
      for (const x of v) { const r = walk(x); if (r) return r }
    } else if (isObj(v)) {
      for (const x of Object.values(v)) { const r = walk(x); if (r) return r }
    } else if (typeof v === 'string' && v.length > NATIVE_RESOURCE_LIMITS.textChars) {
      return `un texto tiene ${v.length} caracteres; el máximo técnico es ${NATIVE_RESOURCE_LIMITS.textChars}`
    }
    return null
  }
  return walk(content)
}

const colors = ['ok', 'warn', 'danger', 'info', 'neutral', 'highlight'] as const
const label = { type: 'string', minLength: 1 }
const tone = { type: 'string', enum: [...colors] }
const flowNode = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' },
    label,
    kind: { type: 'string', enum: ['start', 'step', 'decision', 'end'] },
  },
  required: ['id', 'label', 'kind'],
}
const flowEdge = {
  type: 'object', additionalProperties: false,
  properties: { from: label, to: label, label },
  required: ['from', 'to'],
}
const infoSection = {
  type: 'object', additionalProperties: false,
  properties: { heading: label, body: label, icon: label, tone },
  required: ['heading', 'body'],
}
const infoStat = {
  type: 'object', additionalProperties: false,
  properties: { value: label, label, tone },
  required: ['value', 'label'],
}
const tableCell = {
  type: 'object', additionalProperties: false,
  properties: { text: label, tone, icon: label },
  required: ['text'],
}
const tableColumn = {
  type: 'object', additionalProperties: false,
  properties: { key: label, label },
  required: ['key', 'label'],
}

/**
 * Content is optional for file-only declarations; its fields are conditional on artifact.type.
 * Shapes only — no counts or lengths: the Tutor decides how much the student needs.
 */
export const NATIVE_ARTIFACT_CONTENT_TOOL_SCHEMA = {
  type: 'object',
  description: 'Fields depend on the artifact type. flowchart: title, nodes (id, label, kind=start|step|decision|end) and edges (from, to, optional label). infographic: title, sections (heading, body), optional subtitle, stats (value, label) and takeaway; figures must come from your reply. table_matrix: title, columns, rows of cells (text, optional tone). chart: title, categories and panels (kind bar|line, title, values: one number per category). Include only the fields of the chosen type.',
  properties: {
    title: label, subtitle: label,
    nodes: { type: 'array', items: flowNode },
    edges: { type: 'array', items: flowEdge },
    sections: { type: 'array', items: infoSection },
    stats: { type: 'array', items: infoStat },
    takeaway: label,
    columns: { type: 'array', items: tableColumn },
    rows: { type: 'array', items: { type: 'array', items: tableCell } },
    categories: { type: 'array', items: label },
    panels: { type: 'array', items: { type: 'object', properties: {
      kind: { type: 'string', enum: ['bar', 'line'] }, title: label, unit: label,
      values: { type: 'array', items: { type: 'number' } },
    }, required: ['kind', 'title', 'values'], additionalProperties: false } },
  },
  additionalProperties: true, // schema_pro/quiz retain their canonical native contracts
} as const
