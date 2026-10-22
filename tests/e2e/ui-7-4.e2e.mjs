// 7.4 browser E2E — REAL Chromium driving the REAL beta UI (touch viewport).
// Server scope: /api/chat is a deterministic stub (SSE `done` frame carrying artifacts built by the
// REAL renderer/contracts), so this proves UI behaviour only. Live-model behaviour is proven by the
// gate runners on the preview. Run: NODE_PATH=/opt/npm-tools/node_modules node tests/e2e/ui-7-4.e2e.mjs <baseUrl>
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,file)
const {chromium}=require('playwright')
const {renderArtifactHtml}=require('../../server/tools/web/renderArtifactHtml.ts')
const {composeDocumentFromTaught}=require('../../server/tools/pdf/composeArtifactDocument.ts')
const {fidelityTokens}=require('../../server/tools/pdf/documentFidelity.ts')
const base=process.argv[2]||'http://localhost:3111'
const out=process.env.E2E_OUT||'/tmp/e2e-out'; fs.mkdirSync(out,{recursive:true})
const results=[]
const ok=(name,detail='')=>{results.push({name,pass:true,detail});console.log('PASS',name,detail)}
const fail=(name,e)=>{results.push({name,pass:false,detail:String(e&&e.message||e)});console.log('FAIL',name,String(e&&e.message||e))}
async function step(name,fn){try{const d=await fn();ok(name,d||'')}catch(e){fail(name,e);console.log('  console:',JSON.stringify(consoleLog.slice(-6)),'pageerrors:',JSON.stringify(errors.slice(-3)));console.log('  last requests:',JSON.stringify(apiBodies.slice(-3).map(b=>String(b.message).slice(0,80)+' | ui='+b.uiAction)));try{await page.screenshot({path:path.join(out,'fail-'+name.slice(0,3).trim()+'.png')});fs.writeFileSync(path.join(out,'fail-'+name.slice(0,3).trim()+'.txt'),(await page.locator('body').innerText()).slice(-3000))}catch{}}}

// ── fixtures ───────────────────────────────────────────────────────────────────────────────
const doc={title:'Ser y estar',documentType:'lesson',mentorName:'sarah',generatedAt:'2026-10-22',level:'A2',blocks:[
 {type:'heading',level:1,content:'Presente de ser'},
 {type:'paragraph',content:'Ser expresa identidad, origen y características.'},
 {type:'exercise',label:'Ejercicio 1',content:'Completa: Yo ___ médico.'},
 {type:'exercise',label:'Ejercicio 2',content:'Completa: Ella ___ de Madrid.'},
 {type:'heading',level:1,content:'Estar'},
 {type:'table',headers:['Verbo','Uso'],rows:[['ser','identidad'],['estar','estado']]},
 {type:'glossary',label:'Glosario',terms:[{term:'ser',definition:'to be (permanent)'}]},
 {type:'answer_key',label:'Clave',answers:['soy','es']},
]}
const html=renderArtifactHtml(doc)
const webUrl='data:text/html;charset=utf-8;base64,'+Buffer.from(html,'utf8').toString('base64')
const pdfBytes=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')
const pdfUrl='data:application/pdf;base64,'+pdfBytes.toString('base64')
const quizVerified={type:'quiz',title:'Ser y estar',questions:[
 {question:'María ___ cansada hoy.',options:['es','está','son','estoy'],correct:1,explanation:'Estado temporal.'},
 {question:'Nosotros ___ de Argentina.',options:['somos','estamos','es','están'],correct:0,explanation:'Origen.'}]}
const quizUnverified={type:'quiz',title:'Cultura',questions:[
 {question:'¿Cuál es la capital de España?',options:['Madrid','Lima','Roma','Bogotá'],correct:0},
 {question:'¿En qué continente está Colombia?',options:['Asia','América','Europa','África'],correct:1}]}

