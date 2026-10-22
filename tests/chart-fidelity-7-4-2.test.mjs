// 7.4.2 — chart fidelity (P1) and no-rewrite of the Tutor's reply (P1). No API, no model.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const {validateChartContent,renderChartSvg}=require('../lib/chart-contract.ts')
const {materializeNativeArtifact}=require('../server/core/native-artifact.ts')
const {parseClosedTutorTurn}=require('../lib/artifact-signal.ts')

const months=['Enero','Febrero','Marzo','Abril','Mayo','Junio']
const users=[120,180,240,300,420,510], conv=[4,5,7,6,8,9]
const student='Con estos datos: Enero 120 usuarios 4%, Febrero 180 5%, Marzo 240 7%, Abril 300 6%, Mayo 420 8%, Junio 510 9%.'
const table={rows:months.map((m,i)=>[m,String(users[i]),conv[i]+'%'])}
const good={title:'Usuarios y conversión',categories:months,panels:[
  {kind:'bar',title:'Usuarios por mes',values:users},
  {kind:'line',title:'Conversión por mes',unit:'%',values:conv}]}
const src={text:student,tables:[table]}

// positive: all six months, all values, drawn
const ok=validateChartContent(good,src); assert.ok(ok.ok,JSON.stringify(ok))
const svg=renderChartSvg(ok.chart)
assert.equal(svg,renderChartSvg(ok.chart),'deterministic render')
for(const m of months) assert.ok(svg.includes('>'+m+'<'),'category drawn: '+m)
for(const v of users) assert.ok(svg.includes('>'+v+'<'),'bar value drawn: '+v)
for(const v of conv) assert.ok(svg.includes('>'+v+'%<'),'line value drawn: '+v)
assert.equal((svg.match(/<rect data-cat=/g)||[]).length,6,'six bars')
assert.equal((svg.match(/<circle data-cat=/g)||[]).length,6,'six points')

// NEGATIVE — the Work defect: May/420 lost (5 of 6)
const noMay={...good,categories:months.filter(m=>m!=='Mayo'),panels:[
  {kind:'bar',title:'U',values:users.filter(v=>v!==420)},{kind:'line',title:'C',unit:'%',values:conv.filter((_,i)=>i!==4)}]}
assert.equal(validateChartContent(noMay,src).ok,false,'category loss must be rejected')
// NEGATIVE — values shifted (April 6% dropped, sequence displaced)
const shifted={...good,categories:months.slice(0,5),panels:[{kind:'bar',title:'U',values:users.slice(0,5)},{kind:'line',title:'C',unit:'%',values:[4,5,7,8,9]}]}
assert.equal(validateChartContent(shifted,src).ok,false,'shifted conversion must be rejected')
// NEGATIVE — same length, wrong order / wrong value vs table
assert.equal(validateChartContent({...good,panels:[good.panels[0],{...good.panels[1],values:[4,5,7,8,6,9]}]},src).ok,false)
// NEGATIVE — invented magnitude (not in the turn at all)
assert.equal(validateChartContent({...good,panels:[{...good.panels[0],values:[120,180,240,300,420,999]},good.panels[1]]},{text:student}).ok,false,'invented value')
// NEGATIVE — structure: count mismatch, NaN, duplicates, html
assert.equal(validateChartContent({...good,panels:[{...good.panels[0],values:users.slice(0,5)}]},src).ok,false)
assert.equal(validateChartContent({...good,panels:[{...good.panels[0],values:[...users.slice(0,5),NaN]}]},src).ok,false)
assert.equal(validateChartContent({...good,categories:['A','a','B','C','D','E']},{}).ok,false)
assert.equal(validateChartContent({...good,title:'<b>x</b>'},src).ok,false)

