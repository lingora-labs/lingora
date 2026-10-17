// FIELD QA14 regression: no green check for a grammatically impossible key.
// Usage: node tests/quiz-answer-key.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import ts from 'typescript'
const require = createRequire(import.meta.url)
require.extensions['.ts'] = (mod, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText
  mod._compile(output,filename)
}
const { validateQuizAnswerKey } = require('../lib/quiz-answer-key.ts')
const { materializeNativeArtifact } = require('../server/core/native-artifact.ts')
const question = (q,options,correct) => ({question:q,options,correct,explanation:'Explicación didáctica suficiente.'})
const check = (q,opts,index) => validateQuizAnswerKey([question(q,opts,index)]).ok
assert.equal(check('María ___ en casa',['ser','estar','es'],1),false,'QA14: lemma estar cannot complete finite clause')
assert.equal(check('María ___ en casa',['es','está','son'],1),true,'inflected location is correct')
assert.equal(check('María ___ en casa',['es','está','son'],0),false,'ser cannot mark a persons location')
assert.equal(check('Madrid ___ en España',['es','está'],0),false,'place location uses estar')
assert.equal(check('Madrid ___ en España',['es','está'],1),true)
assert.equal(check('María ___ cansada hoy',['es','está'],0),false,'temporary state demands estar')
assert.equal(check('María ___ cansada hoy',['es','está'],1),true)
assert.equal(check('Nosotros ___ de Argentina',['somos','estamos','son'],0),true)
assert.equal(check('Nosotros ___ de Argentina',['somos','estamos','son'],2),false,'person agreement')
assert.equal(check('Él ___ en casa',['es','está'],1),true,'accented subject')
assert.equal(check('Él ___ en casa',['es','está'],0),false)
assert.equal(check('Mi hermano ___ muy simpático',['estar','es','está'],1),true)
assert.equal(check('Yo quiero ___ en casa',['ser','estar','estoy'],1),true,'licensed infinitive should not be rejected')
assert.equal(check('La boda ___ en Madrid',['es','está','somos'],0),true,'events legitimately use ser en')
assert.equal(check('El cielo ___ azul',['es','está','somos'],0),true,'identity-like trait remains allowed')
assert.equal(check('En 2020 España ___ un país...',['era','estaba'],0),true,'unsupported tense should not be falsely rejected')
assert.equal(check('María ___ en casa',['está','está','es'],0),false,'duplicate options')
assert.equal(check('La capital de Francia es ___',['París','Roma'],0),true,'general knowledge unaffected')
const bad = {
  type:'quiz',trigger:'explicit_user_request',format:'native',subject:'SER y ESTAR',
  content:{title:'QA14',questions:[
    question('María ___ en casa',['ser','estar','es'],1),
    question('Mi hermano ___ muy simpático',['estar','es','está'],1),
  ]},
}
assert.equal(materializeNativeArtifact(bad),null,'runtime must never score an ungrammatical key')
const good = {
  ...bad,content:{...bad.content,questions:[
    question('María ___ en casa',['ser','está','es'],1),
    question('Mi hermano ___ muy simpático',['estar','es','está'],1),
  ]},
}
assert.equal(materializeNativeArtifact(good)?.type,'quiz','valid quiz remains materialized')
const source = fs.readFileSync(require.resolve('../app/beta/beta-schema-a.tsx'),'utf8')
assert.ok(source.includes('validateQuizAnswerKey(quiz)'),'client must protect earlier persisted quizzes')
console.log('PASS — QA14 invalid keys blocked before grading in runtime and persisted UI')