const sarahSource=fs.readFileSync(new URL('../fixtures/ser-estar-ar-es.md',import.meta.url),'utf8')
const composedBilingual=await composeDocumentFromTaught({subject:'الفرق بين SER و ESTAR',fullContent:sarahSource,otherSubjects:[],mentorName:'Sarah',preferVerbatim:true})
assert.equal(composedBilingual.ok,true)
const bilingualHtml=renderArtifactHtml(composedBilingual.content)
const bilingualWebUrl='data:text/html;charset=utf-8;base64,'+Buffer.from(bilingualHtml,'utf8').toString('base64')
const retrySignal={type:'emit_pdf',trigger:'explicit_user_request',subject:'الفرق بين SER و ESTAR',format:'pdf_html'}
let turn=0; const apiBodies=[]
function sse(text,artifacts){
  const frames=[`data: ${JSON.stringify({delta:text})}\n\n`,`data: ${JSON.stringify({done:true,state:{tutorMemory:[{id:'m1',kind:'goal',text:'DELE A2',learnedTurn:1,updatedTurn:1,at:'2026-10-22T00:00:00.000Z'}],tutorMemorySeq:1},artifacts,suggestedActions:[]})}\n\n`]
  return frames.join('')
}
async function wire(page){
  await page.route('**/api/chat',async route=>{
    const body=JSON.parse(route.request().postData()||'{}'); apiBodies.push(body); turn++
    const msg=String(body.message||'')
    if(body.uiAction==='retry_delivery'){
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({message:'Entrega completada.',retryOf:true,state:{},artifacts:[{type:'pdf',url:pdfUrl,title:'الفرق بين SER و ESTAR',webUrl:bilingualWebUrl}],suggestedActions:[]})})
    }
    if(/pdf y html bilingüe/i.test(msg)){
      const frames=[`data: ${JSON.stringify({delta:sarahSource})}\n\n`,`data: ${JSON.stringify({done:true,state:{},artifactFailures:[{subject:retrySignal.subject+' (PDF y HTML no disponibles)'}],artifactSignals:[retrySignal],suggestedActions:[{type:'retry_delivery',action:'retry_delivery',label:'Reintentar entrega',payload:{signals:[retrySignal]}}]})}\n\n`]
      return route.fulfill({status:200,headers:{'content-type':'text/event-stream'},body:frames.join('')})
    }
    if(/fallo total/i.test(msg)){
      const frames=[`data: ${JSON.stringify({delta:'\n\nNo se pudo completar la entrega solicitada. Puedes reintentar sin perder la conversación.'})}\n\n`,`data: ${JSON.stringify({done:true,state:{},artifactFailures:[{subject:'Entrega no completada en este turno'}],suggestedActions:[{type:'retry_delivery',action:'retry_delivery',label:'Reintentar entrega',payload:{message:msg}}]})}\n\n`]
      return route.fulfill({status:200,headers:{'content-type':'text/event-stream'},body:frames.join('')})
    }
    let text='Hola, soy Sarah.',arts
    if(/quiz verificado/i.test(msg)){text='Quiz listo.';arts=[quizVerified]}
    else if(/quiz abierto/i.test(msg)){text='Quiz listo.';arts=[quizUnverified]}
    else if(/sin calificación automática/i.test(msg)){text='Revisión del Tutor: bien hecho.'}
    else if(/seguir aprendiendo/i.test(msg)){text='Continuemos con el siguiente paso.'}
    else if(/^dame el material en pdf/i.test(msg)){text='Aquí tienes tu material.';arts=[{type:'pdf',url:pdfUrl,title:'Ser y estar',webUrl}]}
    await route.fulfill({status:200,headers:{'content-type':'text/event-stream'},body:sse(text,arts)})
  })
}
async function startChat(page){
  await page.goto(base+'/beta',{waitUntil:'domcontentloaded'})
  await page.getByText('Spanish',{exact:false}).first().waitFor({timeout:30000}).catch(()=>{})
  // English interface, first topic, first mentor are preselected defaults; press Start.
  await page.getByRole('button',{name:/^Start/}).click()
  await page.getByRole('button').filter({hasText:'🧠'}).first().waitFor({timeout:15000})
  await page.getByRole('button').filter({hasText:'🧠'}).first().click()
  await page.getByPlaceholder(/.+/).first().waitFor({timeout:15000})
}
async function send(page,text){
  const ta=page.locator('textarea').first(); await ta.fill(text)
  await page.locator('textarea').first().press('Control+Enter')
}

