// LINGORA 7.5 — what one turn receives from the Space.
//
// - The Space instructions: always.
// - Sources and CONFIRMED memory: only the passages that share words with the student's
//   message, best first, within RETRIEVAL_TOKEN_BUDGET. Every block carries its provenance id
//   (source:<id>#<passage> or memory:<id>), so the Tutor can say where a fact came from.
// - Inferred memory is never retrieved: until the student confirms it, it stays with the
//   conversation that produced it.
// - Nothing here reads a conversation. The history of the active conversation is built
//   from that conversation alone (buildConversationRequest).
import { estimateTokens, selectHistoryWindow } from '../tutor-memory'
import type { Space } from './model'
import { projectCommercialFacts } from './commercial-projection'

export const RETRIEVAL_TOKEN_BUDGET = 1_500
const PASSAGE_CHARS = 900

export interface SpaceBlock { id: string; kind: 'source' | 'memory'; label: string; text: string }
export interface SpaceContextPayload {
  spaceId: string
  instructions: string | null
  blocks: SpaceBlock[]
  /** Passages that matched but did not fit the budget (reported, not hidden). */
  omitted: number
  usedTokens: number
}

const STOP = new Set(('the and for are but not you your with this that from have has was were will what when where which who how ' +
  'que los las del por para con una uno unos unas como pero mas más sus sin sobre este esta esto estos estas ese esa eso entre ' +
  'cuando donde quien porque muy tambien también hay ser son fue han era les nos ella ellos mis tus del al lo le se').split(' '))

function fold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
}

/** Words of 3+ letters (any script with spaces) and character bigrams for scripts written without spaces. */
export function terms(text: string): Set<string> {
  const out = new Set<string>()
  const folded = fold(text)
  for (const w of folded.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(w)) {
      const chars = [...w]
      for (let i = 0; i < chars.length - 1; i++) out.add(chars[i] + chars[i + 1])
      if (chars.length === 1) out.add(chars[0])
      continue
    }
    if ([...w].length >= 3 && !STOP.has(w)) out.add(w)
  }
  return out
}

/** Paragraph-aligned passages of about PASSAGE_CHARS; long paragraphs split on whitespace. */
export function passages(text: string): string[] {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const out: string[] = []
  let cur = ''
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = '' }
  for (const p of paras) {
    if (p.length > PASSAGE_CHARS) {
      push()
      let rest = p
      while (rest.length > PASSAGE_CHARS) {
        let cut = rest.lastIndexOf(' ', PASSAGE_CHARS)
        if (cut < PASSAGE_CHARS / 2) cut = PASSAGE_CHARS
        out.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
      }
      cur = rest
      continue
    }
    if (cur && cur.length + p.length + 2 > PASSAGE_CHARS) push()
    cur = cur ? cur + '\n\n' + p : p
  }
  push()
  return out
}

export function retrieveForTurn(space: Space, message: string, budget = RETRIEVAL_TOKEN_BUDGET): SpaceContextPayload {
  const instructions = space.instructions.trim() || null
  const query = terms(message)
  const candidates: Array<SpaceBlock & { order: number; t: Set<string> }> = []
  let order = 0
  for (const s of space.sources) {
    passages(s.text).forEach((text, i) => candidates.push({ id: `source:${s.id}#${i + 1}`, kind: 'source', label: s.name, text, order: order++, t: terms(text) }))
  }
  for (const f of space.memory) {
    if (f.kind !== 'confirmed') continue
    const text = `${f.key}: ${f.value}`
    candidates.push({ id: `memory:${f.id}`, kind: 'memory', label: 'memoria confirmada', text, order: order++, t: terms(text) })
  }
  if (!query.size || !candidates.length) return { spaceId: space.id, instructions, blocks: [], omitted: 0, usedTokens: 0 }
  // Inverse document frequency over this Space: a word present everywhere says little.
  const df = new Map<string, number>()
  for (const c of candidates) for (const w of c.t) if (query.has(w)) df.set(w, (df.get(w) ?? 0) + 1)
  const N = candidates.length
  const scored = candidates
    .map(c => {
      let score = 0
      for (const w of query) if (c.t.has(w)) score += Math.log(1 + N / (df.get(w) ?? 1))
      return { c, score }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.order - b.c.order)
  const blocks: SpaceBlock[] = []
  let used = 0
  let omitted = 0
  for (const { c } of scored) {
    const cost = estimateTokens(c.text) + 12
    if (used + cost > budget) { omitted++; continue }
    used += cost
    blocks.push({ id: c.id, kind: c.kind, label: c.label, text: c.text })
  }
  return { spaceId: space.id, instructions, blocks, omitted, usedTokens: used }
}

type DialogueMsg = { sender: string; text?: string }

/**
 * Everything one turn takes from the student's side: the active conversation's own history and
 * what the Space contributes. The other conversations are not an input of this function.
 */
export function buildConversationRequest<M extends DialogueMsg>(
  space: Space,
  conversation: { id: string; msgs: M[] },
  message: string,
  opts: { rewindToLastUser?: boolean } = {},
) {
  const lastUser = conversation.msgs.map(m => m.sender).lastIndexOf('user')
  const source = opts.rewindToLastUser && lastUser >= 0 ? conversation.msgs.slice(0, lastUser) : conversation.msgs
  const conversationHistory = selectHistoryWindow(source
    .filter(m => m.sender !== 'ln' && (m.text || '').trim().length > 0)
    .map(m => ({ role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.text as string }))).kept
  return {
    conversationHistory,
    spaceContext: retrieveForTurn(space, message),
    // Space-wide facts the commercial context needs (frequency and recorded interest).
    commercialOffers: space.offers.map(o => ({ timestamp: o.timestamp, sessionId: o.sessionId })),
    immersionInterest: space.interest.map(i => ({ at: i.at, note: i.note })),
    // Bounded projection for immersion eligibility (independent of lexical retrieval).
    commercialFacts: projectCommercialFacts(space),
  }
}
