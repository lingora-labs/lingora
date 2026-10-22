// EPHEMERAL AE 7.4.4 QA probe — only on ae/7-4-4-live-probe, never merged.
// Protected by a branch-only secret; makes at most one real Tutor call per GET.
// No source content, token or identity information is logged.
import { NextRequest, NextResponse } from 'next/server'
import { POST } from '../../../server/api/chat-entry'
import { DEFAULT_SESSION_STATE } from '../../../lib/contracts'
import { validateFlowchartContent, renderFlowchartSvg } from '../../../lib/flowchart-contract'
import { validateInfographicContent, renderInfographicSvg } from '../../../lib/infographic-contract'
import { validateChartContent, renderChartSvg } from '../../../lib/chart-contract'
export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const SCENARIOS: Record<string, string> = {
  f: 'Explícame cómo decidir entre SER y ESTAR con un diagrama de flujo visual, con preguntas, bifurcaciones SÍ/NO, conexiones, ejemplos y al menos dos finales diferentes. Quiero poder seguir las flechas sin tener que leer una explicación aparte.',
  i: 'Prepara una infografía académica a todo color sobre los errores más frecuentes con SER y ESTAR, incluyendo explicación, categorías, ejemplos, reglas y conclusión. No inventes porcentajes ni estadísticas.',
  t: 'Construye una tabla académica completa y a todo color que compare SER y ESTAR: usos, estructuras, conjugaciones, excepciones, ejemplos, errores frecuentes, nivel CEFR y correcciones. Quiero verla aquí en la conversación.',
}
export async function GET(req: NextRequest) {
  if (!process.env.AE_PROBE_KEY || req.nextUrl.searchParams.get('key') !== process.env.AE_PROBE_KEY)
    return NextResponse.json({error:'unauthorized'}, {status:403,headers:{'Cache-Control':'no-store'}})
  const id=req.nextUrl.searchParams.get('p')??'f'
  const message=SCENARIOS[id]
  if(!message)return NextResponse.json({error:'invalid_case'}, {status:400})
  const state={...DEFAULT_SESSION_STATE, mentorProfile:'Sarah',userLevel:'A2',
    confirmedLevel:'A2',interfaceLanguage:'es',activeMode:'interact',tokens:2}
  const t=Date.now()
  const q=new NextRequest('http://localhost/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,state,stream:false})})
  try {
    const resp=await POST(q)
    const json=await resp.json() as Record<string,unknown>
    const reply=String(json.message??json.reply??'')
    const unique=new Map<string,Record<string,unknown>>()
    for(const a of [...(Array.isArray(json.artifacts)?json.artifacts:[]),...(json.artifact?[json.artifact]:[])]){
      if(a&&typeof a==='object'){const v=a as Record<string,unknown>;unique.set(String(v.type)+JSON.stringify(v.content??v.title??''),v)}
    }
    const artifacts=[...unique.values()].map(a=>{
      const type=String(a.type??'')
      const c=a.content
      const check=type==='flowchart'?validateFlowchartContent(c):
        type==='infographic'?validateInfographicContent(c):
        type==='chart'?validateChartContent(c):null
      let svg=''
      if(check?.ok){if(type==='flowchart')svg=renderFlowchartSvg((check as ReturnType<typeof validateFlowchartContent> & {ok:true}).flow,{fixed:true})
        else if(type==='infographic')svg=renderInfographicSvg((check as ReturnType<typeof validateInfographicContent> & {ok:true}).info,{fixed:true})
        else if(type==='chart')svg=renderChartSvg((check as ReturnType<typeof validateChartContent> & {ok:true}).chart,{fixed:true})}
      return {type,valid:check?.ok??null,validation:check&&!check.ok?'invalid':null,svgBytes:Buffer.byteLength(svg),svgPresent:svg.startsWith('<svg'),details:type==='flowchart'?{nodeCount:Array.isArray((c as Record<string,unknown>)?.nodes)?(c as {nodes:unknown[]}).nodes.length:0,edgeCount:Array.isArray((c as Record<string,unknown>)?.edges)?(c as {edges:unknown[]}).edges.length:0}:
        type==='infographic'?{sections:Array.isArray((c as Record<string,unknown>)?.sections)?(c as {sections:unknown[]}).sections.length:0,stats:Array.isArray((c as Record<string,unknown>)?.stats)?(c as {stats:unknown[]}).stats.length:0}:
        type==='table_matrix'?{columns:Array.isArray((c as Record<string,unknown>)?.columns)?(c as {columns:unknown[]}).columns.length:0,rows:Array.isArray((c as Record<string,unknown>)?.rows)?(c as {rows:unknown[]}).rows.length:0}:null}
    })
    return NextResponse.json({case:id,ms:Date.now()-t,status:resp.status,replyChars:reply.length,replyHead:reply.slice(0,360),replyTail:reply.slice(-100),artifacts,failures:json.artifactFailures??[],modelTarget:'gpt-5.6-sol',stateMentor:String(state.mentorProfile)}, {headers:{'Cache-Control':'no-store'}})
  }catch(err){return NextResponse.json({case:id,error:err instanceof Error?err.name:'request_failed',ms:Date.now()-t},{status:502,headers:{'Cache-Control':'no-store'}})}
}
