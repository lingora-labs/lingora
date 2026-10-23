// LINGORA 7.5 — the printed form of a native artifact. One function for every document
// (conversation export, downloaded message, Tutor PDF/HTML). The same validated content the
// chat shows; diagrams use the same SVG renderers as the chat. Anything that cannot be printed
// completely throws a named refusal instead of disappearing.
import { renderChartSvg, validateChartContent } from '../chart-contract'
import { renderFlowchartSvg, validateFlowchartContent } from '../flowchart-contract'
import { renderInfographicSvg, validateInfographicContent } from '../infographic-contract'
import { esc, renderTutorMarkdown } from './markdown'

export interface PrintableArtifact { type: string; content?: Record<string, unknown> }

const TONES: Record<string, { bg: string; fg: string }> = {
  ok: { bg: '#c5f4e6', fg: '#065f46' }, warn: { bg: '#fff0b3', fg: '#754a00' },
  danger: { bg: '#ffe1e4', fg: '#991b1b' }, info: { bg: '#d5efff', fg: '#075985' },
  highlight: { bg: '#e8dcff', fg: '#5b21b6' }, neutral: { bg: '#e7edf3', fg: '#22374b' },
}
const COLUMN_TINTS = ['#d5f5ee', '#e0f2fe', '#eee5ff', '#fff1d5', '#ffe4e6', '#e8edf4']
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/

function table(c: Record<string, unknown>): string {
  if (!Array.isArray(c.columns) || !Array.isArray(c.rows)) throw new Error('export_invalid_table_structure')
  const heads = (c.columns as unknown[]).map((x, i) => {
    const label = typeof x === 'string' ? x : (x as { label?: unknown } | null)?.label
    if (typeof label !== 'string') throw new Error('export_invalid_column:' + i)
    return label
  })
  if (!heads.length) throw new Error('export_empty_table')
  const th = heads.map((h, i) => `<th dir="auto" style="background:${COLUMN_TINTS[i % COLUMN_TINTS.length]}">${esc(h)}</th>`).join('')
  const rows = (c.rows as unknown[]).map((row, ri) => {
    if (!Array.isArray(row) || row.length !== heads.length) throw new Error('export_invalid_table_row:' + ri)
    return '<tr>' + row.map((raw, i) => {
      const cell = typeof raw === 'string' ? { text: raw } : raw as { text?: unknown; tone?: unknown; icon?: unknown } | null
      if (!cell || typeof cell.text !== 'string') throw new Error('export_invalid_table_cell:' + ri + ':' + i)
      if (cell.tone !== undefined && (typeof cell.tone !== 'string' || !(cell.tone in TONES))) throw new Error('export_invalid_table_tone:' + ri + ':' + i)
      const style = typeof cell.tone === 'string' ? TONES[cell.tone] : null
      const prefix = typeof cell.icon === 'string' ? esc(cell.icon) + ' ' : ''
      return `<td dir="auto" data-tone="${esc(typeof cell.tone === 'string' ? cell.tone : 'column-default')}" style="background:${style?.bg ?? COLUMN_TINTS[i % COLUMN_TINTS.length]};color:${style?.fg ?? '#1f2937'}">${prefix}${esc(cell.text)}</td>`
    }).join('') + '</tr>'
  }).join('')
  return `<section class="ln-art ln-art-table"><h3 dir="auto">${esc(String(c.title ?? 'Tabla'))}</h3>${c.subtitle ? `<p dir="auto">${esc(String(c.subtitle))}</p>` : ''}<div class="ln-table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div></section>`
}

function quiz(c: Record<string, unknown>): string {
  if (!Array.isArray(c.questions) || !c.questions.length) throw new Error('export_invalid_quiz')
  const items = (c.questions as unknown[]).map((question, i) => {
    const q = question as Record<string, unknown> | null
    if (!q || typeof q.question !== 'string' || !Array.isArray(q.options) || !q.options.length) throw new Error('export_invalid_quiz_question:' + i)
    const options = q.options.map((op, j) => {
      if (typeof op !== 'string') throw new Error('export_invalid_quiz_option:' + i + ':' + j)
      return `<li dir="auto"><span class="ln-opt">${String.fromCharCode(65 + j)})</span> ${esc(op)}</li>`
    }).join('')
    return `<li class="ln-q"><div class="ln-q-text" dir="auto">${esc(q.question)}</div><ol class="ln-opts" type="A">${options}</ol></li>`
  }).join('')
  return `<section class="ln-art ln-art-quiz"><h3 dir="auto">${esc(String(c.title ?? 'Cuestionario'))}</h3><ol class="ln-qs">${items}</ol></section>`
}

