// QA9 — composed-outline validation must be distinct from lossless
// tutor-source recovery. Run: node tests/document-source-recovery.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import Module from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const filename = fileURLToPath(new URL('../server/tools/pdf/documentFidelity.ts', import.meta.url))
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const mod = new Module(filename)
mod.filename = filename
mod.paths = Module._nodeModulePaths(path.dirname(filename))
mod._compile(output, filename)
const { auditDocumentFidelity, auditRecoveredSource, sourceToDocumentBlocks } = mod.exports

const ser = [
  '## Ficha autónoma SER y ESTAR',
  '## Cinco ejemplos contrastivos',
  '1. Yo soy médico: profesión.',
  '2. Yo estoy cansado: estado temporal.',
  '3. Mi madre es alta: característica.',
  '4. La puerta está abierta: resultado.',
  '5. La clase es mañana: acontecimiento.',
  '## Tres ejercicios resueltos',
  '1. Ella ___ ingeniera. Respuesta: es. Profesión.',
  '2. Hoy ___ nervioso. Respuesta: estoy. Estado.',
  '3. Nosotros ___ en casa. Respuesta: estamos. Ubicación.',
].join('\n\n')
const serBlocks = sourceToDocumentBlocks(ser)
assert.equal(auditDocumentFidelity(ser, serBlocks).reason, 'empty_section',
  'reproduce false rejection of consecutive tutor headings')
const recovered = auditRecoveredSource(ser, serBlocks)
assert.equal(recovered.ok, true, 'complete SER/ESTAR must survive')
assert.equal(recovered.coverage, 1)
assert.equal(auditRecoveredSource(ser, serBlocks.filter(b => !JSON.stringify(b).includes('ingeniera'))).ok, false,
  'losing an exercise cannot pass recovery')

const mtc = [
  '# Medicina tradicional china',
  '# Qi',
  'Qi pertenece a un marco conceptual tradicional.',
  '# Meridianos',
  'Los meridianos no están demostrados como estructuras anatómicas.',
  '# Zang-fu',
  'Son categorías funcionales, no órganos literales.',
  '# Tres preguntas resueltas',
  'Pregunta: ¿Es medible qi? Respuesta: no existe medición biomédica aceptada.',
].join('\n\n')
assert.equal(auditRecoveredSource(mtc, sourceToDocumentBlocks(mtc)).ok, true)
const emptyScientific = [
  { type:'heading', level:1, content:'MTC' },
  { type:'paragraph', content:'Marco conceptual tradicional.' },
  { type:'heading', level:1, content:'Qi' },
  { type:'heading', level:1, content:'Meridianos' },
  { type:'heading', level:1, content:'Zang-fu' },
]
assert.equal(auditDocumentFidelity(mtc, emptyScientific).ok, false,
  'empty scientific outline still must fail')
assert.equal(auditRecoveredSource('Una frase íntegra de ejemplo.', 
  sourceToDocumentBlocks('Una frase íntegra de ejemplo.')).ok, true)
console.log('PASS: complete source recovered, missing exercises rejected, empty model outline rejected')
