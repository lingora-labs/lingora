// 7.4.3 — RTD visual parity: flowchart and infographic as typed native instruments. No API, no model.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const {validateFlowchartContent,renderFlowchartSvg,layoutLevels}=require('../lib/flowchart-contract.ts')
const {validateInfographicContent,renderInfographicSvg}=require('../lib/infographic-contract.ts')
const {wrapLines,visualWidth}=require('../lib/svg-text.ts')
const {materializeNativeArtifact}=require('../server/core/native-artifact.ts')
const {parseClosedTutorTurn,COMPLETE_TUTOR_TURN_TOOL,ARTIFACT_CHANNEL_INSTRUCTION,NATIVE_TYPES}=require('../lib/artifact-signal.ts')

// ───────────── flowchart ─────────────
const flow={title:'¿Ser o estar?',subtitle:'Decisión paso a paso',nodes:[
  {id:'s',label:'Quiero describir algo',kind:'start'},
  {id:'d1',label:'¿Es una característica permanente?',kind:'decision'},
  {id:'ser',label:'Uso SER: Ella es alta',kind:'step'},
  {id:'d2',label:'¿Es un estado o lugar?',kind:'decision'},
  {id:'estar',label:'Uso ESTAR: Ella está cansada',kind:'step'},
  {id:'rev',label:'Reformulo la frase',kind:'step'},
  {id:'e',label:'Frase correcta',kind:'end'}],
 edges:[{from:'s',to:'d1'},{from:'d1',to:'ser',label:'Sí'},{from:'d1',to:'d2',label:'No'},
  {from:'d2',to:'estar',label:'Sí'},{from:'d2',to:'rev',label:'No'},{from:'ser',to:'e'},{from:'estar',to:'e'},{from:'rev',to:'d1'}]}
