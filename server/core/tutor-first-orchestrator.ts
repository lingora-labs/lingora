// LINGORA 7.1 — central execution authority for Tutor First.
//
// The orchestrator decides WHO executes, in which ORDER and WHY.
// It never writes student-facing content or chooses a pedagogical answer:
// the Tutor Maestro is the only cognitive author.
//
// Determinism: same message + normalized state + explicit UI action =>
// same plan. No clock, RNG, mutable process state, or LLM in plan selection.
// Manifesto 7.0 arts 47-52; ARCH-9.11 section 8.
import type { ExecutionPlan, SessionState } from '../../lib/contracts'
import { buildTutorFirstPlan } from './tutor-first-plan'
import { reconcileDocumentContract } from './document-contract'

export type RuntimeOperation = 'export_chat_pdf'|'download_pdf'|'hear_audio'|undefined
export interface RuntimePlanInput {
  message: string
  state: SessionState
  interfaceLanguage: string
  uiAction?: RuntimeOperation
}

function assertExecutionPlan(plan:ExecutionPlan):ExecutionPlan {
  if(!plan.reason?.trim() || !plan.executionOrder?.length) {
    throw new Error('orchestration invariant: no reason/order')
  }
  const ordered=plan.executionOrder.map(step=>step.order)
  if(ordered.some((n,i)=>n!==i+1) || new Set(ordered).size!==ordered.length) {
    throw new Error('orchestration invariant: non-sequential plan')
  }
  if(plan.blocking && plan.executionOrder.length!==1) {
    throw new Error('orchestration invariant: blocking plan must be atomic')
  }
  if(plan.executionOrder[0].executor!==plan.executor){
    throw new Error('orchestration invariant: executor mismatch')
  }
  return plan
}

export function orchestrateTutorFirst(input:RuntimePlanInput):ExecutionPlan {
  const {message,state,interfaceLanguage,uiAction}=input
  if(uiAction && !['export_chat_pdf','download_pdf','hear_audio'].includes(uiAction)) {
    throw new Error('orchestration invariant: unauthorized UI operation')
  }
  if(message.trim()==='*1357*#' || message.trim()==='*2468*#') {
    return assertExecutionPlan({
      executor:'diagnostic',priority:100,blocking:true,skipPhaseAdvance:true,
      pedagogicalAction:'diagnostic_assessment',artifacts:[],
      reason:'Explicit diagnostics command, no learning or file side effects.',
      executionOrder:[{order:1,executor:'diagnostic',action:message.trim()==='*1357*#'?'runtimeStatus':'runtimePlanAudit'}],
    })
  }
  if(uiAction==='export_chat_pdf') {
    return assertExecutionPlan({
      executor:'tool_pdf',priority:100,blocking:true,skipPhaseAdvance:true,
      pedagogicalAction:'export_chat_pdf',artifacts:['pdf_chat'],
      reason:'Explicit student chat-history export; tool executes existing conversation only, never asks tutor to recreate it.',
      executionOrder:[{order:1,executor:'tool_pdf',action:'exportChatPdf'}],
    })
  }
  if(uiAction==='download_pdf'||uiAction==='hear_audio'){
    // Direct tactile operations retain their existing tested tool
    // implementation in the adapter; the central plan authorizes WHO.
    return assertExecutionPlan({
      executor:uiAction==='download_pdf'?'tool_pdf':'tool_audio',
      priority:100,blocking:true,skipPhaseAdvance:true,
      pedagogicalAction:'export_artifact',artifacts:[uiAction==='download_pdf'?'pdf':'audio'],
      reason:'Explicit tactile operation on existing tutor-authored material, no independent cognitive generation.',
      executionOrder:[{
        order:1,executor:uiAction==='download_pdf'?'tool_pdf':'tool_audio',
        action:uiAction==='download_pdf'?'downloadMaterialPdf':'hearExistingMaterial',
      }],
    })
  }
  // All normal conversations are SINGLE-TUTOR — no distributed
  // intent router, commercial brain, model-derived arbitration or
  // hidden mode switch. Direct transformations are local constraints
  // applied by the tutor planner under central execution authority.
  const plan=buildTutorFirstPlan(message,state,interfaceLanguage)
  const contract=reconcileDocumentContract(message,state)
  if(contract.kind==='clear') {
    plan.clearDocumentContract=true
    plan.documentContractControlOnly=contract.reason.includes('withdrawal') ||
      contract.reason.includes('Expired')
    plan.reason+=' Contract cleared: '+contract.reason
  } else if(contract.next) {
    plan.documentContractUpdate=contract.next
    plan.documentContractReady=contract.kind==='ready'
    plan.documentContractControlOnly=contract.kind==='open'||contract.kind==='continue'
    if(contract.kind==='ready'){
      // Source of truth is the student's accumulated contract, not a fresh
      // keyword classification of a short continuation such as "A1, sobre ...".
      // The existing ContextPack is the interface to authoring depth;
      // no new model, no old generateCoursePdf brain, no lowered PDF threshold.
      const first=plan.executionOrder[0]
      const params=first.params??{}
      const pack=params.contextPack as Record<string,unknown>|undefined
      first.params={
        ...params,
        contextPack:pack?{...pack,
          artifactGoal:'emit_pdf',artifactAction:'author',
          artifactDepth:'comprehensive',activeFlowType:'course',
          domain:contract.next.topic,
        }:pack,
        outputBudget:8192,
      }
      if(plan.mentor)plan.mentor.directive='PDF_COURSE_DIRECTIVE'
      plan.priority=80
    }
    plan.reason+=' Contract state: '+contract.kind
  }
  return assertExecutionPlan(plan)
}
