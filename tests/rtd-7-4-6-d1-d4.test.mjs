// 7.4.6 — DAE's independently reproduced D1–D4; reject silent omissions.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}
}).outputText,file)
const {renderConversationExportHtml}=require('../server/tools/pdf/conversationExport.ts')
const {tutorQuizFromText}=require('../server/core/native-artifact.ts')
const tick=String.fromCharCode(96)
const input='**SER** y '+tick+'const x = "<etiqueta>"'+tick+'\n'+tick.repeat(3)+'js\nconst x = 1 < 2\n'+tick.repeat(3)
const html=renderConversationExportHtml('Prueba',[{sender:'SARAH',text:input}])
assert.match(html,/<strong>SER<\/strong>/,'D1 — bold rendered')
assert.match(html,/<code>const x = &quot;&lt;etiqueta&gt;&quot;<\/code>/,'D1 — inline code escaped correctly')
assert.match(html,/<pre><code>const x = 1 &lt; 2<\/code><\/pre>/,'D1 — fenced code rendered')
assert.ok(!html.includes(tick.repeat(3)),'D1 — fences not printed literally')
const tb={type:'table_matrix',content:{
  title:'Colores semánticos',columns:[{label:'A'},{label:'B'},{label:'C'}],
  rows:[[{text:'bien',tone:'ok'},{text:'cuidado',tone:'warn'},{text:'error',tone:'danger'}],
    [{text:'sin tono'},{text:'nota',tone:'info'},{text:'recuerda',tone:'highlight'}]]}}
const colored=renderConversationExportHtml('Colores',[{sender:'SARAH',text:'Contenido',artifacts:[tb]}])
for(const [tone,fragment] of [['ok','#c5f4e6'],['warn','#fff0b3'],['danger','#ffe1e4'],['info','#d5efff'],['highlight','#e8dcff']]){
  assert.ok(colored.includes('data-tone="'+tone+'" style="background:'+fragment),'D2 — keeps the author’s semantic '+tone+' tone')
}
assert.ok(colored.includes('sin tono'),'D2 — unlabeled cell remains printed')
assert.throws(()=>renderConversationExportHtml('Inválido',[{sender:'SARAH',text:'Tablas',artifacts:[{type:'table_matrix',content:{...tb.content,rows:[[{text:'x',tone:'not-a-tone'},{text:'b'},{text:'c'}]]}}]}]),/export_invalid_table_tone/,'D2/D3 — invalid semantic tone fails rather than being silently recolored')
const badChart={type:'chart',content:{title:'Roto',categories:['Enero','Febrero'],panels:[{title:'Enero',kind:'bar',values:[8]}]}}
assert.throws(()=>renderConversationExportHtml('Invalido',[{sender:'SARAH',text:'Hay un gráfico',artifacts:[badChart]}]),
  /export_invalid_chart/,'D3 — invalid visual stops export rather than silently disappearing')
const badFlow={type:'flowchart',content:{title:'Roto',nodes:[],edges:[]}}
assert.throws(()=>renderConversationExportHtml('Invalido',[{sender:'SARAH',text:'Diagrama',artifacts:[badFlow]}]),
  /export_invalid_flowchart/,'D3 — malformed flow refuses PDF')
const withoutContent={type:'infographic'}
assert.throws(()=>renderConversationExportHtml('Invalido',[{sender:'SARAH',text:'Infografía',artifacts:[withoutContent]}]),
  /export_missing_artifact_content/,'D3 — invalid source must not produce successful PDF')
const quiz='12 años de experiencia no son doce preguntas.\n\n1. ¿Cuál es la forma correcta?\nA) soy\nB) estoy\nC) somos\n\n2. ¿Cuál indica ubicación?\nA) ser\nB) estar\nC) haber'
const q=tutorQuizFromText(quiz)
assert.equal(q?.type,'quiz','D4 — valid two-item quiz still materializes')
assert.equal(q.content.questions.length,2,'D4 — numeric prose not interpreted as question 12')
const twelve=Array.from({length:12},(_,i)=>(i+1)+'. Pregunta real numero '+(i+1)+'?\nA) SER\nB) ESTAR').join('\n\n')
assert.equal(tutorQuizFromText(twelve)?.content.questions.length,12,'D4 — 12 legitimate numbered questions preserved')
console.log('PASS D1–D4 — code fences, colored cells, fail-closed PDF export and strict quiz numbering')
