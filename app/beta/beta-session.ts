// LINGORA 7.1 — local beta continuity (no server account or cross-device sync).
// Persist an honest, bounded session snapshot; do not silently reset on reload.
import type { ActiveMode, Lang, MK, Msg, SS, TK } from './beta-model'

export const BETA_SESSION_KEY = 'lingora-beta-session-v1'
const MAX_STORE_CHARS = 3_000_000
const MAX_MESSAGES = 80
const MAX_DATA_URL_CHARS = 180_000

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
  const value = raw as Partial<BetaSessionSnapshot>
  if (value.version !== 1 || !validLang.has(String(value.lang))
    || !validMentor.has(String(value.mentor)) || !validTopic.has(String(value.topic))
    || !validMode.has(String(value.activeMode))
    || !value.session || typeof value.session !== 'object' || !Array.isArray(value.msgs)) return null
  const msgs = value.msgs.filter((m): m is Msg =>
    !!m && typeof m.id === 'string' && typeof m.text === 'string'
    && ['user','sarah','alex','nick','ln'].includes(m.sender))
  return {
    version: 1, phase: value.phase === 'chat' ? 'chat' : 'onboarding',
    lang: value.lang!, mentor: value.mentor!, topic: value.topic!, activeMode: value.activeMode!,
    session: value.session as SS, msgs: msgs.slice(-MAX_MESSAGES), reduced: !!value.reduced,
  }
}

export function readBetaSession(): BetaSessionSnapshot | null {
  try {
    const raw = localStorage.getItem(BETA_SESSION_KEY)
    return raw ? validated(JSON.parse(raw)) : null
  } catch { return null }
}

function withoutExpiredLinks(msg: Msg): Msg {
  const artifact = (entry: NonNullable<Msg['artifact']>) => {
    const expired = Object.values(entry).some(v => typeof v === 'string'
      && v.startsWith('data:') && v.length > MAX_DATA_URL_CHARS)
    return expired ? null : entry
  }
  const single = msg.artifact ? artifact(msg.artifact) : null
  const multiple = msg.artifacts?.map(a => artifact(a)).filter((a): a is NonNullable<Msg['artifact']> => !!a) ?? null
  const discarded = (!!msg.artifact && !single)
    || (msg.artifacts != null && multiple != null && multiple.length !== msg.artifacts.length)
  return {
    ...msg, artifact: single, artifacts: multiple,
    audioUrl: msg.audioUrl?.startsWith('blob:') || msg.audioUrl?.startsWith('data:') ? undefined : msg.audioUrl,
    imageUrl: msg.imageUrl?.startsWith('blob:') || msg.imageUrl?.startsWith('data:') ? undefined : msg.imageUrl,
    artifactFailures: discarded
      ? [...(msg.artifactFailures ?? []), { subject: 'Archivo grande no conservado tras recarga; descárgalo durante la sesión' }]
      : msg.artifactFailures,
  }
}

export function saveBetaSession(input: Omit<BetaSessionSnapshot, 'version' | 'reduced'>): 'saved' | 'reduced' | 'failed' {
  try {
    // Registry payloads duplicate downloadable data URLs already present in messages.
    const session = { ...input.session } as SS & { artifactRegistry?: unknown }
    delete session.artifactRegistry
    const selected = input.msgs.slice(-MAX_MESSAGES)
    const snapshot: BetaSessionSnapshot = { ...input, version: 1, session, msgs: selected }
    let serialized = JSON.stringify(snapshot)
    if (serialized.length <= MAX_STORE_CHARS) {
      localStorage.setItem(BETA_SESSION_KEY, serialized)
      return 'saved'
    }
    const reduced = { ...snapshot, reduced: true, msgs: selected.map(withoutExpiredLinks) }
    serialized = JSON.stringify(reduced)
    // Never truncate message content. If storage cannot hold the history,
    // report failure, rather than pretend that a partial session is complete.
    if (serialized.length > MAX_STORE_CHARS) return 'failed'
    localStorage.setItem(BETA_SESSION_KEY, serialized)
    return 'reduced'
  } catch { return 'failed' }
}

export function clearBetaSession(): void {
  try { localStorage.removeItem(BETA_SESSION_KEY) } catch {}
}
