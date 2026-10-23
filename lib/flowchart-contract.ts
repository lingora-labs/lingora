// LINGORA 7.5 — flowchart instrument (Manifesto 7.1 arts. 49–52).
//
// The Tutor Maestro decides that a flow diagram helps and AUTHORS its nodes and edges. The runtime
// checks only that the graph is well-formed (unique ids, every edge points at a node, labels are
// text) and draws all of it. It does not impose an opinion on how a diagram must look: any number
// of branches, from any node, with labels of any length (wrapped), several entry points, cycles.
// 7.4.3 rejected valid Tutor diagrams (a start with six labelled outcomes, labels over 30 characters,
// more than four nodes per level); those were layout limits disguised as rules and were removed.
// A flow diagram is never painted by an image model. Pure module: no I/O, no model.
import { esc, wrapLines, TONES } from './svg-text'
import { displayText, VISUAL_MINIMUMS } from './native-visual-schema'

export type FlowKind = 'start' | 'step' | 'decision' | 'end'
export interface FlowNode { id: string; label: string; kind: FlowKind }
export interface FlowEdge { from: string; to: string; label?: string }
export interface FlowContent { title: string; subtitle?: string; nodes: FlowNode[]; edges: FlowEdge[] }
export type FlowCheck = { ok: true; flow: FlowContent } | { ok: false; reason: string }

type Obj = Record<string, unknown>
const obj = (v: unknown): v is Obj => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const nodeWrap = (k: FlowKind) => (k === 'decision' ? 24 : 28)
const EDGE_WRAP = 26

// Only equivalent Tutor-authored forms are normalized; never invent nodes or branches.
function canonicalKind(value: unknown): FlowKind | null {
  const aliases: Record<string, FlowKind> = { start:'start', begin:'start', inicio:'start', step:'step', process:'step', action:'step', paso:'step', decision:'decision', question:'decision', condition:'decision', pregunta:'decision', end:'end', finish:'end', final:'end', fin:'end' }
  return typeof value === 'string' ? aliases[value.trim().toLowerCase()] ?? null : null
}

export function validateFlowchartContent(raw: unknown): FlowCheck {
  if (!obj(raw) || !displayText(raw.title)) return { ok: false, reason: 'flow_title' }
  if (!Array.isArray(raw.nodes) || raw.nodes.length < VISUAL_MINIMUMS.flow.nodes) return { ok: false, reason: 'flow_node_count' }
  const nodes: FlowNode[] = []
  const ids = new Set<string>()
  for (const [i, rawNode] of raw.nodes.entries()) {
    if (!obj(rawNode)) return { ok: false, reason: `flow_node_shape:${i}` }
    const id = rawNode.id
    const label = rawNode.label ?? rawNode.text
    const declared = rawNode.kind ?? rawNode.type
    const kind = declared === undefined ? 'step' : canonicalKind(declared)
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id) || !displayText(label) || !kind) return { ok: false, reason: `flow_node_shape:${i}` }
    if (ids.has(id)) return { ok: false, reason: `flow_duplicate_id:${id}` }
    ids.add(id)
    nodes.push({ id, label: label.trim(), kind })
  }
  if (!Array.isArray(raw.edges) || raw.edges.length < VISUAL_MINIMUMS.flow.edges) return { ok: false, reason: 'flow_edge_count' }
  const edges: FlowEdge[] = []
  const seen = new Set<string>()
  for (const [i, rawEdge] of raw.edges.entries()) {
    if (!obj(rawEdge)) return { ok: false, reason: `flow_edge_ref:${i}` }
    const from = rawEdge.from ?? rawEdge.source
    const to = rawEdge.to ?? rawEdge.target
    if (typeof from !== 'string' || typeof to !== 'string' || !ids.has(from) || !ids.has(to)) return { ok: false, reason: `flow_edge_ref:${i}` }
    if (from === to) return { ok: false, reason: `flow_self_loop:${i}` }
    if (rawEdge.label !== undefined && !displayText(rawEdge.label)) return { ok: false, reason: `flow_edge_label:${i}` }
    const key = `${from}>${to}`
    if (seen.has(key)) return { ok: false, reason: `flow_duplicate_edge:${key}` }
    seen.add(key)
    edges.push({ from, to, ...(typeof rawEdge.label === 'string' ? { label: rawEdge.label.trim() } : {}) })
  }
  return { ok: true, flow: { title: (raw.title as string).trim(), ...(displayText(raw.subtitle) ? { subtitle: (raw.subtitle as string).trim() } : {}), nodes, edges } }
}

