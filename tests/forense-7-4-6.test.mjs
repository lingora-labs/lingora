// 7.4.6 DAE forensic regressions: reproduced by DAE on 8b2ef87, each failed before its fix. No API, no model.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f)
const {renderConversationExportHtml:render,explainExportRefusal}=require('../server/tools/pdf/conversationExport.ts')
const {buildExportTurns}=require('../app/beta/beta-model.ts')
const T='`'
const html=t=>render('t',[{sender:'ALEX',text:t}])
// F-A: nested fence — a 4-tick block that contains a 3-tick line used to export EMPTY (code lost)
const nested=T.repeat(4)+'md\n'+T.repeat(3)+'\ntexto que NO debe perderse\n'+T.repeat(3)+'\n'+T.repeat(4)
let h=html(nested)
assert.ok(h.includes('texto que NO debe perderse'),'nested fence keeps its content')
assert.ok(/<pre><code>[^]*texto que NO debe perderse[^]*<\/code><\/pre>/.test(h),'and prints it as code')
// tilde fence is code, not literal paragraphs
h=html('~~~py\nprint("hola")\n~~~'); assert.match(h,/<pre><code>print\(&quot;hola&quot;\)<\/code><\/pre>/); assert.ok(!h.includes('~~~'))
// unchanged behaviours
h=html(T.repeat(3)+'js\nconst a = 1 < 2\n'+T.repeat(3)); assert.match(h,/<pre><code>const a = 1 &lt; 2<\/code><\/pre>/)
// F-B: loss gate — a table row with more cells than the header silently dropped the extra cell
assert.throws(()=>html('| a | b |\n|---|---|\n| 1 | 2 | CELDA-EXTRA |'),/export_content_loss/)
// the gate does not fire on ordinary Markdown, arithmetic, bilingual text or code
for(const ok of ['2*3*4 = 24','**negrita** y _cursiva_ y ~~tachado~~','Ver [enlace](https://example.org/a_b)','مرحبا **الفعل** `كان`','# Título\n- uno\n  - sub\n1. dos','<b>x</b> & "q"'])
  assert.doesNotThrow(()=>html(ok),'no false loss: '+ok)
// F-C: explicit, named refusal text
assert.match(explainExportRefusal('export_unsupported_artifact_type:schema_pro'),/No se generó el PDF.*aún no se puede imprimir.*schema_pro/)
assert.match(explainExportRefusal('export_invalid_chart:chart_categories'),/inválido/)
assert.equal(explainExportRefusal('boom'),null)
// F-D: one export builder for the header menu and the chat chip
const msg=(o)=>({id:'1',sender:'ALEX',text:'hola',...o})
assert.equal(buildExportTurns([msg({}),msg({sender:'user',text:'q'}),msg({complete:false})]).ok,false,'interrupted turn refuses export')
const r=buildExportTurns([msg({artifacts:[{type:'schema_pro',content:{title:'x'}},{type:'pdf',url:'u'},{type:'chart',content:{a:1}}]})])
assert.ok(r.ok); assert.deepEqual(r.turns[0].artifacts.map(a=>a.type),['schema_pro','chart'],'unsupported types are SENT (server refuses explicitly), only link-only files are skipped')
assert.equal(buildExportTurns([]).ok,false)
// F-E: static wiring — no private cap, one shared limit, acceptance handshake, header menu uses the builder
const src=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8')
const page=src('app/beta/use-beta-page.ts'), quiz=src('app/beta/beta-schema-a.tsx'), io=src('app/beta/beta-io.ts')
assert.ok(!/value\.length > 8/.test(page),'review handler has no private 8-question cap')
assert.ok(page.includes('VISUAL_LIMITS.quiz.questionsMax'))
assert.ok(page.includes('detail.accepted = true') && quiz.includes('request.detail.accepted'),'"Enviado" only after acceptance')
assert.ok(quiz.includes('quiz-send-refused'),'refusal is visible')
assert.ok(io.includes('buildExportTurns') && io.includes('exportTurns: built.turns'),'header export is structured')
console.log('PASS 7.4.6 forensic regressions (fence, loss gate, explicit refusal, single export builder, quiz review cap/handshake)')
