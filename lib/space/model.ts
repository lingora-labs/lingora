// LINGORA 7.5 — the student's Space.
//
// A Space holds what the student brings and keeps: standing instructions, sources
// (text with provenance: name, type, SHA-256, date), memory (confirmed by the student,
// distinct from what the Tutor inferred) and N independent conversations.
// A conversation never reads another conversation's messages. What crosses between
// conversations is only what the student placed in the Space (instructions, sources,
// confirmed memory, immersion interest) and the immersion-offer frequency record.
//
// Pure data and pure operations. Storage lives in ./store.ts; selection for a turn in
// ./retrieve.ts. Isomorphic: no browser or server API is used here.
import type { AcceptedLearningFact } from '../learning-facts'

export const SPACE_VERSION = 1 as const

/** Resource limits (bytes/characters), each refused with a visible reason. Not cognitive caps. */
export const SPACE_RESOURCE_LIMITS = {
  instructionsChars: 8_000,
  sourceChars: 2_000_000,
  sourcesTotalChars: 20_000_000,
  memoryValueChars: 600,
} as const

export interface Source { id: string; name: string; mime: string; text: string; sha256: string; addedAt: string }
export interface MemoryFact {
  id: string
  kind: 'confirmed' | 'inferred'
  key: string
  value: string
  at: string
  /** For an inferred fact: the conversation whose Tutor recorded it. */
  conversationId?: string
  /** 7.5: a fact the Tutor declared and the runtime accepted on the student's own words (lib/learning-facts.ts). */
  provenance?: { origin: 'tutor_declared'; conversationId: string; evidence: string }
}
export interface ImmersionInterest { spaceId: string; conversationId: string | null; at: string; note: string }
/** Frequency record of immersion invitations actually sent by the Tutor. */
export interface OfferRecord { timestamp: number; sessionId: string | null }
export interface ConversationRef { id: string; title: string; createdAt: string; updatedAt: string }

export interface Space {
  version: typeof SPACE_VERSION
  id: string
  instructions: string
  sources: Source[]
  memory: MemoryFact[]
  conversations: ConversationRef[]
  activeConversationId: string
  interest: ImmersionInterest[]
  offers: OfferRecord[]
  createdAt: string
  updatedAt: string
}

/** One conversation. M/S are the client's message and session types. */
export interface Conversation<M = unknown, S = unknown> {
  id: string
  spaceId: string
  msgs: M[]
  session: S
  /** UI settings of this conversation (onboarding choices). */
  ui: { phase: 'chat' | 'onboarding' | 'mode'; lang: string; mentor: string; topic: string; activeMode: string }
  reduced?: boolean
  createdAt: string
  updatedAt: string
}

export type Refusal = { ok: false; message: string }

export function newId(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return prefix + '_' + rnd
}

const nowIso = (now?: number) => new Date(now ?? Date.now()).toISOString()

export function createSpace(firstConversationId: string, now?: number): Space {
  const at = nowIso(now)
  return {
    version: SPACE_VERSION, id: newId('sp'), instructions: '', sources: [], memory: [],
    conversations: [{ id: firstConversationId, title: 'Conversación 1', createdAt: at, updatedAt: at }],
    activeConversationId: firstConversationId, interest: [], offers: [], createdAt: at, updatedAt: at,
  }
}

export function createConversation<M, S>(spaceId: string, session: S, ui: Conversation['ui'], now?: number): Conversation<M, S> {
  const at = nowIso(now)
  return { id: newId('cv'), spaceId, msgs: [], session, ui, createdAt: at, updatedAt: at }
}

/** Title from the first real student line; stable once set. */
export function conversationTitle(msgs: Array<{ sender?: string; text?: string }>, fallback: string): string {
  const first = msgs.find(m => m.sender === 'user' && (m.text ?? '').trim())
  const line = (first?.text ?? '').trim().split('\n')[0]
  if (!line) return fallback
  return line.length > 60 ? line.slice(0, 57).trimEnd() + '…' : line
}

export function touchConversation(space: Space, id: string, title?: string, now?: number): Space {
  const at = nowIso(now)
  return {
    ...space, updatedAt: at,
    conversations: space.conversations.map(c => c.id === id ? { ...c, updatedAt: at, ...(title ? { title } : {}) } : c),
  }
}

export function addConversationRef(space: Space, id: string, now?: number): Space {
  const at = nowIso(now)
  const n = space.conversations.length + 1
  return {
    ...space, updatedAt: at, activeConversationId: id,
    conversations: [...space.conversations, { id, title: 'Conversación ' + n, createdAt: at, updatedAt: at }],
  }
}

