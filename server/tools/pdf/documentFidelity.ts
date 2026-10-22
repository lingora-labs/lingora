// LINGORA 7.1 — document fidelity contract, independent of document genre.
// The Tutor Maestro already authored the content. A layout model may reorder
// or style it, but may never silently delete chapters, exercises or evidence.
import type { DocumentBlock } from './generateCoursePdf'

export interface DocumentFidelityResult {
  ok: boolean
  reason: 'ok' | 'empty_source' | 'empty_blocks' | 'empty_section' | 'loss_of_source'
  coverage: number
}

function blockText(blocks: DocumentBlock[]): string {
  return blocks.map(b => [b.content ?? '', ...(b.items ?? []), ...(b.headers ?? []),
    ...(b.rows ?? []).flat()].join(' ')).join(' ')
}
/**
 * ONE comparison projection for BOTH sides of every fidelity audit.
 * Inline emphasis delimiters (`*`, `_`, backtick) are presentation, not
 * content: the converter strips them, so the verifier must not let them act
 * as token boundaries on one side only. 7.4.1 root cause: the source
 * "و**ESTAR**" was tokenised as two words (و, estar) while the converted text
 * "وESTAR" is one, so a lossless conversion was rejected as `loss_of_source`.
 * The projection is applied BEFORE normalisation so composition across a
 * removed delimiter is symmetric too. It removes no letter or digit: a
 * dropped sentence, exercise or answer is still detected, and strictly.
 */
export function fidelityTokens(value: string): string[] {
  return value.replace(/[*_\x60]/g, '').toLocaleLowerCase().normalize('NFKC')
    .match(/[\p{L}\p{N}]+/gu) ?? []
}
function words(value: string): string[] {
  return fidelityTokens(value).filter(w => Array.from(w).length >= 4)
}

export function auditDocumentFidelity(source: string, blocks: DocumentBlock[]): DocumentFidelityResult {
  if (!source.trim()) return { ok: false, reason: 'empty_source', coverage: 0 }
  if (blocks.length < 2) return { ok: false, reason: 'empty_blocks', coverage: 0 }
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== 'heading') continue
    const next = blocks[i + 1]
    // A parent heading may contain subheadings; a sibling with no prose
    // is an empty section, as seen in the QA8 scientific dossier.
    if (!next || (next.type === 'heading' && (next.level ?? 1) <= (blocks[i].level ?? 1))) {
      return { ok: false, reason: 'empty_section', coverage: 0 }
    }
  }
  const sourceWords = new Set(words(source))
  const documentWords = new Set(words(blockText(blocks)))
  const coverage = sourceWords.size
    ? [...sourceWords].filter(w => documentWords.has(w)).length / sourceWords.size
    : 1
  // Deliberately conservative: false negatives select the lossless source
  // instead of approving a possibly incomplete paraphrase.
  return { ok: coverage >= 0.9, reason: coverage >= 0.9 ? 'ok' : 'loss_of_source', coverage }
}

/**
 * Inline marks the shared HTML renderer understands (**bold**, _italic_) are KEPT;
 * `__bold__` is normalised to `**bold**`. Runs of underscores are exercise blanks
 * ("______") and are never touched. Code ticks are dropped.
 */
function plain(text: string): string {
  return text.replace(/(?<![\w_])__([^_\n]+?)__(?![\w_])/gu, '**$1**')
    .replace(/\x60([^\x60]+)\x60/g, '$1')
}
const bare = (text: string): string => plain(text).replace(/\*\*/g, '')

const isPipeLine = (line: string): boolean => line.startsWith('|') && line.length > 1
const isSeparator = (line: string): boolean =>
  line.includes('|') && /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/.test(line)
function cells(line: string): string[] {
  const body = line.replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  return body.split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|').trim())
}

/**
 * The fallback is THE document, not a second copy appended to a document.
 * Structure the Tutor wrote is kept as structure: headings, lists, GFM tables,
 * block quotes, rules and line breaks inside a paragraph. Nothing is summarised
 * or reordered; `auditRecoveredSource` proves that no word was lost.
 */
