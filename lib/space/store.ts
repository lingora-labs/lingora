// LINGORA 7.5 — Space storage. IndexedDB database `lingora-space-v1`, isolated per origin.
//   store `spaces`        : the Space record (instructions, sources, memory, conversation index, interest, offers)
//   store `conversations` : one record per conversation (messages with their artifacts, session)
// Conversations are separate records so a streamed turn rewrites only its own conversation,
// never every other conversation's files.
//
// Writes are serialized: a late debounced save can never reappear after a Reset or a delete.
// The backend is injectable (memory backend for tests); the browser uses IndexedDB.
import { createConversation, createSpace, validateSpace, addConversationRef, removeConversationRef, type Conversation, type Space } from './model'

export const SPACE_DB = 'lingora-space-v1'
export const SPACE_STORE = 'spaces'
export const CONVERSATION_STORE = 'conversations'
const CURRENT_SPACE_KEY = 'current'
/** Above this, a conversation is saved without its oversized embedded files and says so. */
export const MAX_CONVERSATION_CHARS = 60_000_000

export interface SpaceBackend {
  get(store: string, key: string): Promise<unknown>
  put(store: string, key: string, value: unknown): Promise<void>
  delete(store: string, key: string): Promise<void>
}

export function memoryBackend(): SpaceBackend & { dump(): Record<string, Map<string, unknown>> } {
  const stores: Record<string, Map<string, unknown>> = { [SPACE_STORE]: new Map(), [CONVERSATION_STORE]: new Map() }
  const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v))
  return {
    async get(s, k) { return clone(stores[s].get(k)) },
    async put(s, k, v) { stores[s].set(k, clone(v)) },
    async delete(s, k) { stores[s].delete(k) },
    dump: () => stores,
  }
}

export function indexedDbBackend(): SpaceBackend {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(Error('IndexedDB no está disponible en este navegador'))
    const req = indexedDB.open(SPACE_DB, 1)
    req.onupgradeneeded = () => {
      for (const s of [SPACE_STORE, CONVERSATION_STORE]) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? Error('IndexedDB open failed'))
    req.onblocked = () => reject(Error('IndexedDB bloqueado por otra pestaña'))
  })
  const run = async <T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open()
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        let result: T
        const r = op(tx.objectStore(store))
        r.onsuccess = () => { result = r.result }
        r.onerror = () => reject(r.error ?? Error('IndexedDB request failed'))
        tx.oncomplete = () => resolve(result)
        tx.onerror = () => reject(tx.error ?? Error('IndexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? Error('IndexedDB aborted'))
      })
    } finally { db.close() }
  }
  return {
    get: (s, k) => run(s, 'readonly', st => st.get(k)),
    put: async (s, k, v) => { await run(s, 'readwrite', st => st.put(v, k)) },
    delete: async (s, k) => { await run(s, 'readwrite', st => st.delete(k)) },
  }
}

export type SaveResult = 'saved' | 'reduced' | 'failed'

export interface ConversationSeed<S> { session: S; ui: Conversation['ui'] }

