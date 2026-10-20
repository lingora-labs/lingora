// Run from the checkout: node tests/p1-02-audit.mjs /workspace/p1-02-evidence/candidate
// Evidence stays outside the checkout. Every command is bounded and tied to HEAD.
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync,execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const base='b4bed61623c31a956e6863f2a8d120c17d7dd41d'
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const out=path.resolve(process.argv[2]??'/workspace/p1-02-evidence/candidate')
if(out.startsWith(process.cwd()+path.sep))throw Error('Store evidence outside the checkout')
fs.mkdirSync(out,{recursive:true})
const diff=execFileSync('git',['diff',base,sha,'--'],{encoding:'utf8'})
fs.writeFileSync(path.join(out,'candidate.diff'),diff)
const report={base,candidate:sha,started:new Date().toISOString(),diffSha256:createHash('sha256').update(diff).digest('hex'),results:[],liveGates:{C:{status:'NOT_RUN',attempts:0,required:10,reason:'Requires accessible real preview verified against candidate SHA, with working OpenAI binding; no hidden retries or replacement battery.'},D:{status:'NOT_RUN',reason:'Local contracts are recorded separately; other four P1, real image bytes, bilingual PDF+HTML, export, continuity and browser UI require preview execution on candidate. No inherited PASS.'}},certification:'UNSCORED; IJL/Work independent retest and DAE review required'}
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')
save()
const suites=fs.readdirSync('tests').filter(n=>n.endsWith('.test.mjs')).sort()
const commands=suites.map(n=>({id:n,cmd:process.execPath,args:['tests/'+n],timeout:45000}))
commands.push({id:'document-fidelity',cmd:process.execPath,args:['tests/document-fidelity.mjs'],timeout:45000})
commands.push({id:'typescript',cmd:process.execPath,args:['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],timeout:90000})
commands.push({id:'production-build',cmd:process.execPath,args:['node_modules/next/dist/bin/next','build'],timeout:180000})
for(const c of commands){
 const started=new Date().toISOString()
 const r=spawnSync(c.cmd,c.args,{encoding:'utf8',timeout:c.timeout,maxBuffer:8*1024*1024})
 const log=c.id.replace(/[^a-zA-Z0-9_.-]/g,'_')+'.log'
 fs.writeFileSync(path.join(out,log),(r.stdout??'')+(r.stderr??''))
 const status=r.error?.code==='ETIMEDOUT'?'TIMEOUT':r.status===0?'PASS':'FAIL'
 report.results.push({id:c.id,commit:sha,command:[c.cmd,...c.args],started,finished:new Date().toISOString(),timeoutMs:c.timeout,status,exitCode:r.status,signal:r.signal,errorCode:r.error?.code??null,log})
 save();console.log(status,c.id)
}
report.finished=new Date().toISOString();save()
console.log('Evidence:',out)
if(report.results.some(r=>r.status!=='PASS'))process.exitCode=1