/** Entry points: declared starts, then nodes nothing points to, then (pure cycles) the first unreached node. */
export function flowRoots(f: FlowContent): string[] {
  const incoming = new Set(f.edges.map(e => e.to))
  const roots = f.nodes.filter(n => n.kind === 'start' || !incoming.has(n.id)).map(n => n.id)
  const reached = new Set<string>()
  const mark = (id: string) => { if (reached.has(id)) return; reached.add(id); for (const e of f.edges) if (e.from === id) mark(e.to) }
  roots.forEach(mark)
  for (const n of f.nodes) if (!reached.has(n.id)) { roots.push(n.id); mark(n.id) }
  return roots
}

/** Edges that close a cycle (DFS from every root): they point back to a node still on the stack. */
export function backEdges(f: FlowContent): Set<string> {
  const back = new Set<string>(), state = new Map<string, 1 | 2>()
  const visit = (id: string) => {
    state.set(id, 1)
    for (const e of f.edges) if (e.from === id) {
      const st = state.get(e.to)
      if (st === 1) back.add(`${e.from}>${e.to}`)
      else if (!st) visit(e.to)
    }
    state.set(id, 2)
  }
  for (const r of flowRoots(f)) if (!state.has(r)) visit(r)
  return back
}

/** Level = longest path from a root over forward edges (cycles removed). Deterministic. */
export function layoutLevels(f: FlowContent): Map<string, number> {
  const back = backEdges(f)
  const fwd = f.edges.filter(e => !back.has(`${e.from}>${e.to}`))
  const lv = new Map<string, number>()
  const level = (id: string): number => {
    if (lv.has(id)) return lv.get(id)!
    const ins = fwd.filter(e => e.to === id)
    const v = ins.length ? Math.max(...ins.map(e => level(e.from) + 1)) : 0
    lv.set(id, v); return v
  }
  for (const n of f.nodes) level(n.id)
  return lv
}

const TOPY = 64, NW = 232, NH = 54, DW = 232, DH = 76, COL = 260, LABEL_LINE = 13
const KIND_TONE: Record<FlowKind, keyof typeof TONES> = { start: 'ok', step: 'info', decision: 'warn', end: 'highlight' }