export function removeConversationRef(space: Space, id: string): Space {
  const conversations = space.conversations.filter(c => c.id !== id)
  return {
    ...space, conversations,
    // Inferred facts belong to the conversation that produced them; confirmed facts belong to the student.
    memory: space.memory.filter(f => !(f.kind === 'inferred' && f.conversationId === id)),
    activeConversationId: space.activeConversationId === id ? (conversations[conversations.length - 1]?.id ?? '') : space.activeConversationId,
  }
}

export function setInstructions(space: Space, text: string, now?: number): Space | Refusal {
  if (text.length > SPACE_RESOURCE_LIMITS.instructionsChars) {
    return { ok: false, message: `Las instrucciones tienen ${text.length} caracteres; el máximo es ${SPACE_RESOURCE_LIMITS.instructionsChars}. No se guardaron.` }
  }
  return { ...space, instructions: text, updatedAt: nowIso(now) }
}

export function addSource(space: Space, input: { name: string; mime: string; text: string; sha256: string }, now?: number): Space | Refusal {
  const name = input.name.trim() || 'fuente sin nombre'
  if (!input.text.trim()) return { ok: false, message: `«${name}» no contiene texto legible. No se añadió.` }
  if (input.text.length > SPACE_RESOURCE_LIMITS.sourceChars) {
    return { ok: false, message: `«${name}» tiene ${(input.text.length / 1e6).toFixed(1)} M caracteres; el máximo por fuente es ${SPACE_RESOURCE_LIMITS.sourceChars / 1e6} M. No se añadió.` }
  }
  const total = space.sources.reduce((n, s) => n + s.text.length, 0) + input.text.length
  if (total > SPACE_RESOURCE_LIMITS.sourcesTotalChars) {
    return { ok: false, message: `Con «${name}» el espacio superaría ${SPACE_RESOURCE_LIMITS.sourcesTotalChars / 1e6} M caracteres de fuentes. No se añadió.` }
  }
  const duplicate = space.sources.find(s => s.sha256 === input.sha256)
  if (duplicate) return { ok: false, message: `«${name}» es idéntica a «${duplicate.name}» (mismo SHA-256). No se duplicó.` }
  const source: Source = { id: newId('src'), name, mime: input.mime || 'text/plain', text: input.text, sha256: input.sha256, addedAt: nowIso(now) }
  return { ...space, sources: [...space.sources, source], updatedAt: nowIso(now) }
}

export function removeSource(space: Space, id: string): Space {
  return { ...space, sources: space.sources.filter(s => s.id !== id) }
}

export function addConfirmedFact(space: Space, key: string, value: string, now?: number): Space | Refusal {
  const k = key.trim(), v = value.trim()
  if (!k || !v) return { ok: false, message: 'Un dato de memoria necesita un nombre y un valor.' }
  if (k.length + v.length > SPACE_RESOURCE_LIMITS.memoryValueChars) return { ok: false, message: `El dato supera ${SPACE_RESOURCE_LIMITS.memoryValueChars} caracteres. No se guardó.` }
  const fact: MemoryFact = { id: newId('mf'), kind: 'confirmed', key: k, value: v, at: nowIso(now) }
  return { ...space, memory: [...space.memory, fact], updatedAt: nowIso(now) }
}

/** The student confirms what the Tutor inferred: only now can other conversations use it. */
export function confirmFact(space: Space, id: string, now?: number): Space {
  return {
    ...space, updatedAt: nowIso(now),
    memory: space.memory.map(f => f.id === id ? { id: newId('mf'), kind: 'confirmed', key: f.key, value: f.value, at: nowIso(now) } : f),
  }
}

export function removeFact(space: Space, id: string): Space {
  return { ...space, memory: space.memory.filter(f => f.id !== id) }
}

/** Mirror the Tutor's notes of one conversation as inferred facts (replacing that conversation's previous mirror).
 *  An inferred fact is shown to the student and never retrieved into another conversation. */
export function mirrorInferredMemory(
  space: Space, conversationId: string,
  entries: Array<{ id: string; kind: string; text: string; at?: string }> | undefined,
): Space {
  const confirmedValues = new Set(space.memory.filter(f => f.kind === 'confirmed').map(f => f.value))
  const inferred: MemoryFact[] = (entries ?? [])
    .filter(e => e && typeof e.text === 'string' && e.text.trim() && !confirmedValues.has(e.text.trim()))
    .map(e => ({ id: `inf_${conversationId}_${e.id}`, kind: 'inferred' as const, key: e.kind, value: e.text.trim(), at: e.at ?? nowIso(), conversationId }))
  const kept = space.memory.filter(f => !(f.kind === 'inferred' && f.conversationId === conversationId))
  const before = space.memory.filter(f => f.kind === 'inferred' && f.conversationId === conversationId)
  const same = before.length === inferred.length && before.every((f, i) => f.id === inferred[i].id && f.value === inferred[i].value)
  return same ? space : { ...space, memory: [...kept, ...inferred] }
}

