// 7.4 — Tutor memory. Structural pieces, no prompt tricks:
//  1. A typed memory the Tutor itself governs (remember / update / forget by id). The platform only
//     validates shape and size, stores provenance, and shows the memory back each turn, so facts
//     survive even when old messages no longer fit. The runtime never reads the student's words.
//  2. Ids are monotonic and never reused (a persisted counter), so "forget m5" can never hit a
//     different, later note.
//  3. One integral context budget (system + tools + memory + history + current turn + reply). The
//     history gets what remains: the whole thread when it fits (like any LLM chat), and only a hard
//     budget trims it, oldest first. Nothing is cut silently: dropped / shortened messages are
//     counted, logged, and declared to the Tutor in a context note.

export type TutorMemoryKind = 'goal' | 'fact' | 'level' | 'preference' | 'progress' | 'other'
export interface TutorMemoryEntry {
  id: string
  kind: TutorMemoryKind
  text: string
  learnedTurn: number
  updatedTurn: number
  at: string
}
export type TutorMemoryOp =
  | { op: 'remember'; kind: TutorMemoryKind; text: string }
  | { op: 'update'; id: string; kind?: TutorMemoryKind; text: string }
  | { op: 'forget'; id: string }

export const MEMORY_MAX_ENTRIES = 80
export const MEMORY_MAX_TEXT = 280
export const MEMORY_MAX_OPS = 8
const KINDS: TutorMemoryKind[] = ['goal', 'fact', 'level', 'preference', 'progress', 'other']

export const UPDATE_STUDENT_MEMORY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'update_student_memory',
    description: 'Keep durable notes about this student that you will need in later turns: goal, exam and its date, level, profession, preferences, recurring errors, commitments. The platform stores them with their origin and shows them back to you every turn, even when old messages no longer fit in view. Call it when you learn something durable, when a fact changes (update by id) or when the student asks you to forget something (forget by id). Short, factual, in your own words; one fact per note. Do not store health, religion, politics or financial details. It has no effect on your reply: keep writing your normal answer.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        ops: {
          type: 'array', maxItems: MEMORY_MAX_OPS,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              op: { type: 'string', enum: ['remember', 'update', 'forget'] },
              id: { type: 'string', description: 'Existing note id (update, forget).' },
              kind: { type: 'string', enum: KINDS },
              text: { type: 'string', description: 'The note (max ' + MEMORY_MAX_TEXT + ' characters).' },
            },
            required: ['op'],
          },
        },
      },
      required: ['ops'],
    },
  },
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, MEMORY_MAX_TEXT) : '')

export function parseMemoryOps(raw: unknown): TutorMemoryOp[] | null {
  if (!raw || typeof raw !== 'object') return null
  const list = (raw as Record<string, unknown>).ops
  if (!Array.isArray(list) || !list.length) return null
  const out: TutorMemoryOp[] = []
  for (const item of list.slice(0, MEMORY_MAX_OPS)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const kind = KINDS.includes(o.kind as TutorMemoryKind) ? (o.kind as TutorMemoryKind) : undefined
    const id = typeof o.id === 'string' ? o.id.trim().slice(0, 40) : ''
    const text = clean(o.text)
    if (o.op === 'remember' && text) out.push({ op: 'remember', kind: kind ?? 'fact', text })
    else if (o.op === 'update' && id && text) out.push({ op: 'update', id, ...(kind ? { kind } : {}), text })
    else if (o.op === 'forget' && id) out.push({ op: 'forget', id })
  }
  return out.length ? out : null
}

