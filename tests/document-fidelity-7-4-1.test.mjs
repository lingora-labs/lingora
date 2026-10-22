// ORDEN AE 7.4.1 — paired PDF+HTML material must be delivered whole, and the fidelity verifier stays strict.
// Root cause (reproduced here, no model calls): the verifier tokenised the SOURCE with Markdown delimiters in
// place ("و**ESTAR**" -> «و», «estar») and the CONVERTED blocks without them ("وESTAR" -> one token), so a
// lossless conversion was rejected as `source_content_incomplete:loss_of_source`.
// Run: node tests/document-fidelity-7-4-1.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file)
const {auditRecoveredSource,auditDocumentFidelity,sourceToDocumentBlocks,fidelityTokens}=require('../server/tools/pdf/documentFidelity.ts')
const {composeDocumentFromTaught}=require('../server/tools/pdf/composeArtifactDocument.ts')
const {renderArtifactHtml}=require('../server/tools/web/renderArtifactHtml.ts')
const source=fs.readFileSync(new URL('./fixtures/ser-estar-ar-es.md',import.meta.url),'utf8')
const blockText=blocks=>blocks.map(b=>[b.content??'',...(b.items??[]),...(b.headers??[]),...(b.rows??[]).flat()].join(' ')).join(' ')
const multiset=list=>{const m=new Map();for(const w of list)m.set(w,(m.get(w)??0)+1);return m}
function missing(expected,actual){const rem=multiset(actual),lost=[];for(const w of expected){const c=rem.get(w)??0;if(c>0)rem.set(w,c-1);else lost.push(w)}return lost}

// ---- 1. Reproduction of the pre-7.4.1 verifier on a substantive Arabic/Spanish corpus ----
assert.ok(source.length>8000,'substantive corpus (headings, tables, exercises, answers, ❌/✅, blockquotes)')
for(const needle of ['| SER | ESTAR |','1. Yo ______','التمرين الثاني','إجابات التمرين','❌','> ملاحظة','---'])assert.ok(source.includes(needle),'corpus has '+needle)
const blocks=sourceToDocumentBlocks(source)
const legacyTokens=s=>s.toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)??[]
const legacyExpected=legacyTokens(source.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm,''))
// pre-7.4.1 converter output: emphasis delimiters stripped from the blocks, verifier tokenising the raw source
const legacyText=blockText(blocks).replace(/\*\*(.+?)\*\*/g,'$1').replace(/__(.+?)__/g,'$1')
const legacyLost=missing(legacyExpected,legacyTokens(legacyText))
assert.deepEqual(legacyLost.sort(),['estar','estar','و','و'],'old verifier: exactly the two «و**ESTAR**» occurrences were "lost"')
assert.ok(legacyLost.length/legacyExpected.length<0.005,'0.3% of tokens, all of them markup-boundary merges')
assert.ok(/وESTAR/.test(legacyText),'the text is PRESENT in the converted blocks; only the token boundary moved')
assert.ok(source.includes('و**ESTAR**'),'trigger: Arabic conjunction glued to a bold Latin word, as in the Sarah title')

// ---- 2. Corrected contract: same projection on both sides, nothing else relaxed ----
const audit=auditRecoveredSource(source,blocks)
assert.equal(audit.ok,true);assert.equal(audit.coverage,1,'every letter and digit of the source survives, repeats included')
assert.deepEqual(fidelityTokens('و**ESTAR**'),fidelityTokens('وESTAR'),'emphasis delimiters are not token boundaries')
assert.deepEqual(fidelityTokens('snake_case'),fidelityTokens('snakecase'))
assert.notDeepEqual(fidelityTokens('سر ريع'),fidelityTokens('سريع'),'real spaces still separate tokens')

// ---- 3. The verifier is still strict (negative controls) ----
let controls=0
for(let i=0;i<blocks.length;i++){
  if(!fidelityTokens(blockText([blocks[i]])).length)continue
  const without=blocks.filter((_,j)=>j!==i)
  assert.equal(auditRecoveredSource(source,without).ok,false,'dropping block '+i+' ('+blocks[i].type+') must be rejected');controls++
}
assert.ok(controls>90,'every substantive block was dropped in turn: '+controls)
let seed=7;const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/2**32
let single=0
for(let t=0;t<300;t++){
  const bi=Math.floor(rnd()*blocks.length),b=blocks[bi]
  const texts=[b.content,...(b.items??[])].filter(x=>typeof x==='string'&&fidelityTokens(x).length)
  if(!texts.length)continue
  const k=Math.floor(rnd()*texts.length),parts=texts[k].split(' '),w=Math.floor(rnd()*parts.length)
  if(!/\p{L}/u.test(parts[w]))continue // bare ordinals ("8.") are list markers, not content
  const copy=blocks.map(x=>({...x,items:x.items?[...x.items]:undefined}))
  const cut=parts.filter((_,i)=>i!==w).join(' ')
  if(copy[bi].content===texts[k])copy[bi].content=cut;else copy[bi].items=copy[bi].items.map(x=>x===texts[k]?cut:x)
  assert.equal(auditRecoveredSource(source,copy).ok,false,'losing the single word «'+parts[w]+'» must be rejected');single++
}
assert.ok(single>200,'single-word deletions rejected: '+single)
const answersOnly=blocks.filter(b=>!JSON.stringify(b).includes('Estoy estudiando español'))
assert.equal(auditRecoveredSource(source,answersOnly).ok,false)
const flat=[{type:'heading',level:1,content:'Resumen'},{type:'paragraph',content:'Texto breve.'}]
assert.equal(auditRecoveredSource(source,flat).ok,false,'a summary can never replace the source')
assert.equal(auditDocumentFidelity(source,flat).ok,false)
assert.equal(auditDocumentFidelity(source,blocks.filter(b=>b.type!=='heading'||b.level!==2)).ok,true,'LLM-outline audit still sees the words')