const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/opt/pw-browsers/chromium',args:['--no-sandbox']})
const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,acceptDownloads:true})
const page=await ctx.newPage(); const errors=[]
page.on('pageerror',e=>errors.push(String(e)))
const consoleLog=[]; page.on('console',m=>{if(['error','warning'].includes(m.type()))consoleLog.push(m.type()+': '+m.text().slice(0,300))})
await wire(page)

await step('E1 onboarding→mode→chat (touch viewport)',async()=>{await startChat(page);return 'reached chat'})
await step('E2 PDF+HTML artifact delivered after a Tutor turn',async()=>{
  await send(page,'dame el material en pdf')
  await page.getByTestId('html-open').waitFor({timeout:20000})
  await page.getByText('Descargar PDF').waitFor({timeout:5000})
})
await step('E3 PDF download is a real PDF',async()=>{
  const [dl]=await Promise.all([page.waitForEvent('download',{timeout:15000}),page.getByText('Descargar PDF').click()])
  const p=path.join(out,'dl.pdf'); await dl.saveAs(p)
  const b=fs.readFileSync(p); assert.equal(b.slice(0,5).toString(),'%PDF-'); return b.length+' bytes'
})
await step('E4 HTML download is self-contained & identical to the renderer output',async()=>{
  const [dl]=await Promise.all([page.waitForEvent('download',{timeout:15000}),page.getByTestId('html-download').click()])
  const p=path.join(out,'dl.html'); await dl.saveAs(p)
  const b=fs.readFileSync(p,'utf8'); assert.equal(b,html); assert.ok(!/src="http|href="http/.test(b)); return b.length+' bytes'
})
let popup
await step('E5 interactive HTML OPENS in Chromium (Blob URL)',async()=>{
  const [pp]=await Promise.all([ctx.waitForEvent('page',{timeout:15000}),page.getByTestId('html-open').click()])
  popup=pp; await popup.waitForLoadState('domcontentloaded')
  assert.match(popup.url(),/^blob:/); assert.equal(await popup.locator('details.ln-sec').count(),2)
  assert.ok(await popup.locator('html.js').count()===1,'the pinned script executed (CSP allowed it)')
  return popup.url().slice(0,30)
})
await step('E6 touch: mark exercises done → progress counter + bar',async()=>{
  const dones=popup.locator('.ln-ex-done'); assert.equal(await dones.count(),2)
  await dones.nth(0).tap(); assert.match(await popup.locator('#ln-count').innerText(),/1 \/ 2/)
  await dones.nth(1).tap(); assert.match(await popup.locator('#ln-count').innerText(),/2 \/ 2/)
  const w=await popup.locator('#ln-bar').evaluate(e=>e.style.width); assert.equal(w,'100%')
})
await step('E7 type an answer, collapse/expand sections, TOC opens a closed section',async()=>{
  await popup.locator('.ln-ex-ans').first().fill('soy')
  await popup.locator('#ln-collapse').tap()
  assert.equal(await popup.locator('details.ln-sec[open]').count(),0)
  await popup.locator('.ln-toc a').nth(1).tap()
  await popup.waitForFunction(()=>document.getElementById('s2').open===true)
  await popup.locator('#ln-expand').tap(); assert.equal(await popup.locator('details.ln-sec[open]').count(),2)
})
await step('E8 answer-key & glossary reveal on tap',async()=>{
  const key=popup.locator('details.ln-reveal'); assert.equal(await key.evaluate(e=>e.open),false)
  await key.locator('summary').tap(); assert.equal(await key.evaluate(e=>e.open),true)
  const term=popup.locator('details.ln-term').first(); await term.locator('summary').tap(); assert.equal(await term.evaluate(e=>e.open),true)
})
await step('E9 controls: bigger text, dark mode',async()=>{
  await popup.locator('#ln-bigger').tap()
  const z=await popup.locator('.ln-container').evaluate(e=>getComputedStyle(e).zoom); assert.ok(Number(z)>1,'zoom '+z)
  await popup.locator('#ln-theme').tap(); assert.equal(await popup.locator('html').getAttribute('data-theme'),'dark')
})
await step('E10 HTML progress persists across reload of the document',async()=>{
  await popup.reload({waitUntil:'domcontentloaded'}).catch(()=>{})
  // blob URL may be revoked on some engines after reload; if it still loads, state must persist
  const alive=await popup.locator('html.js').count()
  if(!alive) return 'blob not re-loadable after reload (expected for revoked URL); persistence covered by E11'
  assert.match(await popup.locator('#ln-count').innerText(),/2 \/ 2/); assert.equal(await popup.locator('.ln-ex-ans').first().inputValue(),'soy')
})
await step('E11 downloaded HTML file works standalone from disk (file://) with persistence',async()=>{
  const p2=await ctx.newPage(); await p2.goto('file://'+path.join(out,'dl.html'))
  assert.ok(await p2.locator('html.js').count()===1,'script runs from a saved file (CSP hash)')
  await p2.locator('.ln-ex-done').first().tap(); await p2.reload()
  assert.match(await p2.locator('#ln-count').innerText(),/1 \/ 2/,'progress persisted in localStorage')
  await p2.close()
})
await popup?.close().catch(()=>{})

