// SEEK: a wrong artifact side-effect cannot destroy the tutor's valid reply.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText,file)
const {isExplicitPdfRequest}=require('../lib/pdf-intent-authorization.ts')
const accept=[
 'Quiero un PDF y HTML con la explicación y ejercicios',
 'Genera el PDF de esta lección',
 'Prepara una guía descargable en PDF',
 'Exporta esta conversación a PDF',
]
const reject=[
 'Quiero un esquema visual con opciones de exportación',
 'Hazme un esquema interactivo. No generes PDF',
 'Necesito botones de descargar el esquema como PNG y PDF',
 'Hola',
 'Curso PDF',
]
for(const m of accept)assert.equal(isExplicitPdfRequest(m),true,m)
for(const m of reject)assert.equal(isExplicitPdfRequest(m),false,m)
assert.equal(isExplicitPdfRequest('Prepara la primera entrega del curso','pdf_course'),true)
assert.equal(isExplicitPdfRequest('Modo seleccionado: pdf_course','pdf_course'),false)
const mentor=fs.readFileSync(new URL('../server/mentors/mentor-engine.ts',import.meta.url),'utf8')
const fulfillment=fs.readFileSync(new URL('../server/core/artifact-side-effect.ts',import.meta.url),'utf8')
assert.ok(!mentor.includes("throw Error('PDF requested without sufficient teaching content')"),'PDF must not destroy the tutor turn')
assert.ok(mentor.includes("closure.artifacts.filter(s => s.type !== 'emit_pdf' || pdfAuthorized)"))
assert.ok(fulfillment.includes('if (pedagogicalContent.trim().length < 500)'))
assert.ok(fulfillment.includes('failures.push('))
console.log('PASS — PDF intent authority, native-artifact survival, and honest PDF failures')
