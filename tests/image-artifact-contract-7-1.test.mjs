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
const {isExplicitImageRequest,fulfillArtifactSignals}=require('../server/core/artifact-side-effect.ts')
const mentor=fs.readFileSync(new URL('../server/mentors/mentor-engine.ts',import.meta.url),'utf8')
assert.match(mentor,/const recoveryModel = process\.env\.OPENAI_RECOVERY_MODEL \|\| model/)
assert.doesNotMatch(mentor,/OPENAI_RECOVERY_MODEL \|\| 'gpt-4o'/)
const image={type:'emit_image',trigger:'explicit_user_request',subject:'una chef dibujada en una cocina luminosa',format:'image'}
assert.ok(COMPLETE_TUTOR_TURN_TOOL.function.parameters.properties.artifacts.items.properties.type.enum.includes('emit_image'))
assert.ok(COMPLETE_TUTOR_TURN_TOOL.function.parameters.properties.artifacts.items.properties.format.enum.includes('image'))
assert.ok(parseArtifactSignal(image))
assert.equal(parseClosedTutorTurn({reply:'Imagen solicitada',artifacts:[image]})?.artifacts.length,1)
assert.equal(parseClosedTutorTurn({reply:'Bienvenido',artifacts:[{...image,trigger:'pedagogical_completion'}]}),null)
assert.equal(parseClosedTutorTurn({reply:'Imagen',artifacts:[{...image,format:'pdf'}]}),null)
assert.equal(parseClosedTutorTurn({reply:'No hay contenido',artifacts:[{...image,type:'inexistente'}]}),null)
for(const msg of ['Genera una imagen de una chef en cocina','Crea una ilustración original de un mercado','Quiero una fotografía generada de una clase de español','Draw an image of a restaurant','Generate a picture of a Spanish kitchen','ارسم صورة عن مطبخ إسباني']){
 assert.equal(isExplicitImageRequest(msg),true,'expected authorized: '+msg)
}
for(const msg of ['Hola','Enséñame SER y ESTAR','Quiero una tabla de vocabulario con imágenes en las celdas','Explícame cómo se generan las imágenes','Genera una tabla de imágenes para estudiar','No generes una imagen; hazme un quiz','Sin imagen. Quiero un PDF de la conversación.']){
 assert.equal(isExplicitImageRequest(msg),false,'expected rejected: '+msg)
}
const state={activeMode:'interact',interfaceLanguage:'es',mentorProfile:'Sarah',tokens:1}
const fulfill=(message,signals=[image])=>fulfillArtifactSignals(signals,'Lección con contenido útil.',state,message)
let r=await fulfill('Hola')
assert.equal(globalThis.__imageCalls.length,0,'no image credit on greetings')
assert.deepEqual(r.artifacts,[]);assert.deepEqual(r.failures,[])
r=await fulfill('Genera una imagen original de una cocina')
assert.equal(globalThis.__imageCalls.length,1);assert.equal(r.artifacts[0]?.type,'illustration');assert.deepEqual(r.failures,[])
r=await fulfill('Genera una imagen de cocina',[{...image,trigger:'pedagogical_completion'}])
assert.equal(globalThis.__imageCalls.length,1,'pedagogical completion forbidden')
r=await fulfill('Genera una imagen de cocina',[image,image,{...image,subject:'segunda imagen no solicitada'}])
assert.equal(globalThis.__imageCalls.length,2,'one image per turn')
globalThis.__imageFail=true
r=await fulfill('Genera una imagen de una chef')
assert.equal(globalThis.__imageCalls.length,3);assert.equal(r.artifacts.length,0);assert.equal(r.failures.length,1)
console.log('PASS DAE — explicit image, no unrequested generation, failure truth, model parity')