const ok=validateFlowchartContent(flow); assert.ok(ok.ok,JSON.stringify(ok))
const svg=renderFlowchartSvg(ok.flow)
assert.equal(svg,renderFlowchartSvg(ok.flow),'flowchart render deterministic')
const plain=svg.replace(/<[^>]+>/g,' ').replace(/&#?\w+;/g,' ')
for(const n of flow.nodes) for(const w of n.label.split(/\s+/)) assert.ok(plain.includes(w.replace(/[&<>]/g,'')),'node word drawn: '+w)
for(const e of flow.edges.filter(e=>e.label)) assert.ok(svg.includes('>'+e.label+'<'),'edge label drawn: '+e.label)
assert.equal((svg.match(/data-node=/g)||[]).length,flow.nodes.length,'every node drawn')
assert.equal((svg.match(/data-edge=/g)||[]).length,flow.edges.length,'every edge drawn')
assert.equal((svg.match(/<polygon data-node=/g)||[]).length,2,'decisions are diamonds')
assert.ok(svg.includes('marker-end'),'edges have arrowheads')
assert.ok(/viewBox="0 0 \d+ \d+"/.test(svg)&&/min-width:\d+px/.test(svg),'adaptive fluid layout with mobile scroll')
assert.ok(/ width="\d+" height="\d+"/.test(renderFlowchartSvg(ok.flow,{fixed:true})),'fixed export has real dimensions')
// layout: nothing overlaps, nothing leaves the canvas
const boxes=[...svg.matchAll(/<rect data-node="[^"]+" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(m=>[+m[1],+m[2],+m[1]+ +m[3],+m[2]+ +m[4]])
for(const m of svg.matchAll(/<polygon data-node="[^"]+" points="([^"]+)"/g)){const p=m[1].split(' ').map(s=>s.split(',').map(Number));boxes.push([Math.min(...p.map(q=>q[0])),Math.min(...p.map(q=>q[1])),Math.max(...p.map(q=>q[0])),Math.max(...p.map(q=>q[1]))])}
const dimensions=/viewBox="0 0 (\d+) (\d+)"/.exec(svg)
assert.ok(dimensions,'SVG has full viewBox dimensions')
const W=Number(dimensions[1]),H=Number(dimensions[2])
for(const b of boxes) assert.ok(b[0]>=0&&b[2]<=W&&b[1]>=0&&b[3]<=H,'node inside canvas')
for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(a[2]<=b[0]||b[2]<=a[0]||a[3]<=b[1]||b[3]<=a[1],'nodes must not overlap')}
const lv=layoutLevels(ok.flow); assert.equal(lv.get('s'),0); assert.ok(lv.get('e')>lv.get('d1'))
// back edge (rev→d1) is drawn, not lost
assert.ok(svg.includes('data-edge="rev&gt;d1"')||svg.includes('data-edge="rev>d1"'),'back edge drawn')

// NEGATIVE: what is not a well-formed graph is refused (7.5: integrity only)
const bad=(mut,why)=>{const f=JSON.parse(JSON.stringify(flow));mut(f);assert.equal(validateFlowchartContent(f).ok,false,'must reject: '+why)}
bad(f=>{f.nodes[1].id='s'},'duplicate id')
bad(f=>{f.edges[0].to='nope'},'edge to unknown node')
bad(f=>{f.nodes[2].label='<b>Uso SER</b>'},'markup in label')
bad(f=>{f.edges[0].to='s'},'self loop')
bad(f=>{f.edges.push({...f.edges[0]})},'duplicate edge')
bad(f=>{f.nodes=f.nodes.slice(0,1);f.edges=[]},'a single node is not a diagram')
bad(f=>{f.nodes[2].kind='banana'},'unknown node kind')
// POSITIVE (7.5): the Tutor's diagram is drawn as authored — these were layout opinions disguised as rules in 7.4.3
const good=(mut,why)=>{const f=JSON.parse(JSON.stringify(flow));mut(f);const r=validateFlowchartContent(f);assert.equal(r.ok,true,'must accept: '+why);const svg2=renderFlowchartSvg(r.flow);assert.equal((svg2.match(/data-node=/g)||[]).length,f.nodes.length,why+': every node drawn');assert.equal((svg2.match(/data-edge=/g)||[]).length,f.edges.length,why+': every edge drawn')}
good(f=>{f.nodes=f.nodes.filter(n=>n.kind!=='end');f.edges=f.edges.filter(e=>e.to!=='e')},'no end node')
good(f=>{f.nodes[2].kind='start'},'two entry points')
good(f=>{delete f.edges[1].label},'unlabelled branch')
good(f=>{f.edges=f.edges.filter(e=>!(e.from==='d1'&&e.to==='d2'))},'decision with one branch; d2 becomes an entry point')
good(f=>{f.nodes.push({id:'x',label:'Huérfano',kind:'step'});f.edges.push({from:'x',to:'e'})},'node only reachable as an entry point')
good(f=>{f.edges.push({from:'ser',to:'estar'})},'step with two outgoing edges')
good(f=>{f.nodes[1].label='Explicación extensa '.repeat(20)},'long label, wrapped')
const detailedFlow=JSON.parse(JSON.stringify(flow))
detailedFlow.nodes[1].label='¿Es esta característica de la persona permanente o transitoria en el tiempo?'
const detailed=validateFlowchartContent(detailedFlow)
assert.equal(detailed.ok,true,'detailed Tutor decision remains legible with adaptive layout')
assert.equal(detailed.flow.nodes[1].label,detailedFlow.nodes[1].label,'no Tutor wording is truncated')
{ // wide: 6 labelled outcomes from the start (the real Sol flow6 shape, refused by 7.4.3)
  const wide={title:'Ancho',nodes:[{id:'s',label:'¿Qué quieres expresar?',kind:'start'},...[1,2,3,4,5,6].map(i=>({id:'a'+i,label:'Opción '+i,kind:'end'}))],
    edges:[1,2,3,4,5,6].map(i=>({from:'s',to:'a'+i,label:'Una acción terminada en un periodo de tiempo ya cerrado → caso '+i}))}
  const r=validateFlowchartContent(wide); assert.equal(r.ok,true,'six labelled branches accepted')
  const ws=renderFlowchartSvg(r.flow)
  for(const e of wide.edges) for(const w of e.label.split(/\s+/)) assert.ok(ws.includes(w),'long edge label drawn in full: '+w)
}
// Arabic / CJK labels keep every character and isolate direction
{const f=JSON.parse(JSON.stringify(flow));f.title='هل أستخدم ser أم estar؟';f.nodes[0].label='ابدأ هنا';f.nodes[2].label='我用 SER 表示特征';const r=validateFlowchartContent(f);assert.ok(r.ok);const s=renderFlowchartSvg(r.flow);assert.ok(s.includes('هل أستخدم')&&s.includes('ابدأ هنا')&&s.includes('我用'));assert.ok(s.includes('unicode-bidi:plaintext'))}
// wrapping never drops a character
for(const t of ['Una frase bastante larga que necesita varias líneas para caber','supercalifragilisticoespialidosoextraordinario','这是一个没有空格的很长的中文句子需要自动换行处理','مرحبا بكم في معهد لينجورا الثقافي لتعلم الإسبانية']){
  for(const max of [8,14,17,30]){const ls=wrapLines(t,max);assert.equal(ls.join('').replace(/\s/g,''),t.replace(/\s/g,''),'wrap lossless: '+t.slice(0,12));for(const l of ls)assert.ok(visualWidth(l)<=max,'line within width')}}

// ───────────── infographic ─────────────
const turn='El 70% de los errores de principiantes mezcla ser y estar. Con 20 minutos al día, 3 semanas bastan. Hay 2 reglas básicas.'
const info={title:'Ser vs Estar en una mirada',subtitle:'Resumen visual A2',
  stats:[{value:'70%',label:'de los errores iniciales',tone:'danger'},{value:'20 min',label:'de práctica diaria'},{value:'3',label:'semanas para notar el cambio',tone:'ok'}],
  sections:[{heading:'SER',body:'Identidad, profesión, origen y características permanentes: Ella es ingeniera.',icon:'🧬',tone:'info'},
            {heading:'ESTAR',body:'Estados, lugares y resultados de acciones: Ella está cansada en Madrid.',icon:'📍',tone:'warn'}],
  takeaway:'Pregúntate: ¿esto define o describe un estado?'}
const io=validateInfographicContent(info,{text:turn}); assert.ok(io.ok,JSON.stringify(io))
const isvg=renderInfographicSvg(io.info)
assert.equal(isvg,renderInfographicSvg(io.info),'infographic deterministic')
for(const s of info.stats){assert.ok(isvg.includes('>'+s.value+'<'),'figure drawn: '+s.value)}
for(const s of info.sections){assert.ok(isvg.includes(s.heading));for(const w of s.body.split(/\s+/))assert.ok(isvg.includes(w.replace(/&/g,'&amp;')),'body word drawn: '+w)}
assert.equal((isvg.match(/data-section=/g)||[]).length,2);assert.equal((isvg.match(/data-stat=/g)||[]).length,3);assert.ok(isvg.includes('data-takeaway'))
assert.ok(isvg.includes('min-width:440px')&&/ width="520" height="\d+"/.test(renderInfographicSvg(io.info,{fixed:true})))
// NEGATIVE
const ib=(mut,src,why)=>{const f=JSON.parse(JSON.stringify(info));mut(f);assert.equal(validateInfographicContent(f,src??{text:turn}).ok,false,'must reject: '+why)}
ib(f=>{f.stats[0].value='95%'},undefined,'invented headline figure')
ib(f=>{f.sections=[]},undefined,'no sections')
ib(f=>{f.sections[0].body='<script>x</script> texto'},undefined,'markup')
ib(f=>{f.sections[0].tone='rainbow'},undefined,'unknown tone')
ib(f=>{f.sections[1].icon='<img src=x>'},undefined,'icon markup')
ib(f=>{delete f.title},undefined,'no title')
// 7.5: one section, many figures and long labels are the Tutor's choice; they are drawn in full.
{const f=JSON.parse(JSON.stringify(info));f.sections=f.sections.slice(0,1);assert.ok(validateInfographicContent(f,{text:turn}).ok,'single section accepted')}
{const f=JSON.parse(JSON.stringify(info));f.stats.push(...info.stats,...info.stats);const r=validateInfographicContent(f,{text:turn});assert.ok(r.ok,'nine figures accepted');assert.equal((renderInfographicSvg(r.info).match(/data-stat=/g)||[]).length,9,'every figure drawn')}
{const f=JSON.parse(JSON.stringify(info));f.stats[0].label='una etiqueta demasiado larga que no cabe en una línea de la tarjeta de cifra principal';const r=validateInfographicContent(f,{text:turn});assert.ok(r.ok);const g=renderInfographicSvg(r.info);for(const w of f.stats[0].label.split(' '))assert.ok(g.includes(w),'stat label wrapped, not cut: '+w)}
assert.ok(validateInfographicContent({...info,stats:[]},{text:''}).ok,'infographic without figures needs no numeric source')
// same-turn table also traces a figure
assert.ok(validateInfographicContent({...info,stats:[{value:'420',label:'usuarios en mayo'}]},{text:'',tables:[{rows:[['Mayo','420']]}]}).ok)

// ───────────── wiring (no regex on intent; typed signal is the only door) ─────────────
for(const t of ['flowchart','infographic']){assert.ok(NATIVE_TYPES.includes(t),t+' is a native type')
  const enumList=COMPLETE_TUTOR_TURN_TOOL.function.parameters.properties.artifacts.items.properties.type.enum;assert.ok(enumList.includes(t),t+' in tool enum')
  const turnOk=parseClosedTutorTurn({reply:'ok',artifacts:[{type:t,trigger:'pedagogical_completion',subject:'x y',format:'native',content:t==='flowchart'?flow:info}]});assert.ok(turnOk,t+' accepted as closed turn')
  assert.equal(parseClosedTutorTurn({reply:'ok',artifacts:[{type:t,trigger:'pedagogical_completion',subject:'x y',format:'image',content:flow}]}),null,t+' must be native')
  assert.equal(parseClosedTutorTurn({reply:'ok',artifacts:[{type:t,trigger:'pedagogical_completion',subject:'x y',format:'native'}]}),null,t+' needs content')}
assert.ok(/flowchart/.test(ARTIFACT_CHANNEL_INSTRUCTION)&&/infographic/.test(ARTIFACT_CHANNEL_INSTRUCTION),'Tutor is told the instruments exist')
const mf=materializeNativeArtifact({type:'flowchart',trigger:'pedagogical_completion',subject:'ser/estar',format:'native',content:flow},{text:''});assert.equal(mf?.type,'flowchart')
const mi=materializeNativeArtifact({type:'infographic',trigger:'pedagogical_completion',subject:'ser/estar',format:'native',content:info},{text:turn,tables:[]});assert.equal(mi?.type,'infographic')
const wrongFlow=JSON.parse(JSON.stringify(flow));wrongFlow.edges[1].to='nope'
assert.equal(materializeNativeArtifact({type:'flowchart',trigger:'pedagogical_completion',subject:'x y',format:'native',content:wrongFlow}),null,'invalid flow is refused, never drawn')
assert.equal(materializeNativeArtifact({type:'infographic',trigger:'pedagogical_completion',subject:'x y',format:'native',content:{...info,stats:[{value:'99%',label:'inventado'}]}},{text:turn}),null,'invented figure refused')

// UI + typed model
const ui=fs.readFileSync(new URL('../app/beta/beta-artifacts.tsx',import.meta.url),'utf8')
const model=fs.readFileSync(new URL('../app/beta/beta-model.ts',import.meta.url),'utf8')
assert.ok(ui.includes("a.type === 'flowchart'")&&ui.includes("a.type === 'infographic'"),'UI renders both')
assert.ok(/'chart' \| 'flowchart' \| 'infographic'/.test(model),'typed chat model includes the instruments (no casts)')
assert.ok(!/overflow:\s*'hidden'/.test(ui.slice(ui.indexOf('function SvgInstrumentBlock'),ui.indexOf('export function ArtifactRender'))),'no clipping container')
assert.ok(/overflowX:\s*'auto'/.test(ui),'scroll instead of clipping')
for(const n of ['chart','flowchart','infographic']) assert.ok(ui.includes(`kind="${n}"`),'download buttons for '+n)
// the image model is never the path
assert.ok(!/emit_image/.test(fs.readFileSync(new URL('../lib/flowchart-contract.ts',import.meta.url),'utf8')))
console.log('PASS 7.4.3/7.5 — RTD visual parity: flowchart (decisions, loops, integrity refusals, no caps, no overlap, lossless wrap) and infographic (traceable figures, refusals), typed end to end, deterministic, mobile-safe')
