// AE 7.4.4 — regressions from Work's real 7.4.3 UI failures.
// Offline. The SAME canonical limits are advertised to the Tutor and
// enforced by runtime; adapters preserve content and never invent branches.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file)
const {NATIVE_ARTIFACT_CONTENT_TOOL_SCHEMA: schema,VISUAL_LIMITS}=require('../lib/native-visual-schema.ts')
const {COMPLETE_TUTOR_TURN_TOOL,parseClosedTutorTurn}=require('../lib/artifact-signal.ts')
const {validateFlowchartContent,renderFlowchartSvg}=require('../lib/flowchart-contract.ts')
const {validateInfographicContent,renderInfographicSvg}=require('../lib/infographic-contract.ts')
const {materializeNativeArtifact}=require('../server/core/native-artifact.ts')
const exposed=COMPLETE_TUTOR_TURN_TOOL.function.parameters.properties.artifacts.items.properties.content
assert.equal(exposed,schema,'tool and tests must use the same actual schema')
const props=exposed.properties
assert.deepEqual(props.nodes.items.properties.kind.enum,['start','step','decision','end'])
assert.deepEqual(props.nodes.items.required,['id','label','kind'])
assert.equal(props.nodes.items.properties.label.maxLength,VISUAL_LIMITS.flow.labelMax)
assert.equal(props.nodes.minItems,VISUAL_LIMITS.flow.nodesMin)
assert.equal(props.nodes.maxItems,VISUAL_LIMITS.flow.nodesMax)
assert.equal(props.edges.items.properties.label.maxLength,VISUAL_LIMITS.flow.edgeLabelMax)
assert.deepEqual(props.sections.items.required,['heading','body'])
assert.equal(props.sections.minItems,VISUAL_LIMITS.infographic.sectionsMin)
assert.equal(props.sections.maxItems,VISUAL_LIMITS.infographic.sectionsMax)
assert.equal(props.stats.maxItems,VISUAL_LIMITS.infographic.statsMax)
assert.equal(props.rows.minItems,VISUAL_LIMITS.table.rowsMin)
assert.ok(props.rows.items.items.properties.tone.enum.includes('warn'),'colored table cell schema')

const flow={title:'SER o ESTAR',nodes:[
  {id:'start',kind:'start',label:'Quiero describir una situación'},
  {id:'question',kind:'decision',label:'¿Identidad o estado?'},
  {id:'ser',kind:'step',label:'SER: ella es médica'},
  {id:'estar',kind:'step',label:'ESTAR: ella está cansada'},
  {id:'done',kind:'end',label:'Fin'},
],edges:[
  {from:'start',to:'question'},
  {from:'question',to:'ser',label:'Identidad'},
  {from:'question',to:'estar',label:'Estado'},
  {from:'ser',to:'done'},
  {from:'estar',to:'done'},
]}
assert.equal(validateFlowchartContent(flow).ok,true,'canonical flow passes')
// Tutor-authored equivalent keys and kind names: content is lossless.
const equivalent={...flow,nodes:flow.nodes.map(n=>({
  id:n.id,type:n.kind==='decision'?'question':n.kind==='step'?'process':n.kind,
  text:n.label
})),edges:flow.edges.map(e=>({source:e.from,target:e.to,...(e.label?{label:e.label}:{})}))}
const parsed=validateFlowchartContent(equivalent)
assert.equal(parsed.ok,true,JSON.stringify(parsed))
assert.deepEqual(parsed.flow,flow,'adapters preserve exactly all original labels, branch labels and topology')
assert.ok(renderFlowchartSvg(parsed.flow).includes('data-node="question"'),'decision node rendered')
assert.equal(parsed.flow.nodes.find(n=>n.id==='question').label,'¿Identidad o estado?','complete Tutor label survives wrapping')
const broken={...equivalent,nodes:equivalent.nodes.filter(n=>n.id!=='estar')}
assert.equal(validateFlowchartContent(broken).ok,false,'never invent a missing branch')
const unknown={...equivalent,nodes:equivalent.nodes.map(n=>n.id==='question'?{...n,type:'something-else'}:n)}
assert.equal(validateFlowchartContent(unknown).ok,false,'unknown decision type never guessed')
const unlabeled={...equivalent,edges:equivalent.edges.map(e=>e.source==='question'&&e.target==='ser'?{source:e.source,target:e.target}:e)}
assert.equal(validateFlowchartContent(unlabeled).ok,false,'decision with missing branch label rejected')

