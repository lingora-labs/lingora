// SEEK: a wrong artifact side-effect cannot destroy the tutor's valid reply.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText,file)
const {isExplicitPdfRequest,isConversationPdfExportRequest}=require('../lib/pdf-intent-authorization.ts')
const accept=[
 'Quiero un PDF y HTML con la explicación y ejercicios',
 'Genera el PDF de esta lección',
 'Prepara una guía descargable en PDF',
 'Necesito material de práctica en nivel B1 sobre el pretérito perfecto frente al indefinido: ejemplos en español, cinco ejercicios y claves razonadas. Entrégame un documento PDF descargable y su página HTML en esta misma respuesta.',
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
assert.ok(mentor.includes("closed.artifacts.filter(a=>a.type!=='emit_pdf'||pdfOk)"),'PDF side effect retains explicit authorization')
assert.ok(mentor.includes("tool_choice: wantsPdf || wantsVisualReview || wantsQuiz ? 'none'"),'PDF and explicit visual content are authored as free text and materialized by typed authorization')
assert.ok(fulfillment.includes('pedagogicalContent.trim().length < 500 || refusalSource'),'short or refusal source must never generate PDF placebo')
assert.ok(fulfillment.includes('failures.push('))
for(const message of [
 'Exporta esta conversación a PDF',
 'Quiero exportar mi historial de chat a PDF',
 'Descarga el historial de esta conversación en PDF',
]) assert.equal(isConversationPdfExportRequest(message),true,message)
for(const message of [
 'No exportes esta conversación a PDF',
 '¿Cómo se exporta un chat a PDF?',
 'Genera un PDF sobre SER y ESTAR',
 'Quiero un esquema en PNG y PDF',
]) assert.equal(isConversationPdfExportRequest(message),false,message)
const hook=fs.readFileSync(new URL('../app/beta/use-beta-page.ts',import.meta.url),'utf8')
const route=fs.readFileSync(new URL('../server/api/chat-entry.ts',import.meta.url),'utf8')
assert.ok(hook.includes('payload.uiAction = \'export_chat_pdf\''),'text command must use certified pdf_chat executor')
assert.ok(route.includes('isConversationPdfExportRequest(normalizedMessage)'),'API cannot bypass typed export for explicit chat PDF')
console.log('PASS — PDF intent authority, native-artifact survival, and honest PDF failures')
