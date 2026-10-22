import { VISUAL_LIMITS } from './native-visual-schema'
// LINGORA 7.4.3 — flowchart instrument (Manifesto 7.1 arts. 49–52; Manifesto arts. 29–32).
//
// The Tutor Maestro decides that a flow diagram helps and AUTHORS its nodes and edges as a typed call.
// The runtime (a) validates that the graph is a sound process (one start, an end, labelled decision
// branches, no dead ends, everything reachable) and (b) lays it out and draws it deterministically.
// A flow diagram is never painted by an image model. Pure module: no I/O, no model, no regex on intent.
import { esc, wrapLines, TONES } from './svg-text'

export type FlowKind = 'start' | 'step' | 'decision' | 'end'
export interface FlowNode { id: string; label: string; kind: FlowKind }
export interface FlowEdge { from: string; to: string; label?: string }
export interface FlowContent { title: string; subtitle?: string; nodes: FlowNode[]; edges: FlowEdge[] }
export type FlowCheck = { ok: true; flow: FlowContent } | { ok: false; reason: string }

type Obj = Record<string, unknown>
const obj = (v: unknown): v is Obj => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/<\s*\/?\s*[a-z][^>]*>/i.test(v)
const MAX_PER_LEVEL = 4
const nodeWrap = (k: FlowKind) => (k === 'decision' ? 14 : 17)

// Only equivalent Tutor-authored forms are normalized; never invent nodes or branches.
function canonicalKind(value: unknown): FlowKind | null {
  const aliases: Record<string, FlowKind> = { start:'start', begin:'start', inicio:'start', step:'step', process:'step', action:'step', paso:'step', decision:'decision', question:'decision', condition:'decision', pregunta:'decision', end:'end', finish:'end', final:'end', fin:'end' }
  return typeof value === 'string' ? aliases[value.trim().toLowerCase()] ?? null : null
}