function schema(c: Record<string, unknown>): string {
  if (!Array.isArray(c.blocks) || !c.blocks.length) throw new Error('export_invalid_schema')
  const blocks = (c.blocks as unknown[]).map((raw, i) => {
    const b = raw as Record<string, unknown> | null
    if (!b || typeof b.type !== 'string') throw new Error('export_invalid_schema_block:' + i)
    const title = typeof b.title === 'string' ? `<h4 dir="auto">${esc(b.title)}</h4>` : typeof b.label === 'string' ? `<h4 dir="auto">${esc(b.label)}</h4>` : ''
    if (b.type === 'concept' && typeof b.body === 'string') return `<div class="ln-blk">${title}${renderTutorMarkdown(b.body)}</div>`
    if (b.type === 'highlight' && typeof b.text === 'string') return `<div class="ln-blk ln-hl" data-tone="${esc(String(b.tone ?? 'info'))}">${renderTutorMarkdown(b.text)}</div>`
    if (b.type === 'bullets' && Array.isArray(b.items)) return `<div class="ln-blk">${title}<ul>${b.items.map((x) => `<li dir="auto">${esc(String(x))}</li>`).join('')}</ul></div>`
    if (b.type === 'flow' && Array.isArray(b.steps)) return `<div class="ln-blk">${title}<ol>${b.steps.map((x) => `<li dir="auto">${esc(String(x))}</li>`).join('')}</ol></div>`
    if (b.type === 'comparison' && typeof b.left === 'string' && typeof b.right === 'string') return `<div class="ln-blk">${title}<div class="ln-cmp"><div dir="auto">${esc(b.left)}</div><div dir="auto">${esc(b.right)}</div></div></div>`
    if (b.type === 'table' && Array.isArray(b.columns) && Array.isArray(b.rows))
      return `<div class="ln-blk">${title}<div class="ln-table-wrap"><table><thead><tr>${b.columns.map((h) => `<th dir="auto">${esc(String(h))}</th>`).join('')}</tr></thead><tbody>${(b.rows as unknown[][]).map((r) => `<tr>${r.map((x) => `<td dir="auto">${esc(String(x))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`
    throw new Error('export_invalid_schema_block:' + i)
  }).join('')
  return `<section class="ln-art ln-art-schema"><h3 dir="auto">${esc(String(c.title ?? 'Esquema'))}</h3>${blocks}</section>`
}

/** Printed HTML for one artifact. Throws `export_*` codes; never returns an empty placeholder. */
export function printArtifact(a: PrintableArtifact): string {
  if (!a || !a.content || typeof a.content !== 'object') throw new Error('export_missing_artifact_content:' + String(a?.type ?? 'unknown'))
  const c = a.content
  let svg = ''
  if (a.type === 'chart') {
    const v = validateChartContent(c)
    if (!v.ok) throw new Error('export_invalid_chart:' + v.reason)
    svg = renderChartSvg(v.chart, { fixed: true })
  } else if (a.type === 'flowchart') {
    const v = validateFlowchartContent(c)
    if (!v.ok) throw new Error('export_invalid_flowchart:' + v.reason)
    svg = renderFlowchartSvg(v.flow, { fixed: true })
  } else if (a.type === 'infographic') {
    const v = validateInfographicContent(c)
    if (!v.ok) throw new Error('export_invalid_infographic:' + v.reason)
    svg = renderInfographicSvg(v.info, { fixed: true })
  }
  if (svg) {
    if (!svg.includes('<svg')) throw new Error('export_missing_svg:' + a.type)
    return `<figure class="ln-art ln-visual" data-type="${esc(a.type)}">${svg}</figure>`
  }
  if (a.type === 'table_matrix') return table(c)
  if (a.type === 'quiz') return quiz(c)
  if (a.type === 'schema_pro') return schema(c)
  if (a.type === 'illustration') {
    const url = String(c.url ?? '')
    const caption = typeof c.prompt === 'string' ? `<figcaption dir="auto">${esc(c.prompt)}</figcaption>` : ''
    if (DATA_IMAGE.test(url)) return `<figure class="ln-art ln-img"><img src="${url}" alt="">${caption}</figure>`
    if (/^https:\/\//.test(url)) return `<figure class="ln-art ln-img"><a href="${esc(url)}">${esc(url)}</a>${caption}</figure>`
    throw new Error('export_missing_artifact_content:illustration')
  }
  throw new Error('export_unsupported_artifact_type:' + a.type)
}

export const ARTIFACT_PRINT_CSS = `
.ln-art{margin:12px 0;break-inside:auto}
.ln-art h3{font-size:1.05em;margin:0 0 6px;color:#0f3550}
.ln-art table{border-collapse:collapse;width:100%;font-size:.86em}
.ln-art th,.ln-art td{border:1px solid #bdc9d3;padding:5px 6px;text-align:start;vertical-align:top;overflow-wrap:anywhere}
.ln-art tr{break-inside:avoid-page}
.ln-visual svg{max-width:100%;width:100%!important;min-width:0!important;height:auto!important}
.ln-visual{break-inside:avoid-page}
.ln-art-quiz{background:#eef4fb;padding:8px 12px;border-radius:8px}
.ln-qs{padding-inline-start:1.6em}.ln-q{margin:.5em 0;break-inside:avoid-page}.ln-q-text{font-weight:700}
.ln-opts{list-style:none;padding-inline-start:.6em;margin:.2em 0}.ln-opt{font-weight:700;color:#08777d}
.ln-art-schema .ln-blk{margin:8px 0}.ln-art-schema h4{margin:0 0 4px;font-size:.98em}
.ln-hl{background:#eef6ff;border-inline-start:3px solid #08777d;padding:6px 10px}
.ln-cmp{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ln-cmp>div{background:#f4f7fa;padding:6px 8px}
.ln-img img{max-width:100%;height:auto}.ln-img figcaption{font-size:.85em;color:#52667a}
`
