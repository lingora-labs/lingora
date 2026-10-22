// Temporary QA-only probe for 7.4.5. Never merge to product or production.
import {NextRequest, NextResponse} from 'next/server'
import {POST} from '../../../server/api/chat-entry'
import {DEFAULT_SESSION_STATE} from '../../../lib/contracts'
import {renderConversationExportHtml} from '../../../server/tools/pdf/conversationExport'
export const runtime='nodejs'
export const maxDuration=300
export const dynamic='force-dynamic'
const samples:Record<string,string>={
 table:'Explícame profundamente la diferencia entre SER y ESTAR y construye dentro de esta conversación una tabla académica completa A TODO COLOR con al menos 8 columnas: usos, estructuras, conjugaciones, excepciones, ejemplos, errores frecuentes, nivel CEFR y correcciones. Quiero verla aquí, no como una promesa ni como texto que parezca una tabla.',
 quiz:'Crea aquí un quiz táctil de exactamente 12 preguntas sobre SER y ESTAR, cada una con opciones A), B) y C), para que pueda pulsar mis respuestas y pedir revisión pedagógica. No generes PDF.',
}
const chart={title:'Usuarios y conversion',categories:['Enero','Febrero','Marzo','Abril','Mayo','Junio'],panels:[{kind:'bar',title:'Usuarios',values:[120,180,240,300,420,510]},{kind:'line',title:'Conversion',unit:'%',values:[4,5,7,6,8,9]}]}
const flow={title:'SER ESTAR',nodes:[{id:'s',kind:'start',label:'Inicio'},{id:'d',kind:'decision',label:'¿Identidad?'},
{id:'a',kind:'end',label:'SER'},{id:'b',kind:'end',label:'ESTAR'}],
edges:[{from:'s',to:'d'},{from:'d',to:'a',label:'Sí'},{from:'d',to:'b',label:'No'}]}
const info={title:'Infografia',sections:[{heading:'SER',body:'Para indicar identidad o profesion.'},{heading:'ESTAR',body:'Para describir estados y ubicacion.'}]}
const table={title:'Tabla',columns:[{key:'a',label:'SER'},{key:'b',label:'ESTAR'}],rows:[[{text:'Identidad',tone:'ok'},{text:'Estado',tone:'info'}],[{text:'Es medico'},{text:'Esta cansado'}]]}
export async function GET(req:NextRequest){
  const key=req.nextUrl.searchParams.get('key')??''
  if(!process.env.AE_PROBE_KEY||key!==process.env.AE_PROBE_KEY)return NextResponse.json({error:'unauthorized'},{status:403,headers:{'cache-control':'no-store'}})
  const kind=req.nextUrl.searchParams.get('p')??'table',t=Date.now()
  try{
    if(kind==='pdf'){
      const turns=[
        {sender:'Student',text:'Dame SER/ESTAR y un grafico'},
        {sender:'SARAH',text:'## SER y ESTAR\n**SER** identifica; **ESTAR** describe estados.\n\n| Tema | SER | ESTAR |\n|---|---|---|\n|Ejemplo|es|está|',
         artifacts:[{type:'chart',content:chart},{type:'flowchart',content:flow},{type:'infographic',content:info},{type:'table_matrix',content:table}]}]
      const html=renderConversationExportHtml('QA LINGORA 7.4.5 — Documento',turns)
      const {generatePDF}=await import('../../../server/tools/pdf-generator')
      const x=await generatePDF({title:'QA LINGORA 7.4.5 — Documento',content:'',conversationTurns:turns,filename:'probe-745-'+Date.now()})
      let pages:null|number=null,bytes=0
      if(x.url?.startsWith('data:application/pdf;base64,')){
        const buf=Buffer.from(x.url.split(',')[1], 'base64')
        bytes=buf.length
        const {PDFDocument}=await import('pdf-lib')
        const document=await PDFDocument.load(buf)
        pages=document.getPageCount()
      }
      return NextResponse.json({kind,success:x.success,bytes:bytes||x.pdfByteLength||0,pages,visualSvgCount:(html.match(/<svg /g)||[]).length,
      hasRawMd:html.includes('**SER**'),hasRenderedBold:html.includes('<strong>SER</strong>'),
      ms:Date.now()-t,method:x.method,error:x.error??null},{headers:{'cache-control':'no-store'}})
    }
    const message=samples[kind];if(!message)return NextResponse.json({error:'invalid case'},{status:400})
    const state={...DEFAULT_SESSION_STATE,mentorProfile:'Sarah',interfaceLanguage:'es',activeMode:'interact',tokens:2}
    const q=new NextRequest('http://localhost/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,state,stream:false})})
    const result=await POST(q),data=await result.json() as Record<string,unknown>
    const reply=String(data.message??data.reply??'')
    const artifacts=(Array.isArray(data.artifacts)?data.artifacts:(data.artifact?[data.artifact]:[])) as Array<Record<string,unknown>>
    return NextResponse.json({kind,status:result.status,ms:Date.now()-t,replyChars:reply.length,
      replyHead:reply.slice(0,200),artifactTypes:artifacts.map(a=>a.type),artifacts:artifacts.map(a=>{
        const c=(a.content??{}) as Record<string,unknown>
        return {type:a.type,columns:Array.isArray(c.columns)?c.columns.length:null,
        rows:Array.isArray(c.rows)?c.rows.length:null,
        questions:Array.isArray(c.questions)?c.questions.length:null,
        gradingMode:c.gradingMode??null}
      }),failures:data.artifactFailures??[]},{headers:{'cache-control':'no-store'}})
  }catch(e){return NextResponse.json({kind,error:e instanceof Error?e.name:'failure',ms:Date.now()-t},{status:502,headers:{'cache-control':'no-store'}})}
}