export function validateFlowchartContent(raw: unknown): FlowCheck {
  if (!obj(raw) || !text(raw.title, VISUAL_LIMITS.flow.titleMax)) return { ok: false, reason: 'flow_title' }
  if (!Array.isArray(raw.nodes) || raw.nodes.length < VISUAL_LIMITS.flow.nodesMin || raw.nodes.length > VISUAL_LIMITS.flow.nodesMax) return { ok: false, reason: 'flow_node_count' }
  const nodes: FlowNode[] = []
  const ids = new Set<string>()
  for (const [i, rawNode] of raw.nodes.entries()) {
    if (!obj(rawNode)) return { ok: false, reason: `flow_node_shape:${i}` }
    const id = rawNode.id
    const label = rawNode.label ?? rawNode.text
    const kind = canonicalKind(rawNode.kind ?? rawNode.type)
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(id) || !text(label, VISUAL_LIMITS.flow.labelMax) || !kind)
      return { ok: false, reason: `flow_node_shape:${i}` }
    if (ids.has(id)) return { ok: false, reason: `flow_duplicate_id:${id}` }
    ids.add(id)
    if (wrapLines(label, nodeWrap(kind)).length > 4) return { ok: false, reason: `flow_label_too_long:${id}` }
    nodes.push({ id, label: label.trim(), kind })
  }
  if (nodes.filter(n => n.kind === 'start').length !== 1) return { ok: false, reason: 'flow_start_count' }
  if (!nodes.some(n => n.kind === 'end')) return { ok: false, reason: 'flow_no_end' }
  if (!Array.isArray(raw.edges) || raw.edges.length < VISUAL_LIMITS.flow.edgesMin || raw.edges.length > VISUAL_LIMITS.flow.edgesMax) return { ok: false, reason: 'flow_edge_count' }
  const edges: FlowEdge[] = []
  const seen = new Set<string>()
  for (const [i, rawEdge] of raw.edges.entries()) {
    if (!obj(rawEdge)) return { ok: false, reason: `flow_edge_ref:${i}` }
    const from = rawEdge.from ?? rawEdge.source
    const to = rawEdge.to ?? rawEdge.target
    if (typeof from !== 'string' || typeof to !== 'string' || !ids.has(from) || !ids.has(to))
      return { ok: false, reason: `flow_edge_ref:${i}` }
    if (from === to) return { ok: false, reason: `flow_self_loop:${i}` }
    if (rawEdge.label !== undefined && !text(rawEdge.label, VISUAL_LIMITS.flow.edgeLabelMax))
      return { ok: false, reason: `flow_edge_label:${i}` }
    const key = `${from}>${to}`
    if (seen.has(key)) return { ok: false, reason: `flow_duplicate_edge:${key}` }
    seen.add(key)
    edges.push({ from, to, ...(typeof rawEdge.label === 'string' ? { label: rawEdge.label.trim() } : {}) })
  }
  const out = (id: string) => edges.filter(e => e.from === id)
  const inc = (id: string) => edges.filter(e => e.to === id)
  for (const n of nodes) {
    const o = out(n.id)
    if (n.kind === 'start' && inc(n.id).length) return { ok: false, reason: 'flow_start_has_incoming' }
    if (n.kind === 'end' && o.length) return { ok: false, reason: `flow_end_has_outgoing:${n.id}` }
    if (n.kind !== 'end' && o.length === 0) return { ok: false, reason: `flow_dead_end:${n.id}` }
    if (n.kind === 'decision') {
      if (o.length < 2 || o.length > 4) return { ok: false, reason: `flow_decision_branches:${n.id}` }
      if (o.some(e => !e.label)) return { ok: false, reason: `flow_decision_unlabelled:${n.id}` }
      if (new Set(o.map(e => e.label!.toLowerCase())).size !== o.length) return { ok: false, reason: `flow_decision_duplicate_label:${n.id}` }
    } else if (o.length > 1) return { ok: false, reason: `flow_branch_without_decision:${n.id}` }
  }
  const start = nodes.find(n => n.kind === 'start')!
  const reach = new Set([start.id]); const q = [start.id]
  while (q.length) for (const e of out(q.shift()!)) if (!reach.has(e.to)) { reach.add(e.to); q.push(e.to) }
  const lost = nodes.find(n => !reach.has(n.id))
  if (lost) return { ok: false, reason: `flow_unreachable:${lost.id}` }
  const lv = layoutLevels({ title: '', nodes, edges })
  for (let l = 0; l <= Math.max(...lv.values()); l++)
    if (nodes.filter(n => lv.get(n.id) === l).length > MAX_PER_LEVEL) return { ok: false, reason: `flow_level_too_wide:${l}` }
  return { ok: true, flow: { title: (raw.title as string).trim(), ...(text(raw.subtitle, 80) ? { subtitle: (raw.subtitle as string).trim() } : {}), nodes, edges } }
}

/** Edges that close a cycle (DFS from the start): they point back to a node still on the stack. */
export function backEdges(f: FlowContent): Set<string> {
  const start = f.nodes.find(n => n.kind === 'start')!
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
  visit(start.id)
  return back
}

/** Level = longest path from the start over forward edges (cycles removed). Deterministic; ends sink to the bottom. */
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

const W = 520, TOPY = 64, ROW = 96, NW = 112, NH = 52, DW = 128, DH = 70
const KIND_TONE: Record<FlowKind, keyof typeof TONES> = { start: 'ok', step: 'info', decision: 'warn', end: 'highlight' }

