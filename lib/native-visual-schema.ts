// LINGORA 7.4.4 — one instrumental contract advertised to the Tutor and verified by runtime.
// JSON-schema shapes are descriptive; runtime validators remain final authority.
// This module is PURE (no model calls, routing or user intent classification).
export const VISUAL_LIMITS = {
  flow: { nodesMin: 3, nodesMax: 32, edgesMin: 2, edgesMax: 64, labelMax: 60, edgeLabelMax: 30, titleMax: 160, subtitleMax: 80 },
  infographic: { sectionsMin: 2, sectionsMax: 6, headingMax: 60, bodyMax: 420, statsMax: 4, statLabelMax: 60, statValueMax: 14, takeawayMax: 220, titleMax: 120 },
  table: { columnsMin: 2, columnsMax: 6, rowsMin: 2, rowsMax: 18 },
} as const

const colors = ['ok','warn','danger','info','neutral','highlight'] as const
const label = (maximum: number) => ({ type: 'string', minLength: 1, maxLength: maximum })
const tone = { type: 'string', enum: [...colors] }
const flowNode = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,20}$' },
    label: label(VISUAL_LIMITS.flow.labelMax),
    kind: { type: 'string', enum: ['start','step','decision','end'] },
  },
  required: ['id','label','kind'],
}
const flowEdge = {
  type: 'object', additionalProperties: false,
  properties: {
    from: label(20), to: label(20), label: label(VISUAL_LIMITS.flow.edgeLabelMax),
  },
  required: ['from','to'],
}
const infoSection = {
  type: 'object', additionalProperties: false,
  properties: {
    heading: label(VISUAL_LIMITS.infographic.headingMax),
    body: label(VISUAL_LIMITS.infographic.bodyMax),
    icon: label(8), tone,
  },
  required: ['heading','body'],
}
const infoStat = {
  type: 'object', additionalProperties: false,
  properties: {
    value: label(VISUAL_LIMITS.infographic.statValueMax),
    label: label(VISUAL_LIMITS.infographic.statLabelMax),
    tone,
  },
  required: ['value','label'],
}
const tableCell = {
  type: 'object', additionalProperties: false,
  properties: { text: label(1800), tone, icon: label(1800) },
  required: ['text'],
}
const tableColumn = {
  type: 'object', additionalProperties: false,
  properties: { key: label(1800), label: label(1800) },
  required: ['key','label'],
}

/**
 * Content is optional for file-only declarations; its fields are conditional
 * on artifact.type. Every array item is STRUCTURED here rather than described
 * in a paragraph. The same VISUAL_LIMITS drive server-side validation.
 * Do not make all fields required: non-visual native tools reuse this channel.
 */
export const NATIVE_ARTIFACT_CONTENT_TOOL_SCHEMA = {
  type: 'object',
  description: 'For flowchart provide title, nodes and edges; every node uses kind=start|step|decision|end, one start and at least one end, decisions have 2-4 labelled outgoing edges. For infographic provide title and 2-6 substantive sections (heading+body), optional stats/takeaway; never invent numbers. For table_matrix provide title, columns and rows with colored cells. For chart provide categories and panels. Only include fields relevant to the chosen artifact type; the runtime refuses invalid data.',
  properties: {
    title: label(160), subtitle: label(140),
    nodes: { type: 'array', minItems: VISUAL_LIMITS.flow.nodesMin, maxItems: VISUAL_LIMITS.flow.nodesMax, items: flowNode },
    edges: { type: 'array', minItems: VISUAL_LIMITS.flow.edgesMin, maxItems: VISUAL_LIMITS.flow.edgesMax, items: flowEdge },
    sections: { type: 'array', minItems: VISUAL_LIMITS.infographic.sectionsMin, maxItems: VISUAL_LIMITS.infographic.sectionsMax, items: infoSection },
    stats: { type: 'array', maxItems: VISUAL_LIMITS.infographic.statsMax, items: infoStat },
    takeaway: label(VISUAL_LIMITS.infographic.takeawayMax),
    columns: { type: 'array', minItems: VISUAL_LIMITS.table.columnsMin, maxItems: VISUAL_LIMITS.table.columnsMax, items: tableColumn },
    rows: { type: 'array', minItems: VISUAL_LIMITS.table.rowsMin, maxItems: VISUAL_LIMITS.table.rowsMax, items: { type: 'array', items: tableCell } },
    categories: { type: 'array', minItems: 2, maxItems: 24, items: label(60) },
    panels: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', properties: {
      kind: { type:'string', enum:['bar','line'] }, title: label(100), unit: label(12),
      values: { type: 'array', items: { type: 'number' } },
    }, required:['kind','title','values'], additionalProperties:false } },
  },
  additionalProperties: true, // schema_pro/quiz retain their canonical native contracts
} as const
