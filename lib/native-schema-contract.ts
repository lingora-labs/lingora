// LINGORA native schema contract adapter. This is NOT a second content
// generator: it only accepts semantically equivalent fields already written
// by the tutor and refuses missing content. There is one canonical renderer
// shape, independent of the model's optional labels.
type Obj=Record<string,unknown>
const obj=(x:unknown):x is Obj=>Boolean(x&&typeof x==='object'&&!Array.isArray(x))
// 7.5: no count caps (blocks, items, rows, columns, steps); validity and resource limits only.
import { displayText as text } from './native-visual-schema'
const arr=(x:unknown,min:number,_max=Infinity):x is string[]=>Array.isArray(x)&&x.length>=min&&x.every(text)
const tone=(v:unknown):boolean=>v===undefined||(typeof v==='string'&&['ok','warn','danger','info','neutral','highlight'].includes(v))
const find=(o:Obj,names:string[]):string|undefined=>{
 for(const key of names)if(text(o[key]))return(o[key] as string).trim()
 return undefined
}
const normSteps=(raw:unknown):string[]|null=>{
 if(arr(raw,1))return raw
 if(!Array.isArray(raw)||raw.length<1)return null
 const out=raw.map(e=>{
  if(text(e))return e.trim()
  if(!obj(e))return null
  const desc=find(e,['text','description','body','content'])
  const title=find(e,['title','label','step'])
  if(!desc&&!title)return null
  return desc&&title&&!desc.startsWith(title)?title+': '+desc:desc??title!
 })
 return out.every(text)?out as string[]:null
}
function block(raw:unknown):Obj|null {
 if(!obj(raw))return null
 const type=text(raw.type)?raw.type.toLowerCase():undefined
 const heading=find(raw,['title','heading','label','name'])
 const body=find(raw,['body','text','description','content'])
 const kind=type??(heading&&body?'concept':null)
 switch(kind){
  case 'concept':case 'section':case 'definition':
   return heading&&body?{type:'concept',title:heading,body}:null
  case 'bullets':case 'list':{
   const items=arr(raw.items,1)?raw.items:arr(raw.points,1)?raw.points:null
   return heading&&items?{type:'bullets',title:heading,items}:null
  }
  case 'highlight':case 'callout':
   return body&&tone(raw.tone)?{type:'highlight',text:body,...(raw.tone?{tone:raw.tone}:{})}:null
  case 'flow':case 'steps':{
   const steps=normSteps(raw.steps??raw.nodes)
   return steps?{type:'flow',steps}:null
  }
  case 'comparison':
   return text(raw.left)&&text(raw.right)?{type:'comparison',left:raw.left,right:raw.right,...(heading?{label:heading}:{})}:null
  case 'table':{
   const cols:unknown=raw.columns
   const columns=arr(cols,1)?cols:Array.isArray(cols)&&cols.length>=1
     ?cols.map(c=>obj(c)?find(c,['label','title','key']):null):null
   if(!arr(columns,1)||!Array.isArray(raw.rows)||raw.rows.length<1)return null
   const rows=(raw.rows as unknown[]).map(r=>{
    if(!Array.isArray(r)||r.length!==columns.length)return null
    const cells=r.map(cell=>text(cell)?cell:obj(cell)?find(cell,['text','label','value']):null)
    return arr(cells,columns.length,columns.length)?cells:null
   })
   return rows.every(x=>x!==null)?{type:'table',columns,rows}:null
  }
  default:return null
 }
}
export function normalizeSchemaPro(content:unknown):Obj|null {
 if(!obj(content)||!text(content.title)||!Array.isArray(content.blocks)||
    content.blocks.length<1)return null
 const normalized=content.blocks.map(block)
 if(normalized.some(x=>x===null))return null
 return {...content,blocks:normalized}
}