/** Deterministic SVG. Same input, same bytes; every node label and every edge label is drawn. */
export function renderFlowchartSvg(f: FlowContent, opts: { fixed?: boolean } = {}): string {
  const lv = layoutLevels(f)
  const levels = Math.max(...lv.values()) + 1
  const H = TOPY + levels * ROW + 20
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>()
  for (let l = 0; l < levels; l++) {
    const row = f.nodes.filter(n => lv.get(n.id) === l)
    row.forEach((n, i) => {
      const w = n.kind === 'decision' ? DW : NW, h = n.kind === 'decision' ? DH : NH
      pos.set(n.id, { x: (W / (row.length + 1)) * (i + 1), y: TOPY + l * ROW + DH / 2, w, h })
    })
  }
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${opts.fixed ? `width="${W}" height="${H}"` : `preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;min-width:440px;height:auto"`} role="img" aria-label="${esc(f.title)}" font-family="system-ui,-apple-system,Segoe UI,Noto Sans,Noto Naskh Arabic,sans-serif">`,
    `<defs><marker id="lg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#475569"/></marker></defs>`,
    `<rect width="${W}" height="${H}" rx="14" fill="#ffffff"/>`,
    `<text x="${W / 2}" y="30" text-anchor="middle" font-size="18" font-weight="700" fill="#111827" style="unicode-bidi:plaintext">${esc(f.title)}</text>`,
  ]
  if (f.subtitle) parts.push(`<text x="${W / 2}" y="46" text-anchor="middle" font-size="12" fill="#4b5563" style="unicode-bidi:plaintext">${esc(f.subtitle)}</text>`)
  const labels: string[] = []
  const laneUse = { left: 0, right: 0 }
  f.edges.forEach((e, i) => {
    const a = pos.get(e.from)!, b = pos.get(e.to)!
    const dl = lv.get(e.to)! - lv.get(e.from)!
    let d: string, lx: number, ly: number
    if (dl === 1) {
      const x1 = a.x, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y - b.h / 2, my = (y1 + y2) / 2
      d = `M${x1.toFixed(1)} ${y1.toFixed(1)} C${x1.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
      lx = (x1 + x2) / 2; ly = my - 4
    } else {
      // Long, back or same-level edge: travel in a side lane so it never crosses a node.
      const right = (a.x + b.x) / 2 >= W / 2
      const lane = right ? W - 12 - (laneUse.right++ % 3) * 8 : 12 + (laneUse.left++ % 3) * 8
      const x1 = a.x + (right ? a.w / 2 : -a.w / 2), y1 = a.y, x2 = b.x + (right ? b.w / 2 : -b.w / 2), y2 = b.y
      d = `M${x1.toFixed(1)} ${y1.toFixed(1)} C${lane} ${y1.toFixed(1)} ${lane} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
      lx = lane + (right ? -2 : 2); ly = (y1 + y2) / 2
    }
    parts.push(`<path data-edge="${esc(e.from)}>${esc(e.to)}" d="${d}" fill="none" stroke="#475569" stroke-width="1.8" marker-end="url(#lg-arrow)"/>`)
    if (e.label) {
      const w = Math.max(24, e.label.length * 6.4 + 10)
      labels.push(`<rect x="${(lx - w / 2).toFixed(1)}" y="${(ly - 11).toFixed(1)}" width="${w.toFixed(1)}" height="16" rx="4" fill="#ffffff" stroke="#cbd5e1"/>`,
        `<text x="${lx.toFixed(1)}" y="${(ly + 1).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#334155" style="unicode-bidi:plaintext">${esc(e.label)}</text>`)
    }
  })
  for (const n of f.nodes) {
    const p = pos.get(n.id)!, t = TONES[KIND_TONE[n.kind]]
    const shape = n.kind === 'decision'
      ? `<polygon data-node="${esc(n.id)}" points="${p.x},${p.y - p.h / 2} ${p.x + p.w / 2},${p.y} ${p.x},${p.y + p.h / 2} ${p.x - p.w / 2},${p.y}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>`
      : `<rect data-node="${esc(n.id)}" x="${(p.x - p.w / 2).toFixed(1)}" y="${(p.y - p.h / 2).toFixed(1)}" width="${p.w}" height="${p.h}" rx="${n.kind === 'step' ? 8 : p.h / 2}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>`
    const lines = wrapLines(n.label, nodeWrap(n.kind))
    const y0 = p.y - ((lines.length - 1) * 7.5) + 4
    parts.push(shape, `<text text-anchor="middle" font-size="11.5" font-weight="600" fill="${t.ink}" style="unicode-bidi:plaintext">${lines.map((ln, k) => `<tspan x="${p.x.toFixed(1)}" y="${(y0 + k * 15).toFixed(1)}">${esc(ln)}</tspan>`).join('')}</text>`)
  }
  parts.push(...labels, '</svg>')
  return parts.join('')
}