export function sourceToDocumentBlocks(source: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = []
  let paragraph: string[] = []
  let items: string[] = []
  let listType: 'bullets' | 'numbered' | null = null
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', content: plain(paragraph.join('\n')) })
    paragraph = []
  }
  const flushList = () => {
    if (items.length && listType) blocks.push({ type: listType, items: items.map(plain) })
    items = []
    listType = null
  }
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) { flushParagraph(); flushList(); continue }
    // GFM table: header, separator, rows. Blank lines are tolerated until the
    // separator has been seen; a pipe run with no separator stays plain text.
    if (isPipeLine(line)) {
      const run: string[] = []
      let separators = 0
      let k = i
      for (; k < lines.length; k++) {
        const t = lines[k].trim()
        if (!t) { if (separators) break; continue }
        if (!isPipeLine(t)) break
        if (isSeparator(t)) { separators++; continue }
        run.push(t)
      }
      if (separators && run.length) {
        flushParagraph(); flushList()
        const [head, ...rows] = run.map(cells)
        const width = head.length
        blocks.push({
          type: 'table', headers: head.map(h => bare(h)),
          rows: rows.map(r => Array.from({ length: Math.max(width, r.length) }, (_, c) => plain(r[c] ?? ''))),
        })
        i = k - 1
        continue
      }
    }
    if (/^(?:-{3,}|\*{3,})$/.test(line)) { flushParagraph(); flushList(); blocks.push({ type: 'divider' }); continue }
    if (line.startsWith('>')) {
      flushParagraph(); flushList()
      const quoted: string[] = []
      for (; i < lines.length && lines[i].trim().startsWith('>'); i++) {
        quoted.push(lines[i].trim().replace(/^>+\s?/, ''))
      }
      i--
      const text = quoted.join('\n').trim()
      if (text) blocks.push({ type: 'quote', content: plain(text) })
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    // 7.4.2: "N." alone, with its options indented below, is ONE numbered item.
    if (/^\d+[.)]$/.test(line) && i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
      flushParagraph()
      if (listType && listType !== 'numbered') flushList()
      listType = 'numbered'
      const sub: string[] = []
      let k = i + 1
      for (; k < lines.length && /^\s+\S/.test(lines[k]); k++) sub.push(lines[k].trim())
      items.push(sub.join('\n'))
      i = k - 1
      continue
    }
    // 7.4.2: the last item of a numbered list is an item, never a heading just
    // because a blank line follows it (item 10 became a level-2 heading).
    const titledSection = (listType === 'numbered' && items.length) ? null : line.match(/^\d{1,2}[.)]\s+(.{3,90})$/)
    const followedByBlank = i + 1 < lines.length && !lines[i + 1].trim()
    if (heading || (titledSection && followedByBlank)) {
      flushParagraph(); flushList()
      blocks.push({
        type: 'heading',
        level: heading ? Math.min(3, heading[1].length) as 1 | 2 | 3 : 2,
        content: bare(heading ? heading[2] : line),
      })
      continue
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/)
    const numbered = line.match(/^\d+[.)]\s+(.+)$/)
    if (bullet || numbered) {
      flushParagraph()
      const nextType = bullet ? 'bullets' : 'numbered'
      if (listType && listType !== nextType) flushList()
      listType = nextType
      items.push((bullet ?? numbered)![1])
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushParagraph(); flushList()
  return blocks
}

/**
 * Checks a deterministic source-to-block conversion, not an LLM-composed
 * outline. Consecutive headings are legal in original tutor content.
 * Every meaningful source word, including repeats, must survive.
 */
export function auditRecoveredSource(
  source: string, blocks: DocumentBlock[],
): DocumentFidelityResult {
  if (!source.trim()) return { ok: false, reason: 'empty_source', coverage: 0 }
  if (!blocks.length) return { ok: false, reason: 'empty_blocks', coverage: 0 }
  const tokens = fidelityTokens
  const normalizedSource = source.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
  const expected = tokens(normalizedSource)
  const actual = tokens(blockText(blocks))
  const remaining = new Map<string, number>()
  for (const word of actual) remaining.set(word, (remaining.get(word) ?? 0) + 1)
  let retained = 0
  for (const word of expected) {
    const count = remaining.get(word) ?? 0
    if (count > 0) {
      retained++
      remaining.set(word, count - 1)
    }
  }
  const coverage = expected.length ? retained / expected.length : 1
  return {
    ok: coverage === 1,
    reason: coverage === 1 ? 'ok' : 'loss_of_source',
    coverage,
  }
}
