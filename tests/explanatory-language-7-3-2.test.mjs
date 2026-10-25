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
// 7.5 P1-A: a declared language supersedes the selection only when the student asked for it (source).
const dp=buildContextPack({interfaceLanguage:'es',message:'Yo vivo en Madrid',explanatoryLanguage:'ar',explanatoryLanguageSource:'student_request'})
for(const opening of [false,true]){
  const declared=formatContextPack(dp,{opening})
  assert.match(declared,/explanatoryLanguage: ar/)
  assert.ok(!/interfaceLanguage/.test(declared),'declared language must not coexist with the UI default')
}
const note=formatLanguageTurnNote(dp)
assert.match(note,/explanatoryLanguage = "ar"/)
assert.match(note,/even though the student's message above may be Spanish practice/)

// 7.3.3b: opening greeting = one voice, defined only in the language note. Spanish protagonist,
// the selected language in italics below; Spanish alone for Spanish; English alone for OTHER.
const fresh=buildContextPack({interfaceLanguage:'no',message:'x'})
const bi=formatLanguageTurnNote(fresh,{opening:true})
assert.match(bi,/first the greeting in Spanish/)
assert.match(bi,/same greeting in "no"/)
assert.match(bi,/single asterisks for italics/)
assert.match(formatLanguageTurnNote(buildContextPack({interfaceLanguage:'es',message:'x'}),{opening:true}),/ONLY in Spanish/)
const other=formatLanguageTurnNote(fresh,{opening:true,other:true})
assert.match(other,/ONLY in English/)
assert.match(other,/any language they like/)
assert.ok(!/"no"/.test(other),'OTHER must not mention a panel language')
assert.ok(!/interfaceLanguage/.test(formatContextPack(fresh,{opening:true})),'the pack carries no second language statement')
const afterWrite=formatContextPack(fresh,{opening:false})
assert.ok(!/interfaceLanguage/.test(afterWrite),'once the student writes, the UI default has no voice')
// 7.5 P1-A: after the greeting the selected language binds (it is the session's explanatoryLanguage);
// only OTROS leaves the language open for the Tutor to settle.
const freshNote=formatLanguageTurnNote(fresh,{opening:false})
assert.match(freshNote,/explanatoryLanguage = "no" \(the student selected it\)/)
assert.match(freshNote,/changes only if the student explicitly asks/)
const otherNote=formatLanguageTurnNote(buildContextPack({interfaceLanguage:'en',uiLanguageChoice:'other',message:'x'}),{opening:false})
assert.ok(!/interfaceLanguage|"en"/.test(otherNote),'OTROS note must not mention a panel language')
assert.match(otherNote,/any language you can write well/)
assert.match(otherNote,/call set_explanatory_language once/)

// Source barriers: no script detector, not required every turn, state carried.
const pack=fs.readFileSync(root+'lib/context-pack.ts','utf8')
assert.ok(!/detectScriptLanguage|withRecentScriptLanguage|SCRIPT_RANGES/.test(pack),'script detector must stay deleted')
const mentor=fs.readFileSync(root+'server/mentors/mentor-engine.ts','utf8')
assert.match(mentor,/tool_choice:wantsVisualReview\?'none':'auto'/)
assert.ok(!/withRecentScriptLanguage/.test(mentor))
assert.match(mentor,/role:'system',content:languageNote\}/,'language note must sit adjacent to the user turn in the stream path')
assert.match(mentor,/role:\s*'system',\s*content:\s*languageNote/)
const stream=fs.readFileSync(root+'server/core/execution-engine-stream.ts','utf8')
assert.ok(stream.includes('patch.explanatoryLanguage = stream.explanatoryLanguage'))
console.log('PASS 7.3.2 — explanatory language: Tutor-declared, any code, persisted, no detector')