export function createSpaceStore<M extends { artifact?: unknown; artifacts?: unknown }, S>(backend: SpaceBackend, opts: {
  /** Removes oversized embedded files from a message and marks it (persistLoss). */
  reduceMessage?: (m: M) => M
} = {}) {
  let queue: Promise<void> = Promise.resolve()
  const serialized = <T>(op: () => Promise<T>): Promise<T> => {
    const next = queue.then(op, op)
    queue = next.then(() => undefined, () => undefined)
    return next
  }
  const readSpace = async () => validateSpace(await backend.get(SPACE_STORE, CURRENT_SPACE_KEY))
  const writeSpace = (space: Space) => backend.put(SPACE_STORE, CURRENT_SPACE_KEY, space)
  const readConversation = async (id: string): Promise<Conversation<M, S> | null> => {
    const raw = await backend.get(CONVERSATION_STORE, id) as Conversation<M, S> | undefined
    return raw && typeof raw === 'object' && raw.id === id && Array.isArray(raw.msgs) ? raw : null
  }

  return {
    /** Opens the Space, creating it (and migrating a legacy single session) the first time. */
    open(seed: () => Promise<(ConversationSeed<S> & { msgs?: M[]; reduced?: boolean }) | null>, fresh: () => ConversationSeed<S>) {
      return serialized(async () => {
        const existing = await readSpace()
        if (existing) {
          let active = existing.activeConversationId ? await readConversation(existing.activeConversationId) : null
          let space = existing
          if (!active) {
            const f = fresh()
            active = createConversation<M, S>(space.id, f.session, f.ui)
            space = addConversationRef(space, active.id)
            await backend.put(CONVERSATION_STORE, active.id, active)
            await writeSpace(space)
          }
          return { space, conversation: active, migrated: false }
        }
        const legacy = await seed().catch(() => null)
        const base = legacy ?? fresh()
        const placeholder = createConversation<M, S>('', base.session, base.ui)
        const space = createSpace(placeholder.id)
        const conversation: Conversation<M, S> = { ...placeholder, spaceId: space.id, msgs: legacy?.msgs ?? [], ...(legacy?.reduced ? { reduced: true } : {}) }
        await backend.put(CONVERSATION_STORE, conversation.id, conversation)
        await writeSpace(space)
        return { space, conversation, migrated: !!legacy }
      })
    },
    saveSpace(space: Space) {
      return serialized(async (): Promise<SaveResult> => {
        try { await writeSpace(space); return 'saved' } catch { return 'failed' }
      })
    },
    /** Read-modify-write of the stored Space in one serialized step (other pages, e.g. /immersion, use this). */
    mutate<R>(fn: (space: Space) => { space: Space; result: R } | { refusal: string }) {
      return serialized(async (): Promise<{ ok: true; space: Space; result: R } | { ok: false; message: string }> => {
        const current = await readSpace()
        if (!current) return { ok: false, message: 'Todavía no existe un espacio en este navegador. Abre LINGORA para crearlo.' }
        const out = fn(current)
        if ('refusal' in out) return { ok: false, message: out.refusal }
        if (out.space === current) return { ok: true, space: current, result: out.result }
        try { await writeSpace(out.space); return { ok: true, space: out.space, result: out.result } }
        catch { return { ok: false, message: 'No se pudo guardar en tu espacio de este navegador.' } }
      })
    },
    /** Saves one conversation. Oversized: saved reduced (files dropped and marked), never silently. */
    saveConversation(conversation: Conversation<M, S>) {
      return serialized(async (): Promise<SaveResult> => {
        let record = conversation
        let chars = 0
        try { chars = JSON.stringify(record).length } catch { return 'failed' }
        if (chars > MAX_CONVERSATION_CHARS && opts.reduceMessage) record = { ...record, msgs: record.msgs.map(opts.reduceMessage), reduced: true }
        try {
          await backend.put(CONVERSATION_STORE, record.id, record)
          return record.reduced ? 'reduced' : 'saved'
        } catch { return 'failed' }
      })
    },
    loadConversation(id: string) { return serialized(() => readConversation(id)) },
    /** New empty conversation in the same Space; becomes active. */
    newConversation(space: Space, seed: ConversationSeed<S>) {
      return serialized(async () => {
        const conversation = createConversation<M, S>(space.id, seed.session, seed.ui)
        const next = addConversationRef(space, conversation.id)
        await backend.put(CONVERSATION_STORE, conversation.id, conversation)
        await writeSpace(next)
        return { space: next, conversation }
      })
    },
    switchConversation(space: Space, id: string) {
      return serialized(async () => {
        const conversation = await readConversation(id)
        if (!conversation) return null
        const next = { ...space, activeConversationId: id }
        await writeSpace(next)
        return { space: next, conversation }
      })
    },
    /** Reset: empties the ACTIVE conversation only (same id, new session). The Space is untouched. */
    resetConversation(conversation: Conversation<M, S>, seed: ConversationSeed<S>) {
      return serialized(async () => {
        const at = new Date().toISOString()
        const cleared: Conversation<M, S> = { ...conversation, msgs: [], session: seed.session, ui: seed.ui, reduced: undefined, updatedAt: at }
        try { await backend.put(CONVERSATION_STORE, cleared.id, cleared); return cleared } catch { return null }
      })
    },
    /** Deletes one conversation and its inferred memory; another becomes active (or a new one is created). */
    deleteConversation(space: Space, id: string, seed: ConversationSeed<S>) {
      return serialized(async () => {
        await backend.delete(CONVERSATION_STORE, id)
        let next = removeConversationRef(space, id)
        let conversation = next.activeConversationId ? await readConversation(next.activeConversationId) : null
        if (!conversation) {
          conversation = createConversation<M, S>(next.id, seed.session, seed.ui)
          next = addConversationRef(next, conversation.id)
          await backend.put(CONVERSATION_STORE, conversation.id, conversation)
        }
        await writeSpace(next)
        return { space: next, conversation }
      })
    },
    /** Explicit «Borrar espacio»: every conversation, source, memory fact and interest record. */
    deleteSpace(space: Space) {
      return serialized(async () => {
        try {
          for (const c of space.conversations) await backend.delete(CONVERSATION_STORE, c.id)
          await backend.delete(SPACE_STORE, CURRENT_SPACE_KEY)
          return true
        } catch { return false }
      })
    },
  }
}
