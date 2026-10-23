// LINGORA 7.1 — shared glyph resolver for EVERY PDF.
// Rendering is language-agnostic. Only Unicode coverage selects font faces.
// Fonts are downloaded on demand from Google Fonts and cached per warm runtime.
// This module never alters, transliterates or translates document text.
type FaceSpec = { family: string; scripts: RegExp };
const CATALOG: FaceSpec[] = [
  { family: 'Noto Naskh Arabic', scripts: /[؀-ࣿﭐ-﷿ﹰ-﻿]/u },
  { family: 'Noto Sans Hebrew', scripts: /[֐-׿]/u },
  { family: 'Noto Sans Devanagari', scripts: /[ऀ-ॿ]/u },
  { family: 'Noto Sans Bengali', scripts: /[ঀ-৿]/u },
  { family: 'Noto Sans Gurmukhi', scripts: /[਀-੿]/u },
  { family: 'Noto Sans Gujarati', scripts: /[઀-૿]/u },
  { family: 'Noto Sans Tamil', scripts: /[஀-௿]/u },
  { family: 'Noto Sans Telugu', scripts: /[ఀ-౿]/u },
  { family: 'Noto Sans Kannada', scripts: /[ಀ-೿]/u },
  { family: 'Noto Sans Malayalam', scripts: /[ഀ-ൿ]/u },
  { family: 'Noto Sans Sinhala', scripts: /[඀-෿]/u },
  { family: 'Noto Sans Thai', scripts: /[฀-๿]/u },
  { family: 'Noto Sans Lao', scripts: /[຀-໿]/u },
  { family: 'Noto Sans Myanmar', scripts: /[က-႟]/u },
  { family: 'Noto Sans Khmer', scripts: /[ក-៿]/u },
  { family: 'Noto Sans Georgian', scripts: /[Ⴀ-ჿ]/u },
  { family: 'Noto Sans Armenian', scripts: /[԰-֏]/u },
  { family: 'Noto Sans Ethiopic', scripts: /[ሀ-፿]/u },
  { family: 'Noto Sans JP', scripts: /[぀-ヿ]/u },
  { family: 'Noto Sans KR', scripts: /[가-힯]/u },
  { family: 'Noto Sans SC', scripts: /[㐀-鿿]/u },
];
// Noto Sans covers Latin, Greek and Cyrillic as the shared baseline.
// Add scripts to this DATA catalog, not special cases to PDF orchestration.
const BASE_FONT: FaceSpec = { family: 'Noto Sans', scripts: /[\s\S]/u };
const FONT_CSS_HOST = 'https://fonts.googleapis.com/css2?family=';
const MAX_INLINE_FONT_BYTES = 4_000_000;
const MAX_FONT_CSS_BYTES = 450_000;
const cssCache = new Map<string, Promise<string>>();
const fontCache = new Map<string, Promise<string>>();
// A browser UA makes Google Fonts answer with unicode-range woff2 subsets,
// the smallest payload per document (also keeps CJK under the inline cap).
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function cssRangesCover(text: string, ranges: string | null): boolean {
  if (!ranges) return true;
  const codes = new Set(Array.from(text, char => char.codePointAt(0)!));
  const fragments = ranges.match(/U\+[0-9A-F?]+(?:-[0-9A-F]+)?/gi) ?? [];
  return fragments.some(fragment => {
    const v = fragment.slice(2).toUpperCase();
    const [lo, hi] = v.split('-');
    const low = parseInt(lo.replace(/\?/g, '0'), 16);
    const high = parseInt((hi ?? lo).replace(/\?/g, 'F'), 16);
    for (const cp of codes) if (cp >= low && cp <= high) return true;
    return false;
  });
}