await step('Q1 verified quiz: auto-correct only on proven key, tutor continue',async()=>{
  await page.bringToFront(); await send(page,'quiz verificado')
  await page.getByTestId('quiz-opt-0-1').last().waitFor({timeout:20000})
  const q=page.getByTestId('quiz-block').last()
  await q.getByTestId('quiz-opt-0-0').tap()           // wrong on purpose
  await q.getByTestId('quiz-verified-0').waitFor(); assert.match(await q.getByTestId('quiz-verified-0').innerText(),/Incorrecto.*está/s)
  await q.getByTestId('quiz-opt-1-0').tap()           // right
  assert.match(await q.getByTestId('quiz-verified-1').innerText(),/Correcto/)
  assert.match(await q.getByTestId('quiz-autoscore').innerText(),/1\/2/)
  await q.getByTestId('quiz-continue').waitFor()
})
await step('Q2 quiz progress persists across a full reload (IndexedDB)',async()=>{
  await page.waitForTimeout(1500)
  await page.reload({waitUntil:'domcontentloaded'})
  const q=page.getByTestId('quiz-block').last(); await q.waitFor({timeout:20000})
  assert.match(await q.getByTestId('quiz-autoscore').innerText(),/1\/2/)
  assert.equal(await q.getByTestId('quiz-opt-0-0').getAttribute('aria-pressed'),'true')
})
await step('Q3 "Seguir aprendiendo" sends a Tutor turn without requesting an artifact',async()=>{
  const before=apiBodies.length
  await page.getByTestId('quiz-continue').last().tap()
  await page.getByText('Continuemos con el siguiente paso.').waitFor({timeout:20000})
  const b=apiBodies[before]; assert.match(b.message,/seguir aprendiendo/i)
})
await step('Q4 unverifiable quiz: no automatic score; Tutor review required',async()=>{
  await send(page,'quiz abierto')
  await page.getByText('Cultura').last().waitFor({timeout:20000}); console.log('  Q4: quiz visible')
  const q=page.getByTestId('quiz-block').last()
  assert.equal(await q.getByTestId('quiz-autoscore').count(),0,'no auto score')
  await q.getByTestId('quiz-opt-0-0').tap(); await q.getByTestId('quiz-opt-1-1').tap()
  assert.equal(await q.getByTestId('quiz-pending-0').count(),1)
  // The review handler is gated by `loading`: for ~100 ms after a quiz appears the previous request is still
  // finishing and a review fired in that window is ignored by design. A person cannot answer two questions that fast.
  await page.waitForTimeout(1200)
  const before=apiBodies.length
  await q.getByTestId('quiz-review-send').tap()
  console.log('  Q4: review sent'); await page.getByText('Revisión del Tutor: bien hecho.').waitFor({timeout:20000})
  const b=apiBodies[before]; assert.match(b.message,/sin calificación automática/); assert.ok(!/acierto|✅/.test(b.message),'no invented score')
  await q.getByTestId('quiz-sent').waitFor()
})
await step('S1 state integrity: typed memory & seq round-trip through the client request',async()=>{
  const last=apiBodies[apiBodies.length-1]
  assert.ok(Array.isArray(last.state.tutorMemory)&&last.state.tutorMemory[0].id==='m1'); assert.equal(last.state.tutorMemorySeq,1)
})
await step('S2 long history: client sends the whole thread under budget (no 16-message cut)',async()=>{
  for(let i=0;i<14;i++){await send(page,'mensaje de práctica número '+i); await page.getByText('Hola, soy Sarah.').nth(i).waitFor({timeout:15000}).catch(()=>{})}
  await page.waitForTimeout(500)
  const n=apiBodies[apiBodies.length-1].conversationHistory.length
  assert.ok(n>16,'history length '+n+' (old cap was 16)')
  return 'history '+n
})
await step('S2b memory block survives into the request after reload (state persisted)',async()=>{
  await page.reload({waitUntil:'domcontentloaded'}); await page.locator('textarea').first().waitFor({timeout:20000})
  await send(page,'seguimos'); await page.waitForTimeout(1500)
  const last=apiBodies[apiBodies.length-1]; assert.equal(last.state.tutorMemory?.[0]?.id,'m1'); assert.equal(last.state.tutorMemorySeq,1)
})

