// LINGORA 7.4.5 — fidelity-first conversation export.
// The learner's real messages plus validated real-time artifacts are the single
// source of truth. No second tutor, no markdown shown as literal code, no
// invented data and no silently clipped turns.
import { renderChartSvg, validateChartContent } from '../../../lib/chart-contract'
import { renderFlowchartSvg, validateFlowchartContent } from '../../../lib/flowchart-contract'
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
const inline=(s:string):string=>{
  let x=escapeHtml(s)
  x=x.replace(/\\x60([^\\x60]+)\\x60/g,'<code>$1</code>')
  x=x.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
  x=x.replace(/(^|[^*])\*([^*]+)\*/g,'$1<em>$2</em>')
  return x
}
const ROW=/^\|(.+)\|$/
function mdSafe(source:string):string {
  const lines=source.replace(/\r\n/g,'\n').split('\n'),out:string[]=[]
  let code=false,codeLines:string[]=[]
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim()
    if(/^\\x60\\x60\\x60/.test(line)) {
      if(code){out.push('<pre><code>'+escapeHtml(codeLines.join('\n'))+'</code></pre>');codeLines=[]}
      code=!code;continue
    }
    if(code){codeLines.push(lines[i]);continue}
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
    const head=/^(#{1,5})\s+(.+)$/.exec(line)
    if(head){const level=Math.min(5,head[1].length+1);out.push('<h'+level+'>'+inline(head[2])+'</h'+level+'>');continue}
    const bullet=/^[-*]\s+(.+)$/.exec(line)
    if(bullet){out.push('<p class="ln-bullet">• '+inline(bullet[1])+'</p>');continue}
    const numbered=/^(\d{1,3})[.)]\s+(.+)$/.exec(line)
    if(numbered){out.push('<p class="ln-bullet">'+escapeHtml(numbered[1])+'. '+inline(numbered[2])+'</p>');continue}
    const quote=/^>\s*(.*)$/.exec(line)
    if(quote){out.push('<blockquote>'+inline(quote[1])+'</blockquote>');continue}
    out.push('<p>'+inline(line)+'</p>')
  }
  if(code)out.push('<pre><code>'+escapeHtml(codeLines.join('\n'))+'</code></pre>')
  return out.join('\n')
}
function visual(a:ExportArtifact):string {
  if(!a || !a.content || typeof a.content!=='object')return ''
  try {
    let svg=''
    if(a.type==='chart'){const v=validateChartContent(a.content);if(!v.ok)return '';svg=renderChartSvg(v.chart,{fixed:true})}
    if(a.type==='flowchart'){const v=validateFlowchartContent(a.content);if(!v.ok)return '';svg=renderFlowchartSvg(v.flow,{fixed:true})}
    if(a.type==='infographic'){const v=validateInfographicContent(a.content);if(!v.ok)return '';svg=renderInfographicSvg(v.info,{fixed:true})}
    if(svg)return '<figure class="ln-visual" data-type="'+escapeHtml(a.type)+'">'+svg+'</figure>'
    if(a.type==='table_matrix'){
      const c=a.content
      if(!Array.isArray(c.columns)||!Array.isArray(c.rows))return ''
      const cols=c.columns as Array<{label?:unknown}>
      const heads=cols.map(x=>typeof x?.label==='string'?x.label:'')
      if(!heads.length)return ''
      const colors=['#d5f5ee','#e0f2fe','#eee5ff','#fff1d5','#ffe4e6','#e8edf4']
      const th=heads.map((h,i)=>'<th style="background:'+colors[i%colors.length]+'">'+escapeHtml(h)+'</th>').join('')
      const rows=(c.rows as unknown[]).map(row=>Array.isArray(row)?
        '<tr>'+heads.map((_,i)=>{
          const obj=row[i] as unknown
          const cell=typeof obj==='string'?obj:obj&&typeof obj==='object'&&'text' in obj?String((obj as {text:unknown}).text):''
          return '<td style="background:'+colors[i%colors.length]+'">'+escapeHtml(cell)+'</td>'
        }).join('')+'</tr>':'').join('')
      return '<section class="ln-native-table"><h3>'+escapeHtml(String(c.title??'Tabla'))+'</h3><table><thead><tr>'+th+'</tr></thead><tbody>'+rows+'</tbody></table></section>'
    }
    if(a.type==='quiz'){
      const qs=a.content.questions
      if(!Array.isArray(qs))return ''
      return '<section class="ln-quiz"><h3>'+escapeHtml(String(a.content.title??'Cuestionario'))+'</h3>'+
        qs.map((q,i)=>{
          if(!q||typeof q!=='object')return ''
          const o=q as Record<string,unknown>
          const options=Array.isArray(o.options)?o.options:[]
          return '<p><strong>'+String(i+1)+'. '+escapeHtml(String(o.question??''))+'</strong></p>'+
            options.map((op,j)=>'<p>'+String.fromCharCode(65+j)+') '+escapeHtml(String(op))+'</p>').join('')
        }).join('')+'</section>'
    }
  }catch{return ''}
  return ''
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
export function renderConversationExportHtml(title:string,turns:ExportTurn[]):string {
  const turnsHtml=turns.map(turn=>{
    const artifactHtml=(turn.artifacts??[]).map(visual).join('')
    return '<article class="ln-turn"><h2>'+escapeHtml(turn.sender)+'</h2><div class="ln-text" dir="auto">'+mdSafe(turn.text)+'</div>'+artifactHtml+'</article>'
  }).join('\n')
  return '<!doctype html><html lang="und"><head><meta charset="utf-8"><title>'+escapeHtml(title)+'</title>'+
    '<style>@page{size:A4;margin:15mm 14mm}body{background:white;color:#152c42;line-height:1.5;font-family:sans-serif}'+
    '.ln-heading{background:#102a40;color:white;padding:16px;margin-bottom:12px}.ln-heading h1{font-size:16pt;margin:0}.ln-turn{padding:10px 3px;border-bottom:1px solid #dae1e9}.ln-turn h2{font-size:11pt;color:#08777d;margin:0 0 7px}'+
    '.ln-text p{margin:5px 0;overflow-wrap:anywhere}.ln-text h2,.ln-text h3,.ln-text h4,.ln-text h5{break-after:avoid-page;margin:14px 0 5px}.ln-gap{height:6px}.ln-bullet{margin-left:12px!important}'+
    'table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:8.5pt;margin:8px 0;break-inside:auto}th,td{border:1px solid #bdc9d3;padding:5px;overflow-wrap:anywhere}th{background:#d5f5ee}tr{break-inside:avoid-page}'+
    'pre{background:#f0f4f8;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere}blockquote{border-left:3px solid #08777d;padding-left:10px}'+
    '.ln-visual{margin:12px 0;page-break-inside:auto;break-inside:avoid-page;max-width:100%}.ln-visual svg{max-width:100%;width:100%!important;min-width:0!important;height:auto!important}'+
    '.ln-quiz{background:#eef4fb;padding:8px}.ln-native-table{break-before:auto}strong{font-weight:700}'+
    '</style></head><body><header class="ln-heading"><h1>'+escapeHtml(title)+'</h1></header>'+turnsHtml+'</body></html>'
}
