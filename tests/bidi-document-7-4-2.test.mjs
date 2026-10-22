// ORDEN AE 7.4.2 / P2 — bilingual RTL/LTR composition of the shared PDF+HTML source. No model, no network.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file)
const {composeDocumentFromTaught}=require('../server/tools/pdf/composeArtifactDocument.ts')
const {renderArtifactHtml}=require('../server/tools/web/renderArtifactHtml.ts')
const {sourceToDocumentBlocks,auditRecoveredSource}=require('../server/tools/pdf/documentFidelity.ts')
const source=fs.readFileSync(new URL('./fixtures/ser-estar-ar-es.md',import.meta.url),'utf8')

// Converter: list items stay list items; "N." + indented options is ONE numbered item.
const blocks=sourceToDocumentBlocks(source)
assert.ok(!blocks.some(b=>b.type==='heading'&&/^10\.\s+Ellos/.test(b.content)),'item 10 must not become a heading')
const opts=blocks.find(b=>b.type==='numbered'&&b.items.some(i=>i.includes('Soy en el restaurante')))
assert.ok(opts,'options exercise converted to a numbered list')
assert.equal(opts.items.length,6)
assert.ok(opts.items.every(i=>i.split('\n').length===2),'each item keeps its two options as lines')
assert.ok(auditRecoveredSource(source,blocks).ok,'fidelity audit stays strict and passes')

const composed=await composeDocumentFromTaught({subject:'الفرق بين SER و ESTAR',fullContent:source,otherSubjects:[],mentorName:'Sarah',level:'A2',nativeLanguage:'ar',preferVerbatim:true})
const html=renderArtifactHtml(composed.content)

/** Deterministic bidi-integrity checker, also used below on a corrupted copy. */
function bidiIssues(h){
  const issues=[]
  const body=h.slice(h.indexOf('<body'))
  for(const m of body.matchAll(/<(p|li|h2|h3|h4|td|th|blockquote)(\s[^>]*)?>/g))
    if(!/\sdir="(?:rtl|ltr)"/.test(m[0])&&!/class="ln-sec/.test(m[0]))issues.push('no explicit dir: '+m[0].slice(0,60))
  // isolates must nest properly with emphasis
  for(const m of body.matchAll(/<strong>([\s\S]*?)<\/strong>/g)){const o=(m[1].match(/<bdi/g)||[]).length,c=(m[1].match(/<\/bdi>/g)||[]).length;if(o!==c)issues.push('bdi crosses strong')}
  if((body.match(/<bdi/g)||[]).length!==(body.match(/<\/bdi>/g)||[]).length)issues.push('unbalanced bdi')
  // Arabic sentence with an embedded Spanish sentence: the Spanish run is isolated LTR
  if(!/<bdi dir="ltr">La reunión es en el restaurante\.<\/bdi>/.test(body))issues.push('embedded LTR sentence not isolated')
  // Spanish option led by an Arabic label is an LTR line
  if(!/<li dir="ltr">[\s\S]{0,80}<span class="ln-line" dir="ltr">(?:<bdi dir="rtl">)?أ(?:<\/bdi>)?\) <strong>Soy en el restaurante\.<\/strong>/.test(body))issues.push('option line direction')
  // numeric label of an RTL heading is isolated so it reads "8. title"
  if(!/<bdi dir="ltr">8\.<\/bdi>/.test(body))issues.push('heading number not isolated')
  // multi-line paragraphs: each line owns its direction
  if(!/<span class="ln-line" dir="rtl">/.test(body)||!/<span class="ln-line" dir="ltr">/.test(body))issues.push('per-line direction')
  return issues
}
assert.deepEqual(bidiIssues(html),[],'real render is bidi-clean')

// NEGATIVE: the 7.4.1 render (no per-block direction, single global LTR flow) is detected.
const old=html.replace(/ dir="(?:rtl|ltr|auto)"/g,m=>/bdi/.test(m)?m:'')
assert.ok(bidiIssues(old).length>0,'corrupted direction is detected')
const crossed=html.replace('<strong>Soy en el restaurante.</strong>','<strong><bdi dir="rtl">Soy en el restaurante.</strong></bdi>')
assert.ok(bidiIssues(crossed).length>0,'mis-nested isolate is detected')
const flat=html.replace(/<span class="ln-line" dir="(?:rtl|ltr)">/g,'<span class="ln-line">')
assert.ok(bidiIssues(flat).length>0,'lost per-line direction is detected')

// Header: no duplicated kicker/badge, no repeated brand prefix in the title
assert.equal((html.match(/MATERIAL DE REFERENCIA/g)||[]).length,1,'kicker not repeated as badge')
assert.ok(!/class="ln-title"[^>]*>\s*LINGORA\s*[—–-]/.test(html),'brand prefix not repeated in the title')
// CSS uses logical properties (no physical left padding/border for lists or quotes)
assert.ok(/border-inline-start/.test(html)&&!/\.ln-quote \{ border-left/.test(html))
// Same source, same document: every original Arabic and Spanish token survives in the HTML (PDF is rendered from it)
const text=html.replace(/<[^>]+>/g,' ')
for(const t of ['الفرق','التمرين','Marruecos','إجابات','Ellos','preparando'])assert.ok(text.includes(t),'lost '+t)
console.log('PASS 7.4.2 — RTL/LTR composition: per-block/line direction, isolated runs, list integrity, negative detection')
