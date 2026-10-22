#!/usr/bin/env node
// Fail-closed documentation preflight. Evidence still requires AE/DAE review.
'use strict'
const fs=require('node:fs')
const empty=new Set(['','n/a','na','none','ninguna','por definir','pendiente','tbd','todo','yes','no','not verified','blocked','pass','fail'])
const requirements={
  1:['Obligatorio'],
  2:['Respuesta','Evidencia'],
  3:['Responsabilidad instrumental'],
  4:['Clasificación','Evidencia reproducible'],
  5:['Justificación','Tratamiento sin pérdida'],
  6:['Alternativas evaluadas','Solución propuesta'],
  7:['Contrato único y errores visibles'],
  8:['Prueba negativa','Prueba real','Limitaciones sin verificar'],
  9:['Dependencia constitucional','Decisión gate CNP-01'],
}
function check(body){
  const errors=[]
  if(typeof body!=='string'||!body.trim())return ['CNP-01: falta el cuerpo completo del PR']
  const sections=new Map()
  const starts=[...body.matchAll(/^##\s+([1-9])\.\s+.+$/gm)].map(m=>({section:Number(m[1]),index:m.index}))
  for(let i=0;i<starts.length;i++)sections.set(starts[i].section,body.slice(starts[i].index,starts[i+1]?.index??body.length))
  for(const [section,keys] of Object.entries(requirements)){
    const block=sections.get(Number(section))
    if(!block){errors.push('CNP-01: falta sección '+section);continue}
    for(const key of keys){
      const line=block.split('\n').find(x=>x.toLowerCase().startsWith(key.toLowerCase()+':'))
      const answer=line?.slice(key.length+1).trim()??''
      if(!answer||empty.has(answer.toLowerCase()))errors.push('CNP-01: '+section+' — '+key+' necesita evidencia y criterio concreto')
    }
  }
  const block2=sections.get(2)??''
  if(!/^Respuesta:\s*(YES|NO|NOT VERIFIED)\s*[-–:,;.]\s*\S/im.test(block2))
    errors.push('CNP-01: respuesta nativa debe comenzar YES/NO/NOT VERIFIED seguida de explicación')
  const block4=sections.get(4)??''
  if(!/^Clasificación:\s*(COGNITIVO|INSTRUMENTAL|MIXTO|NO DEMOSTRADO)\s*[-–:,;.]\s*\S/im.test(block4))
    errors.push('CNP-01: clasificación cognitiva/instrumental inválida')
  const block9=sections.get(9)??''
  if(!/^Decisión gate CNP-01 \(PASS\/FAIL\/BLOCKED\):\s*(PASS|FAIL|BLOCKED)\s*[-–:,;.]\s*\S/im.test(block9))
    errors.push('CNP-01: decisión explícita de gate con justificación requerida')
  return errors
}
if(require.main===module){
  let body=process.env.CNP_PR_BODY??''
  if(process.env.GITHUB_EVENT_PATH){
    const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'))
    body=event.pull_request?.body??body
  }
  const issues=check(body)
  if(issues.length){for(const m of issues)console.error(m);process.exitCode=1}
  else console.log('PASS CNP-01 — evidencia documentada, pendiente de revisión humana')
}
module.exports={check,requirements}
