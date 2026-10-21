// DAE 2026-10-18: image contract/cost gate, no real image credits spent.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>{
 if(file.endsWith('/server/tools/image-generator.ts')){
   mod._compile("exports.generateImage = async function(prompt) { globalThis.__imageCalls.push(prompt); return globalThis.__imageFail ? {success:false,error:'synthetic failure'} : {success:true,url:'data:image/png;base64,aW1hZ2UtYnl0ZXM='} }",file); return
 }
 mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
}
globalThis.__imageCalls=[];globalThis.__imageFail=false
const {parseClosedTutorTurn,parseArtifactSignal,COMPLETE_TUTOR_TURN_TOOL}=require('../lib/artifact-signal.ts')
const {fulfillArtifactSignals}=require('../server/core/artifact-side-effect.ts')
const image={type:'emit_image',trigger:'explicit_user_request',subject:'una chef dibujada en una cocina luminosa',format:'image'}
assert.ok(COMPLETE_TUTOR_TURN_TOOL.function.parameters.properties.artifacts.items.properties.type.enum.includes('emit_image'))
assert.ok(COMPLETE_TUTOR_TURN_TOOL.function.parameters.properties.artifacts.items.properties.format.enum.includes('image'))
assert.ok(parseArtifactSignal(image))
assert.equal(parseClosedTutorTurn({reply:'Imagen solicitada',artifacts:[image]})?.artifacts.length,1)
assert.equal(parseClosedTutorTurn({reply:'Bienvenido',artifacts:[{...image,trigger:'pedagogical_completion'}]}),null)
assert.equal(parseClosedTutorTurn({reply:'Imagen',artifacts:[{...image,format:'pdf'}]}),null)
assert.equal(parseClosedTutorTurn({reply:'No hay contenido',artifacts:[{...image,type:'inexistente'}]}),null)
const state={activeMode:'interact',interfaceLanguage:'es',mentorProfile:'Sarah',tokens:1}
const fulfill=(message,signals=[image])=>fulfillArtifactSignals(signals,'Lección con contenido útil.',state,message)
// 7.3: the Tutor's typed signal is the authorization; the runtime never reads the message.
let r=await fulfill('',[])
assert.equal(globalThis.__imageCalls.length,0,'no signal, no image credit')
r=await fulfill('',[image])
assert.equal(globalThis.__imageCalls.length,1);assert.equal(r.artifacts[0]?.type,'illustration');assert.deepEqual(r.failures,[])
r=await fulfill('',[{...image,trigger:'pedagogical_completion'}])
assert.equal(globalThis.__imageCalls.length,1,'pedagogical completion forbidden')
r=await fulfill('',[image,image,{...image,subject:'segunda imagen'}])
assert.equal(globalThis.__imageCalls.length,2,'one image per turn')
globalThis.__imageFail=true
r=await fulfill('',[image])
assert.equal(globalThis.__imageCalls.length,3);assert.equal(r.artifacts.length,0);assert.equal(r.failures.length,1)
console.log('PASS 7.3 — image only by Tutor signal, 1 per turn, failure truth')