// ── 7.4.1: delivery retry on the bilingual Arabic/Spanish material ─────────────────────────────
const count=async(id)=>page.getByTestId(id).count()
let before={}
await step('R1 failed paired delivery shows the Tutor text, the failure and ONE retry button',async()=>{
  await page.reload({waitUntil:'domcontentloaded'}).catch(()=>{})
  await send(page,'dame el pdf y html bilingüe de SER y ESTAR')
  await page.getByTestId('artifact-failure').last().waitFor({timeout:20000})
  await page.getByRole('button',{name:/Reintentar entrega/}).waitFor({timeout:5000})
  assert.equal(await page.getByRole('button',{name:/Reintentar entrega/}).count(),1)
  before={user:await count('bubble-user'),mentor:await count('bubble-mentor')}
  return JSON.stringify(before)
})
await step('R2 retry updates the SAME message: no new bubble, no new Tutor turn, signals not student text',async()=>{
  const n=apiBodies.length, opens=await count('html-open')
  await page.getByRole('button',{name:/Reintentar entrega/}).tap()
  await page.getByTestId('artifact-failure').waitFor({state:'detached',timeout:20000})
  await page.waitForFunction(k=>document.querySelectorAll('[data-testid="html-open"]').length===k,opens+1,{timeout:20000})
  const b=apiBodies[n]; assert.equal(apiBodies.length,n+1,'exactly one request')
  assert.equal(b.uiAction,'retry_delivery'); assert.equal(b.retrySignals[0].format,'pdf_html')
  assert.ok(b.materialText.includes('الفرق بين'),'the Tutor\'s own text is what gets materialised')
  assert.equal(await count('bubble-user'),before.user,'no duplicated student bubble')
  assert.equal(await count('bubble-mentor'),before.mentor,'no second Tutor answer')
  assert.equal(await page.getByTestId('artifact-failure').count(),0,'failure cleared')
  assert.equal(await page.getByRole('button',{name:/Reintentar entrega/}).count(),0,'retry action consumed')
})
await step('R3 a replayed/double retry event cannot duplicate anything',async()=>{
  const n=apiBodies.length, a=await count('html-open')
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('lingora-suggested-action',{detail:{action:'retry_delivery',type:'retry_delivery',label:'x',payload:{signals:[{type:'emit_pdf',trigger:'explicit_user_request',subject:'x y',format:'pdf_html'}]}}})))
  await page.waitForTimeout(600)
  assert.equal(apiBodies.length,n,'no request'); assert.equal(await count('html-open'),a); assert.equal(await count('bubble-user'),before.user)
})
let bilingualPopup
await step('R4 the delivered HTML opens and carries every word of the Tutor text; real tables; interactive',async()=>{
  const [pp]=await Promise.all([ctx.waitForEvent('page',{timeout:15000}),page.getByTestId('html-open').last().click()])
  bilingualPopup=pp; await pp.waitForLoadState('domcontentloaded')
  assert.match(pp.url(),/^blob:/); assert.ok(await pp.locator('html.js').count()===1)
  // text as the reader gets it: inline wrappers (bdi/strong/em) add no space, block elements do
  const text=(await pp.evaluate(()=>document.body.innerHTML)).replace(/<script[\s\S]*?<\/script>/g,' ').replace(/<style[\s\S]*?<\/style>/g,' ')
    .replace(/<\/?(?:bdi|strong|em|span|b|i)\b[^>]*>/g,'').replace(/<[^>]+>/g,' ')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&')
  const strip=t=>t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm,'')
  const rem=new Map(); for(const w of fidelityTokens(text)) rem.set(w,(rem.get(w)??0)+1)
  const lost=[]; for(const w of fidelityTokens(strip(sarahSource))){const c=rem.get(w)??0; if(c>0) rem.set(w,c-1); else lost.push(w)}
  assert.deepEqual(lost,[],'lost tokens in the opened document: '+lost.length+' of '+fidelityTokens(strip(sarahSource)).length+' (document text '+text.length+' chars, title '+await pp.title()+')')
  assert.equal(await pp.locator('table.ln-table').count(),2,'both comparison tables are tables'); assert.ok(!(text.includes('|---')))
  assert.ok(await pp.locator('blockquote.ln-quote').count()>=2)
  await pp.locator('#ln-collapse').tap(); assert.equal(await pp.locator('details.ln-sec[open]').count(),0)
  await pp.locator('#ln-expand').tap(); assert.ok(await pp.locator('details.ln-sec[open]').count()>=1)
  await pp.locator('#ln-theme').tap(); assert.equal(await pp.locator('html').getAttribute('data-theme'),'dark')
  await pp.screenshot({path:path.join(out,'bilingual-html.png'),fullPage:false})
  return fidelityTokens(sarahSource).length+' source tokens, 0 lost'
})
await bilingualPopup?.close().catch(()=>{})
await step('R5 the retried artifact is persisted in place (reload keeps it, no retry button)',async()=>{
  await page.bringToFront(); await page.waitForTimeout(1500); await page.reload({waitUntil:'domcontentloaded'})
  await page.getByTestId('html-open').last().waitFor({timeout:20000})
  assert.equal(await page.getByRole('button',{name:/Reintentar entrega/}).count(),0); assert.equal(await page.getByTestId('artifact-failure').count(),0)
})
await step('R6 turn that failed BEFORE any material existed: re-ask shows no second student bubble and no duplicated history',async()=>{
  await send(page,'dame esto con fallo total'); await page.getByRole('button',{name:/Reintentar entrega/}).waitFor({timeout:20000})
  const u=await count('bubble-user'), n=apiBodies.length
  await page.getByRole('button',{name:/Reintentar entrega/}).tap()
  await page.getByText('Hola, soy Sarah.').last().waitFor({timeout:20000})
  const b=apiBodies[n]; assert.equal(apiBodies.length,n+1); assert.match(b.message,/fallo total/)
  assert.equal(b.conversationHistory.filter(m=>m.role==='user'&&/fallo total/.test(m.content)).length,0,'the student\'s words reach the Tutor once (as the message), not twice')
  assert.equal(await count('bubble-user'),u,'no second student bubble')
})
await step('S3 reset clears IndexedDB; no cross-session leakage',async()=>{
  await page.getByRole('button',{name:'Reset'}).click(); await page.waitForTimeout(800)
  await page.reload({waitUntil:'domcontentloaded'})
  assert.equal(await page.getByTestId('quiz-block').count(),0)
})
await step('P1 no uncaught page errors',async()=>{assert.deepEqual(errors,[])})
await browser.close()
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2))
const failed=results.filter(r=>!r.pass); console.log(`\n${results.length-failed.length}/${results.length} passed`)
process.exit(failed.length?1:0)
