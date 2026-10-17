// Generates a text-only font asset BEFORE Next.js compiles the API route.
// Original open-source font is packaged by @fontsource/noto-naskh-arabic.
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(require.resolve('@fontsource/noto-naskh-arabic/package.json'));
const source = path.join(root, 'files', 'noto-naskh-arabic-arabic-400-normal.woff2');
const buffer = fs.readFileSync(source);
if (buffer.length < 8000 || buffer.subarray(0,4).toString('ascii') !== 'wOF2') {
  throw new Error('Fontsource Noto Naskh Arabic WOFF2 absent or corrupt');
}
const out = path.join(__dirname, '..', 'server', 'tools', 'pdf', 'arabic-font.generated.ts');
fs.writeFileSync(out,
  '// Build-generated. Font: Noto Naskh Arabic, OFL-1.1. Do not hand-edit.\n' +
  'export const ARABIC_FONT_BASE64 = ' + JSON.stringify(buffer.toString('base64')) + ';\n');
console.log('[LINGORA PDF] Bundled Arabic font ready: ' + buffer.length + ' bytes');
