// 7.4: Tutor memory = integral context budget + typed notes with stable ids the Tutor governs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const root=new URL('../',import.meta.url).pathname
const M=require('../lib/tutor-memory.ts')

// ── Window: budget, not count ────────────────────────────────────────────────────────────────────────────────────────
const thread=Array.from({length:400},(_,i)=>({role:i%2?'assistant':'user',content:'mensaje '+i+' '+'x'.repeat(200)}))
const all=M.selectHistoryWindow(thread)
assert.equal(all.kept.length,400,'a 400-message thread that fits the budget is delivered whole (far beyond 16)')
assert.equal(all.dropped,0);assert.equal(all.shortened,0)
assert.equal(all.kept[0].content.startsWith('mensaje 0 '),true)
const small=M.selectHistoryWindow(thread,2000)
assert.ok(small.kept.length>0&&small.kept.length<400)
assert.equal(small.kept.at(-1).content,thread.at(-1).content,'trim is oldest-first; newest turn present')
assert.equal(small.dropped,400-small.kept.length)
assert.ok(small.kept.every(m=>!m.content.includes('LINGORA omitted')),'whole messages are dropped, never silently cut')
// a long message that fits is NEVER altered (old 8k-char silent cut is gone)
const longMsg='y'.repeat(30000)
const keepLong=M.selectHistoryWindow([{role:'user',content:longMsg}])
assert.equal(keepLong.kept[0].content,longMsg,'long message under budget is delivered intact');assert.equal(keepLong.shortened,0)
// only a message bigger than the whole budget is shortened — visibly and counted
const huge=M.selectHistoryWindow([{role:'user',content:'a'.repeat(100000)}],3000)
assert.equal(huge.shortened,1);assert.match(huge.kept[0].content,/LINGORA omitted \d+ characters/)
assert.ok(M.estimateTokens(huge.kept[0].content)<=3100)
assert.equal(M.HISTORY_MESSAGE_MAX_CHARS,undefined,'no per-message char cap exported any more')

// ── Integral budget: history only gets what system+tools+memory+turn+reply leave ───────────────
const p1=M.planHistoryBudget({system:'s'.repeat(1000),tools:[],user:'hola'})
const p2=M.planHistoryBudget({system:'s'.repeat(100000),tools:[{a:'b'.repeat(5000)}],user:'hola'})
assert.ok(p2.fixedTokens>p1.fixedTokens&&p2.historyBudget<p1.historyBudget,'a bigger system/tools/memory shrinks the history budget')
assert.equal(p1.historyBudget+p1.fixedTokens,M.CONTEXT_TOKENS_DEFAULT,'budget is a complement of the fixed parts')
assert.ok(p1.fixedTokens>=M.OUTPUT_RESERVE_TOKENS,'the reply is reserved inside the budget')
assert.ok(M.planHistoryBudget({system:'s'.repeat(10_000_000),tools:[],user:''}).historyBudget>=M.HISTORY_MIN_TOKENS,'floor')
assert.equal(M.planHistoryBudget({system:'',tools:[],user:''},{cap:5000}).historyBudget,5000)
assert.equal(M.formatContextNote({dropped:0,shortened:0}),'')
assert.match(M.formatContextNote({dropped:3,shortened:0}),/3 earlier message\(s\)/)
assert.match(M.formatContextNote({dropped:0,shortened:1}),/shortened/)

// ── Typed memory: shape validation ───────────────────────────────────────────────────────────────────────────
assert.equal(M.UPDATE_STUDENT_MEMORY_TOOL.function.name,'update_student_memory')
assert.deepEqual(M.UPDATE_STUDENT_MEMORY_TOOL.function.parameters.required,['ops'])
assert.equal(M.parseMemoryOps(null),null)
assert.equal(M.parseMemoryOps({ops:[]}),null)
assert.equal(M.parseMemoryOps({ops:[{op:'remember'}]}),null)
assert.equal(M.parseMemoryOps({ops:[{op:'update',text:'x'}]}),null)
assert.equal(M.parseMemoryOps({ops:[{op:'forget'}]}),null)
const ops=M.parseMemoryOps({ops:[{op:'remember',kind:'goal',text:'  DELE A2 en diciembre  '},{op:'remember',kind:'bogus',text:'Es médica'},{op:'remember',text:'z'.repeat(1000)}]})
assert.equal(ops.length,3);assert.equal(ops[0].text,'DELE A2 en diciembre');assert.equal(ops[1].kind,'fact');assert.equal(ops[2].text.length,M.MEMORY_MAX_TEXT)

