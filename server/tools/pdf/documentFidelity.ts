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
function words(value: string): string[] {
  return value.toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{4,}/gu) ?? []
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

function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1')
    .replace(/\x60([^\x60]+)\x60/g, '$1')
}

/** The fallback is THE document, not a second copy appended to a document. */
export function sourceToDocumentBlocks(source: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = []
  let paragraph: string[] = []
  let items: string[] = []
  let listType: 'bullets' | 'numbered' | null = null
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', content: plain(paragraph.join(' ')) })
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
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    const titledSection = line.match(/^\d{1,2}[.)]\s+(.{3,90})$/)
    const followedByBlank = i + 1 < lines.length && !lines[i + 1].trim()
    if (heading || (titledSection && followedByBlank)) {
      flushParagraph(); flushList()
      blocks.push({
        type: 'heading',
        level: heading ? Math.min(3, heading[1].length) as 1 | 2 | 3 : 2,
        content: plain(heading ? heading[2] : line),
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
  const tokens = (s: string) =>
    s.toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []
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