export function recordInterest(space: Space, conversationId: string | null, note: string, now?: number): Space | Refusal {
  const text = note.trim()
  if (text.length > 2_000) return { ok: false, message: 'La nota supera 2.000 caracteres. No se guardó.' }
  const entry: ImmersionInterest = { spaceId: space.id, conversationId, at: nowIso(now), note: text }
  return { ...space, interest: [...space.interest, entry], updatedAt: nowIso(now) }
}

/** Merge offers the server recorded this turn (dedup by timestamp+session). */
export function mergeOffers(space: Space, offers: unknown): Space {
  if (!Array.isArray(offers)) return space
  const seen = new Set(space.offers.map(o => o.timestamp + '|' + o.sessionId))
  const added: OfferRecord[] = []
  for (const o of offers) {
    const t = (o as { timestamp?: unknown })?.timestamp
    const s = (o as { sessionId?: unknown })?.sessionId
    if (typeof t !== 'number' || !Number.isFinite(t)) continue
    const rec = { timestamp: t, sessionId: typeof s === 'string' ? s : null }
    if (seen.has(rec.timestamp + '|' + rec.sessionId)) continue
    seen.add(rec.timestamp + '|' + rec.sessionId); added.push(rec)
  }
  return added.length ? { ...space, offers: [...space.offers, ...added] } : space
}

/**
 * 7.5 — store the facts accepted for a completed turn. Idempotent: the same student words in the same
 * conversation give the same id (retries, re-asks and reloads add nothing); one standing decline at most;
 * a reopening removes it. Returns the same object when nothing changes.
 */
export function applyLearningFacts(space: Space, facts: AcceptedLearningFact[]): Space {
  let memory = space.memory
  for (const f of facts) {
    if (f.fact === 'immersion_reopened') {
      if (memory.some(m => m.kind === 'confirmed' && m.key === 'immersion_declined')) memory = memory.filter(m => !(m.kind === 'confirmed' && m.key === 'immersion_declined'))
      continue
    }
    if (f.fact === 'immersion_declined') {
      if (memory.some(m => m.kind === 'confirmed' && m.key === 'immersion_declined')) continue
      memory = [...memory, { id: f.id, kind: 'confirmed', key: 'immersion_declined', value: f.at, at: f.at, provenance: { origin: 'tutor_declared', conversationId: f.conversationId, evidence: f.evidence } }]
      continue
    }
    if (memory.some(m => m.id === f.id)) continue
    memory = [...memory, { id: f.id, kind: 'confirmed', key: f.fact, value: f.text, at: f.at, provenance: { origin: 'tutor_declared', conversationId: f.conversationId, evidence: f.evidence } }]
  }
  return memory === space.memory ? space : { ...space, memory }
}

export function isRefusal(v: unknown): v is Refusal {
  return !!v && typeof v === 'object' && (v as { ok?: unknown }).ok === false
}

/** Structural validation of a stored Space (storage can be edited or corrupted outside LINGORA). */
export function validateSpace(raw: unknown): Space | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Partial<Space>
  if (v.version !== SPACE_VERSION || typeof v.id !== 'string' || !Array.isArray(v.conversations)) return null
  const str = (x: unknown) => typeof x === 'string'
  return {
    version: SPACE_VERSION, id: v.id,
    instructions: str(v.instructions) ? v.instructions! : '',
    sources: (Array.isArray(v.sources) ? v.sources : []).filter(s => s && str(s.id) && str(s.name) && str(s.text) && str(s.sha256)),
    memory: (Array.isArray(v.memory) ? v.memory : []).filter(f => f && str(f.id) && (f.kind === 'confirmed' || f.kind === 'inferred') && str(f.key) && str(f.value)),
    conversations: v.conversations.filter(c => c && str(c.id) && str(c.title)),
    activeConversationId: str(v.activeConversationId) ? v.activeConversationId! : '',
    interest: (Array.isArray(v.interest) ? v.interest : []).filter(i => i && str(i.at) && str(i.note)),
    offers: (Array.isArray(v.offers) ? v.offers : []).filter(o => o && typeof o.timestamp === 'number'),
    createdAt: str(v.createdAt) ? v.createdAt! : nowIso(),
    updatedAt: str(v.updatedAt) ? v.updatedAt! : nowIso(),
  }
}
