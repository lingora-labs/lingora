// SHA-256 of a source's exact text (UTF-8), hex. Web Crypto exists in browsers (secure contexts) and Node 18+.
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw Error('Web Crypto no disponible: no se puede registrar la procedencia de la fuente')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Text a student can add as a source in this version: plain-text formats only, read as UTF-8. */
export const SOURCE_TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html', 'text/xml']
export const SOURCE_TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm', '.xml', '.srt', '.vtt']

export function isTextSource(name: string, mime: string): boolean {
  const lower = name.toLowerCase()
  return mime.startsWith('text/') || SOURCE_TEXT_TYPES.includes(mime) || SOURCE_TEXT_EXTENSIONS.some(e => lower.endsWith(e))
}