async function fontAsBase64(url: string): Promise<string> {
  // Hard allowlist: downloaded CSS can only refer to official Google font files.
  if (!/^https:\/\/fonts\.gstatic\.com\//.test(url)) throw Error('Untrusted font origin');
  let loading = fontCache.get(url);
  if (!loading) {
    loading = (async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(18000) });
      if (!response.ok) throw Error('Font download HTTP ' + response.status);
      const buffer = Buffer.from(await response.arrayBuffer());
      const magic = buffer.subarray(0, 4).toString('ascii');
      if (buffer.length < 2000 || buffer.length > MAX_INLINE_FONT_BYTES ||
          !['wOF2', 'wOFF', 'OTTO'].includes(magic) && buffer.subarray(0,4).toString('hex') !== '00010000') {
        throw Error('Invalid font file');
      }
      const mime = magic === 'wOF2' ? 'font/woff2' : magic === 'wOFF' ? 'font/woff' : 'font/ttf';
      return 'data:' + mime + ';base64,' + buffer.toString('base64');
    })();
    fontCache.set(url, loading);
    loading.catch(() => fontCache.delete(url));
  }
  return loading;
}

async function fontFacesFor(family: string, relevantText: string): Promise<string> {
  const key = family;
  let css = cssCache.get(key);
  if (!css) {
    css = (async () => {
      const url = FONT_CSS_HOST + encodeURIComponent(family).replace(/%20/g, '+') +
        ':wght@400&display=swap';
      const response = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'text/css' },
        signal: AbortSignal.timeout(18000),
      });
      if (!response.ok) throw Error('Font CSS HTTP ' + response.status + ' for ' + family);
      const value = await response.text();
      if (value.length < 40 || value.length > MAX_FONT_CSS_BYTES || !value.includes('@font-face')) {
        throw Error('Invalid CSS from font provider: ' + family);
      }
      return value;
    })();
    cssCache.set(key, css);
    css.catch(() => cssCache.delete(key));
  }
  const fetchedCss = await css;
  const faces = [...fetchedCss.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(m => m[1]);
  const needed = faces.filter(face => {
    const range = face.match(/unicode-range:\s*([^;]+);?/i)?.[1] ?? null;
    return cssRangesCover(relevantText, range);
  });
  if (!needed.length) throw Error('Font provider lacks glyph coverage: ' + family);
  if (needed.length > 32) throw Error('Too many font subsets requested for ' + family);
  const embedded = await Promise.all(needed.map(async face => {
    const match = face.match(/url\((['"]?)(https:\/\/fonts\.gstatic\.com\/[^)'"]+)\1\)/i);
    if (!match) throw Error('Font CSS contains no trusted font URL');
    const data = await fontAsBase64(match[2]);
    // Function replacer: the payload must never be read as a $-pattern.
    return '@font-face{' + face.replace(match[2], () => data) + '}';
  }));
  return embedded.join('\n');
}

export async function resolveDocumentFonts(documentText: string): Promise<{ css: string; families: string[] }> {
  const chosen = [BASE_FONT, ...CATALOG.filter(item => item.scripts.test(documentText))];
  // All selected faces use one uniform source, trust boundary and cache.
  const selected = await Promise.all(chosen.map(async item => ({
    family: item.family,
    css: await fontFacesFor(item.family,
      Array.from(documentText).filter(char => item.scripts.test(char)).join('')),
  })));
  const fontCSS = selected.map(item => item.css).join('\n');
  if (!fontCSS) throw Error('No fonts resolved for document');
  return { css: fontCSS, families: selected.map(item => item.family) };
}

/** Monospace faces for code and formulas (Latin/Greek/Cyrillic subset). Optional: on failure
 * code keeps the document fonts, which changes alignment, never content. */
export async function resolveMonospaceFont(codeText: string): Promise<string> {
  const covered = Array.from(codeText).filter(ch => /[\u0020-\u052F]/u.test(ch)).join('');
  if (!covered.trim()) return '';
  try { return await fontFacesFor('Noto Sans Mono', covered); }
  catch (e) { console.warn('[pdf-fonts] monospace face unavailable:', e instanceof Error ? e.message : e); return ''; }
}
