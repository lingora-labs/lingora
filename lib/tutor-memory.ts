// 7.3.3f — Tutor memory. Two structural pieces, no prompt tricks:
//  1. History window by token budget (not by message count): the Tutor sees as much of the
//     thread as fits, like any LLM chat. Only a hard context budget ever trims it, oldest first.
//  2. A typed memory the Tutor itself governs (remember / update / forget by id). The platform
//     only validates shape and size, stores provenance, and shows the memory back each turn, so
//     facts survive even when old messages no longer fit. The runtime never reads the student's words.

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
  for (const e of value) {
    if (!e || typeof e !== 'object') continue
    const m = e as Record<string, unknown>
    const text = clean(m.text)
    const id = typeof m.id === 'string' ? m.id.slice(0, 40) : ''
    if (!id || !text) continue
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

/** Pure reducer. `turn` is the session's exchange counter; `at` an ISO timestamp (provenance). */
export function applyMemoryOps(current: unknown, ops: TutorMemoryOp[], turn: number, at: string): TutorMemoryEntry[] {
  let mem = sanitizeMemory(current)
  let seq = mem.reduce((n, e) => Math.max(n, Number(/^m(\d+)$/.exec(e.id)?.[1] ?? 0)), 0)
  for (const op of ops) {
    if (op.op === 'forget') mem = mem.filter(e => e.id !== op.id)
    else if (op.op === 'update') mem = mem.map(e => (e.id === op.id ? { ...e, text: op.text, kind: op.kind ?? e.kind, updatedTurn: turn, at } : e))
    else {
      const dup = mem.find(e => e.text.toLowerCase() === op.text.toLowerCase())
      if (dup) mem = mem.map(e => (e.id === dup.id ? { ...e, updatedTurn: turn, at } : e))
      else mem = [...mem, { id: 'm' + ++seq, kind: op.kind, text: op.text, learnedTurn: turn, updatedTurn: turn, at }]
    }
  }
  if (mem.length > MEMORY_MAX_ENTRIES) mem = [...mem].sort((a, b) => a.updatedTurn - b.updatedTurn).slice(mem.length - MEMORY_MAX_ENTRIES)
  return mem
}

export function formatMemoryBlock(value: unknown): string {
  const mem = sanitizeMemory(value)
  if (!mem.length) return ''
  const lines = mem.map(e => `- ${e.id} [${e.kind}, learned at exchange ${e.learnedTurn}${e.updatedTurn !== e.learnedTurn ? ', updated ' + e.updatedTurn : ''}] ${e.text}`)
  return '\n\n[STUDENT MEMORY — notes you recorded with update_student_memory; they stay valid even if the messages they came from are no longer in view]\n' + lines.join('\n')
}

// ── History window by token budget ───────────────────────────────────────────────────────
export const HISTORY_TOKEN_BUDGET = 120_000
export const HISTORY_MESSAGE_MAX_CHARS = 24_000
// Conservative estimate across scripts (Latin ≈ 4 chars/token, Arabic/CJK ≈ 1–2): never undercounts much.
export const estimateTokens = (s: string): number => Math.ceil(s.length / 2.5) + 4

export interface HistoryTurn { role: 'user' | 'assistant'; content: string }
/** Newest-first accumulation up to the budget; returns chronological order. Never a message count. */
export function selectHistoryWindow<T extends HistoryTurn>(history: T[], budgetTokens: number = HISTORY_TOKEN_BUDGET, perMessageChars: number = HISTORY_MESSAGE_MAX_CHARS): { kept: T[]; dropped: number } {
  const kept: T[] = []
  let used = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    const content = m.content.length > perMessageChars ? m.content.slice(0, perMessageChars) : m.content
    const cost = estimateTokens(content)
    if (used + cost > budgetTokens && kept.length) break
    used += cost
    kept.push(content === m.content ? m : { ...m, content })
  }
  kept.reverse()
  return { kept, dropped: history.length - kept.length }
}
