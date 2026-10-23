import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}
}).outputText,file)
const {normalizeSchemaPro}=require('../lib/native-schema-contract.ts')
const {materializeNativeArtifact}=require('../server/core/native-artifact.ts')
const signal=c=>({type:'schema_pro',trigger:'explicit_user_request',subject:'SER y ESTAR',format:'native',content:c})
const canonical={title:'Contraste SER/ESTAR',blocks:[
 {type:'concept',title:'SER',body:'Identidad, profesión y origen con ejemplos concretos.'},
 {type:'concept',title:'ESTAR',body:'Estado, ubicación y resultado con ejemplos concretos.'},
 {type:'flow',steps:['Identifica el sujeto','Reconoce el significado']},
 {type:'table',columns:['Rasgo','SER','ESTAR'],rows:[['Ubicación','Evento','Objeto']]}
]}
assert.deepEqual(normalizeSchemaPro(canonical)?.blocks,canonical.blocks,'canonical data unchanged')
assert.equal(materializeNativeArtifact(signal(canonical))?.type,'schema_pro')
const equivalent={title:'Contraste SER/ESTAR',blocks:[
 {type:'section',heading:'SER',description:'Identidad, profesión y origen con ejemplos concretos.'},
 {type:'definition',title:'ESTAR',text:'Estado, ubicación y resultado con ejemplos concretos.'},
 {type:'steps',nodes:[{title:'Paso 1',description:'Identifica el sujeto'},{label:'Paso 2',text:'Reconoce el significado'}]},
 {type:'table',columns:[{key:'use',label:'Rasgo'},{key:'ser',label:'SER'}],rows:[[{text:'Ubicación'},{value:'Evento'}]]}
]}
const accepted=normalizeSchemaPro(equivalent)
assert.ok(accepted,'semantically equivalent tutor-authored fields')
assert.equal(accepted.blocks.length,4)
assert.equal(accepted.blocks[0].type,'concept')
assert.equal(accepted.blocks[2].type,'flow')
assert.equal(accepted.blocks[3].type,'table')
assert.equal(materializeNativeArtifact(signal(equivalent))?.type,'schema_pro')
assert.equal(normalizeSchemaPro({title:'Sin contenido',blocks:[{type:'concept',title:'SER'},{}]}),null,'no empty placebo')
assert.ok(normalizeSchemaPro({title:'Un solo bloque',blocks:[canonical.blocks[0]]}),'7.5: one substantive block is a valid schema (no minimum-count opinion)')
assert.equal(normalizeSchemaPro({title:'Vacío',blocks:[]}),null,'but an empty schema is refused')
assert.equal(normalizeSchemaPro({title:'HTML',blocks:[{type:'concept',title:'SER',body:'<script>bad</script>'},canonical.blocks[1]]}),null)
assert.equal(normalizeSchemaPro({title:'Improper flow',blocks:[{type:'flow',steps:[{name:'step'}]},canonical.blocks[0]]}),null)
assert.equal(normalizeSchemaPro({title:'Empty table',blocks:[{type:'table',columns:['A','B'],rows:[[null,null]]},canonical.blocks[0]]}),null)
console.log('PASS — Schema Pro canonical adapters: grounded aliases, native materialization, invalid content fail-closed')