/** Deterministic SVG. Same input, same bytes; every node label and every edge label is drawn in full. */
export function renderFlowchartSvg(f: FlowContent, opts: { fixed?: boolean } = {}): string {
  const lv = layoutLevels(f)
  const levels = Math.max(...lv.values()) + 1
  const rows = Array.from({ length: levels }, (_, l) => f.nodes.filter(n => lv.get(n.id) === l))
  const maxAcross = Math.max(1, ...rows.map(r => r.length))
  const W = Math.max(600, (maxAcross + 1) * COL)
  const keyOf = (e: FlowEdge) => `${e.from}>${e.to}`
  const edgeLines = new Map(f.edges.map(e => [keyOf(e), e.label ? wrapLines(e.label, EDGE_WRAP) : []]))
  // Short edges (one level down) carry their label just above their target, stacked per target.
  const short = (e: FlowEdge) => lv.get(e.to)! - lv.get(e.from)! === 1
  const labelHeight = (lines: string[]) => lines.length * LABEL_LINE + 8
  const stackAbove = new Map<string, number>()
  for (const e of f.edges) if (short(e) && e.label) stackAbove.set(e.to, (stackAbove.get(e.to) ?? 0) + labelHeight(edgeLines.get(keyOf(e))!))
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>()
  let cursor = TOPY
  for (const row of rows) {
    const heights = row.map(n => Math.max(n.kind === 'decision' ? DH : NH, wrapLines(n.label, nodeWrap(n.kind)).length * 15 + (n.kind === 'decision' ? 48 : 26)))
    cursor += Math.max(0, ...row.map(n => stackAbove.get(n.id) ?? 0))
    const maxHeight = Math.max(...heights, NH)
    row.forEach((n, i) => pos.set(n.id, { x: (W / (row.length + 1)) * (i + 1), y: cursor + maxHeight / 2, w: n.kind === 'decision' ? DW : NW, h: heights[i] }))
    cursor += maxHeight + 48
  }
  const H = cursor + 20
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${opts.fixed ? `width="${W}" height="${H}"` : `preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;min-width:${Math.min(W, 1040)}px;height:auto"`} role="img" aria-label="${esc(f.title)}" font-family="system-ui,-apple-system,Segoe UI,Noto Sans,Noto Naskh Arabic,sans-serif">`,
    `<defs><marker id="lg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#475569"/></marker></defs>`,
    `<rect width="${W}" height="${H}" rx="14" fill="#ffffff"/>`,
    `<text x="${W / 2}" y="30" text-anchor="middle" font-size="18" font-weight="700" fill="#111827" style="unicode-bidi:plaintext">${esc(f.title)}</text>`,
  ]
  if (f.subtitle) parts.push(`<text x="${W / 2}" y="46" text-anchor="middle" font-size="12" fill="#4b5563" style="unicode-bidi:plaintext">${esc(f.subtitle)}</text>`)
  const labels: string[] = []
  const placedAbove = new Map<string, number>()
  const laneUse = { left: 0, right: 0 }
  const drawLabel = (lines: string[], cx: number, top: number) => {
    const w = Math.max(24, Math.max(...lines.map(l => l.length)) * 6.1 + 12), h = lines.length * LABEL_LINE + 5
    labels.push(`<rect x="${(cx - w / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="4" fill="#ffffff" stroke="#cbd5e1"/>`,
      `<text text-anchor="middle" font-size="10.5" font-weight="700" fill="#334155" style="unicode-bidi:plaintext">${lines.map((ln, k) => `<tspan x="${cx.toFixed(1)}" y="${(top + 11 + k * LABEL_LINE).toFixed(1)}">${esc(ln)}</tspan>`).join('')}</text>`)
  }
  for (const e of f.edges) {
    const a = pos.get(e.from)!, b = pos.get(e.to)!
    const lines = edgeLines.get(keyOf(e))!
    let d: string
    if (short(e)) {
      const x1 = a.x, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y - b.h / 2, my = (y1 + y2) / 2
      d = `M${x1.toFixed(1)} ${y1.toFixed(1)} C${x1.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
      if (lines.length) {
        const used = placedAbove.get(e.to) ?? 0
        drawLabel(lines, x2, y2 - used - labelHeight(lines))
        placedAbove.set(e.to, used + labelHeight(lines))
      }
    } else {
      // Long, back or same-level edge: travel in a side lane so it never crosses a node.
      const right = (a.x + b.x) / 2 >= W / 2
      const lane = right ? W - 12 - (laneUse.right++ % 3) * 8 : 12 + (laneUse.left++ % 3) * 8
      const x1 = a.x + (right ? a.w / 2 : -a.w / 2), y1 = a.y, x2 = b.x + (right ? b.w / 2 : -b.w / 2), y2 = b.y
      d = `M${x1.toFixed(1)} ${y1.toFixed(1)} C${lane} ${y1.toFixed(1)} ${lane} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
      if (lines.length) drawLabel(lines, (x1 + lane) / 2, (y1 + y2) / 2 - (lines.length * LABEL_LINE) / 2)
    }
    parts.push(`<path data-edge="${esc(e.from)}>${esc(e.to)}" d="${d}" fill="none" stroke="#475569" stroke-width="1.8" marker-end="url(#lg-arrow)"/>`)
  }
  for (const n of f.nodes) {
    const p = pos.get(n.id)!, t = TONES[KIND_TONE[n.kind]]
    const shape = n.kind === 'decision'
      ? `<polygon data-node="${esc(n.id)}" points="${p.x},${p.y - p.h / 2} ${p.x + p.w / 2},${p.y} ${p.x},${p.y + p.h / 2} ${p.x - p.w / 2},${p.y}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>`
      : `<rect data-node="${esc(n.id)}" x="${(p.x - p.w / 2).toFixed(1)}" y="${(p.y - p.h / 2).toFixed(1)}" width="${p.w}" height="${p.h}" rx="${n.kind === 'step' ? 8 : Math.min(p.h / 2, 27)}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>`
    const nl = wrapLines(n.label, nodeWrap(n.kind))
    const y0 = p.y - ((nl.length - 1) * 7.5) + 4
    parts.push(shape, `<text text-anchor="middle" font-size="11.5" font-weight="600" fill="${t.ink}" style="unicode-bidi:plaintext">${nl.map((ln, k) => `<tspan x="${p.x.toFixed(1)}" y="${(y0 + k * 15).toFixed(1)}">${esc(ln)}</tspan>`).join('')}</text>`)
  }
  parts.push(...labels, '</svg>')
  return parts.join('')
}