export function sanitizeMemory(value: unknown): TutorMemoryEntry[] {
  if (!Array.isArray(value)) return []
  const out: TutorMemoryEntry[] = []
  const seen = new Set<string>()
  for (const e of value) {
    if (!e || typeof e !== 'object') continue
    const m = e as Record<string, unknown>
    const text = clean(m.text)
    const id = typeof m.id === 'string' ? m.id.slice(0, 40) : ''
    if (!id || !text || seen.has(id)) continue
    seen.add(id)
    out.push({
      id, text,
      kind: KINDS.includes(m.kind as TutorMemoryKind) ? (m.kind as TutorMemoryKind) : 'fact',
      learnedTurn: Number.isFinite(m.learnedTurn) ? Number(m.learnedTurn) : 0,
      updatedTurn: Number.isFinite(m.updatedTurn) ? Number(m.updatedTurn) : 0,
      at: typeof m.at === 'string' ? m.at.slice(0, 40) : '',
    })
  }
  return out.slice(-MEMORY_MAX_ENTRIES)
}

/** The persisted id counter (`state.tutorMemorySeq`). Garbage becomes 0. */
export function sanitizeMemorySeq(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 1_000_000_000) : 0
}

export interface MemoryApplyResult {
  entries: TutorMemoryEntry[]
  /** Highest id number ever issued. Persist it as `state.tutorMemorySeq`; ids are never reused. */
  seq: number
  /** update/forget ids that matched no note (reported, never silently treated as success). */
  rejected: string[]
  /** Notes evicted because the memory is full (oldest-updated first). */
  evicted: number
}

/** Pure reducer. `turn` is the session's exchange counter; `at` an ISO timestamp (provenance). */
export function applyMemoryOps(current: unknown, ops: TutorMemoryOp[], turn: number, at: string, storedSeq?: unknown): MemoryApplyResult {
  let mem = sanitizeMemory(current)
  let seq = Math.max(
    sanitizeMemorySeq(storedSeq),
    mem.reduce((n, e) => Math.max(n, Number(/^m(\d+)$/.exec(e.id)?.[1] ?? 0)), 0),
  )
  const rejected: string[] = []
  for (const op of ops) {
    if (op.op === 'forget') {
      if (mem.some(e => e.id === op.id)) mem = mem.filter(e => e.id !== op.id)
      else rejected.push(op.id)
    } else if (op.op === 'update') {
      if (mem.some(e => e.id === op.id)) mem = mem.map(e => (e.id === op.id ? { ...e, text: op.text, kind: op.kind ?? e.kind, updatedTurn: turn, at } : e))
      else rejected.push(op.id)
    } else {
      const dup = mem.find(e => e.text.toLowerCase() === op.text.toLowerCase())
      if (dup) mem = mem.map(e => (e.id === dup.id ? { ...e, updatedTurn: turn, at } : e))
      else mem = [...mem, { id: 'm' + ++seq, kind: op.kind, text: op.text, learnedTurn: turn, updatedTurn: turn, at }]
    }
  }
  let evicted = 0
  if (mem.length > MEMORY_MAX_ENTRIES) {
    evicted = mem.length - MEMORY_MAX_ENTRIES
    mem = [...mem].sort((a, b) => a.updatedTurn - b.updatedTurn).slice(evicted)
    mem.sort((a, b) => Number(/^m(\d+)$/.exec(a.id)?.[1] ?? 0) - Number(/^m(\d+)$/.exec(b.id)?.[1] ?? 0))
  }
  return { entries: mem, seq, rejected, evicted }
}

export function formatMemoryBlock(value: unknown): string {
  const mem = sanitizeMemory(value)
  if (!mem.length) return ''
  const lines = mem.map(e => `- ${e.id} [${e.kind}, learned at exchange ${e.learnedTurn}${e.updatedTurn !== e.learnedTurn ? ', updated ' + e.updatedTurn : ''}] ${e.text}`)
  return '\n\n[STUDENT MEMORY — notes you recorded with update_student_memory; they stay valid even if the messages they came from are no longer in view]\n' + lines.join('\n')
}

