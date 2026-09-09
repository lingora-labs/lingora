import { escapeHtml } from './beta-escape'

export function fmt(t: string): string {
  if (!t) return ''
  let s = escapeHtml(t)
  s = s.replace(
    /\|(.+)\|\n\|([-| :]+)\|\n((?:\|.+\|\n?)+)/g,
    (_match, header, _sep, body) => {
      const ths = header.split('|').filter((c: string) => c.trim())
        .map((h: string) => `<th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:800;color:var(--teal);letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid rgba(0,201,167,.2);white-space:nowrap">${h.trim()}</th>`).join('')
      const trs = body.trim().split('\n').map((row: string) => {
        const cells = row.split('|').filter((c: string) => c !== undefined && row.includes('|'))
          .filter((_: string, i: number, arr: string[]) => i > 0 && i < arr.length)
          .map((c: string) => `<td style="padding:7px 10px;color:var(--silver);border-bottom:1px solid rgba(255,255,255,.04)">${c.trim()}</td>`).join('')
        return `<tr>${cells}</tr>`
      }).join('')
      return `<div style="overflow-x:auto;margin:8px 0"><table style="width:100%;border-collapse:collapse;font-size:13px;background:rgba(255,255,255,.02);border-radius:10px;overflow:hidden"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`
    }
  )
  s = s.replace(/^### (.+)$/gm, '<div style="font-size:13px;font-weight:800;color:var(--teal);margin:10px 0 4px;letter-spacing:.04em;text-transform:uppercase">$1</div>')
  s = s.replace(/^## (.+)$/gm,  '<div style="font-size:15px;font-weight:800;color:#fff;margin:12px 0 6px">$1</div>')
  s = s.replace(/^# (.+)$/gm,   '<div style="font-size:17px;font-weight:800;color:#fff;margin:14px 0 8px">$1</div>')
  s = s.replace(/((?:^- .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map((line: string) => `<li style="margin:3px 0;color:var(--silver)">${line.replace(/^- /, '')}</li>`).join('')
    return `<ul style="margin:6px 0 6px 16px;padding:0;list-style:none">${items}</ul>`
  })
  s = s.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    let n = 0
    const items = block.trim().split('\n').map((line: string) => { n++; return `<li style="margin:3px 0;color:var(--silver)"><span style="color:var(--teal);font-weight:700;margin-right:6px">${n}.</span>${line.replace(/^\d+\. /, '')}</li>` }).join('')
    return `<ol style="margin:6px 0 6px 8px;padding:0;list-style:none">${items}</ol>`
  })
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;font-weight:700">$1</strong>')
  s = s.replace(/\*(.+?)\*/g,     '<em style="color:var(--silver);font-style:italic">$1</em>')
  s = s.replace(/`(.+?)`/g,       '<code style="background:rgba(0,0,0,.4);padding:1px 6px;border-radius:4px;font-family:monospace;font-size:.86em;color:#7dd3fc">$1</code>')
  s = s.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:10px 0">')
  s = s.replace(/\n/g, '<br>')
  return s
}
