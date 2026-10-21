// 7.3.3f: Tutor memory = token-budget history window + typed notes the Tutor governs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const root=new URL('../',import.meta.url).pathname
const M=require('../lib/tutor-memory.ts')

// ── Window: budget, not count ────────────────────────────────────────────────────────────
const thread=Array.from({length:400},(_,i)=>({role:i%2?'assistant':'user',content:'mensaje '+i+' '+'x'.repeat(200)}))
const all=M.selectHistoryWindow(thread)
assert.equal(all.kept.length,400,'a 400-message thread that fits the budget is delivered whole (far beyond 16)')
assert.equal(all.dropped,0)
assert.equal(all.kept[0].content.startsWith('mensaje 0 '),true,'oldest message kept when it fits')
const small=M.selectHistoryWindow(thread,2000)
assert.ok(small.kept.length>0&&small.kept.length<400,'only a hard budget trims')
assert.equal(small.kept.at(-1).content,thread.at(-1).content,'trim is oldest-first; newest turn always present')
assert.equal(small.dropped,400-small.kept.length)
const huge=M.selectHistoryWindow([{role:'user',content:'a'.repeat(100000)}],10)
assert.equal(huge.kept.length,1,'the current message is never dropped')
assert.equal(huge.kept[0].content.length,M.HISTORY_MESSAGE_MAX_CHARS)

// ── Typed memory: shape validation ────────────────────────────────────────────────────────
assert.equal(M.UPDATE_STUDENT_MEMORY_TOOL.function.name,'update_student_memory')
assert.deepEqual(M.UPDATE_STUDENT_MEMORY_TOOL.function.parameters.required,['ops'])
assert.equal(M.parseMemoryOps(null),null)
assert.equal(M.parseMemoryOps({ops:[]}),null)
assert.equal(M.parseMemoryOps({ops:[{op:'remember'}]}),null,'empty note rejected')
assert.equal(M.parseMemoryOps({ops:[{op:'update',text:'x'}]}),null,'update needs an id')
assert.equal(M.parseMemoryOps({ops:[{op:'forget'}]}),null,'forget needs an id')
const ops=M.parseMemoryOps({ops:[{op:'remember',kind:'goal',text:'  DELE A2 en diciembre  '},{op:'remember',kind:'bogus',text:'Es médica'},{op:'remember',text:'z'.repeat(1000)}]})
assert.equal(ops.length,3)
assert.equal(ops[0].text,'DELE A2 en diciembre')
assert.equal(ops[1].kind,'fact','unknown kind falls back to fact')
assert.equal(ops[2].text.length,M.MEMORY_MAX_TEXT)

// ── Reducer: remember / update / forget with provenance ──────────────────────────────────────
const at='2026-10-22T00:00:00.000Z'
let mem=M.applyMemoryOps(undefined,ops.slice(0,2),3,at)
assert.deepEqual(mem.map(e=>e.id),['m1','m2'])
assert.equal(mem[0].learnedTurn,3);assert.equal(mem[0].at,at)
mem=M.applyMemoryOps(mem,[{op:'remember',kind:'goal',text:'dele a2 en diciembre'}],9,at)
assert.equal(mem.length,2,'duplicate text is not stored twice');assert.equal(mem[0].updatedTurn,9);assert.equal(mem[0].learnedTurn,3)
mem=M.applyMemoryOps(mem,[{op:'update',id:'m1',text:'DELE A2 el 14 de enero'}],12,at)
assert.equal(mem[0].text,'DELE A2 el 14 de enero');assert.equal(mem[0].learnedTurn,3);assert.equal(mem[0].updatedTurn,12)
mem=M.applyMemoryOps(mem,[{op:'forget',id:'m2'}],13,at)
assert.deepEqual(mem.map(e=>e.id),['m1'],'forget removes the note entirely')
mem=M.applyMemoryOps(mem,[{op:'remember',kind:'fact',text:'Vive en Oslo'}],14,at)
assert.equal(mem.at(-1).id,'m2','ids keep increasing from the highest in use')
let big=[]
for(let i=0;i<120;i++)big=M.applyMemoryOps(big,[{op:'remember',kind:'fact',text:'nota '+i}],i,at)
assert.equal(big.length,M.MEMORY_MAX_ENTRIES,'memory is bounded');assert.equal(big.at(-1).text,'nota 119','newest notes win over the oldest')
assert.deepEqual(M.sanitizeMemory('garbage'),[]);assert.deepEqual(M.sanitizeMemory([{id:'',text:'x'},null,{id:'a',text:''}]),[])

// ── Shown back to the Tutor ────────────────────────────────────────────────────────────
assert.equal(M.formatMemoryBlock(undefined),'')
const block=M.formatMemoryBlock(mem)
assert.match(block,/\[STUDENT MEMORY/);assert.match(block,/m1 \[goal, learned at exchange 3, updated 12\] DELE A2 el 14 de enero/)

// ── Wiring (structure, not strings alone: functional pieces are exercised above) ────────────────
const eng=fs.readFileSync(root+'server/mentors/mentor-engine.ts','utf8')
assert.match(eng,/UPDATE_STUDENT_MEMORY_TOOL\]/,'tool offered after the opening')
assert.match(eng,/formatMemoryBlock\(state\.tutorMemory\)/,'memory is part of the Tutor system prompt')
assert.match(eng,/selectHistoryWindow\(valid/,'server applies the token-budget window')
const stream=fs.readFileSync(root+'server/core/execution-engine-stream.ts','utf8')
assert.match(stream,/applyMemoryOps\(/,'memory ops become state patch')
const page=fs.readFileSync(root+'app/beta/use-beta-page.ts','utf8')
assert.ok(!/slice\(-16\)/.test(page),'client no longer cuts the thread to 16 messages')
assert.match(page,/selectHistoryWindow\(/)
console.log('PASS 7.3.3f — token-budget history window and Tutor-governed typed memory')
