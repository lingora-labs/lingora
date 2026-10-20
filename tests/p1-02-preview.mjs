// Gate C: one immutable battery. Requires an independently verified deployment/SHA record.
// node tests/p1-02-preview.mjs https://preview.example /path/deployment.json /workspace/p1-02-evidence/preview
// deployment.json: {"commit":"<full HEAD>","url":"https://preview.example","evidence":"<deployment record URL or identifier>"}
// Optional protection bypass comes only from LINGORA_PREVIEW_BYPASS (never persisted).
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const {validateQuizAnswerKey}=require('../lib/quiz-answer-key.ts')
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const [urlArg,proofArg,outArg]=process.argv.slice(2)
if(!urlArg||!proofArg||!outArg)throw Error('Supply real preview URL, deployment evidence JSON and a new external evidence directory')
const url=new URL(urlArg)
if(url.protocol!=='https:'||url.username||url.password||['localhost','127.0.0.1'].includes(url.hostname))throw Error('Real HTTPS preview required')
const proof=JSON.parse(fs.readFileSync(proofArg,'utf8'))
if(proof.commit!==commit||new URL(proof.url).origin!==url.origin||!proof.evidence)throw Error('Deployment evidence must identify exact candidate SHA and preview')
const out=path.resolve(outArg)
if(out.startsWith(process.cwd()+path.sep))throw Error('Evidence must be external to checkout')
// Exclusive directory: never overwrite a failed battery or silently start it over.
fs.mkdirSync(out,{recursive:false})
const message='Hazme un quiz táctil de tres preguntas sobre SER y ESTAR. No generes una imagen ni un PDF.'
const report={commit,deployment:proof,promptSha256:createHash('sha256').update(message).digest('hex'),configuration:{mentorProfile:'Sarah',interfaceLanguage:'es',activeMode:'interact',tokens:2},timeoutMs:120000,results:[],status:'RUNNING',certification:'UNSCORED'}
const save=()=>fs.writeFileSync(path.join(out,'gate-c.json'),JSON.stringify(report,null,2)+'\n')
save()
for(let i=1;i<=10;i++){
 const result={iteration:i,commit,started:new Date().toISOString(),status:'FAIL',cause:null,artifactCount:0,artifactTypes:[],requestId:null,serverStructuralCause:null}
 try{
  const headers={'content-type':'application/json','accept':'text/event-stream'}
  if(process.env.LINGORA_PREVIEW_BYPASS)headers['x-vercel-protection-bypass']=process.env.LINGORA_PREVIEW_BYPASS
  const response=await fetch(new URL('/api/chat',url),{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(report.timeoutMs),body:JSON.stringify({message,state:{...report.configuration,targetLanguage:'es',tutorPhase:'guide',confirmedLevel:null,userLevel:'A1',lastConcept:null,lastUserGoal:null,masteryByModule:{},samples:[]},stream:true})})
  result.requestId=response.headers.get('x-vercel-id')
  if(!response.ok)throw Error('http_'+response.status)
  const body=await response.text()
  let payload,text='',doneCount=0
  if(response.headers.get('content-type')?.includes('text/event-stream')){
   for(const line of body.split('\n'))if(line.startsWith('data: ')){
    const event=JSON.parse(line.slice(6));if(event.delta)text+=event.delta
    if(event.done){doneCount++;payload=event}
   }
   if(doneCount!==1)throw Error('done_count')
  }else {payload=JSON.parse(body);text=payload.message??''}
  if(!text.trim()||payload?.error||payload?.artifactFailures?.length)throw Error('turn_not_completed')
  const artifacts=payload.artifacts??(payload.artifact?[payload.artifact]:[])
  result.artifactCount=artifacts.length
  const known=['quiz','schema_pro','table_matrix','pdf','document','illustration','image','audio','visual']
  result.artifactTypes=artifacts.map(a=>known.includes(a?.type)?a.type:'invalid')
  if(artifacts.some(a=>['pdf','document','illustration','image'].includes(a.type)||a.pdfUrl||a.imageUrl||/^(?:data:application\/pdf|data:image\/)/.test(a.url??a.dataUrl??'')))throw Error('unauthorized_artifact')
  const quizzes=artifacts.filter(a=>a.type==='quiz')
  if(quizzes.length!==1)throw Error('quiz_count')
  const c=quizzes[0].content
  if(c?.questions?.length!==3)throw Error('question_count')
  if(c.gradingMode==='tutor_review'||!validateQuizAnswerKey(c.questions).ok)throw Error('quiz_key_unverified')
  result.status='PASS'
 }catch(e){result.cause=e?.name==='TimeoutError'?'request_timeout':/^(http_\d+|done_count|turn_not_completed|unauthorized_artifact|quiz_count|question_count|quiz_key_unverified)$/.test(e?.message)?e.message:'transport_or_payload_invalid'}
 result.finished=new Date().toISOString();report.results.push(result);save();console.log(result.iteration,result.status,result.cause??'')
 if(result.status!=='PASS'){
  report.status='FAIL_STOPPED';report.remaining='NOT_RUN after first FAIL; do not replace battery';save();process.exitCode=1;break
 }
}
if(report.results.length===10&&report.results.every(r=>r.status==='PASS')){report.status='PASS_10_OF_10_REQUIRES_INDEPENDENT_REVIEW';save()}
