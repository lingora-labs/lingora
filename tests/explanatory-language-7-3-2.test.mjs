// 7.3.2: the Tutor declares its explanatory language; the runtime only remembers it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const root=new URL('../',import.meta.url).pathname
const {parseExplanatoryLanguage,SET_EXPLANATORY_LANGUAGE_TOOL}=require('../lib/explanatory-language.ts')
const {buildContextPack,formatContextPack}=require('../lib/context-pack.ts')

// Any language code is accepted; shape-only validation (no panel list, no words).
for(const ok of ['ar','zh','zh-Hans','no','tr','nl','pt-BR','fil','haw'])assert.equal(parseExplanatoryLanguage({language:ok}),ok)
for(const bad of ['','x','arabic language','12','ar_',null,{},{language:5}])assert.equal(parseExplanatoryLanguage(bad&&typeof bad==='object'&&'language' in bad?bad:{language:bad}),null)
assert.deepEqual(SET_EXPLANATORY_LANGUAGE_TOOL.function.parameters.required,['language'])

// ContextPack: declared language persists across a Spanish-practice turn; panel is only a default.
const declared=formatContextPack(buildContextPack({interfaceLanguage:'en',message:'Yo vivo en Madrid',explanatoryLanguage:'ar'}))
assert.match(declared,/explanatoryLanguage: ar/)
assert.match(declared,/Keep explaining in it, including when the student writes Spanish practice/)
const fresh=formatContextPack(buildContextPack({interfaceLanguage:'en',message:'hola'}))
assert.match(fresh,/explanatoryLanguage: not declared yet/)
assert.match(fresh,/ANY language you can write well, whether or not it appears in the UI picker/)

// Source barriers: no script detector, not required every turn, state carried.
const pack=fs.readFileSync(root+'lib/context-pack.ts','utf8')
assert.ok(!/detectScriptLanguage|withRecentScriptLanguage|SCRIPT_RANGES/.test(pack),'script detector must stay deleted')
const mentor=fs.readFileSync(root+'server/mentors/mentor-engine.ts','utf8')
assert.match(mentor,/tool_choice:wantsVisualReview\?'none':'auto'/)
assert.ok(!/withRecentScriptLanguage/.test(mentor))
const stream=fs.readFileSync(root+'server/core/execution-engine-stream.ts','utf8')
assert.ok(stream.includes('patch.explanatoryLanguage = stream.explanatoryLanguage'))
console.log('PASS 7.3.2 — explanatory language: Tutor-declared, any code, persisted, no detector')
