// LINGORA 7.1 — INSTRUMENTAL execution plan for Tutor First.
//
// Constitution 7.1 (arts. 47-52, reformed): the Tutor Maestro (Alex, Sarah or
// Nick) is the sole cognitive authority; it interprets the student's intent from
// the first turn. This module has NO conversational sovereignty: it never reads
// the meaning of a message, never chooses a pedagogical answer and never
// reclassifies intent. It only (a) authorizes explicit UI operations and
// diagnostics, (b) hands every conversational turn to the Tutor, and (c) checks
// the plan's structural invariants (order, atomicity, executor).
//
// Determinism: same message + normalized state + explicit UI action =>
// same plan. No clock, RNG, mutable process state, or LLM in plan selection.
// Manifesto 7.0 as reformed by 7.1 (conciliated, approved 16 Oct 2026): arts. 47-52.
import type { ExecutionPlan, SessionState } from '../../lib/contracts'
import { buildTutorFirstPlan } from './tutor-first-plan'

export type RuntimeOperation = 'export_chat_pdf'|'download_pdf'|'hear_audio'|'create_visual_review'|undefined
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
  if(uiAction && !['export_chat_pdf','download_pdf','hear_audio','create_visual_review'].includes(uiAction)) {
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
    // implementation in the adapter; the plan only authorizes the instrument.
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
  // hidden mode switch. The Tutor reads the intent; nothing here does.
  const plan=buildTutorFirstPlan(message,state,interfaceLanguage)
  // A stale document request from an earlier build never gates anything now:
  // the Tutor decides, so any pending contract is simply cleared.
  if(state.pendingDocumentRequest)plan.clearDocumentContract=true
  return assertExecutionPlan(plan)
}