// AE 7.4.2 dictamen — association WITHOUT a native table: swapped figures between categories are rejected
const textOnly={text:student}
assert.ok(validateChartContent(good,textOnly).ok,'faithful chart passes with text only')
assert.equal(validateChartContent({...good,panels:[{...good.panels[0],values:[120,180,300,240,420,510]},good.panels[1]]},textOnly).ok,false,'Marzo/Abril visitas swapped, no table')
assert.equal(validateChartContent({...good,panels:[good.panels[0],{...good.panels[1],values:[4,5,6,7,8,9]}]},textOnly).ok,false,'conversion swapped Marzo/Abril, no table')
assert.equal(validateChartContent({...good,panels:[{...good.panels[0],values:[510,180,240,300,420,120]},good.panels[1]]},textOnly).ok,false,'first and last swapped, no table')
// prose that lists labels first and figures afterwards is not mis-rejected (association check not applicable)
assert.ok(validateChartContent(good,{text:'Meses: Enero, Febrero, Marzo, Abril, Mayo, Junio. Usuarios: 120, 180, 240, 300, 420, 510. Conversion: 4, 5, 7, 6, 8, 9.'}).ok)
// mobile: inline SVG scales with its container and never clips; export keeps explicit pixels
const inl=renderChartSvg(ok.chart), fix=renderChartSvg(ok.chart,{fixed:true})
assert.match(inl,/viewBox="0 0 520 /);assert.ok(!/<svg[^>]*\swidth="/.test(inl),'inline svg has no fixed pixel width')
assert.match(inl,/width:100%;min-width:440px;height:auto/)
assert.match(fix,/<svg[^>]* width="520" height="/)
for(const m of months)assert.ok(inl.includes('>'+m+'<'),'every category drawn at any width: '+m)
const ui=fs.readFileSync(new URL('../app/beta/beta-artifacts.tsx',import.meta.url),'utf8')
assert.match(ui,/overflowX:\s*'auto'/,'chart container scrolls instead of clipping');assert.ok(!/ChartBlock[\s\S]{0,1500}overflow:\s*'hidden'/.test(ui.slice(ui.indexOf('function ChartBlock'),ui.indexOf('export function ArtifactRender'))),'no overflow:hidden around the chart')

// Tutor-localised labels are allowed when numbers still trace (Arabic months)
const ar={...good,categories:['يناير','فبراير','مارس','أبريل','مايو','يونيو']}
assert.ok(validateChartContent(ar,{text:student}).ok,'localised labels, numbers traceable')
assert.ok(renderChartSvg(validateChartContent(ar,{text:student}).chart).includes('يونيو'))

// Typed boundary: chart travels as native Tutor artifact and is rejected when unfaithful
const sig=content=>({type:'chart',trigger:'explicit_user_request',subject:'gráfico',format:'native',content})
assert.equal(materializeNativeArtifact(sig(good),src).type,'chart')
assert.equal(materializeNativeArtifact(sig(noMay),src),null)
assert.ok(parseClosedTutorTurn({reply:'ok',artifacts:[sig(good)]}),'chart accepted as native signal')
assert.equal(parseClosedTutorTurn({reply:'ok',artifacts:[{...sig(good),format:'image'}]}),null)

// P1 truncation: the runtime must not post-process or classify the Tutor's reply (7.1 arts. 47, 51, 52)
const root=new URL('../',import.meta.url).pathname
assert.ok(!fs.existsSync(root+'lib/direct-intent-contract.ts'),'regex direct-format classifier must stay deleted')
const walk=d=>fs.readdirSync(root+d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(d+'/'+e.name):[d+'/'+e.name])
for(const f of ['app','server','lib'].flatMap(walk).filter(f=>/\.(ts|tsx)$/.test(f)&&!f.includes('lib/engineering/'))){const s=fs.readFileSync(root+f,'utf8')
  for(const bad of ['directFormatFor','formatDirectAnswer','direct-intent-contract'])assert.ok(!s.includes(bad),f+' must not contain '+bad)}
for(const f of ['server/core/execution-engine-stream.ts','server/core/tutor-first-plan.ts']){const s=fs.readFileSync(root+f,'utf8')
  for(const bad of ['CORRECTION_ONLY','TRANSLATION_ONLY','correction_only','translation_only'])assert.ok(!s.includes(bad),f+' must not select '+bad)}
const stream=fs.readFileSync(root+'server/core/execution-engine-stream.ts','utf8')
assert.ok(/fullText \+= delta[\s\S]{0,400}emit\(\{ delta \}\)/.test(stream),'every Tutor delta is emitted as received')
assert.ok(!/fullText\s*=\s*(?!quizFact)\w+\(/.test(stream.replace(/fullText = quizFact/,'')),'fullText is never reassigned from a transform')
// The image model must not be the chart path
const sigsrc=fs.readFileSync(root+'lib/artifact-signal.ts','utf8')
assert.match(sigsrc,/never use emit_image/)
console.log('PASS 7.4.2 — chart fidelity (6/6, no shift, no invention, swapped values rejected without table, responsive, deterministic) and no reply rewriting')