// 7.3.2b: the persona must not contain a competing, higher-ranked language rule.
const profiles=fs.readFileSync(root+'server/mentors/profiles.ts','utf8')
assert.ok(!/van en interfaceLanguage/.test(profiles),'persona must not bind explanations to interfaceLanguage')
assert.match(profiles,/CONTRATO DE IDIOMA \(7\.3\.2/)
assert.match(profiles,/NO cambia el idioma de tus explicaciones/)
const art=fs.readFileSync(root+'lib/artifact-signal.ts','utf8')
assert.ok(!/Do not call any tool for simple conversation/.test(art),'closure contract must not forbid the one language call')
assert.match(art,/the one exception is set_explanatory_language/)
assert.match(mentor,/\[tutor-language\]/,'bounded language observability must exist')
console.log('PASS 7.3.2b — persona language contract agrees with explanatoryLanguage')

// 7.3.2d: the continuation after a language declaration must carry the declared language itself.
assert.ok(mentor.includes('Language recorded: ${declared}'),'continuation tool result must restate the declared language')
assert.ok(!/Language recorded\. Now write/.test(mentor),'generic language-free tool result must be gone')
console.log('PASS 7.3.2d — continuation carries the declared language')

// 7.3.3: the Tutor opens the session itself (streamed), and OTROS exists in the language panel.
const hook=fs.readFileSync(root+'app/beta/use-beta-page.ts','utf8')
const view=fs.readFileSync(root+'app/beta/beta-page-view.tsx','utf8')
const sel=hook.slice(hook.indexOf('const selectMode'),hook.indexOf('const resetChat'))
assert.match(sel,/callAPI\(\{ message: '' \}\)/,'the opening is a streamed Tutor turn, not a static message')
assert.match(sel,/lastCallFailedRef\.current/,'static welcome is only a failure fallback')
assert.ok(sel.indexOf("callAPI({ message: '' })")<sel.indexOf('GREETINGS['),'static greeting must come after the streamed opening attempt')
assert.match(view,/OTROS/,'language panel offers OTROS')
assert.match(view,/pickOther\(\)/)
assert.match(hook,/uiLanguageChoice: otherRef\.current \? 'other' : undefined/)
assert.match(mentor,/other: state\.uiLanguageChoice === 'other'/,'OTROS shapes only the opening note')
assert.ok(!/Student interface language/.test(mentor),'no second interface-language voice')
assert.match(mentor,/n\.opening\?\[COMPLETE_TUTOR_TURN_TOOL,DELIVER_FROM_TEXT_TOOL\]/,'the opening settles no language')
assert.ok(!/about today in Spanish/.test(mentor),'first-turn directive must not fix the greeting language')
console.log('PASS 7.3.3 — streamed Tutor opening + OTROS')

// 7.3.3e: model parameters for the validated tutor contract (functional, runs the real function).
{
  const src = mentor.slice(mentor.indexOf('export function buildModelParams'), mentor.indexOf('/** 7.3: one Tutor, typed tools.'))
  const js = ts.transpileModule(src.replace('export function', 'function'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const buildModelParams = new Function(js + '\nreturn buildModelParams')()
  for (const m of ['gpt-5.6-sol', 'gpt-5.4', 'gpt-5.4-mini']) {
    assert.deepEqual(buildModelParams(m, 8192, 0.7, 0.88), { model: m, max_completion_tokens: 8192, reasoning_effort: 'none', temperature: 0.7 }, m)
  }
  assert.deepEqual(buildModelParams('gpt-5', 100, 0.3), { model: 'gpt-5', max_completion_tokens: 100, temperature: 0.3 }, 'original gpt-5 has no "none" effort')
  assert.deepEqual(buildModelParams('gpt-4o-mini', 100, 0.7, 0.88), { model: 'gpt-4o-mini', max_tokens: 100, temperature: 0.7, top_p: 0.88 })
  assert.match(mentor, /served/, 'effective model served by the provider is logged')
  assert.ok(!/diag-battery|_lx|ALLOWED_MODELS|lxModel/.test(mentor), 'no experimental switch in the candidate')
  console.log('PASS 7.3.3e — model parameters (reasoning_effort=none, temperature 0.7) and clean candidate')
}
