// LINGORA 7.1 — one HTML -> Chromium -> PDF engine for ALL writing systems.
// The font resolver works on characters actually present, not UI language.
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { resolveDocumentFonts, resolveMonospaceFont } from './fontResolver';

// The shared interactive page ships a strict CSP (default-src 'none'). The PDF
// engine embeds its glyph faces as data: URIs, which that CSP blocks as a
// network error. Widen ONLY font-src, only for the print render, and only for
// data: payloads that this module itself produced.
function allowEmbeddedFonts(html: string): string {
  return html.replace(
    /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i,
    (_m, open: string, policy: string, close: string) =>
      /font-src/i.test(policy) ? open + policy + close : open + policy + '; font-src data:' + close,
  );
}

/** The exact print document Chromium receives: the page plus the print stylesheet. Pure (QA renders it too). */
export function preparePrintHtml(html: string, fonts: { fontCss: string; fontList: string; monoCss: string }): string {
  const { fontCss, fontList, monoCss } = fonts;
  const documentCSS = '@page{size:A4;margin:15mm 14mm}';
  const commonCSS =
    '<style>' + fontCss + '\n' + monoCss + '\n' + documentCSS +
    'body{font-family:' + fontList + ',sans-serif!important}' +
    (monoCss ? 'code,pre,.ln-math{font-family:"Noto Sans Mono",' + fontList + ',monospace!important}' : '') +
    // Elements the page gave an explicit direction keep it; only undirected text follows its content.
    ':is(p,li,td,th,blockquote,h1,h2,h3,h4):not([dir]){unicode-bidi:plaintext;text-align:start}' +
    'table{max-width:100%;min-width:0!important;break-inside:auto}' +
    'th,td{overflow-wrap:anywhere;vertical-align:top}' +
    'tr{break-inside:avoid-page}' +
    'p,li,blockquote{orphans:3;widows:3}' +
    '</style>';
  const source = allowEmbeddedFonts(html);
  return source.includes('</head>')
    ? source.replace('</head>', () => commonCSS + '</head>')
    : '<!DOCTYPE html><html><head>' + commonCSS + '</head><body>' + source + '</body></html>';
}

export async function renderDocumentPdf(html: string): Promise<Uint8Array> {
  const text = html.replace(/<[^>]*>/g, ' ');
  const resolved = await resolveDocumentFonts(text);
  const codeText = [...html.matchAll(/<(code|pre|span class="ln-math"|div class="ln-math")[^>]*>([\s\S]*?)<\/(?:code|pre|span|div)>/g)].map(m => m[2].replace(/<[^>]*>/g, '')).join(' ');
  const monoCss = codeText ? await resolveMonospaceFont(codeText) : '';
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
    const prepared = preparePrintHtml(html, { fontCss: resolved.css, fontList, monoCss });
    await page.setContent(prepared, { waitUntil: 'load', timeout: 30000 });
    // Embedded faces are lazy: a face nobody has requested yet stays
    // "unloaded" and would be miscounted as missing. Force-load every
    // embedded face, then verify that at least one really decoded.
    const fontReport = await page.evaluate(async () => {
      document.querySelectorAll('p,li,td,th,blockquote,h1,h2,h3,h4').forEach(el => {
        if (!el.hasAttribute('dir')) el.setAttribute('dir', 'auto');
      });
      const faces = Array.from(document.fonts);
      const outcomes = await Promise.allSettled(faces.map(face => face.load()));
      await document.fonts.ready;
      return {
        total: faces.length,
        loaded: faces.filter(face => face.status === 'loaded').length,
        states: faces.map(face => face.family + ':' + face.status).slice(0, 12),
        reasons: outcomes.map(o => o.status === 'rejected'
          ? String((o.reason && (o.reason.message || o.reason.name)) || o.reason).slice(0, 80) : 'ok').slice(0, 6),
      };
    });
    if (!fontReport.loaded) {
      throw Error('No web fonts loaded for PDF document (faces=' + fontReport.total +
        ', reasons=' + fontReport.reasons.join('|') + ', states=' + fontReport.states.join('|') + ')');
    }
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
