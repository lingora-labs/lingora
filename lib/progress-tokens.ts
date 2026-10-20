// Manifiesto arts. 25–27: keep ONE balance (state.tokens).
// Credit only observable evidence, deduplicated with IDs, not a new counter.
import type { SessionState, ChatRequest } from './contracts'
import { normalizeQuizEvidence } from './quiz-evidence'
const day=(t:number)=>new Date(t).toISOString().slice(0,10)
const hash=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(36)}
export function creditLearningProgress(state:Partial<SessionState>,request:Pick<ChatRequest,'message'>,now=Date.now()){
 const previous=Math.max(0,Math.trunc(state.tokens??0))
 const ids=new Set((state.progressCredits??[]).filter(x=>typeof x==='string').slice(-80))
 let earned=request.message.trim()?1:0 // message sent
 const add=(id:string)=>{if(!ids.has(id)){ids.add(id);earned++}}
 const quiz=normalizeQuizEvidence(state.quizEvidence)
 if(quiz&&quiz.correctCount>0&&request.message.startsWith('He completado el quiz:')){
   add('applied-correction:'+hash(JSON.stringify(quiz.responses.map(r=>[r.question,r.chosen,r.correct]))))
 }
 const samples=Math.max(0,Math.trunc(state.diagnosticSamples??0))
 if(samples>0)add('diagnostic:'+samples)
 if(state.confirmedLevel&&samples>0)add('confirmed-level:'+state.confirmedLevel)
 const previousVisit=state.engagement?.lastActive??0
 if(previousVisit>0&&day(previousVisit)!==day(now)&&now-previousVisit<7*86400000)add('consistent-use:'+day(now))
 const tokens=previous+earned
 return {
   tokens,progressCredits:[...ids].slice(-80),earned,
   hitFive:Math.floor(tokens/5)>Math.floor(previous/5),
   engagement:{
     streak:previousVisit>0&&day(previousVisit)!==day(now)?(state.engagement?.streak??0)+1:Math.max(1,state.engagement?.streak??0),
     lastActive:now,completedModules:state.engagement?.completedModules??[],totalTokens:tokens,
   },
 }
}
