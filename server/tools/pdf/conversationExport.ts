// LINGORA 7.4.5 — fidelity-first conversation export.
// The learner's real messages plus validated real-time artifacts are the single
// source of truth. No second tutor, no markdown shown as literal code, no
// invented data and no silently clipped turns.
import { renderChartSvg, validateChartContent } from '../../../lib/chart-contract'
import { renderFlowchartSvg, validateFlowchartContent } from '../../../lib/flowchart-contract'
import { fidelityTokens } from './documentFidelity'
import { renderInfographicSvg, validateInfographicContent } from '../../../lib/infographic-contract'

export interface ExportArtifact {
  type: string
  content?: Record<string, unknown>
}
export interface ExportTurn {
  sender: string
  text: string
  complete?: boolean
  artifacts?: ExportArtifact[]
}
const escapeHtml=(v:string):string=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
const SAFE_URL=/^(?:https?:\/\/|mailto:)[^\s<>"']+$/i
const emphasis=(escaped:string):string=>escaped
  .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
  .replace(/(^|[^_\w])__([^_]+)__(?![_\w])/g,'$1<strong>$2</strong>')
  .replace(/~~([^~]+)~~/g,'<del>$1</del>')
  .replace(/(^|[^*])\*([^*]+)\*/g,'$1<em>$2</em>')
const inline=(s:string):string=>{
  // Parse code before everything else; no formatting or markup interpretation inside backticks.
  return s.split(/(\x60[^\x60\n]+\x60)/g).map(part=>{
    if(/^\x60[^\x60\n]+\x60$/.test(part))return '<code>'+escapeHtml(part.slice(1,-1))+'</code>'
    // 7.4.6: [text](url) is a link, never literal syntax. The address is also PRINTED, because a PDF has no hover.
    return part.split(/(\[[^\]\n]+\]\([^)\s]+\))/g).map(seg=>{
      const m=/^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(seg)
      if(m&&SAFE_URL.test(m[2]))return '<a href="'+escapeHtml(m[2])+'">'+emphasis(escapeHtml(m[1]))+'</a> <span class="ln-url">('+escapeHtml(m[2])+')</span>'
      return emphasis(escapeHtml(seg))
    }).join('')
  }).join('')
}
const ROW=/^\|(.+)\|$/
function mdSafe(source:string):string {
  const lines=source.replace(/\r\n/g,'\n').split('\n'),out:string[]=[]
  let fence:{ch:string;len:number}|null=null,codeLines:string[]=[]
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim()
    // CommonMark fence: opens with >=3 backticks or tildes; closes only with the same character, at least as long, alone on the line.
    const open=/^(\x60{3,}|~{3,})/.exec(line)
    if(fence){
      const close=new RegExp('^'+(fence.ch==='~'?'~':'\\x60')+'{'+fence.len+',}$').test(line)
      if(close){out.push('<pre><code>'+escapeHtml(codeLines.join('\n'))+'</code></pre>');codeLines=[];fence=null;continue}
      codeLines.push(lines[i]);continue
    }
    if(open){fence={ch:open[1][0],len:open[1].length};continue}
    const cells=(x:string)=>x.slice(1,-1).split('|').map(y=>y.trim())
    if(ROW.test(line) && i+1<lines.length &&
       /^\|[\s:|\-]+\|$/.test(lines[i+1].trim())){
      const hdr=cells(line);const rows:string[][]=[];i+=2
      while(i<lines.length && ROW.test(lines[i].trim())){rows.push(cells(lines[i].trim()));i++}
      i--
      out.push('<table class="ln-md-table"><thead><tr>'+hdr.map(v=>'<th>'+inline(v)+'</th>').join('')+'</tr></thead><tbody>'+
        rows.map(r=>'<tr>'+hdr.map((_,j)=>'<td>'+inline(r[j]??'')+'</td>').join('')+'</tr>').join('')+'</tbody></table>')
      continue
    }
    if(!line){out.push('<div class="ln-gap"></div>');continue}
    if(/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)){out.push('<hr>');continue}
    const head=/^(#{1,6})\s+(.+)$/.exec(line)
    if(head){const level=Math.min(6,head[1].length+1);out.push('<h'+level+'>'+inline(head[2])+'</h'+level+'>');continue}
    // Nesting depth comes from the leading indentation (2 spaces or one tab per level, capped for layout only).
    const depth=Math.min(4,Math.floor(lines[i].replace(/\t/g,'  ').search(/\S/)/2))
    const pad=depth>0?' style="margin-left:'+(12+depth*14)+'px"':''
    const bullet=/^[-*]\s+(.+)$/.exec(line)
    if(bullet){out.push('<p class="ln-bullet"'+pad+'>• '+inline(bullet[1])+'</p>');continue}
    const numbered=/^(\d{1,3})[.)]\s+(.+)$/.exec(line)
    if(numbered){out.push('<p class="ln-bullet"'+pad+'>'+escapeHtml(numbered[1])+'. '+inline(numbered[2])+'</p>');continue}
    const quote=/^>\s*(.*)$/.exec(line)
    if(quote){out.push('<blockquote>'+inline(quote[1])+'</blockquote>');continue}
    out.push('<p>'+inline(line)+'</p>')
  }
  if(fence)out.push('<pre><code>'+escapeHtml(codeLines.join('\n'))+'</code></pre>')
  return out.join('\n')
}
function visual(a:ExportArtifact):string {
  if(!a || !a.content || typeof a.content!=='object')
    throw new Error('export_missing_artifact_content:'+String(a?.type??'unknown'))
  const type=a.type, c=a.content
  let svg=''
  if(type==='chart'){
    const v=validateChartContent(c)
    if(!v.ok)throw new Error('export_invalid_chart:'+v.reason)
    svg=renderChartSvg(v.chart,{fixed:true})
  }else if(type==='flowchart'){
    const v=validateFlowchartContent(c)
    if(!v.ok)throw new Error('export_invalid_flowchart:'+v.reason)
    svg=renderFlowchartSvg(v.flow,{fixed:true})
  }else if(type==='infographic'){
    const v=validateInfographicContent(c)
    if(!v.ok)throw new Error('export_invalid_infographic:'+v.reason)
    svg=renderInfographicSvg(v.info,{fixed:true})
  }
  if(svg){
    if(!svg.includes('<svg'))throw new Error('export_missing_svg:'+type)
    return '<figure class="ln-visual" data-type="'+escapeHtml(type)+'">'+svg+'</figure>'
  }
  if(type==='table_matrix'){
    if(!Array.isArray(c.columns)||!Array.isArray(c.rows))
      throw new Error('export_invalid_table_structure')
    const heads=(c.columns as unknown[]).map((x,i)=>{
      if(!x||typeof x!=='object'||typeof (x as {label?:unknown}).label!=='string')
        throw new Error('export_invalid_column:'+i)
      return (x as {label:string}).label
    })
    if(!heads.length)throw new Error('export_empty_table')
    const fallback=['#d5f5ee','#e0f2fe','#eee5ff','#fff1d5','#ffe4e6','#e8edf4']
    const palette:Record<string,{bg:string;fg:string}>={
      ok:{bg:'#c5f4e6',fg:'#065f46'},
      warn:{bg:'#fff0b3',fg:'#754a00'},
      danger:{bg:'#ffe1e4',fg:'#991b1b'},
      info:{bg:'#d5efff',fg:'#075985'},
      highlight:{bg:'#e8dcff',fg:'#5b21b6'},
      neutral:{bg:'#e7edf3',fg:'#22374b'},
    }
    const th=heads.map((h,i)=>'<th style="background:'+fallback[i%fallback.length]+'">'+escapeHtml(h)+'</th>').join('')
    const rows=(c.rows as unknown[]).map((row,ri)=>{
      if(!Array.isArray(row)||row.length!==heads.length)
        throw new Error('export_invalid_table_row:'+ri)
      return '<tr>'+heads.map((_,i)=>{
        const raw=row[i]
        const cell=typeof raw==='string'?{text:raw}:raw
        if(!cell||typeof cell!=='object'||typeof (cell as {text?:unknown}).text!=='string')
          throw new Error('export_invalid_table_cell:'+ri+':'+i)
        const item=cell as {text:string;tone?:unknown;icon?:unknown}
        if(item.tone!==undefined && (typeof item.tone!=='string'||!(item.tone in palette)))
          throw new Error('export_invalid_table_tone:'+ri+':'+i)
        const style=typeof item.tone==='string'?palette[item.tone]:null
        const bg=style?.bg??fallback[i%fallback.length]
        const fg=style?.fg??'#1f2937'
        const prefix=typeof item.icon==='string'?escapeHtml(item.icon)+' ':''
        return '<td data-tone="'+escapeHtml(typeof item.tone==='string'?item.tone:'column-default')+
          '" style="background:'+bg+';color:'+fg+'">'+prefix+escapeHtml(item.text)+'</td>'
      }).join('')+'</tr>'
    }).join('')
    return '<section class="ln-native-table"><h3>'+escapeHtml(String(c.title??'Tabla'))+
      '</h3><table><thead><tr>'+th+'</tr></thead><tbody>'+rows+'</tbody></table></section>'
  }
  if(type==='quiz'){
    if(!Array.isArray(c.questions)||!c.questions.length)throw new Error('export_invalid_quiz')
    return '<section class="ln-quiz"><h3>'+escapeHtml(String(c.title??'Cuestionario'))+'</h3>'+
      c.questions.map((question,i)=>{
        if(!question||typeof question!=='object')throw new Error('export_invalid_quiz_question:'+i)
        const q=question as Record<string,unknown>
        if(typeof q.question!=='string'||!Array.isArray(q.options)||!q.options.length)
          throw new Error('export_invalid_quiz_question:'+i)
        return '<p><strong>'+String(i+1)+'. '+escapeHtml(q.question)+'</strong></p>'+
          q.options.map((op,j)=>{
            if(typeof op!=='string')throw new Error('export_invalid_quiz_option:'+i+':'+j)
            return '<p>'+String.fromCharCode(65+j)+') '+escapeHtml(op)+'</p>'
          }).join('')
      }).join('')+'</section>'
  }
  // Non-printable native artifacts must not disappear silently.
  throw new Error('export_unsupported_artifact_type:'+type)
}
export function validateExportTurns(raw:unknown):ExportTurn[] | null {
  if(!Array.isArray(raw)||raw.length<1||raw.length>120)return null
  const result:ExportTurn[]=[]
  for(const t of raw){
    if(!t || typeof t!=='object'||Array.isArray(t))return null
    const v=t as Record<string,unknown>
    if(typeof v.sender!=='string'||v.sender.length>30||typeof v.text!=='string'||v.text.length>150000)return null
    if(v.complete===false)return null
    if(v.artifacts!==undefined && (!Array.isArray(v.artifacts)||v.artifacts.length>20))return null
    const artifacts=(v.artifacts??[]) as unknown[]
    if(artifacts.some(a=>!a||typeof a!=='object'||typeof (a as Record<string,unknown>).type!=='string'))return null
    result.push({sender:v.sender,text:v.text,complete:true,artifacts:artifacts as ExportArtifact[]})
  }
  return result
}
// 7.4.6 — loss gate: every word of the source turn must be present in what is printed. A Markdown construct the
// converter does not understand may print literally, but it can never make content vanish (nested fences, odd lists...).
function assertNoLoss(sender:string,source:string,html:string):void{
  // Inline tags join (so "2*3*4" -> "234" stays one token); block tags separate. Entities never carry words.
  const text=html.replace(/<\/?(?:em|strong|code)>/g,'').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|#39);/g,' ')
  const printed=new Set(fidelityTokens(text))
  // A fence line (the ``` or ~~~ marker and its language tag) is syntax, not content.
  const body=source.split(/\r?\n/).filter(l=>!/^\s*(?:\x60{3,}|~{3,})\s*[\w+#.-]*\s*$/.test(l)).join('\n')
  const missing=fidelityTokens(body).filter(t=>!printed.has(t))
  if(missing.length)throw new Error('export_content_loss:'+sender+':'+missing.slice(0,3).join(','))
}
const EXPLAIN:Record<string,string>={
  export_unsupported_artifact_type:'contiene un tipo de artifact que aún no se puede imprimir',
  export_missing_artifact_content:'un artifact llegó sin contenido',
  export_content_loss:'el documento habría perdido texto de la conversación',
}
/** Turns a refusal code into the sentence the student sees. Returns null for non-export errors. */
export function explainExportRefusal(message?:string):string|null{
  const m=/^(export_[a-z_]+)(?::(.*))?$/.exec((message??'').trim())
  if(!m)return null
  const why=EXPLAIN[m[1]]??(m[1].startsWith('export_invalid_')?'contiene un artifact inválido que no se puede imprimir sin perder información':'no se pudo imprimir de forma íntegra')
  return 'No se generó el PDF: '+why+(m[2]?' ('+m[2]+')':'')+'. No se exporta un documento incompleto.'
}
export function renderConversationExportHtml(title:string,turns:ExportTurn[]):string {
  const turnsHtml=turns.map(turn=>{
    const artifactHtml=(turn.artifacts??[]).map(visual).join('')
    const body=mdSafe(turn.text)
    assertNoLoss(turn.sender,turn.text,body)
    return '<article class="ln-turn"><h2>'+escapeHtml(turn.sender)+'</h2><div class="ln-text" dir="auto">'+body+'</div>'+artifactHtml+'</article>'
  }).join('\n')
  return '<!doctype html><html lang="und"><head><meta charset="utf-8"><title>'+escapeHtml(title)+'</title>'+
    '<style>@page{size:A4;margin:15mm 14mm}body{background:white;color:#152c42;line-height:1.5;font-family:sans-serif}'+
    '.ln-heading{background:#102a40;color:white;padding:16px;margin-bottom:12px}.ln-heading h1{font-size:16pt;margin:0}.ln-turn{padding:10px 3px;border-bottom:1px solid #dae1e9}.ln-turn h2{font-size:11pt;color:#08777d;margin:0 0 7px;break-after:avoid}'+
    '.ln-text p{margin:5px 0;overflow-wrap:anywhere}.ln-text h2,.ln-text h3,.ln-text h4,.ln-text h5,.ln-text h6{break-after:avoid-page;margin:14px 0 5px}.ln-text{display:flow-root}.ln-url{font-size:.85em;color:#52667a;overflow-wrap:anywhere}hr{border:0;border-top:1px solid #bdc9d3;margin:10px 0}.ln-gap{height:6px}.ln-text p.ln-bullet{margin-left:12px}'+
    'table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:8.5pt;margin:8px 0;break-inside:auto}th,td{border:1px solid #bdc9d3;padding:5px;overflow-wrap:anywhere}th{background:#d5f5ee}tr{break-inside:avoid-page}'+
    'pre{background:#f0f4f8;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere}blockquote{border-left:3px solid #08777d;padding-left:10px}'+
    '.ln-visual{margin:12px 0;page-break-inside:auto;break-inside:avoid-page;max-width:100%}.ln-visual svg{max-width:100%;width:100%!important;min-width:0!important;height:auto!important}'+
    '.ln-quiz{background:#eef4fb;padding:8px}.ln-native-table{break-before:auto}strong{font-weight:700}'+
    '</style></head><body><header class="ln-heading"><h1>'+escapeHtml(title)+'</h1></header>'+turnsHtml+'</body></html>'
}
