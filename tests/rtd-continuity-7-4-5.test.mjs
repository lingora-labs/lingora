// LINGORA 7.4.5 — production regressions from Work 7.4.4 RTD acceptance.
// Offline proofs: 8-column 24-row native matrix, real 12-question tactile quiz,
// and source-preserving rich PDF HTML with three materialized SVG artifacts.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}
}).outputText,file)
const {materializeNativeArtifact,tutorQuizFromText}=require('../server/core/native-artifact.ts')
const {validateExportTurns,renderConversationExportHtml}=require('../server/tools/pdf/conversationExport.ts')
const {VISUAL_LIMITS,NATIVE_ARTIFACT_CONTENT_TOOL_SCHEMA}=require('../lib/native-visual-schema.ts')
assert.equal(VISUAL_LIMITS.table.columnsMax,16)
assert.equal(VISUAL_LIMITS.table.rowsMax,80)
assert.equal(NATIVE_ARTIFACT_CONTENT_TOOL_SCHEMA.properties.columns.maxItems,16)
assert.equal(NATIVE_ARTIFACT_CONTENT_TOOL_SCHEMA.properties.rows.maxItems,80)
const columnLabels=['Área','SER','ESTAR','Estructura','Excepción','Ejemplo','CEFR','Corrección']
const columns=columnLabels.map((label,i)=>({key:'c'+i,label}))
const rows=Array.from({length:24},(_,i)=>columnLabels.map((v,j)=>({text:v+' '+i, tone:j===1?'ok':j===2?'info':'neutral'})))
const table={title:'SER/ESTAR — comparación académica',columns,rows}
const sig=(type,content)=>({type,format:'native',trigger:'explicit_user_request',subject:'SER y ESTAR',content})
const matrix=materializeNativeArtifact(sig('table_matrix',table))
assert.equal(matrix?.type,'table_matrix','full 24x8 matrix materializes')
assert.equal(matrix.content.rows.length,24)
assert.equal(matrix.content.columns.length,8)
assert.equal(matrix.content.rows[19][4].text,'Excepción 19')
const stringMatrix={title:'Tabla completa',columns:columnLabels,rows:rows.map(r=>r.map(v=>v.text))}
const canonical=materializeNativeArtifact(sig('table_matrix',stringMatrix))
assert.equal(canonical?.content.rows[23][7].text,'Corrección 23','string-only equivalent preserves the Tutor-authored data')
assert.equal(materializeNativeArtifact(sig('table_matrix',{...table, rows:[...rows,...rows,...rows,...rows]})),null,
  'invalid bounds remain closed; no trimmed fake table')
const ask=Array.from({length:12},(_,i)=>(i+1)+'. Hoy ___ listo para la clase '+(i+1)+'?\nA) estoy\nB) soy\nC) eres').join('\n\n')
const parsed=tutorQuizFromText(ask)
assert.equal(parsed?.type,'quiz','12-question Tutor-authored quiz becomes tactile')
assert.equal(parsed.content.questions.length,12)
assert.equal(parsed.content.gradingMode,'tutor_review','never invent score or answer keys')
assert.equal(parsed.content.questions[11].question.includes('12'),true)
const more=Array.from({length:21},(_,i)=>(i+1)+'. Hoy ___ listo\nA) estoy\nB) soy').join('\n')
assert.equal(tutorQuizFromText(more),null,'21-question payload is rejected honestly, never silently cut')

const chart={title:'Usuarios y conversión',categories:['Enero','Febrero','Marzo','Abril','Mayo','Junio'],
  panels:[{kind:'bar',title:'Usuarios',values:[120,180,240,300,420,510]},
  {kind:'line',title:'Conversión',values:[4,5,7,6,8,9],unit:'%'}]}
const flow={title:'¿SER o ESTAR?',nodes:[
  {id:'a',kind:'start',label:'Inicio'},
  {id:'b',kind:'decision',label:'¿Identidad o estado?'},
  {id:'c',kind:'end',label:'SER'},{id:'d',kind:'end',label:'ESTAR'}],
  edges:[{from:'a',to:'b'},{from:'b',to:'c',label:'Identidad'},{from:'b',to:'d',label:'Estado'}]}
const info={title:'Errores frecuentes',sections:[
  {heading:'Identidad',body:'SER para clasificar'},
  {heading:'Estado',body:'ESTAR para describir estados'}]}
const turns=[
  {sender:'Student',text:'Enséñame SER y ESTAR'},
  {sender:'SARAH',text:'## SER y ESTAR\n**SER** identifica.\n\n- Identidad\n- Estado\n\n| Área | SER | ESTAR |\n|---|---|---|\n|Identidad|es|está|',
   artifacts:[sig('table_matrix',table),sig('chart',chart),sig('flowchart',flow),sig('infographic',info)]}
]
const verified=validateExportTurns(turns)
assert.ok(verified)
const html=renderConversationExportHtml('LINGORA — Historial',verified)
for(const type of ['chart','flowchart','infographic']) assert.ok(html.includes('data-type="'+type+'"'), 'visual preserved '+type)
assert.equal((html.match(/<svg /g)||[]).length,3,'three real SVG visuals in transcript')
assert.ok(html.includes('<strong>SER</strong>'),'Markdown bold is actually rendered')
assert.ok(html.includes('<h3>SER y ESTAR</h3>'),'Markdown heading is actually rendered')
assert.ok(html.includes('<table class="ln-md-table">'),'original markdown table is rendered')
assert.ok(html.includes('Corrección 23'),'last row of 24x8 matrix survives')
assert.ok(html.includes('Mayo'),'chart source is included')
assert.ok(!html.includes('**SER**'),'raw Markdown not printed')
assert.equal(validateExportTurns([...turns,{sender:'SARAH',text:'Inconcluso',complete:false}]),null,
  'incomplete SSE turn must not be passed off as a complete PDF')
assert.equal(validateExportTurns([{sender:'SARAH',text:'ok',artifacts:Array.from({length:21},()=>({type:'chart'}))}]),null)
const escaped=renderConversationExportHtml('X',[{sender:'USER',text:'<script>alert("x")</script>'}])
assert.ok(!escaped.includes('<script>'),'HTML injection escaped')
console.log('PASS 7.4.5 — 24x8 table, 12-question tactile quiz, rich export of three SVGs, Markdown rendered, incomplete streams rejected')