// Work real-Sol rejection 7.4.4: 22 valid nodes were rejected by the old 16-node cap.
// A complete Tutor-authored flow must not be clipped to fit an arbitrary UI limit.
const longNodes=[{id:'s',label:'Inicio',kind:'start'},
  ...Array.from({length:20},(_,i)=>({id:'step'+i,label:'Paso '+(i+1),kind:'step'})),
  {id:'e',label:'Fin',kind:'end'}]
const longEdges=longNodes.slice(1).map((node,i)=>({from:longNodes[i].id,to:node.id}))
const longFlow={title:'Curso paso a paso',nodes:longNodes,edges:longEdges}
const longCheck=validateFlowchartContent(longFlow)
assert.equal(longCheck.ok,true,JSON.stringify(longCheck))
assert.equal((renderFlowchartSvg(longCheck.flow).match(/data-node=/g)||[]).length,22,'22 nodes rendered, none lost')
assert.equal((renderFlowchartSvg(longCheck.flow).match(/data-edge=/g)||[]).length,21,'21 edges rendered, none lost')
assert.equal(schema.properties.nodes.maxItems,32,'Tutor advertised cap agrees with server')
assert.equal(validateFlowchartContent({...longFlow,nodes:[...longNodes,...longNodes]}).ok,false,'bounded graph still rejects oversized payload')

const info={title:'SER y ESTAR — infografía',sections:[
  {heading:'SER',body:'Identidad, profesión, origen y definiciones estables.'},
  {heading:'ESTAR',body:'Estados temporales, localizaciones y resultados.'},
],takeaway:'Elige de acuerdo con el sentido de la frase.'}
assert.ok(validateInfographicContent(info).ok,'canonical infographic passes')
const infoAlt={title:info.title,cards:info.sections.map(s=>({title:s.heading,text:s.body})),takeaway:info.takeaway}
const alt=validateInfographicContent(infoAlt)
assert.equal(alt.ok,true,JSON.stringify(alt))
assert.deepEqual(alt.info, { title:info.title, stats:[],sections:info.sections,takeaway:info.takeaway })
assert.match(renderInfographicSvg(alt.info),/ESTAR/)
assert.equal(validateInfographicContent({...info,sections:info.sections.slice(0,1)}).ok,false,'single section remains invalid')
assert.equal(validateInfographicContent({...info,sections:[]}).ok,false,'no fabricated sections')
assert.equal(validateInfographicContent({...info,sections:[{heading:'SER',body:'<script>evil</script>'},info.sections[1]]}).ok,false,'markup rejected')
assert.equal(validateInfographicContent({...info,stats:[{value:'99%',label:'dato inventado'}]},{text:'ser estar 10%'}).ok,false,'untraceable stat rejected')
for(const [type,content] of [['flowchart',equivalent],['infographic',infoAlt]]){
  const s={type,trigger:'explicit_user_request',subject:'SER ESTAR',format:'native',content}
  assert.ok(parseClosedTutorTurn({reply:'Explicación sustantiva',artifacts:[s]}),'typed closure keeps artifact')
  assert.equal(materializeNativeArtifact(s,{text:'SER ESTAR'})?.type,type,'native instrument must materialize')
}
console.log('PASS 7.4.4 — typed tool schema, lossy aliases refused, compatible synonyms materialized, no invented nodes/sections or figures')
