// LINGORA 7.1 — one HTML -> Chromium -> PDF engine for ALL writing systems.
// The font resolver works on characters actually present, not UI language.
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { resolveDocumentFonts } from './fontResolver';

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Deterministic transcript rendering. Never invoke a summarizer or LLM here.
export function transcriptPrintHtml(title: string, content: string): string {
  const chunks = content.split(/\n(?=\[(?:Student|USER|SARAH|ALEX|NICK)\]:)/i);
  const entries = chunks.map(chunk => {
    const match = chunk.match(/^\[([^\]]+)\]:\s*/);
    const speaker = match?.[1] ?? '';
    const message = match ? chunk.slice(match[0].length) : chunk;
    return '<section class="ln-turn">' +
      (speaker ? '<h2 class="ln-speaker">' + esc(speaker) + '</h2>' : '') +
      '<div class="ln-speech" dir="auto">' + esc(message) + '</div></section>';
  }).join('\n');
  return '<!DOCTYPE html><html lang="und"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(title) + '</title><style>' +
    'body{margin:0;color:#132b40;background:white;line-height:1.6}' +
    '.ln-header{background:#102a40;color:white;padding:16px 22px;margin-bottom:20px}' +
    '.ln-header strong{font-size:18pt;letter-spacing:.02em}' +
    '.ln-header h1{font-size:16pt;margin:8px 0 0}' +
    '.ln-turn{padding:12px 4px;border-bottom:1px solid #dde4e9;break-inside:auto}' +
    '.ln-speaker{font-size:10pt;color:#08777d;margin:0 0 7px;font-weight:700}' +
    '.ln-speech{font-size:11pt;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext}' +
    '</style></head><body><header class="ln-header"><strong>LINGORA</strong><h1>' + esc(title) +
    '</h1></header><main>' + entries + '</main></body></html>';
}

export async function renderDocumentPdf(
  html: string,
  options: { layout?: 'document' | 'lesson' } = {},
): Promise<Uint8Array> {
  const text = html.replace(/<[^>]*>/g, ' ');
  const resolved = await resolveDocumentFonts(text);
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    const page = await browser.newPage();
    // CSS/data fonts are embedded before page load; Chromium needs no
    // external access and won't print while a font request is unfinished.
    const fontList = [...resolved.families].reverse().map(f => JSON.stringify(f)).join(',');
    const documentCSS = options.layout === 'lesson'
      ? '@page{size:A4;margin:0} .page{width:210mm;max-width:210mm}'
      : '@page{size:A4;margin:15mm 14mm}';
    const commonCSS =
      '<style>' + resolved.css + '\n' + documentCSS +
      'body{font-family:' + fontList + ',sans-serif!important}' +
      ':is(p,li,td,th,blockquote,h1,h2,h3,h4,.ln-speech){unicode-bidi:plaintext;text-align:start}' +
      'table{max-width:100%;min-width:0!important;break-inside:auto}' +
      'th,td{overflow-wrap:anywhere;vertical-align:top}' +
      'tr{break-inside:avoid-page}' +
      'p,li,blockquote{orphans:3;widows:3}' +
      '</style>';
    const prepared = html.includes('</head>')
      ? html.replace('</head>', commonCSS + '</head>')
      : '<!DOCTYPE html><html><head>' + commonCSS + '</head><body>' + html + '</body></html>';
    await page.setContent(prepared, { waitUntil: 'load', timeout: 30000 });
    const loadedFonts = await page.evaluate(async () => {
      await document.fonts.ready;
      document.querySelectorAll('p,li,td,th,blockquote,h1,h2,h3,h4,.ln-speech').forEach(el => {
        if (!el.hasAttribute('dir')) el.setAttribute('dir', 'auto');
      });
      return Array.from(document.fonts).filter(face => face.status === 'loaded').length;
    });
    if (!loadedFonts) throw Error('No web fonts loaded for PDF document');
    const bytes = await page.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: false, timeout: 90000,
    });
    if (bytes.length < 600) throw Error('PDF renderer returned incomplete bytes');
    return new Uint8Array(bytes);
  } finally {
    if (browser) await browser.close();
  }
}
