// 7.4: the HTML artifact is really interactive, still closed-grammar safe, and shares the PDF's semantic source.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file)
const root=new URL('../',import.meta.url).pathname
const {renderArtifactHtml}=require('../server/tools/web/renderArtifactHtml.ts')

const evil='<script>alert(1)</script><img src=x onerror=alert(2)>'
const doc={title:'Ser y estar '+evil,documentType:'lesson',mentorName:'sarah',generatedAt:'2026-10-22',level:'A2',nextStep:'Practica',blocks:[
 {type:'heading',level:1,content:'Presente de ser'},
 {type:'paragraph',content:'Texto '+evil},
 {type:'exercise',label:'Ejercicio 1',content:'Completa: Yo ___ médico. '+evil},
 {type:'exercise',label:'Ejercicio 2',content:'Completa: Ella ___ en casa.'},
 {type:'heading',level:1,content:'Estar'},
 {type:'table',headers:['Verbo','Uso'],rows:[['ser','identidad'],['estar','estado '+evil]]},
 {type:'glossary',label:'Glosario',terms:[{term:'ser',definition:'ser/estar → to be'}]},
 {type:'answer_key',label:'Clave',answers:['soy','está']},
]}
const html=renderArtifactHtml(doc)

// exactly one script, and the CSP pins execution to its hash
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
assert.equal(scripts.length,1,'one fixed script only')
assert.equal((html.match(/<script/gi)||[]).length,1,'model text can never open a script tag')
const hash=crypto.createHash('sha256').update(scripts[0][1]).digest('base64')
assert.ok(html.includes(`script-src 'sha256-${hash}'`),'CSP pins the only script by SHA-256')
assert.match(html,/default-src 'none'/)
// nothing from the model reaches markup/handlers/script
assert.ok(!/\sonerror=|\sonclick=|\sonload=/i.test(html.replace(/&lt;[^]*?&gt;/g,'')),'no inline handlers outside escaped text')
assert.ok(!scripts[0][1].includes('alert(')&&!scripts[0][1].includes('Ser y estar'),'model text never interpolated into the script')
assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),'model markup is escaped data')
assert.ok(!/innerHTML|eval\(|new Function|fetch\(|XMLHttpRequest|document\.write/.test(scripts[0][1]),'script has no dynamic-code or network primitives')
// interactions present and wired to real elements
assert.equal((html.match(/<details class="ln-sec"/g)||[]).length,2,'collapsible sections from level-1 headings')
assert.equal((html.match(/class="ln-callout ln-callout-info ln-ex"/g)||[]).length,2,'tactile exercises')
assert.equal((html.match(/class="ln-ex-done"/g)||[]).length,2)
assert.match(html,/class="ln-toc"/);assert.match(html,/href="#s2"/,'navigation')
assert.match(html,/class="ln-reveal"/,'answer key hidden behind a control')
assert.match(html,/class="ln-term"/,'glossary tap-reveal')
for(const id of ['ln-expand','ln-collapse','ln-bigger','ln-smaller','ln-theme','ln-print','ln-reset','ln-count','ln-bar'])assert.ok(html.includes(`id="${id}"`)&&scripts[0][1].includes(id),'control '+id+' exists and is wired')
// content stays substantive (table survives, not placebo)
assert.match(html,/<table class="ln-table">/);assert.match(html,/<th dir="ltr">Verbo<\/th>/)
// same source as the PDF: renderer consumes DocumentContent, no second model
const src=fs.readFileSync(root+'server/tools/web/renderArtifactHtml.ts','utf8')
assert.match(src,/DocumentContent/);assert.ok(!/openai/i.test(src.replace(/\/\/.*$/gm,'')))
// transport: Blob, not a navigated data: URL (Chromium blocks top-level data: navigation)
const ui=fs.readFileSync(root+'app/beta/beta-artifacts.tsx','utf8')
assert.match(ui,/createObjectURL/,'HTML opens through a Blob URL');assert.match(ui,/Descargar HTML/,'HTML is downloadable')
assert.ok(!/<a[^>]+href=\{[^}]*webUrl[^}]*\}[^>]*target="_blank"/.test(ui),'no direct data: href navigation')
console.log('PASS 7.4 — interactive HTML renderer: safe, CSP-pinned, collapsible, tactile, Blob transport')