// ── Integral context budget ──────────────────────────────────────────────────────────────
/** Total prompt window we plan against (system + tools + memory + history + current turn). */
export const CONTEXT_TOKENS_DEFAULT = 128_000
/** Reserved for the reply (max completion tokens) and per-request overhead. */
export const OUTPUT_RESERVE_TOKENS = 8_192 + 1_024
/** Floor so a pathological prompt never leaves the history with nothing at all. */
export const HISTORY_MIN_TOKENS = 2_000
// Conservative estimate across scripts (Latin ≈ 4 chars/token, Arabic/CJK ≈ 1–2): never undercounts much.
export const estimateTokens = (s: string): number => Math.ceil(s.length / 2.5) + 4

/** Everything that is not history. `fixed` is the sum of the parts the model always receives. */
export function planHistoryBudget(parts: { system: string; tools: unknown; user: string; languageNote?: string }, opts: { contextTokens?: number; outputReserve?: number; cap?: number } = {}): { historyBudget: number; fixedTokens: number; contextTokens: number } {
  const contextTokens = opts.contextTokens && opts.contextTokens > 0 ? opts.contextTokens : CONTEXT_TOKENS_DEFAULT
  const outputReserve = opts.outputReserve ?? OUTPUT_RESERVE_TOKENS
  const fixedTokens = estimateTokens(parts.system) + estimateTokens(JSON.stringify(parts.tools ?? [])) + estimateTokens(parts.user) + estimateTokens(parts.languageNote ?? '') + outputReserve
  let historyBudget = Math.max(HISTORY_MIN_TOKENS, contextTokens - fixedTokens)
  if (opts.cap && opts.cap > 0) historyBudget = Math.min(historyBudget, Math.max(HISTORY_MIN_TOKENS, opts.cap))
  return { historyBudget, fixedTokens, contextTokens }
}

export interface HistoryTurn { role: 'user' | 'assistant'; content: string }
export interface HistoryWindow<T> { kept: T[]; dropped: number; shortened: number }

function shortenToBudget(content: string, budgetTokens: number): string {
  // Visible, never silent: head + tail survive and the gap says exactly how much was omitted.
  const keepChars = Math.max(400, Math.floor((budgetTokens - 60) * 2.5))
  if (content.length <= keepChars) return content
  const head = Math.ceil(keepChars * 0.6), tail = keepChars - head
  const omitted = content.length - head - tail
  return content.slice(0, head) + `\n[… LINGORA omitted ${omitted} characters of this message to fit the context window …]\n` + content.slice(content.length - tail)
}

/** Newest-first accumulation up to the budget; returns chronological order. Never a message count.
 *  Whole messages are dropped oldest-first. A single message larger than the whole budget is
 *  shortened with a visible marker (and counted); no other message is ever altered. */
export function selectHistoryWindow<T extends HistoryTurn>(history: T[], budgetTokens: number = CONTEXT_TOKENS_DEFAULT - OUTPUT_RESERVE_TOKENS): HistoryWindow<T> {
  const kept: T[] = []
  let used = 0
  let shortened = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    let cost = estimateTokens(m.content)
    let turn = m
    if (cost > budgetTokens) {
      if (kept.length) break
      turn = { ...m, content: shortenToBudget(m.content, budgetTokens) }
      cost = estimateTokens(turn.content)
      shortened++
    } else if (used + cost > budgetTokens) break
    used += cost
    kept.push(turn)
  }
  kept.reverse()
  return { kept, dropped: history.length - kept.length, shortened }
}

/** What the Tutor is told when the thread no longer fits whole — so nothing disappears silently. */
export function formatContextNote(w: { dropped: number; shortened: number }): string {
  if (!w.dropped && !w.shortened) return ''
  const parts: string[] = []
  if (w.dropped) parts.push(`${w.dropped} earlier message(s) of this conversation are no longer in view because the thread exceeds the context window`)
  if (w.shortened) parts.push(`${w.shortened} very long message(s) were shortened and are marked where text was omitted`)
  return `\n\n[CONTEXT NOTE] ${parts.join('; ')}. Durable facts you recorded stay in STUDENT MEMORY. If the student refers to something you cannot see, say so and ask, rather than guessing.`
}
