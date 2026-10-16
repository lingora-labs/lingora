// LINGORA 7.1 — Unicode/RTL document transport.
// Browser shaping and a real Arabic font are required; pdf-lib's
// StandardFonts cannot preserve Arabic joining or bidi text.
// This function is a renderer only; the Tutor Maestro owns the content.
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const ARABIC_FONT_URL =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notonaskharabic/NotoNaskhArabic%5Bwght%5D.ttf';

export function containsArabic(value: unknown): boolean {
  return /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(
    typeof value === 'string' ? value : JSON.stringify(value ?? ''),
  );
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function transcriptPrintHtml(title: string, content: string): string {
  const chunks = content.split(/\n(?=\[(?:Student|USER|SARAH|ALEX|NICK)\]:)/i);
  const entries = chunks.map((chunk) => {
    const match = chunk.match(/^\[([^\]]+)\]:\s*/);
    const label = match?.[1] ?? '';
    const body = match ? chunk.slice(match[0].length) : chunk;
    return '<section class="turn">' +
      (label ? '<div class="speaker">' + escapeHtml(label) + '</div>' : '') +
      '<div class="speech" dir="auto">' + escapeHtml(body) + '</div></section>';
  }).join('\n');
  return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title></head><body>' +
    '<header><strong>LINGORA</strong><h1>' + escapeHtml(title) + '</h1></header>' +
    '<main>' + entries + '</main></body></html>';
}

export async function renderUnicodePdf(html: string, requireArabic = false): Promise<Uint8Array> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    // AWS/Vercel Lambda ships no Arabic fonts. Register the licensed
    // Noto font BEFORE launching Chromium. Never silently render tofu.
    if (requireArabic) {
      const registered = await chromium.font(ARABIC_FONT_URL);
      if (!registered) throw new Error('Arabic font provisioning failed');
    }
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    const page = await browser.newPage();
    const printStyle = '<style>' +
      '@page{size:A4;margin:16mm 14mm}' +
      'html{print-color-adjust:exact;-webkit-print-color-adjust:exact}' +
      'body{font-family:"Noto Naskh Arabic","Open Sans",Arial,sans-serif;line-height:1.6;color:#1a2430}' +
      'main{max-width:none}' +
      '.speech{white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext;font-size:12pt;line-height:1.65}' +
      '.turn{break-inside:avoid-page;padding:10px 0;border-bottom:1px solid #dde3ea}' +
      '.speaker{font-size:10pt;font-weight:bold;color:#127e84;margin-bottom:5px}' +
      'header{background:#102b42;color:white;padding:18px 22px;margin-bottom:18px}' +
      'h1{font-size:18pt;margin:6px 0 0}' +
      'table{max-width:100%;width:100%;min-width:0!important;table-layout:auto;break-inside:auto}' +
      'th,td{overflow-wrap:anywhere;word-break:normal;vertical-align:top}' +
      'tr{break-inside:avoid-page}' +
      'p,li,blockquote{orphans:3;widows:3}' +
      '[dir="auto"]{unicode-bidi:plaintext}' +
      '</style>';
    const source = html.includes('</head>')
      ? html.replace('</head>', printStyle + '</head>')
      : '<html><head>' + printStyle + '</head><body>' + html + '</body></html>';
    await page.setContent(source, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(async () => { await document.fonts.ready; });
    const pdf = await page.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: false, timeout: 90000,
    });
    if (pdf.byteLength < 600) throw new Error('PDF renderer produced insufficient bytes');
    return new Uint8Array(pdf);
  } finally {
    if (browser) await browser.close();
  }
}
