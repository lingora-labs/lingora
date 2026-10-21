// 7.3.2: the Tutor declares its explanatory language; the runtime only remembers it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const root=new URL('../',import.meta.url).pathname
const {parseExplanatoryLanguage,SET_EXPLANATORY_LANGUAGE_TOOL}=require('../lib/explanatory-language.ts')
const {buildContextPack,formatContextPack,formatLanguageTurnNote}=require('../lib/context-pack.ts')

// Any language code is accepted; shape-only validation (no panel list, no words).
for(const ok of ['ar','zh','zh-Hans','no','tr','nl','pt-BR','fil','haw'])assert.equal(parseExplanatoryLanguage({language:ok}),ok)
for(const bad of ['','x','arabic language','12','ar_',null,{},{language:5}])assert.equal(parseExplanatoryLanguage(bad&&typeof bad==='object'&&'language' in bad?bad:{language:bad}),null)
assert.deepEqual(SET_EXPLANATORY_LANGUAGE_TOOL.function.parameters.required,['language'])

// Declared language persists across a Spanish-practice turn; the UI default is superseded and not shown.
const dp=buildContextPack({interfaceLanguage:'es',message:'Yo vivo en Madrid',explanatoryLanguage:'ar'})
const declared=formatContextPack(dp)
assert.match(declared,/explanatoryLanguage: ar/)
assert.ok(!/interfaceLanguage:/.test(declared),'declared language must not coexist with the UI default')
const note=formatLanguageTurnNote(dp)
assert.match(note,/explanatoryLanguage = "ar"/)
assert.match(note,/even though the student's message below may be Spanish practice/)
const fresh=buildContextPack({interfaceLanguage:'en',message:'hola'})
assert.match(formatContextPack(fresh),/interfaceLanguage: en/)
assert.match(formatLanguageTurnNote(fresh),/ANY language you can write well, whether or not it appears in the UI picker/)

// Source barriers: no script detector, not required every turn, state carried.
const pack=fs.readFileSync(root+'lib/context-pack.ts','utf8')
assert.ok(!/detectScriptLanguage|withRecentScriptLanguage|SCRIPT_RANGES/.test(pack),'script detector must stay deleted')
const mentor=fs.readFileSync(root+'server/mentors/mentor-engine.ts','utf8')
assert.match(mentor,/tool_choice:wantsVisualReview\?'none':'auto'/)
assert.ok(!/withRecentScriptLanguage/.test(mentor))
assert.match(mentor,/role:'system',content:languageNote\}/,'language note must sit adjacent to the user turn in the stream path')
assert.match(mentor,/role: 'system', content: languageNote/)
const stream=fs.readFileSync(root+'server/core/execution-engine-stream.ts','utf8')
assert.ok(stream.includes('patch.explanatoryLanguage = stream.explanatoryLanguage'))
console.log('PASS 7.3.2 — explanatory language: Tutor-declared, any code, persisted, no detector')

// 7.3.2b: the persona must not contain a competing, higher-ranked language rule.
const profiles=fs.readFileSync(root+'server/mentors/profiles.ts','utf8')
assert.ok(!/van en interfaceLanguage/.test(profiles),'persona must not bind explanations to interfaceLanguage')
assert.match(profiles,/CONTRATO DE IDIOMA \(7\.3\.2/)
assert.match(profiles,/NO cambia el idioma de tus explicaciones/)
console.log('PASS 7.3.2b — persona language contract agrees with explanatoryLanguage')
