// LINGORA 7.1 — complete same-browser continuity, including real PDF/HTML.
// IndexedDB stores the full structured-clone snapshot, not a truncated
// localStorage string. It requires no account, S3 credentials or new backend.
// Browser data clearing, private mode and storage eviction can remove files.
import type { ActiveMode, Lang, MK, Msg, SS, TK } from './beta-model'

export const BETA_SESSION_KEY = 'lingora-beta-session-v1'
const DB_NAME = 'lingora-beta-v1'
const DB_STORE = 'sessions'
const DB_RECORD = 'current'
// 7.5: no message-count cap (7.4 kept only the last 80 messages). The only limit is the size the
// browser store can hold; above it the session is saved reduced and says so.
const MAX_SNAPSHOT_CHARS = 60_000_000
const LOCAL_LIMIT = 3_000_000
const LOCAL_LINK_LIMIT = 180_000

export type BetaSessionSnapshot = {
  version: 1
  phase: 'chat' | 'onboarding'
  lang: Lang
  mentor: MK
  topic: TK
  activeMode: ActiveMode
  session: SS
  msgs: Msg[]
  reduced?: boolean
}

const validLang = new Set(['es','en','no','fr','de','it','pt','ar','ja','zh'])
const validMentor = new Set(['sarah','alex','nick'])
const validTopic = new Set(['conversation','structured','cervantes','business','travel','course','leveltest'])
const validMode = new Set(['interact','structured','pdf_course','free'])

function validated(raw: unknown): BetaSessionSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Partial<BetaSessionSnapshot>
  if (v.version !== 1 || !validLang.has(String(v.lang))
      || !validMentor.has(String(v.mentor)) || !validTopic.has(String(v.topic))
      || !validMode.has(String(v.activeMode)) || !v.session
      || typeof v.session !== 'object' || !Array.isArray(v.msgs)) return null
  const msgs = v.msgs.filter((m): m is Msg => !!m && typeof m.id === 'string'
    && typeof m.text === 'string' && ['user','sarah','alex','nick','ln'].includes(m.sender))
  return {
    version: 1, phase: v.phase === 'chat' ? 'chat' : 'onboarding',
    lang: v.lang!, mentor: v.mentor!, topic: v.topic!, activeMode: v.activeMode!,
    session: v.session as SS, msgs, reduced: !!v.reduced,
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(Error('IndexedDB unavailable'))
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? Error('IndexedDB open failed'))
    request.onblocked = () => reject(Error('IndexedDB blocked by another tab'))
  })
}

async function transact<T>(mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode)
      let result: T
      const request = callback(tx.objectStore(DB_STORE))
      request.onsuccess = () => { result = request.result }
      request.onerror = () => reject(request.error ?? Error('IndexedDB request failed'))
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error ?? Error('IndexedDB transaction failed'))
      tx.onabort = () => reject(tx.error ?? Error('IndexedDB aborted'))
    })
  } finally { db.close() }
}

// Session writes and resets have a single ordering authority. A late-running
// save cannot reappear after Reset and resurrect a private old conversation.
let writeQueue: Promise<void> = Promise.resolve()
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(operation, operation)
  writeQueue = next.then(() => undefined, () => undefined)
  return next
}

export async function readBetaSession(): Promise<BetaSessionSnapshot | null> {
  await writeQueue
  try {
    const stored = validated(await transact('readonly', store => store.get(DB_RECORD)))
    if (stored) return stored
  } catch (err) {
    console.warn('[LINGORA] IndexedDB read unavailable', err)
  }
  // Upgrade from the previous localStorage-only beta. Its large data URLs
  // may already have been discarded; do not claim they were recovered.
  try {
    const raw = localStorage.getItem(BETA_SESSION_KEY)
    return raw ? validated(JSON.parse(raw)) : null
  } catch { return null }
}

function strippedArtifact(message: Msg): Msg {
  const strip = (a: NonNullable<Msg['artifact']>) => {
    const oversized = Object.values(a).some(v => typeof v === 'string' && v.startsWith('data:')
      && v.length > LOCAL_LINK_LIMIT)
    return oversized ? null : a
  }
  const artifact = message.artifact ? strip(message.artifact) : null
  const artifacts = message.artifacts?.map(a => strip(a)).filter((a): a is NonNullable<Msg['artifact']> => !!a) ?? null
  const missing = (!!message.artifact && !artifact)
    || (message.artifacts != null && artifacts != null && artifacts.length !== message.artifacts.length)
  return {
    ...message, artifact, artifacts, ...(missing ? { persistLoss: true } : {}),
    audioUrl: message.audioUrl?.startsWith('data:') || message.audioUrl?.startsWith('blob:') ? undefined : message.audioUrl,
    imageUrl: message.imageUrl?.startsWith('data:') || message.imageUrl?.startsWith('blob:') ? undefined : message.imageUrl,
    artifactFailures: missing
      ? [...(message.artifactFailures ?? []), { subject: 'El navegador no pudo conservar este archivo; descárgalo ahora.' }]
      : message.artifactFailures,
  }
}

function localFallback(snapshot: BetaSessionSnapshot): 'reduced' | 'failed' {
  try {
    const session = { ...snapshot.session } as SS & { artifactRegistry?: unknown }
    delete session.artifactRegistry
    const reduced: BetaSessionSnapshot = {
      ...snapshot, session, reduced: true,
      msgs: snapshot.msgs.map(strippedArtifact),
    }
    const encoded = JSON.stringify(reduced)
    if (encoded.length > LOCAL_LIMIT) return 'failed'
    localStorage.setItem(BETA_SESSION_KEY, encoded)
    return 'reduced'
  } catch { return 'failed' }
}

export function saveBetaSession(
  input: Omit<BetaSessionSnapshot, 'version' | 'reduced'>,
): Promise<'saved' | 'reduced' | 'failed'> {
  return serialized(async () => {
    const session = { ...input.session } as SS & { artifactRegistry?: unknown }
    delete session.artifactRegistry
    const snapshot: BetaSessionSnapshot = {
      ...input, version: 1, session, msgs: input.msgs, reduced: false,
    }
    // Do not silently crop real artifacts to satisfy a storage limit.
    // Failure must be visible to the student, while preserving a text
    // fallback where possible.
    let chars = 0
    try { chars = JSON.stringify(snapshot).length } catch { return 'failed' }
    if (chars > MAX_SNAPSHOT_CHARS) return localFallback(snapshot)
    try {
      await transact('readwrite', store => store.put(snapshot, DB_RECORD))
      // Prevent old localStorage snapshots from resurfacing after an IDB
      // eviction or partial upgrade.
      try { localStorage.removeItem(BETA_SESSION_KEY) } catch {}
      return snapshot.reduced ? 'reduced' : 'saved'
    } catch (err) {
      console.warn('[LINGORA] IndexedDB write unavailable', err)
      return localFallback(snapshot)
    }
  })
}

export function clearBetaSession(): Promise<boolean> {
  return serialized(async () => {
    let idbCleared = false
    let localCleared = false
    try {
      await transact('readwrite', store => store.delete(DB_RECORD))
      idbCleared = true
    } catch (err) { console.warn('[LINGORA] IndexedDB clear unavailable', err) }
    try {
      localStorage.removeItem(BETA_SESSION_KEY)
      localCleared = true
    } catch (err) { console.warn('[LINGORA] localStorage clear unavailable', err) }
    // Reset is only confirmed if both existing storage routes completed.
    return idbCleared && localCleared
  })
}