// ── Reducer: stable ids that are never reused ─────────────────────────────────────────────────────────────────────────────────
const at='2026-10-22T00:00:00.000Z'
let r=M.applyMemoryOps(undefined,ops.slice(0,2),3,at)
assert.deepEqual(r.entries.map(e=>e.id),['m1','m2']);assert.equal(r.seq,2)
assert.equal(r.entries[0].learnedTurn,3);assert.equal(r.entries[0].at,at)
r=M.applyMemoryOps(r.entries,[{op:'remember',kind:'goal',text:'dele a2 en diciembre'}],9,at,r.seq)
assert.equal(r.entries.length,2,'duplicate text not stored twice');assert.equal(r.entries[0].updatedTurn,9);assert.equal(r.entries[0].learnedTurn,3)
r=M.applyMemoryOps(r.entries,[{op:'update',id:'m1',text:'DELE A2 el 14 de enero'}],12,at,r.seq)
assert.equal(r.entries[0].text,'DELE A2 el 14 de enero');assert.equal(r.entries[0].updatedTurn,12)
// forget the HIGHEST id, then remember something new: the new note must NOT inherit m2
r=M.applyMemoryOps(r.entries,[{op:'forget',id:'m2'}],13,at,r.seq)
assert.deepEqual(r.entries.map(e=>e.id),['m1']);assert.equal(r.seq,2,'counter survives the forget')
r=M.applyMemoryOps(r.entries,[{op:'remember',kind:'fact',text:'Vive en Oslo'}],14,at,r.seq)
assert.equal(r.entries.at(-1).id,'m3','forgotten id m2 is never reissued')
assert.equal(r.seq,3)
// stale model reference to the old id must be reported, never hit the new note
const stale=M.applyMemoryOps(r.entries,[{op:'forget',id:'m2'},{op:'update',id:'m99',text:'x'}],15,at,r.seq)
assert.deepEqual(stale.rejected,['m2','m99']);assert.equal(stale.entries.length,2,'stale ids touch nothing')
// even if the persisted counter is lost, the highest live id still protects against reuse
assert.equal(M.applyMemoryOps(r.entries,[{op:'remember',kind:'fact',text:'otra'}],16,at).entries.at(-1).id,'m4')
assert.equal(M.sanitizeMemorySeq('x'),0);assert.equal(M.sanitizeMemorySeq(7.9),7)
// bounded, newest win, ids stay unique and monotonic through eviction
let big={entries:[],seq:0}
for(let i=0;i<120;i++)big=M.applyMemoryOps(big.entries,[{op:'remember',kind:'fact',text:'nota '+i}],i,at,big.seq)
assert.equal(big.entries.length,M.MEMORY_MAX_ENTRIES);assert.equal(big.entries.at(-1).text,'nota 119');assert.equal(big.seq,120)
assert.equal(new Set(big.entries.map(e=>e.id)).size,big.entries.length)
assert.deepEqual(M.sanitizeMemory('garbage'),[]);assert.deepEqual(M.sanitizeMemory([{id:'',text:'x'},null,{id:'a',text:''}]),[])
assert.equal(M.sanitizeMemory([{id:'a',text:'x'},{id:'a',text:'y'}]).length,1,'duplicate ids dropped on ingest')

// ── Shown back to the Tutor ────────────────────────────────────────────────────────────────────────────────
assert.equal(M.formatMemoryBlock(undefined),'')
const block=M.formatMemoryBlock(r.entries)
assert.match(block,/\[STUDENT MEMORY/);assert.match(block,/m1 \[goal, learned at exchange 3, updated 12\] DELE A2 el 14 de enero/)

// ── Wiring: every user-reachable route, typed contract, no silent cut ────────────────────────────────────────────────────────────────────────────────────────
const eng=fs.readFileSync(root+'server/mentors/mentor-engine.ts','utf8')
assert.match(eng,/UPDATE_STUDENT_MEMORY_TOOL\]/);assert.match(eng,/formatMemoryBlock\(state\.tutorMemory\)/)
assert.match(eng,/planHistoryBudget\(/,'integral budget used by the engine');assert.match(eng,/formatContextNote\(/,'Tutor is told when context was trimmed')
assert.ok(!/HISTORY_MESSAGE_MAX_CHARS/.test(eng),'no leftover silent caps')
const stream=fs.readFileSync(root+'server/core/execution-engine-stream.ts','utf8')
assert.match(stream,/applyMemoryOps\(/);assert.match(stream,/tutorMemorySeq/)
const contracts=fs.readFileSync(root+'lib/contracts.ts','utf8')
assert.match(contracts,/tutorMemory\?:/,'tutorMemory is in the typed SessionState');assert.match(contracts,/tutorMemorySeq\?:/)
const entry=fs.readFileSync(root+'server/api/chat-entry.ts','utf8')
assert.match(entry,/sanitizeMemory\(incomingState\.tutorMemory\)/,'client memory is validated on entry')
assert.match(entry,/buildJsonFromStream/,'non-streaming route runs the SAME engine (parity)')
const page=fs.readFileSync(root+'app/beta/use-beta-page.ts','utf8')
assert.ok(!/slice\(-16\)/.test(page));assert.match(page,/buildConversationRequest\(/);assert.match(fs.readFileSync(root+'lib/space/retrieve.ts','utf8'),/selectHistoryWindow\(/)
const model=fs.readFileSync(root+'app/beta/beta-model.ts','utf8')
assert.match(model,/tutorMemory\?:/);assert.match(model,/tutorMemorySeq\?:/)
console.log('PASS 7.4 — integral context budget, stable memory ids, typed contract, route parity')
