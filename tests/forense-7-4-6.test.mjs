// 7.4.6 DAE forensic regressions: reproduced by DAE on 8b2ef87, each failed before its fix. No API, no model.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,f)
const {renderConversationExportHtml:render,explainExportRefusal}=require('../server/tools/pdf/conversationExport.ts')
const {buildExportTurns}=require('../app/beta/export-turns.ts')
const T='`'
const html=t=>render('t',[{sender:'ALEX',text:t}])
// F-A: nested fence — a 4-tick block that contains a 3-tick line used to export EMPTY (code lost)
const nested=T.repeat(4)+'md\n'+T.repeat(3)+'\ntexto que NO debe perderse\n'+T.repeat(3)+'\n'+T.repeat(4)
let h=html(nested)
assert.ok(h.includes('texto que NO debe perderse'),'nested fence keeps its content')
assert.ok(/<pre class="ln-code" dir="ltr"><code[^>]*>[^]*texto que NO debe perderse[^]*<\/code><\/pre>/.test(h),'and prints it as code')
// tilde fence is code, not literal paragraphs
h=html('~~~py\nprint("hola")\n~~~'); assert.match(h,/<pre class="ln-code" dir="ltr"><code class="language-py">print\(&quot;hola&quot;\)<\/code><\/pre>/); assert.ok(!h.includes('~~~'))
// unchanged behaviours
h=html(T.repeat(3)+'js\nconst a = 1 < 2\n'+T.repeat(3)); assert.match(h,/<code class="language-js">const a = 1 &lt; 2<\/code><\/pre>/)
// F-B: loss gate — a table row with more cells than the header silently dropped the extra cell
assert.throws(()=>html('| a | b |\n|---|---|\n| 1 | 2 | CELDA-EXTRA |'),/export_content_loss/)
// the gate does not fire on ordinary Markdown, arithmetic, bilingual text or code
for(const ok of ['2*3*4 = 24','**negrita** y _cursiva_ y ~~tachado~~','Ver [enlace](https://example.org/a_b)','مرحبا **الفعل** `كان`','# Título\n- uno\n  - sub\n1. dos','<b>x</b> & "q"'])
  assert.doesNotThrow(()=>html(ok),'no false loss: '+ok)
// F-C: explicit, named refusal text
assert.match(explainExportRefusal('export_unsupported_artifact_type:audio_x'),/No se generó el documento.*aún no se puede imprimir.*audio_x/)
assert.match(explainExportRefusal('export_invalid_chart:chart_categories'),/inválido/)
assert.equal(explainExportRefusal('boom'),null)
// F-D: one export builder for the header menu and the chat chip
const msg=(o)=>({id:'1',sender:'ALEX',text:'hola',...o})
assert.equal(buildExportTurns([msg({}),msg({sender:'user',text:'q'}),msg({complete:false})]).ok,false,'interrupted turn refuses export')
const r=buildExportTurns([msg({artifacts:[{type:'schema_pro',content:{title:'x'}},{type:'pdf',url:'u'},{type:'chart',content:{a:1}}]})])
assert.ok(r.ok); assert.deepEqual(r.turns[0].artifacts.map(a=>a.type),['schema_pro','chart'],'unsupported types are SENT (server refuses explicitly), only link-only files are skipped')
assert.equal(buildExportTurns([]).ok,false)
// F-G (AE dictamen): Markdown that printed literally — link, rule, h6, __bold__, ~~strike~~, nested list — and the content stays complete
h=html('Ver [LINGORA](https://example.org/a_b) y [x](javascript:alert(1))\n\n---\n\n###### Seis\n\n__negrita__ y ~~tachado~~\n\n- uno\n  - sub\n    - subsub')
assert.match(h,/<a href="https:\/\/example\.org\/a_b" rel="noopener noreferrer" target="_blank">LINGORA<\/a>/,'link is a link')
assert.ok(h.includes('a:not(.ln-bare)::after{content:" (" attr(href) ")"'),'and paper prints its address (print CSS), because a PDF has no hover')
assert.ok(!h.includes('href="javascript'),'unsafe scheme is never a link'); assert.ok(h.includes('javascript:alert(1)'),'and its text is still printed')
assert.ok(h.includes('<hr>')&&!h.includes('<p>---</p>'),'rule is a rule')
assert.ok(/<h6 [^>]*>Seis<\/h6>/.test(h)&&h.includes('<strong>negrita</strong>')&&h.includes('<del>tachado</del>'))
assert.match(h,/<li dir="ltr">uno\n?<ul>\n<li dir="ltr">sub\n?<ul>\n<li dir="ltr">subsub<\/li>/,'nested lists stay nested')
assert.ok(!/\[LINGORA\]\(|\*\*|__negrita__|~~tachado/.test(h),'no literal Markdown syntax left')
// F-H: a turn header never sits alone at the foot of a page
assert.match(html('x'),/\.ln-section-head\{[^}]*break-after:avoid-page[;}]/); assert.ok(html('x').includes('.ln-section>.ln-md{display:flow-root}'),'flow-root is what makes Chromium honour the header keep-with-next (measured: orphan header on page 16 of the 17-page document)')
// F-E: static wiring — no private cap, one shared limit, acceptance handshake, header menu uses the builder
const src=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8')
const page=src('app/beta/use-beta-page.ts'), quiz=src('app/beta/beta-schema-a.tsx'), io=src('app/beta/beta-io.ts')
assert.ok(!/value\.length > 8/.test(page),'review handler has no private 8-question cap')
assert.ok(page.includes('QUIZ_RESOURCE_LIMITS.questions'),'one shared resource limit (no cognitive cap)')
assert.ok(page.includes('detail.accepted = true') && quiz.includes('request.detail.accepted'),'"Enviado" only after acceptance')
assert.ok(quiz.includes('quiz-send-refused'),'refusal is visible')
assert.ok(io.includes('prepareConversationExport') && io.includes('exportTurns: built.turns') && src('app/beta/export-turns.ts').includes('const built = buildExportTurns(msgs)'),'header export is structured (7.5: one preparation for menu, chip and Tutor delivery)')
console.log('PASS 7.4.6 forensic regressions (fence, loss gate, explicit refusal, single export builder, quiz review cap/handshake)')
