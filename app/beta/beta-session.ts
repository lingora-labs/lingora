// LINGORA 7.5 — the beta page stores its conversations in the student's Space
// (lib/space/store.ts, IndexedDB `lingora-space-v1`). This module is the adapter:
// - spaceStore: the Space store bound to the beta message/session types;
// - the 7.1–7.4 single-session store (`lingora-beta-v1` / localStorage) is READ ONLY,
//   once, to migrate that session into the first conversation, then cleared.
// Browser data clearing, private mode and storage eviction can remove files.
import type { ActiveMode, Lang, MK, Msg, SS, TK } from './beta-model'
import { createSpaceStore, indexedDbBackend } from '../../lib/space/store'

export const BETA_SESSION_KEY = 'lingora-beta-session-v1'
const DB_NAME = 'lingora-beta-v1'
const DB_STORE = 'sessions'
const DB_RECORD = 'current'
// Above this size an embedded file is dropped from a reduced save (and the message says so).
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

/** Legacy (7.1–7.4) single session, for migration only. */
export async function readLegacySession(): Promise<BetaSessionSnapshot | null> {
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

export function strippedArtifact(message: Msg): Msg {
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


/** Removes the legacy single-session copies once they live in the Space. */
export async function clearLegacySession(): Promise<void> {
  try { await transact('readwrite', store => store.delete(DB_RECORD)) } catch {}
  try { localStorage.removeItem(BETA_SESSION_KEY) } catch {}
}

export const spaceStore = createSpaceStore<Msg, SS>(indexedDbBackend(), { reduceMessage: strippedArtifact })
