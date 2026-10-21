import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require=createRequire(import.meta.url)
const ts=require('typescript')
require.extensions['.ts']=(mod,file)=>{
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
 mod._compile(js,file)
}
const { directFormatFor, formatDirectAnswer }=require('../lib/direct-intent-contract.ts')
const source=fs.readFileSync(require.resolve('../server/core/tutor-first-plan.ts'),'utf8')
const stream=fs.readFileSync(require.resolve('../server/core/execution-engine-stream.ts'),'utf8')
assert.equal(directFormatFor('Traduce al inglés: ayer fui al mercado'),'translation')
assert.equal(directFormatFor('Translate to Spanish: I went to the market'),'translation')
assert.equal(directFormatFor('Corrige esto: Yo fui a la tienda y compro pan ayer'),'correction')
assert.equal(directFormatFor('Correct this: I was went yesterday'),'correction')
for(const phrase of ['Traduce al inglés para aprender español','Yo traduzco al inglés: es difícil','Corrige mis errores en el próximo ejercicio','Dame una tabla de traducciones: inglés y español']){
 assert.equal(directFormatFor(phrase),null,'do not hijack intent '+phrase)
}
assert.equal(formatDirectAnswer('translation','In English: Yesterday I went to the market.'),'Yesterday I went to the market.')
assert.equal(formatDirectAnswer('translation','En inglés: Yesterday I went to the market.'),'Yesterday I went to the market.')
assert.equal(formatDirectAnswer('correction','La forma correcta es: Yo fui a la tienda y compré pan ayer.\nPequeña corrección: compro → compré'),'Yo fui a la tienda y compré pan ayer.')
assert.equal(formatDirectAnswer('correction','Corrección: Yo fui a la tienda y compré pan ayer.'),'Yo fui a la tienda y compré pan ayer.')
assert.ok(source.includes("directFormat === 'translation' ? 'TRANSLATION_ONLY_DIRECTIVE'"))
assert.ok(source.includes("directFormat === 'correction' ? 'CORRECTION_ONLY_DIRECTIVE'"))
assert.ok(stream.includes('const signals: ArtifactSignal[] = directFormat ? []'), 'direct transformations must suppress model-issued artifacts')
assert.ok(stream.includes('if (!directFormat) emit({ delta })'), 'ordinary streaming must remain progressive')
console.log('PASS — SEEK strict hard overrides, no artifact and preserved normal SSE')
