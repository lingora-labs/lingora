// LINGORA 7.5 — export E2E without model/API spend.
// This test runs the real Next route and real Chromium UI against a synthetic
// same-browser session. No prompt to Willy, no OpenAI credentials.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { PDFDocument } from 'pdf-lib'

const port = Number(process.env.LINGORA_E2E_PORT || 3100)
const out = resolve('t7-evidence')
mkdirSync(out, { recursive: true })
const URL = 'http://127.0.0.1:' + port + '/beta'
const errors = []
const requests = []
let browser
const ts = Date.now()
const START = 'LINGORA-T7-START-70931'
const END = 'LINGORA-T7-END-70931'
const table = '| Mes | Ocupación |\n|---|---:|\n| Enero | 73 |\n| Febrero | 82 |'
const seed = {
  version:1, phase:'chat', lang:'es', mentor:'alex', topic:'conversation',
  activeMode:'interact', reduced:false,
  session:{
    lang:'es', mentor:'alex',topic:'conversation',level:'A0',
    tokens:4,samples:[],sessionId:'t7-e2e-'+ts,commercialOffers:[],
    lastTask:null,lastArtifact:null,activeMode:'interact'
  },
  msgs:[
    {id:'t7-user',sender:'user',text:START+' Solicito una comparación de ocupación hotelera en español.',complete:true},
    {id:'t7-alex',sender:'alex',text:'# Informe hotelero\n\nDatos de ocupación:\n\n'+table+'\n\nEste material sirve para comparar dos meses.',complete:true,
     artifacts:[{type:'table_matrix',content:{
       title:'Ocupación por mes',
       columns:['Mes','Ocupación'],
       rows:[['Enero', '73'],['Febrero','82']]
     }}]},
    {id:'t7-user2',sender:'user',text:'Confirma que la exportación incluye también el final del historial.',complete:true},
    {id:'t7-alex2',sender:'alex',text:'Confirmado: '+END+'.\n\nLa ocupación de febrero es superior a enero.',complete:true}
  ]
}
async function putSnapshot(page) {
  await page.evaluate(async value => {
    const db = await new Promise((resolve,reject)=>{
      const r=indexedDB.open('lingora-beta-v1',1)
      r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('sessions'))r.result.createObjectStore('sessions')}
      r.onsuccess=()=>resolve(r.result)
      r.onerror=()=>reject(r.error)
    })
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('sessions','readwrite')
      tx.objectStore('sessions').put(value,'current')
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(tx.error)
    })
    db.close()
  }, seed)
}
async function clickExact(page, label) {
  const rect = await page.evaluate(text => {
    const list=[...document.querySelectorAll('button')]
    const button=list.find(b=>b.textContent.trim()===text)
    if(!button) return null
    const box=button.getBoundingClientRect()
    return {x:box.x+box.width/2,y:box.y+box.height/2,visible:box.width>0&&box.height>0}
  },label)
  assert.ok(rect?.visible,'Visible button missing: '+label)
  await page.mouse.click(rect.x,rect.y)
}
try {
  browser = await puppeteer.launch({args:chromium.args, executablePath:await chromium.executablePath(),headless:true})
  const page=await browser.newPage()
  await page.setViewport({width:1200,height:850,deviceScaleFactor:1})
  page.setDefaultTimeout(45000)
  const cdp = await page.createCDPSession()
  await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:out})
  page.on('console',msg=>{if(msg.type()==='error')errors.push('console: '+msg.text())})
  page.on('response',res=>{if(res.url().includes('/api/chat')&&requests.length) requests[requests.length-1].status=res.status()})
  page.on('pageerror',err=>errors.push('pageerror: '+err.message))
  page.on('request',req=>{
    if(req.url().includes('/api/chat')){
      const payload=JSON.parse(req.postData()??'{}')
      requests.push({url:req.url(),method:req.method(),uiAction:payload.uiAction,turns:payload.exportTurns?.length||0})
    }
  })
  await page.goto(URL,{waitUntil:'domcontentloaded',timeout:90000})
  await new Promise(resolve=>setTimeout(resolve,1500))
  await putSnapshot(page)
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction((term)=>document.body.innerText.includes(term),{timeout:45000},START)
  await page.screenshot({path:out+'/01-session-restored.png'})
  // This is the mistake Work previously made: Export is only a menu toggle.
  await clickExact(page,'Export')
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Exportar PDF'))
  await page.screenshot({path:out+'/02-export-menu.png'})
  // The actual user action:
  await clickExact(page,'Exportar PDF')
  await page.waitForFunction(()=>document.body.innerText.includes('PDF verificado') ||
    document.body.innerText.includes('PDF descargado') ||
    document.body.innerText.includes('No se generó') ||
    document.body.innerText.includes('Error del servidor') ||
    document.body.innerText.includes('No fue posible descargar'),{timeout:150000})
  const status = await page.evaluate(()=>document.body.innerText.slice(-2000))
  await page.screenshot({path:out+'/03-after-export.png'})
  writeFileSync(out+'/04-network.json',JSON.stringify(requests,null,2))
  writeFileSync(out+'/05-browser-errors.json',JSON.stringify(errors,null,2))
  assert.equal(requests.length,1,'Exactly one /api/chat call (no Willy invocation)')
  assert.equal(requests[0].uiAction,'export_chat_pdf')
  assert.equal(requests[0].status,200,'Export must return HTTP 200')
  assert.equal(requests[0].turns,4)
  assert.ok(status.includes('PDF verificado') || status.includes('PDF descargado'),
    'PDF archive status unexpected: '+status.slice(-400))
  let pdfPath
  for(let attempt=0;attempt<30;attempt++){
    pdfPath=readdirSync(out).find(f=>/^lingora-session-.+\.pdf$/.test(f))
    if(pdfPath)break
    await new Promise(resolve=>setTimeout(resolve,1000))
  }
  assert.ok(pdfPath,'Real browser download missing')
  const pdf=readFileSync(out+'/'+pdfPath)
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-')
  assert.ok(pdf.length>1000,'PDF content too small')
  const parsed=await PDFDocument.load(pdf)
  assert.ok(parsed.getPageCount()>=1)
  const result={kind:'ui-real-browser-export-no-provider',status:'PASS',
    sourceCommit:process.env.LINGORA_SOURCE_SHA || '0fcb602d8a64b0e2eedc2c12a1aa1dca3ceb238b',
    uiButtons:['Export','Exportar PDF'],httpCalls:requests,pdf:pdfPath,
    bytes:pdf.length,pages:parsed.getPageCount(),browserErrors:errors,
    contentMarkers:[START,END],downloaded:true}
  writeFileSync(out+'/RESULT.json',JSON.stringify(result,null,2))
  console.log('PASS — menu→PDF, /api/chat one export only, real browser PDF '+pdf.length+' bytes, '+parsed.getPageCount()+' pages')
} catch (e) {
  const result={status:'FAIL',error:String(e?.stack||e),httpCalls:requests,browserErrors:errors}
  writeFileSync(out+'/RESULT.json',JSON.stringify(result,null,2))
  console.error('FAIL — '+String(e?.stack||e))
  process.exitCode=1
} finally {if(browser)await browser.close()}
