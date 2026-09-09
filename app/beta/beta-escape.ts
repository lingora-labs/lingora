export function escapeHtml(t: string): string {
  const amp = String.fromCharCode(38)
  return t
    .split(amp).join(amp + 'amp;')
    .split('<').join(amp + 'lt;')
    .split('>').join(amp + 'gt;')
}
