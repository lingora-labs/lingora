import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const {parseClosedTutorTurn:parse,diagnoseClosedTutorTurn:diagnose}=require('../lib/artifact-signal.ts')
const artifact={type:'quiz',trigger:'explicit_user_request',subject:'SER y ESTAR',format:'native',content:{}}
const turn=artifacts=>({reply:'Respuesta',artifacts})
const cases=[
 ['closure_invalid',null],['closure_invalid',false],['closure_invalid','text'],
 ['reply_empty',{}],['reply_empty',{reply:3}],['reply_empty',turn([])&&{reply:'  ',artifacts:[]}],
 ['artifacts_invalid',{reply:'ok'}],['artifacts_invalid',{reply:'ok',artifacts:{}}],
 ['artifact_count',turn(Array(6).fill(artifact))],['artifact_invalid:0',turn([null])],
 ['artifact_invalid:0',turn(['quiz'])],['invalid_type:0',turn([{...artifact,type:'unknown'}])],
 ['invalid_type:0',turn([{...artifact,type:3}])],
 ['invalid_trigger:0',turn([{...artifact,trigger:'unknown'}])],
 ['bad_subject:0',turn([{...artifact,subject:' x '}])],['bad_subject:0',turn([{...artifact,subject:null}])],
 ['pdf_contract:0',turn([{...artifact,type:'emit_pdf',format:'pdf',trigger:'pedagogical_completion'}])],
 ['pdf_contract:0',turn([{...artifact,type:'emit_pdf',format:'native'}])],
 ['audio_contract:0',turn([{...artifact,type:'emit_audio',format:5}])],
 ['image_contract:0',turn([{...artifact,type:'emit_image',format:'image',trigger:'pedagogical_completion'}])],
 ['image_contract:0',turn([{...artifact,type:'emit_image',format:'pdf'}])],
 ['native_format:0',turn([{...artifact,format:undefined}])],
 ['native_missing_content:0',turn([{...artifact,content:undefined}])],
 ['native_missing_content:0',turn([{...artifact,content:[]}])],
 ...['show_visual','show_quiz'].map(type=>['unsupported_type:0',turn([{...artifact,type}])]),
 ['bad_subject:1',turn([artifact,{...artifact,subject:''}])],
]
for(const [cause,raw] of cases){const before=JSON.stringify(raw);assert.equal(diagnose(raw),cause);assert.equal(parse(raw),null);assert.equal(JSON.stringify(raw),before)}
// Cross-product: diagnosis must agree with the unchanged public parser, including legacy quirks.
let combinations=0
for(const type of ['emit_pdf','emit_audio','emit_image','table_matrix','schema_pro','quiz','show_visual','show_quiz','bogus',undefined])
for(const trigger of ['explicit_user_request','pedagogical_completion','bogus',undefined])
for(const format of ['pdf','pdf_html','image','audio','native',42,undefined])
for(const content of [{},[],null,'bad']){
 const raw=turn([{...artifact,type,trigger,format,content}]);assert.equal(diagnose(raw)===null,parse(raw)!==null);combinations++
}
assert.deepEqual(parse(turn([artifact,artifact])).artifacts,[artifact])
assert.equal(diagnose(turn([])),null)
assert.equal(diagnose(turn(Array(5).fill(artifact))),null)
console.log(`PASS Gate A: ${cases.length} rejection cases; ${combinations} parser-parity combinations`)
