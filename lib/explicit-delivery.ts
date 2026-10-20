// Post-answer contractual verification, never a cognitive intent router.
// An LLM may reply freely; unmaterialized explicit deliverables are visible.
import type { ArtifactPayload, SessionState, ExecutionPlan } from './contracts'
import {isExplicitPdfRequest,isPdfAndWebRequest} from './pdf-intent-authorization'
import {isExplicitQuizRequest} from './quiz-intent-guard'
import {isExplicitImageRequest} from '../server/core/artifact-side-effect'
export function unfulfilledExplicitDeliverables(
 message:string,state:SessionState,plan:ExecutionPlan,artifacts:ArtifactPayload[],failures:Array<{subject:string}>
):Array<{subject:string}>{
 const missing:Array<{subject:string}>=[]
 const has=(type:string)=>artifacts.some(a=>a.type===type||(type==='pdf'&&a.type==='course_pdf'))
 const report=(condition:boolean,type:string,subject:string)=>{
   if(condition&&!has(type)&&!failures.some(f=>f.subject.includes(subject)))missing.push({subject})
 }
 report(isExplicitPdfRequest(message,state.activeMode)||Boolean(plan.documentContractReady),'pdf','PDF solicitado')
 report(isExplicitQuizRequest(message),'quiz','Quiz táctil solicitado')
 report(isExplicitImageRequest(message),'illustration','Imagen solicitada')
 report(/(?:crea|crear|haz|genera|create|make|show)\b[^.!?]{0,120}\b(?:esquema visual|visual schema|diagrama interactivo)/iu.test(message),'schema_pro','Esquema visual solicitado')
 if(isPdfAndWebRequest(message)&&has('pdf')&&!artifacts.some(a=>a.type==='pdf'&&typeof (a as {webUrl?:string}).webUrl==='string'))missing.push({subject:'Versión HTML solicitada'})
 return missing
}
