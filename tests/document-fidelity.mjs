// Regression test for QA8: a dossier with a paragraph and empty chapter
// headings must not be considered complete. Run: node tests/document-fidelity.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import Module from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const filename = fileURLToPath(new URL('../server/tools/pdf/documentFidelity.ts', import.meta.url))
const js = ts.transpileModule(fs.readFileSync(filename,'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const m = new Module(filename)
m.filename = filename
m.paths = Module._nodeModulePaths(path.dirname(filename))
m._compile(js,filename)
const { auditDocumentFidelity, sourceToDocumentBlocks } = m.exports

const text = 'El qi es un concepto del marco tradicional, no una unidad anatómica verificable. Los meridianos y zang-fu tienen interpretaciones históricas diferentes a los mecanismos biomédicos modernos.'
const source = '# Resumen\n\n' + text + '\n\n# Qi\n\n' + text + '\n\n# Meridianos\n\n' + text + '\n\n# Zang-fu\n\n' + text + '\n\n# Evidencia\n\n' + text + '\n\n# Preguntas resueltas\n\n' + text
const hollow = [{type:'heading',level:1,content:'Resumen'}, {type:'paragraph',content:text},
  ...['Qi','Meridianos','Zang-fu','Evidencia','Preguntas resueltas'].map(content => ({type:'heading',level:1,content}))]
assert.equal(auditDocumentFidelity(source,hollow).reason,'empty_section')
const single = sourceToDocumentBlocks(source)
assert.equal(single.filter(b => b.type === 'heading').length,6)
assert.equal(single.filter(b => b.type === 'paragraph').length,6)
assert.equal(auditDocumentFidelity(source,single).ok,true)
const truncated = single.filter((b,i) => i < 4)
assert.equal(auditDocumentFidelity(source,truncated).ok,false)
const regular = sourceToDocumentBlocks('## Explicación\n\nUn ejemplo contrastivo de ser y estar.\n\n## Ejercicio\n\nRespuestas explicadas.')
assert.equal(auditDocumentFidelity('## Explicación\n\nUn ejemplo contrastivo de ser y estar.\n\n## Ejercicio\n\nRespuestas explicadas.',regular).ok,true)
assert.equal(regular.some(b => b.content === 'Texto íntegro del tutor — formato de lectura'),false)
console.log('PASS — scientific empty chapters rejected; lossless one-pass source recoverable')