// ---- 4. Glue fuzz: the converter is lossless for any mix of markup and scripts ----
const words=['soy','estoy','Zakia','está','أنا','مكان','ñandú','الْفِعْلُ','ـ','١٢٣','15','ser','ESTAR','و','بـ','ل','cocinar']
const marks=['**','**','*','_','__','`','','']
const lead=['','- ','* ','1. ','2) ','# ','## ','> ','| ','1.','❌ ','✅ ','---','‏']
const rnd2=()=>(seed=(seed*1664525+1013904223)>>>0)/2**32,pick=a=>a[Math.floor(rnd2()*a.length)]
for(let t=0;t<4000;t++){
  const lines=[];for(let l=1+Math.floor(rnd2()*6);l>0;l--){let s=pick(lead);for(let k=1+Math.floor(rnd2()*5);k>0;k--){const m=pick(marks);s+=m+pick(words)+pick(marks==null?[]:marks)+(rnd2()<0.5?' ':'')}lines.push(s);if(rnd2()<0.3)lines.push('')}
  const text=lines.join('\n')
  const r=auditRecoveredSource(text,sourceToDocumentBlocks(text))
  assert.ok(r.ok,'lossless conversion must pass: '+JSON.stringify(text))
}

// ---- 5. The real path: one source -> composed document -> HTML, with no model call ----
const composed=await composeDocumentFromTaught({subject:'الفرق بين SER و ESTAR',fullContent:source,otherSubjects:[],mentorName:'Sarah',level:'A2',nativeLanguage:'ar',preferVerbatim:true})
assert.equal(composed.ok,true,'paired PDF+HTML source recovery: '+(composed.reason??''))
const docBlocks=composed.content.blocks
const contentOf=t=>fidelityTokens(t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm,'')) // list ordinals are markers, not content
assert.deepEqual(missing(contentOf(source),fidelityTokens(blockText(docBlocks))),[],'document text = Tutor text')
const html=renderArtifactHtml(composed.content)
const visible=html.replace(/<script[\s\S]*?<\/script>/g,' ').replace(/<style[\s\S]*?<\/style>/g,' ')
  .replace(/<\/?(?:bdi|strong|em|span|b|i)\b[^>]*>/g,'').replace(/<[^>]+>/g,' ')
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&')
assert.deepEqual(missing(contentOf(source),fidelityTokens(visible)),[],'HTML carries every token of the same source')
// no duplicated second half (the old appendix defect): each distinctive answer line appears once per source occurrence
const plainLine=l=>l.replace(/\*\*/g,'').replace(/^>\s?/,'').replace(/^\s*(?:[-*•]|\d+[.)])\s+/,'').trim()
let dup=0
for(const line of source.split('\n').map(plainLine).filter(l=>l.length>=28&&!l.startsWith('#')&&!l.startsWith('|'))){
  const inSource=source.replace(/\*\*/g,'').replace(/^>\s?/gm,'').split(line).length-1,inHtml=visible.split(line).length-1
  if(inHtml!==inSource){dup++;assert.fail('line count differs ('+inSource+' vs '+inHtml+'): '+line)}
}
assert.equal(dup,0)
assert.equal((html.match(/<script/gi)||[]).length,1,'HTML keeps its single pinned script')
// structure the Tutor wrote stays structure (no pipe-soup tables, no literal rules, emphasis and blanks intact)
assert.equal((html.match(/<table class="ln-table">/g)||[]).length,2,'both Markdown tables are real tables')
assert.ok(!visible.includes('|'),'no raw pipes in visible text'); assert.ok(!html.includes('|---'))
assert.match(html,/<th dir="ltr">SER<\/th>/);assert.match(html,/<td dir="ltr">soy<\/td>/)
assert.equal(docBlocks.filter(b=>b.type==='divider').length,(source.match(/^---$/gm)||[]).length,'rules become dividers')
assert.equal(docBlocks.filter(b=>b.type==='quote').length,2,'blockquotes become quotes')
assert.ok((html.match(/<strong>/g)||[]).length>150,'bold survives to the shared HTML')
assert.ok(html.includes('Yo ______ de Marruecos.'),'exercise blanks keep their length')
assert.ok(html.includes('أ) <strong>Soy en el restaurante.</strong>')||/أ\) <strong>Soy en el restaurante\.<\/strong>/.test(html.replace(/<\/?bdi[^>]*>/g,'')),'choices stay on their own lines')
assert.match(html,/white-space:\s*pre-line/,'line breaks inside a paragraph are honoured')
assert.equal(docBlocks.filter(b=>b.type==='heading'&&/[*]/.test(b.content)).length,0,'headings carry no literal asterisks')
assert.match(html,/id="ln-expand"/);assert.match(html,/class="ln-sec"/)
assert.ok(docBlocks.some(b=>b.type==='heading')&&docBlocks.some(b=>b.type==='numbered')&&docBlocks.some(b=>b.type==='bullets'))
console.log('PASS 7.4.1 — bilingual corpus: old verifier false-negative reproduced (4/1294 tokens, markup boundaries), corrected contract lossless, '+controls+' block and '+single+' word negative controls rejected, 4000 glue-fuzz cases, HTML token-complete')
